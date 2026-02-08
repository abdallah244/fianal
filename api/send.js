function getEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
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
    if (req.method !== "POST") {
      res.setHeader("Allow", "POST");
      res.status(405).send("Method Not Allowed");
      return;
    }

    let body = req.body;
    if (!body || typeof body === "string") {
      const raw = typeof body === "string" ? body : await readRawBody(req);
      body = raw ? JSON.parse(raw) : {};
    }

    const to = body.to;
    const text = body.text;
    const replyToMessageId = body.replyToMessageId;

    if (!to || !text) {
      res.status(400).json({ ok: false, error: "Required: { to, text }" });
      return;
    }

    const result = await sendWhatsAppText({ to, text, replyToMessageId });
    res.status(200).json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
};
