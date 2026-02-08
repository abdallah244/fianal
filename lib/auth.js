const crypto = require("crypto");

function safeEqual(a, b) {
  const aBuf = Buffer.from(String(a));
  const bBuf = Buffer.from(String(b));
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function requireAdmin(req) {
  const adminToken = process.env.ADMIN_TOKEN;
  if (!adminToken) return true;
  const headerToken = req.headers["x-admin-token"];
  if (!headerToken) return false;
  return safeEqual(String(headerToken), String(adminToken));
}

module.exports = { requireAdmin };
