const Notice = require('../models/notice');
const NoticeTrashSetting = require('../models/noticeTrashSetting');

const DEFAULT_RETENTION_DAYS = 30;
const MAX_RETENTION_DAYS = 365;
const MIN_RETENTION_DAYS = 1;

const MIN_CLEANUP_INTERVAL_MS = 30 * 1000;
const DEFAULT_SCHEDULE_INTERVAL_MS = 60 * 60 * 1000;

let cleanupInProgress = false;
let lastCleanupAt = 0;

const clampRetentionDays = (value) => {
  const days = Number(value);
  if (!Number.isFinite(days)) return DEFAULT_RETENTION_DAYS;
  return Math.max(MIN_RETENTION_DAYS, Math.min(MAX_RETENTION_DAYS, Math.floor(days)));
};

const getOrCreateRetentionSetting = async () => {
  const doc = await NoticeTrashSetting.findOneAndUpdate(
    { key: 'default' },
    {
      $setOnInsert: {
        key: 'default',
        retentionDays: DEFAULT_RETENTION_DAYS,
        updatedBy: 'System'
      }
    },
    {
      new: true,
      upsert: true
    }
  );
  return doc;
};

const getNoticeTrashRetentionDays = async () => {
  const setting = await getOrCreateRetentionSetting();
  return clampRetentionDays(setting?.retentionDays);
};

const setNoticeTrashRetentionDays = async (retentionDays, updatedBy = 'Admin') => {
  const normalizedDays = clampRetentionDays(retentionDays);
  const setting = await NoticeTrashSetting.findOneAndUpdate(
    { key: 'default' },
    {
      $set: {
        retentionDays: normalizedDays,
        updatedBy: String(updatedBy || 'Admin').trim().slice(0, 120) || 'Admin'
      },
      $setOnInsert: { key: 'default' }
    },
    {
      new: true,
      upsert: true
    }
  );
  return clampRetentionDays(setting?.retentionDays);
};

const runNoticeTrashCleanup = async ({ force = false } = {}) => {
  const nowMs = Date.now();

  if (cleanupInProgress) {
    return { skipped: true, reason: 'in_progress' };
  }

  if (!force && nowMs - lastCleanupAt < MIN_CLEANUP_INTERVAL_MS) {
    return { skipped: true, reason: 'throttled' };
  }

  cleanupInProgress = true;
  try {
    const retentionDays = await getNoticeTrashRetentionDays();
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await Notice.deleteMany({
      isDeleted: true,
      deletedAt: { $ne: null, $lte: cutoff }
    });

    lastCleanupAt = Date.now();
    return {
      skipped: false,
      retentionDays,
      deletedCount: Number(result?.deletedCount || 0)
    };
  } finally {
    cleanupInProgress = false;
  }
};

const startNoticeTrashCleanupSchedule = () => {
  runNoticeTrashCleanup({ force: true }).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[NoticeTrashCleanup] initial cleanup failed:', err.message);
  });

  const timer = setInterval(() => {
    runNoticeTrashCleanup().catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[NoticeTrashCleanup] scheduled cleanup failed:', err.message);
    });
  }, DEFAULT_SCHEDULE_INTERVAL_MS);

  if (typeof timer.unref === 'function') {
    timer.unref();
  }

  return timer;
};

module.exports = {
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  getNoticeTrashRetentionDays,
  setNoticeTrashRetentionDays,
  runNoticeTrashCleanup,
  startNoticeTrashCleanupSchedule
};
