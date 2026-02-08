require("dotenv").config();

const crypto = require("crypto");
const http = require("http");
const path = require("path");

const express = require("express");
const mongoose = require("mongoose");
const { Server } = require("socket.io");

function getEnv(name, { required = true, fallback } = {}) {
  const value = process.env[name] ?? fallback;
  if (required && (!value || !String(value).trim())) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
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

const MessageSchema = new mongoose.Schema(
  {
    waMessageId: { type: String, index: true, unique: true, sparse: true },
    from: { type: String, index: true },
    text: { type: String },
    timestamp: { type: Date },
    status: {
      type: String,
      enum: ["new", "replied"],
      default: "new",
      index: true,
    },
    replyText: { type: String },
    repliedAt: { type: Date },
    raw: { type: Object },
  },
  { timestamps: true },
);

const Message = mongoose.model("Message", MessageSchema);

async function main() {
  const app = express();
  const server = http.createServer(app);

  const mongoUri = process.env.MONGODB_URI;
  const wantMongo = !!(mongoUri && String(mongoUri).trim());
  // Start in memory mode to avoid request hangs while Mongo connects.
  let useMemoryDb = true;
  let mongoLastError = null;
  const memoryDb = {
    byId: new Map(),
    byKey: new Map(),
  };

  function memUpsert(doc, key) {
    const existingId = memoryDb.byKey.get(key);
    if (existingId) return memoryDb.byId.get(existingId);

    const now = new Date();
    const record = {
      _id: new mongoose.Types.ObjectId().toString(),
      ...doc,
      createdAt: now,
      updatedAt: now,
    };

    memoryDb.byId.set(record._id, record);
    memoryDb.byKey.set(key, record._id);
    return record;
  }

  function memList(filter = {}) {
    const list = Array.from(memoryDb.byId.values());
    return list
      .filter((m) => {
        if (filter.status && m.status !== filter.status) return false;
        return true;
      })
      .sort((a, b) => {
        const at = new Date(a.timestamp || a.createdAt).getTime();
        const bt = new Date(b.timestamp || b.createdAt).getTime();
        return bt - at;
      })
      .slice(0, 300)
      .map((m) => {
        const { raw, ...rest } = m;
        return rest;
      });
  }

  function memFindByIds(ids) {
    return ids.map((id) => memoryDb.byId.get(String(id))).filter(Boolean);
  }

  function memDelete(id) {
    const record = memoryDb.byId.get(String(id));
    if (!record) return null;
    memoryDb.byId.delete(String(id));
    // Note: we keep byKey entries for simplicity; duplicates are still prevented by key.
    return record;
  }

  const io = new Server(server, {
    cors: {
      origin: true,
      credentials: true,
    },
  });

  const adminToken = getEnv("ADMIN_TOKEN", { required: false, fallback: "" });

  io.on("connection", (socket) => {
    socket.emit("connected", { ok: true });
  });

  // Capture raw body for signature verification
  app.use(
    express.json({
      limit: "2mb",
      verify: (req, res, buf) => {
        req.rawBody = buf?.toString("utf8") || "";
      },
    }),
  );

  app.use(express.static(path.join(__dirname, "public")));

  function requireAdmin(req, res, next) {
    if (!adminToken) return next();
    const headerToken = req.headers["x-admin-token"];
    if (headerToken && safeEqual(String(headerToken), adminToken))
      return next();
    res.status(401).json({ ok: false, error: "Unauthorized" });
  }

  app.get("/api/health", (req, res) => {
    res.json({
      ok: true,
      mode: useMemoryDb ? "memory" : "mongo",
      wantMongo,
      mongo: mongoose.connection.readyState,
      mongoError: mongoLastError,
      time: new Date().toISOString(),
    });
  });

  // Meta webhook verification
  app.get("/webhook", (req, res) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === getEnv("WHATSAPP_VERIFY_TOKEN")) {
      res.status(200).send(challenge);
      return;
    }

    res.status(403).send("Forbidden");
  });

  // Incoming WhatsApp messages webhook
  app.post("/webhook", async (req, res) => {
    try {
      const rawBody = req.rawBody || JSON.stringify(req.body || {});
      const appSecret = process.env.META_APP_SECRET || process.env.APP_SECRET;
      const signatureHeader = req.headers["x-hub-signature-256"];

      if (!verifyMetaSignature({ rawBody, signatureHeader, appSecret })) {
        res.status(401).send("Invalid signature");
        return;
      }

      const body = req.body || {};
      const entries = Array.isArray(body?.entry) ? body.entry : [];

      const saved = [];

      for (const entry of entries) {
        const changes = Array.isArray(entry?.changes) ? entry.changes : [];
        for (const change of changes) {
          const value = change?.value;
          const messages = Array.isArray(value?.messages) ? value.messages : [];
          for (const message of messages) {
            const from = message?.from;
            const waMessageId = message?.id;
            const text = message?.text?.body || "";
            const ts = message?.timestamp
              ? new Date(Number(message.timestamp) * 1000)
              : new Date();

            if (!from) continue;

            const doc = {
              waMessageId,
              from,
              text,
              timestamp: ts,
              status: "new",
              raw: message,
            };

            const key = waMessageId || `${from}:${ts.toISOString()}:${text}`;
            const upserted = useMemoryDb
              ? memUpsert(doc, key)
              : await Message.findOneAndUpdate(
                  { waMessageId: key },
                  { $setOnInsert: doc },
                  { new: true, upsert: true },
                );

            const payload = {
              id: String(upserted._id),
              waMessageId: upserted.waMessageId,
              from: upserted.from,
              text: upserted.text,
              timestamp: upserted.timestamp,
              status: upserted.status,
              createdAt: upserted.createdAt,
            };

            saved.push(payload);
            io.emit("message:new", payload);
          }
        }
      }

      res.status(200).json({ ok: true, savedCount: saved.length });
    } catch (err) {
      res
        .status(500)
        .json({ ok: false, error: err?.message || "Server error" });
    }
  });

  app.get("/api/messages", async (req, res) => {
    const status = req.query.status;
    const filter = {};
    if (status === "new" || status === "replied") filter.status = status;

    const list = useMemoryDb
      ? memList(filter)
      : await Message.find(filter)
          .sort({ timestamp: -1, createdAt: -1 })
          .limit(300)
          .select({ raw: 0 });

    res.json({ ok: true, messages: list });
  });

  app.post("/api/reply", requireAdmin, async (req, res) => {
    try {
      const { messageIds, text } = req.body || {};
      if (!Array.isArray(messageIds) || messageIds.length === 0 || !text) {
        res.status(400).json({
          ok: false,
          error: "Required: { messageIds: string[], text: string }",
        });
        return;
      }

      const messages = useMemoryDb
        ? memFindByIds(messageIds)
        : await Message.find({ _id: { $in: messageIds } });
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
        if (!useMemoryDb) {
          await msg.save();
        } else {
          msg.updatedAt = new Date();
          memoryDb.byId.set(String(msg._id), msg);
        }

        const payload = {
          id: String(msg._id),
          waMessageId: msg.waMessageId,
          from: msg.from,
          text: msg.text,
          timestamp: msg.timestamp,
          status: msg.status,
          replyText: msg.replyText,
          repliedAt: msg.repliedAt,
          updatedAt: msg.updatedAt,
        };

        io.emit("message:updated", payload);
        results.push({ id: payload.id, ok: true, wa: waResp });
      }

      res.json({ ok: true, count: results.length, results });
    } catch (err) {
      res
        .status(500)
        .json({ ok: false, error: err?.message || "Server error" });
    }
  });

  app.delete("/api/messages/:id", requireAdmin, async (req, res) => {
    const id = req.params.id;
    const deleted = useMemoryDb
      ? memDelete(id)
      : await Message.findByIdAndDelete(id);
    if (!deleted) {
      res.status(404).json({ ok: false, error: "Not found" });
      return;
    }

    io.emit("message:deleted", { id: String(id) });
    res.json({ ok: true });
  });

  // Fallback for SPA routes
  app.get(/^(?!\/api\/).*/, (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
  });

  const port = Number(process.env.PORT || 3000);
  server.listen(port, () => {
    console.log(`Server listening on http://localhost:${port}`);
    console.log(`Webhook: http://localhost:${port}/webhook`);
  });

  if (!wantMongo) {
    console.warn(
      "[WARN] MONGODB_URI is empty. Running in MEMORY mode (no persistence). Fill MONGODB_URI to enable MongoDB Atlas.",
    );
    return;
  }

  // Attempt Mongo connection in the background (do not block server start)
  const connectWithTimeout = async () => {
    const connectPromise = mongoose.connect(mongoUri, {
      serverSelectionTimeoutMS: 7000,
    });
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("MongoDB connect timeout")), 8000),
    );
    return await Promise.race([connectPromise, timeoutPromise]);
  };

  connectWithTimeout()
    .then(() => {
      useMemoryDb = false;
      mongoLastError = null;
      console.log("MongoDB connected. Switching to MONGO mode.");
    })
    .catch((err) => {
      useMemoryDb = true;
      mongoLastError = err?.message ? String(err.message) : String(err);
      console.warn(
        `[WARN] MongoDB not connected. Staying in MEMORY mode. Reason: ${err?.message || err}`,
      );
    });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
