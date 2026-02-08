const connectMongo = require('../lib/mongo');
const Message = require('../lib/Message');
const { requireAdmin } = require('../lib/auth');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'GET') {
      res.setHeader('Allow', 'GET');
      res.status(405).send('Method Not Allowed');
      return;
    }

    if (!requireAdmin(req)) {
      res.status(401).json({ ok: false, error: 'Unauthorized' });
      return;
    }

    await connectMongo();

    const status = req.query.status;
    const filter = {};
    if (status === 'new' || status === 'replied') filter.status = status;

    const list = await Message.find(filter)
      .sort({ timestamp: -1, createdAt: -1 })
      .limit(300)
      .select({ raw: 0 });

    res.status(200).json({ ok: true, messages: list });
  } catch (err) {
    res.status(500).json({ ok: false, error: err?.message || 'Server error' });
  }
};
