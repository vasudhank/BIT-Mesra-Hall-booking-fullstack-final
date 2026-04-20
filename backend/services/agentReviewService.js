const crypto = require('crypto');
const mongoose = require('mongoose');
const AgentReviewTask = require('../models/agentReviewTask');
const { observeAgentReviewTransition } = require('./metricsService');
const { captureException } = require('./observabilityService');
const { logger } = require('./loggerService');

const inMemoryReviewStore = new Map();

const isMongoReady = () => Number(mongoose?.connection?.readyState || 0) === 1;

const clip = (text, limit = 600) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit);

const createInMemoryId = () => `review_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

const normalizeStatus = (statusLike, fallback = 'PENDING') => {
  const raw = String(statusLike || fallback).trim().toUpperCase();
  if (['PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED', 'CANCELLED'].includes(raw)) return raw;
  return fallback;
};

const normalizeRiskLevel = (riskLike, fallback = 'MEDIUM') => {
  const raw = String(riskLike || fallback).trim().toUpperCase();
  if (['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].includes(raw)) return raw;
  return fallback;
};

const serializeTask = (taskLike) => {
  if (!taskLike) return null;
  const plain = typeof taskLike.toObject === 'function' ? taskLike.toObject() : taskLike;
  return {
    id: String(plain._id || plain.id || ''),
    ownerKey: String(plain.ownerKey || ''),
    threadId: String(plain.threadId || ''),
    status: normalizeStatus(plain.status),
    riskLevel: normalizeRiskLevel(plain.riskLevel),
    title: String(plain.title || ''),
    summary: String(plain.summary || ''),
    rationale: String(plain.rationale || ''),
    requestedByRole: String(plain.requestedByRole || 'GUEST'),
    actionType: String(plain.actionType || ''),
    messagePreview: String(plain.messagePreview || ''),
    actionIntent: plain.actionIntent || null,
    toolRuns: Array.isArray(plain.toolRuns) ? plain.toolRuns : [],
    metadata: plain.metadata && typeof plain.metadata === 'object' ? plain.metadata : {},
    decision: plain.decision || null,
    executedAt: plain.executedAt || null,
    createdAt: plain.createdAt || null,
    updatedAt: plain.updatedAt || null
  };
};

const createReviewTask = async ({
  ownerKey = 'GUEST:anonymous',
  threadId = 'thread_default',
  requestedByRole = 'GUEST',
  actionIntent = null,
  toolRuns = [],
  riskLevel = 'MEDIUM',
  title = '',
  summary = '',
  rationale = '',
  messagePreview = '',
  metadata = {}
} = {}) => {
  if (!actionIntent || typeof actionIntent !== 'object') {
    throw new Error('createReviewTask requires an actionIntent object.');
  }

  const payload = {
    ownerKey: String(ownerKey || 'GUEST:anonymous').trim(),
    threadId: String(threadId || 'thread_default').trim(),
    requestedByRole: String(requestedByRole || 'GUEST').trim().toUpperCase(),
    actionType: String(actionIntent.action || '').trim().toUpperCase(),
    actionIntent,
    toolRuns: Array.isArray(toolRuns) ? toolRuns.slice(0, 12) : [],
    riskLevel: normalizeRiskLevel(riskLevel),
    title: clip(title || `${actionIntent.action || 'Action'} requires review`, 180),
    summary: clip(summary || 'Human review required before execution.', 800),
    rationale: clip(rationale, 1000),
    messagePreview: clip(messagePreview, 300),
    metadata: metadata && typeof metadata === 'object' ? metadata : {}
  };

  observeAgentReviewTransition({ status: 'pending', pendingDelta: 1 });

  if (!isMongoReady()) {
    const task = {
      _id: createInMemoryId(),
      ...payload,
      status: 'PENDING',
      decision: null,
      executedAt: null,
      createdAt: new Date(),
      updatedAt: new Date()
    };
    inMemoryReviewStore.set(String(task._id), task);
    return serializeTask(task);
  }

  const doc = await AgentReviewTask.create(payload);
  return serializeTask(doc);
};

const getReviewTaskById = async (reviewId) => {
  const id = String(reviewId || '').trim();
  if (!id) return null;

  if (!isMongoReady()) {
    return serializeTask(inMemoryReviewStore.get(id) || null);
  }

  const doc = await AgentReviewTask.findById(id).lean();
  return serializeTask(doc);
};

const listReviewTasks = async ({
  status = '',
  ownerKey = '',
  limit = 12
} = {}) => {
  const normalizedLimit = Math.max(Math.min(Number(limit) || 12, 60), 1);
  const normalizedStatus = String(status || '').trim().toUpperCase();
  const cleanOwnerKey = String(ownerKey || '').trim();

  if (!isMongoReady()) {
    let rows = Array.from(inMemoryReviewStore.values());
    if (normalizedStatus) rows = rows.filter((row) => normalizeStatus(row.status) === normalizedStatus);
    if (cleanOwnerKey) rows = rows.filter((row) => String(row.ownerKey || '') === cleanOwnerKey);
    return rows
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, normalizedLimit)
      .map((row) => serializeTask(row));
  }

  const query = {};
  if (normalizedStatus) query.status = normalizedStatus;
  if (cleanOwnerKey) query.ownerKey = cleanOwnerKey;

  const docs = await AgentReviewTask.find(query)
    .sort({ createdAt: -1 })
    .limit(normalizedLimit)
    .lean();

  return docs.map((doc) => serializeTask(doc));
};

const updateStoredTask = async (task, updates) => {
  if (!task) return null;
  const next = {
    ...task,
    ...updates,
    updatedAt: new Date()
  };
  inMemoryReviewStore.set(String(task._id || task.id), next);
  return serializeTask(next);
};

const applyDecision = async ({
  reviewId,
  nextStatus,
  reviewer = {},
  note = ''
} = {}) => {
  const task = await getReviewTaskById(reviewId);
  if (!task) {
    throw new Error('Review task not found.');
  }

  if (task.status !== 'PENDING') {
    return task;
  }

  const decision = {
    status: nextStatus,
    reviewerRole: String(reviewer.role || reviewer.type || 'UNKNOWN').trim().toUpperCase(),
    reviewerId: String(reviewer.id || reviewer._id || '').trim(),
    reviewerEmail: String(reviewer.email || '').trim().toLowerCase(),
    note: clip(note, 600),
    decidedAt: new Date()
  };

  observeAgentReviewTransition({
    status: nextStatus.toLowerCase(),
    pendingDelta: -1
  });

  if (!isMongoReady()) {
    return updateStoredTask(
      {
        ...task,
        _id: task.id
      },
      {
        status: nextStatus,
        decision
      }
    );
  }

  const updated = await AgentReviewTask.findByIdAndUpdate(
    task.id,
    {
      $set: {
        status: nextStatus,
        decision
      }
    },
    { new: true }
  );

  return serializeTask(updated);
};

const approveReviewTask = async ({ reviewId, reviewer = {}, note = '' } = {}) =>
  applyDecision({
    reviewId,
    nextStatus: 'APPROVED',
    reviewer,
    note
  });

const rejectReviewTask = async ({ reviewId, reviewer = {}, note = '' } = {}) =>
  applyDecision({
    reviewId,
    nextStatus: 'REJECTED',
    reviewer,
    note
  });

const markReviewTaskExecuted = async ({ reviewId, error = false } = {}) => {
  const task = await getReviewTaskById(reviewId);
  if (!task) return null;

  const nextStatus = error ? 'FAILED' : 'EXECUTED';
  observeAgentReviewTransition({ status: nextStatus.toLowerCase(), pendingDelta: 0 });

  if (!isMongoReady()) {
    return updateStoredTask(
      {
        ...task,
        _id: task.id
      },
      {
        status: nextStatus,
        executedAt: new Date()
      }
    );
  }

  const updated = await AgentReviewTask.findByIdAndUpdate(
    task.id,
    {
      $set: {
        status: nextStatus,
        executedAt: new Date()
      }
    },
    { new: true }
  );

  return serializeTask(updated);
};

const getReviewQueueSnapshot = async ({ limit = 8 } = {}) => {
  try {
    const preview = await listReviewTasks({ status: 'PENDING', limit });
    const summary = {
      pending: preview.length,
      preview
    };

    if (!isMongoReady()) {
      return summary;
    }

    const [pendingCount, approvedCount, rejectedCount, executedCount] = await Promise.all([
      AgentReviewTask.countDocuments({ status: 'PENDING' }),
      AgentReviewTask.countDocuments({ status: 'APPROVED' }),
      AgentReviewTask.countDocuments({ status: 'REJECTED' }),
      AgentReviewTask.countDocuments({ status: 'EXECUTED' })
    ]);

    return {
      ...summary,
      pending: Number(pendingCount || 0),
      approved: Number(approvedCount || 0),
      rejected: Number(rejectedCount || 0),
      executed: Number(executedCount || 0)
    };
  } catch (err) {
    captureException(err, { area: 'agent_review_snapshot' });
    logger.warn('Agent review snapshot failed', { error: err.message || err });
    return {
      pending: 0,
      approved: 0,
      rejected: 0,
      executed: 0,
      preview: []
    };
  }
};

module.exports = {
  createReviewTask,
  getReviewTaskById,
  listReviewTasks,
  approveReviewTask,
  rejectReviewTask,
  markReviewTaskExecuted,
  getReviewQueueSnapshot
};
