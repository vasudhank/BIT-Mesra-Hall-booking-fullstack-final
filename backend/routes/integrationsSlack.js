const express = require('express');
const {
  getSlackIntegrationStatus,
  isSlackSignatureValid,
  queueSlackEventProcessing,
  queueSlackCommandProcessing,
  dispatchSlackNotification
} = require('../services/slackIntegrationService');

const router = express.Router();

const getRole = (req) => String(req?.user?.type || '').toUpperCase();
const isTrusted = (req) => req.isAuthenticated && req.isAuthenticated() && ['ADMIN', 'DEVELOPER'].includes(getRole(req));

const requireTrusted = (req, res, next) => {
  if (!isTrusted(req)) {
    return res.status(403).json({ error: 'Only admin/developer can access this endpoint.' });
  }
  return next();
};

router.get('/status', requireTrusted, (req, res) => {
  return res.json({
    ok: true,
    status: getSlackIntegrationStatus()
  });
});

router.post('/events', (req, res) => {
  if (!isSlackSignatureValid(req)) {
    return res.status(401).json({ ok: false, error: 'Invalid Slack signature.' });
  }

  const payload = req.body || {};
  if (payload?.type === 'url_verification') {
    return res.status(200).send(String(payload?.challenge || ''));
  }

  queueSlackEventProcessing(payload);
  return res.status(200).json({ ok: true, queued: true });
});

router.post('/command', (req, res) => {
  if (!isSlackSignatureValid(req)) {
    return res.status(401).json({ ok: false, error: 'Invalid Slack signature.' });
  }

  queueSlackCommandProcessing(req.body || {});
  return res.status(200).json({
    response_type: 'ephemeral',
    text: 'Processing your request now...'
  });
});

router.post('/notify', requireTrusted, async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const channel = String(req.body?.channel || '').trim();
  const threadTs = String(req.body?.threadTs || '').trim();

  if (!text) {
    return res.status(400).json({ error: '"text" is required.' });
  }

  try {
    const result = await dispatchSlackNotification({
      text,
      channel,
      threadTs
    });
    return res.json({ ok: true, result });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'Slack notify failed.'
    });
  }
});

module.exports = router;
