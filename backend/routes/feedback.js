const express = require('express');
const Feedback = require('../models/feedback');

const router = express.Router();

const sanitizeText = (value, max = 12000) => String(value || '').trim().slice(0, max);
const sanitizeEmail = (value) => String(value || '').trim().toLowerCase();

const getSessionRole = (req) => {
  if (!(req.isAuthenticated && req.isAuthenticated() && req.user)) return 'GUEST';
  const type = String(req.user.type || '').toUpperCase();
  if (type === 'ADMIN') return 'ADMIN';
  if (type === 'DEVELOPER') return 'DEVELOPER';
  if (type === 'DEPARTMENT') return 'DEPARTMENT';
  return 'GUEST';
};

const isTrustedRole = (role) => role === 'ADMIN' || role === 'DEVELOPER';

const toPublic = (doc) => ({
  _id: doc._id,
  type: doc.type,
  message: doc.message,
  email: doc.email,
  rating: doc.rating,
  status: doc.status,
  visibility: doc.visibility,
  createdByRole: doc.createdByRole,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt
});

router.get('/', async (req, res) => {
  try {
    const role = getSessionRole(req);
    const trusted = isTrustedRole(role);
    const status = String(req.query.status || 'ALL').toUpperCase();
    const q = sanitizeText(req.query.q || '', 200);
    const sort = String(req.query.sort || 'DATE_DESC').toUpperCase();

    let filter = {};
    if (!trusted) {
      filter.visibility = 'PUBLIC';
    }
    if (status !== 'ALL') {
      filter.status = status;
    }
    if (q) {
      filter.$or = [
        { message: { $regex: q, $options: 'i' } },
        { email: { $regex: q, $options: 'i' } },
        { type: { $regex: q, $options: 'i' } }
      ];
    }

    let docs = await Feedback.find(filter).sort({ createdAt: -1 });
    let list = docs.map(toPublic);
    const sorters = {
      DATE_DESC: (a, b) => new Date(b.createdAt) - new Date(a.createdAt),
      DATE_ASC: (a, b) => new Date(a.createdAt) - new Date(b.createdAt),
      TYPE_ASC: (a, b) => a.type.localeCompare(b.type),
      TYPE_DESC: (a, b) => b.type.localeCompare(a.type),
      STATUS_ASC: (a, b) => a.status.localeCompare(b.status),
      STATUS_DESC: (a, b) => b.status.localeCompare(a.status),
      RATING_DESC: (a, b) => (b.rating || 0) - (a.rating || 0),
      RATING_ASC: (a, b) => (a.rating || 0) - (b.rating || 0)
    };
    list.sort(sorters[sort] || sorters.DATE_DESC);
    res.json({ feedbacks: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const type = String(req.body.type || '').toUpperCase();
    const message = sanitizeText(req.body.message, 12000);
    const email = sanitizeEmail(req.body.email || '');
    const rating = req.body.rating ? Number(req.body.rating) : null;
    if (!['BUG', 'SUGGESTION', 'PRAISE'].includes(type)) {
      return res.status(400).json({ error: 'Invalid feedback type' });
    }
    if (!message) return res.status(400).json({ error: 'message is required' });
    if (rating && (rating < 1 || rating > 5)) {
      return res.status(400).json({ error: 'rating must be 1 to 5' });
    }

    const role = getSessionRole(req);
    const trusted = isTrustedRole(role);

    const feedback = await Feedback.create({
      type,
      message,
      email,
      rating,
      createdByRole: role,
      createdById: req.user?.id || null,
      visibility: trusted ? 'INTERNAL' : 'PUBLIC'
    });

    res.status(201).json({ feedback: toPublic(feedback) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/status', async (req, res) => {
  try {
    const role = getSessionRole(req);
    if (!isTrustedRole(role)) {
      return res.status(403).json({ error: 'Only admin/developer can update feedback status.' });
    }
    const status = String(req.body.status || '').toUpperCase();
    if (!['NEW', 'IN_REVIEW', 'DONE'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const feedback = await Feedback.findByIdAndUpdate(req.params.id, { $set: { status } }, { new: true });
    if (!feedback) return res.status(404).json({ error: 'Feedback not found' });
    res.json({ feedback: toPublic(feedback) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

