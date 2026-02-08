const mongoose = require('mongoose');

module.exports = async (req, res) => {
  try {
    const wantMongo = !!(process.env.MONGODB_URI && String(process.env.MONGODB_URI).trim());

    // Don’t force-connect here; just report env + current driver state.
    res.status(200).json({
      ok: true,
      wantMongo,
      mongo: mongoose.connection?.readyState ?? 0,
      time: new Date().toISOString(),
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'Server error' });
  }
};
