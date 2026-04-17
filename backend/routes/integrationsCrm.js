const express = require('express');
const {
  getCrmIntegrationStatus,
  syncSupportThreadToCrm,
  syncBookingEventToCrm
} = require('../services/crmIntegrationService');

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
    status: getCrmIntegrationStatus()
  });
});

router.post('/sync/support-thread', requireTrusted, async (req, res) => {
  try {
    const summary = await syncSupportThreadToCrm({
      kind: req.body?.kind || 'SUPPORT',
      title: req.body?.title || '',
      message: req.body?.message || '',
      email: req.body?.email || '',
      threadId: req.body?.threadId || '',
      aiAnswer: req.body?.aiAnswer || '',
      source: req.body?.source || 'BIT-Booking3'
    });

    return res.json({
      ok: true,
      summary
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'CRM support-thread sync failed.'
    });
  }
});

router.post('/sync/booking', requireTrusted, async (req, res) => {
  try {
    const summary = await syncBookingEventToCrm({
      bookingId: req.body?.bookingId || '',
      department: req.body?.department || '',
      email: req.body?.email || '',
      hall: req.body?.hall || '',
      event: req.body?.event || '',
      startDateTime: req.body?.startDateTime || '',
      endDateTime: req.body?.endDateTime || '',
      status: req.body?.status || ''
    });

    return res.json({
      ok: true,
      summary
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'CRM booking sync failed.'
    });
  }
});

module.exports = router;
