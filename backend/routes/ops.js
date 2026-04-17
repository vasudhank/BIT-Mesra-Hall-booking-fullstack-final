const express = require('express');
const mongoose = require('mongoose');
const { toPrometheus, toJsonSnapshot } = require('../services/metricsService');

const router = express.Router();

router.get('/health', (req, res) => {
  return res.json({
    status: 'ok',
    service: 'bit-booking-backend',
    now: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime())
  });
});

router.get('/ready', (req, res) => {
  const dbReady = Number(mongoose?.connection?.readyState || 0) === 1;
  if (!dbReady) {
    return res.status(503).json({
      status: 'degraded',
      dbReady: false,
      now: new Date().toISOString()
    });
  }
  return res.json({
    status: 'ready',
    dbReady: true,
    now: new Date().toISOString()
  });
});

router.get('/metrics', (req, res) => {
  const asText = String(req.query?.format || '').toLowerCase() === 'prom' || req.headers.accept === 'text/plain';
  if (asText) {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return res.send(toPrometheus());
  }
  return res.json({
    status: 'ok',
    snapshot: toJsonSnapshot()
  });
});

module.exports = router;
