const express = require('express');
const {
  getWhatsAppIntegrationStatus,
  isWhatsAppWebhookVerificationValid,
  queueIncomingWhatsAppWebhookProcessing,
  sendWhatsAppTextMessage
} = require('../services/whatsappIntegrationService');

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
    status: getWhatsAppIntegrationStatus()
  });
});

router.get('/webhook', (req, res) => {
  if (!isWhatsAppWebhookVerificationValid(req.query || {})) {
    return res.status(403).json({ ok: false, error: 'Webhook verification failed.' });
  }
  return res.status(200).send(String(req.query?.['hub.challenge'] || ''));
});

router.post('/webhook', (req, res) => {
  queueIncomingWhatsAppWebhookProcessing(req.body || {});
  return res.status(200).json({ ok: true, queued: true });
});

router.post('/send', requireTrusted, async (req, res) => {
  const to = String(req.body?.to || '').replace(/[^\d+]/g, '').trim();
  const text = String(req.body?.text || '').trim();
  const contextMessageId = String(req.body?.contextMessageId || '').trim();

  if (!to || !text) {
    return res.status(400).json({ error: 'Both "to" and "text" are required.' });
  }

  try {
    const result = await sendWhatsAppTextMessage({
      to,
      text,
      contextMessageId
    });
    return res.json({
      ok: true,
      result
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'Failed to send WhatsApp message.'
    });
  }
});

module.exports = router;
