const express = require('express');
const router = express.Router();
const { handleApproval } = require('../controllers/approvalController');

/* ✅ APPROVE */
router.get('/approve/:token', (req, res) =>
  handleApproval(req, res, 'APPROVED')
);

/* ❌ REJECT */
router.get('/reject/:token', (req, res) =>
  handleApproval(req, res, 'REJECTED')
);

module.exports = router;
