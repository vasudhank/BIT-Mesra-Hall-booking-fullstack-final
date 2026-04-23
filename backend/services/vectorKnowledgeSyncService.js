const mongoose = require('mongoose');
const FAQ = require('../models/faq');
const Notice = require('../models/notice');
const {
  upsertVectorDocuments,
  resolveVectorProvider,
  DEFAULT_VECTOR_NAMESPACE
} = require('./vectorStoreService');
const { logger } = require('./loggerService');

const SYNC_INTERVAL_MS = Math.max(Number(process.env.VECTOR_SYNC_INTERVAL_MS || 30 * 60 * 1000), 60 * 1000);
const MAX_FAQ_DOCS = Math.max(Number(process.env.VECTOR_SYNC_MAX_FAQ || 600), 50);
const MAX_NOTICE_DOCS = Math.max(Number(process.env.VECTOR_SYNC_MAX_NOTICE || 500), 50);

let timer = null;
let running = false;
let lastSummary = {
  syncedAt: null,
  upserted: 0,
  provider: resolveVectorProvider(),
  namespace: DEFAULT_VECTOR_NAMESPACE,
  documentsPrepared: 0,
  sourceCounts: {
    faq: 0,
    notice: 0
  },
  skipped: true
};

const isMongoReady = () => Number(mongoose?.connection?.readyState || 0) === 1;

const buildFaqDocs = async () => {
  const rows = await FAQ.find(
    { $or: [{ active: true }, { active: { $exists: false } }] },
    'question answer intentKey frequencyScore updatedAt'
  )
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(MAX_FAQ_DOCS)
    .lean();

  return rows.map((faq) => ({
    id: `faq:${faq._id}`,
    text: `FAQ Question: ${faq.question}\nFAQ Answer: ${faq.answer}`,
    metadata: {
      kind: 'FAQ',
      sourceId: String(faq._id),
      intentKey: faq.intentKey || '',
      frequencyScore: Number(faq.frequencyScore || 0),
      updatedAt: faq.updatedAt ? new Date(faq.updatedAt).toISOString() : null
    }
  }));
};

const buildNoticeDocs = async () => {
  const rows = await Notice.find(
    { isDeleted: { $ne: true } },
    'title subject summary extracted body content kind holidayName startDate endDate startDateTime endDateTime closureAllHalls rooms updatedAt'
  )
    .sort({ updatedAt: -1, createdAt: -1 })
    .limit(MAX_NOTICE_DOCS)
    .lean();

  return rows.map((notice) => ({
    id: `notice:${notice._id}`,
    text: [
      `Notice Title: ${notice.title || notice.subject || ''}`,
      `Notice Summary: ${notice.summary || notice.extracted || ''}`,
      `Notice Body: ${notice.body || notice.content || ''}`
    ].join('\n'),
    metadata: {
      kind: 'NOTICE',
      sourceId: String(notice._id),
      noticeKind: notice.kind || '',
      holidayName: notice.holidayName || '',
      closureAllHalls: Boolean(notice.closureAllHalls),
      rooms: Array.isArray(notice.rooms) ? notice.rooms.slice(0, 20) : [],
      startDate: notice.startDate || null,
      endDate: notice.endDate || null,
      updatedAt: notice.updatedAt ? new Date(notice.updatedAt).toISOString() : null
    }
  }));
};

const syncSupportKnowledgeVectors = async ({ force = false } = {}) => {
  if (running) return lastSummary;
  if (!force && String(process.env.VECTOR_SYNC_ENABLED || 'true').toLowerCase() === 'false') {
    return {
      ...lastSummary,
      skipped: true
    };
  }

  if (!isMongoReady()) {
    return {
      ...lastSummary,
      skipped: true,
      reason: 'mongo_not_ready'
    };
  }

  running = true;
  try {
    const [faqDocs, noticeDocs] = await Promise.all([buildFaqDocs(), buildNoticeDocs()]);
    const docs = faqDocs.concat(noticeDocs);

    const result = await upsertVectorDocuments({
      namespace: DEFAULT_VECTOR_NAMESPACE,
      documents: docs
    });

    lastSummary = {
      syncedAt: new Date().toISOString(),
      provider: result.provider,
      namespace: DEFAULT_VECTOR_NAMESPACE,
      upserted: Number(result.upserted || 0),
      documentsPrepared: docs.length,
      sourceCounts: {
        faq: faqDocs.length,
        notice: noticeDocs.length
      },
      skipped: false
    };

    logger.info('Vector knowledge sync completed', {
      provider: lastSummary.provider,
      upserted: lastSummary.upserted
    });

    return lastSummary;
  } catch (err) {
    lastSummary = {
      ...lastSummary,
      syncedAt: new Date().toISOString(),
      namespace: DEFAULT_VECTOR_NAMESPACE,
      skipped: true,
      reason: err.message || 'sync_failed'
    };
    logger.error('Vector knowledge sync failed', { error: err.message || err });
    return lastSummary;
  } finally {
    running = false;
  }
};

const startVectorKnowledgeSync = () => {
  if (timer) return;
  if (String(process.env.VECTOR_SYNC_ENABLED || 'true').toLowerCase() === 'false') {
    logger.info('Vector knowledge sync disabled via env', {});
    return;
  }

  timer = setInterval(() => {
    syncSupportKnowledgeVectors({ force: false }).catch(() => {});
  }, SYNC_INTERVAL_MS);

  syncSupportKnowledgeVectors({ force: false }).catch(() => {});
  logger.info('Vector knowledge sync scheduler started', { intervalMs: SYNC_INTERVAL_MS });
};

const getVectorKnowledgeSyncStatus = () => ({
  enabled: String(process.env.VECTOR_SYNC_ENABLED || 'true').toLowerCase() !== 'false',
  running,
  intervalMs: SYNC_INTERVAL_MS,
  provider: resolveVectorProvider(),
  namespace: DEFAULT_VECTOR_NAMESPACE,
  lastSummary: { ...lastSummary }
});

module.exports = {
  startVectorKnowledgeSync,
  syncSupportKnowledgeVectors,
  getVectorKnowledgeSyncStatus
};
