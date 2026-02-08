const mongoose = require("mongoose");

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

module.exports =
  mongoose.models.Message || mongoose.model("Message", MessageSchema);
