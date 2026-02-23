const express = require('express');
const FAQ = require('../models/faq');
const { generateProjectSpecificSupportAnswer } = require('../services/supportAiService');

const router = express.Router();

const sanitizeText = (value, max = 20000) => String(value || '').trim().slice(0, max);
const DEFAULT_FAQS = [
  {
    _id: 'default-faq-1',
    question: 'How does the system prevent booking conflicts?',
    answer:
      'The schedule and booking logic detect overlapping time ranges for the same hall. Conflicting cases are surfaced for admin decisions, while non-conflicting requests follow the streamlined flow.',
    isAIGenerated: false,
    source: 'MANUAL',
    intentKey: '',
    frequencyScore: 0,
    createdByRole: 'SYSTEM',
    createdByEmail: '',
    active: true
  },
  {
    _id: 'default-faq-2',
    question: 'How will I know if my booking or request is processed?',
    answer:
      'You can track thread status from dashboard pages, and trusted responses from admin/developer are marked clearly. Email notifications are also sent for complaint/query updates.',
    isAIGenerated: false,
    source: 'MANUAL',
    intentKey: '',
    frequencyScore: 0,
    createdByRole: 'SYSTEM',
    createdByEmail: '',
    active: true
  }
];

const getSessionRole = (req) => {
  if (!(req.isAuthenticated && req.isAuthenticated() && req.user)) return 'GUEST';
  const type = String(req.user.type || '').toUpperCase();
  if (type === 'ADMIN') return 'ADMIN';
  if (type === 'DEVELOPER') return 'DEVELOPER';
  if (type === 'DEPARTMENT') return 'DEPARTMENT';
  return 'GUEST';
};

const isTrustedRole = (role) => role === 'ADMIN' || role === 'DEVELOPER';

const toPublicFAQ = (doc) => ({
  _id: doc._id,
  question: doc.question,
  answer: doc.answer,
  isAIGenerated: doc.isAIGenerated,
  source: doc.source,
  intentKey: doc.intentKey,
  frequencyScore: doc.frequencyScore,
  createdByRole: doc.createdByRole,
  createdByEmail: doc.createdByEmail,
  active: doc.active !== false,
  createdAt: doc.createdAt,
  updatedAt: doc.updatedAt
});

router.get('/', async (req, res) => {
  try {
    const role = getSessionRole(req);
    const trusted = isTrustedRole(role);
    const includeInactive = String(req.query.includeInactive || '').toLowerCase() === 'true';
    const filter = includeInactive && trusted ? {} : { $or: [{ active: true }, { active: { $exists: false } }] };
    const docs = await FAQ.find(filter).sort({ updatedAt: -1, createdAt: -1 });
    if (!docs.length && !includeInactive) {
      return res.json({ faqs: DEFAULT_FAQS });
    }
    res.json({ faqs: docs.map(toPublicFAQ) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/answer-with-ai', async (req, res) => {
  try {
    const question = sanitizeText(req.body.question, 500);
    if (!question) return res.status(400).json({ error: 'question is required' });

    const answer = await generateProjectSpecificSupportAnswer({
      kind: 'FAQ',
      threadId: 'faq-preview',
      title: question,
      message: question,
      email: 'guest@faq.local'
    });
    res.json({ answer, isAIGenerated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const role = getSessionRole(req);
    if (!isTrustedRole(role)) {
      return res.status(403).json({ error: 'Only admin/developer can create FAQ.' });
    }

    const question = sanitizeText(req.body.question, 500);
    const answer = sanitizeText(req.body.answer, 20000);
    if (!question || !answer) return res.status(400).json({ error: 'question and answer are required' });

    const faq = await FAQ.create({
      question,
      answer,
      isAIGenerated: Boolean(req.body.isAIGenerated),
      source: req.body.source === 'AI_PROMOTED' ? 'AI_PROMOTED' : 'MANUAL',
      intentKey: sanitizeText(req.body.intentKey, 200),
      frequencyScore: Number(req.body.frequencyScore || 0),
      createdByRole: role,
      createdByEmail: req.user?.email || '',
      active: true
    });

    res.status(201).json({ faq: toPublicFAQ(faq) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const role = getSessionRole(req);
    if (!isTrustedRole(role)) {
      return res.status(403).json({ error: 'Only admin/developer can update FAQ.' });
    }

    const updates = {};
    if (req.body.question !== undefined) updates.question = sanitizeText(req.body.question, 500);
    if (req.body.answer !== undefined) updates.answer = sanitizeText(req.body.answer, 20000);
    if (req.body.active !== undefined) updates.active = Boolean(req.body.active);
    if (req.body.frequencyScore !== undefined) updates.frequencyScore = Number(req.body.frequencyScore || 0);
    if (req.body.intentKey !== undefined) updates.intentKey = sanitizeText(req.body.intentKey, 200);
    updates.updatedAt = new Date();

    const faq = await FAQ.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true });
    if (!faq) return res.status(404).json({ error: 'FAQ not found' });
    res.json({ faq: toPublicFAQ(faq) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const role = getSessionRole(req);
    if (!isTrustedRole(role)) {
      return res.status(403).json({ error: 'Only admin/developer can delete FAQ.' });
    }
    const faq = await FAQ.findByIdAndUpdate(req.params.id, { $set: { active: false } }, { new: true });
    if (!faq) return res.status(404).json({ error: 'FAQ not found' });
    res.json({ faq: toPublicFAQ(faq) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
