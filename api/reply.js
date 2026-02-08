const connectMongo = require("../lib/mongo");
const Message = require("../lib/Message");
const { requireAdmin } = require("../lib/auth");

function getEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
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
    throw new Error(msg);
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

    if (!requireAdmin(req)) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    const body =
      typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
    const { messageIds, text } = body;

    if (!Array.isArray(messageIds) || messageIds.length === 0 || !text) {
      res
        .status(400)
        .json({
          ok: false,
          error: "Required: { messageIds: string[], text: string }",
        });
      return;
    }

    await connectMongo();

    const messages = await Message.find({ _id: { $in: messageIds } });
    if (messages.length === 0) {
      res.status(404).json({ ok: false, error: "No messages found" });
      return;
    }

    const results = [];
    for (const msg of messages) {
      const to = msg.from;
      const waResp = await sendWhatsAppText({
        to,
        text,
        replyToMessageId: msg.waMessageId,
      });

      msg.status = "replied";
      msg.replyText = text;
      msg.repliedAt = new Date();
      await msg.save();

      results.push({ id: String(msg._id), ok: true, wa: waResp });
    }

    res.status(200).json({ ok: true, count: results.length, results });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
};
