const express = require('express');
const router = express.Router();
const { handleApproval } = require('../controllers/approvalController');

router.get('/approve/:token', (req, res) =>
  handleApproval(req, res, 'APPROVE')
);

router.get('/reject/:token', (req, res) =>
  handleApproval(req, res, 'REJECT')
);

module.exports = router;
