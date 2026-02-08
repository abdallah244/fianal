const crypto = require("crypto");

function getEnv(name, { required = true } = {}) {
  const value = process.env[name];
  if (required && (!value || !String(value).trim())) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function safeEqual(a, b) {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

async function readRawBody(req) {
  return await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function verifyMetaSignature({ rawBody, signatureHeader, appSecret }) {
  if (!appSecret) return true; // optional
  if (!signatureHeader) return false;

  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  return safeEqual(expected, signatureHeader);
}

async function sendWhatsAppText({ to, text, replyToMessageId }) {
  const token = getEnv("WHATSAPP_TOKEN");
  const phoneNumberId = getEnv("WHATSAPP_PHONE_NUMBER_ID");

  const payload = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: text },
  };

  if (replyToMessageId) {
    payload.context = { message_id: replyToMessageId };
  }

  const resp = await fetch(
    `https://graph.facebook.com/v20.0/${phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    },
  );

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const msg = data?.error?.message || `WhatsApp API error (${resp.status})`;
    const details = data?.error
      ? JSON.stringify(data.error)
      : JSON.stringify(data);
    throw new Error(`${msg}: ${details}`);
  }

  return data;
}

module.exports = async (req, res) => {
  try {
    if (req.method === "GET") {
      const mode = req.query["hub.mode"];
      const token = req.query["hub.verify_token"];
      const challenge = req.query["hub.challenge"];

      if (mode === "subscribe" && token === getEnv("WHATSAPP_VERIFY_TOKEN")) {
        res.status(200).send(challenge);
        return;
      }

      res.status(403).send("Forbidden");
      return;
    }

    if (req.method !== "POST") {
      res.setHeader("Allow", "GET, POST");
      res.status(405).send("Method Not Allowed");
      return;
    }

    const rawBody = await readRawBody(req);

    const appSecret = process.env.META_APP_SECRET || process.env.APP_SECRET; // optional
    const signatureHeader = req.headers["x-hub-signature-256"];

    if (!verifyMetaSignature({ rawBody, signatureHeader, appSecret })) {
      res.status(401).send("Invalid signature");
      return;
    }

    const body = rawBody ? JSON.parse(rawBody) : {};

    // Process webhook payload (may contain multiple entries/changes/messages)
    const entries = Array.isArray(body?.entry) ? body.entry : [];
    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        const value = change?.value;
        const messages = Array.isArray(value?.messages) ? value.messages : [];
        for (const message of messages) {
          const from = message?.from;
          if (!from) continue;

          const textBody = message?.text?.body;
          const replyText = textBody
            ? `تم الاستلام: ${textBody}`
            : "تم الاستلام.";

          await sendWhatsAppText({
            to: from,
            text: replyText,
            replyToMessageId: message?.id,
          });
        }
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    // If we already responded, nothing else we can do
    try {
      if (!res.headersSent) {
        res
          .status(500)
          .json({ ok: false, error: err?.message || "Server error" });
      }
    } catch (_) {
      // ignore
    }
  }
};
