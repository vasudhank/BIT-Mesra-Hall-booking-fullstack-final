const express = require('express');
const router = express.Router();
const { handleApproval } = require('../controllers/approvalController');

/* APPROVE (for PENDING) */
router.get('/approve/:token', (req, res) =>
  handleApproval(req, res, 'APPROVED')
);

/* REJECT (for PENDING) */
router.get('/reject/:token', (req, res) =>
  handleApproval(req, res, 'REJECTED')
);

/* VACATE (for AUTO_BOOKED) */
router.get('/vacate/:token', (req, res) =>
  handleApproval(req, res, 'VACATED')
);

/* LEAVE (for AUTO_BOOKED) */
router.get('/leave/:token', (req, res) =>
  handleApproval(req, res, 'LEFT')
);

module.exports = router;
