const express = require('express');
const {
  listReviewTasks,
  getReviewTaskById,
  approveReviewTask,
  rejectReviewTask
} = require('../services/agentReviewService');

const router = express.Router();

const getRole = (req) => String(req?.user?.type || '').toUpperCase();
const isTrusted = (req) => req.isAuthenticated && req.isAuthenticated() && ['ADMIN', 'DEVELOPER'].includes(getRole(req));

const requireTrusted = (req, res, next) => {
  if (!isTrusted(req)) {
    return res.status(403).json({ error: 'Only admin/developer can access AI review tasks.' });
  }
  return next();
};

router.get('/reviews', requireTrusted, async (req, res) => {
  const status = String(req.query?.status || '').trim().toUpperCase();
  const limit = Number(req.query?.limit || 12);
  const items = await listReviewTasks({ status, limit });

  return res.json({
    ok: true,
    items
  });
});

router.get('/reviews/:reviewId', requireTrusted, async (req, res) => {
  const task = await getReviewTaskById(req.params.reviewId);
  if (!task) {
    return res.status(404).json({ ok: false, error: 'Review task not found.' });
  }

  return res.json({
    ok: true,
    task
  });
});

router.post('/reviews/:reviewId/approve', requireTrusted, async (req, res) => {
  try {
    const task = await approveReviewTask({
      reviewId: req.params.reviewId,
      reviewer: {
        role: req.user?.type || '',
        id: req.user?._id || req.user?.id || '',
        email: req.user?.email || ''
      },
      note: req.body?.note || ''
    });

    return res.json({
      ok: true,
      task,
      executeIntent: task?.actionIntent || null
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'Failed to approve review task.'
    });
  }
});

router.post('/reviews/:reviewId/reject', requireTrusted, async (req, res) => {
  try {
    const task = await rejectReviewTask({
      reviewId: req.params.reviewId,
      reviewer: {
        role: req.user?.type || '',
        id: req.user?._id || req.user?.id || '',
        email: req.user?.email || ''
      },
      note: req.body?.note || ''
    });

    return res.json({
      ok: true,
      task
    });
  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message || 'Failed to reject review task.'
    });
  }
});

module.exports = router;
