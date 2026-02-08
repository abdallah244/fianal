const connectMongo = require("../../lib/mongo");
const Message = require("../../lib/Message");
const { requireAdmin } = require("../../lib/auth");

module.exports = async (req, res) => {
  try {
    if (req.method !== "DELETE") {
      res.setHeader("Allow", "DELETE");
      res.status(405).send("Method Not Allowed");
      return;
    }

    if (!requireAdmin(req)) {
      res.status(401).json({ ok: false, error: "Unauthorized" });
      return;
    }

    await connectMongo();

    const id = req.query.id;
    const deleted = await Message.findByIdAndDelete(id);

    if (!deleted) {
      res.status(404).json({ ok: false, error: "Not found" });
      return;
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || "Server error" });
  }
};
