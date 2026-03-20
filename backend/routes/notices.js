const express = require('express');
const router = express.Router();

const {
  createNotice,
  listNotices,
  getNoticeById,
  getNoticeClosures
} = require('../services/noticeService');
const {
  getNoticeTrashRetentionDays,
  setNoticeTrashRetentionDays,
  runNoticeTrashCleanup
} = require('../services/noticeTrashCleanupService');
const { runNoticeMailSyncNow } = require('../services/noticeMailSyncService');
const Notice = require('../models/notice');
const { syncNoticeToRegisteredCalendars } = require('../services/noticeCalendarSyncService');

const isAdmin = (req) =>
  Boolean(req.isAuthenticated && req.isAuthenticated() && String(req.user?.type || '') === 'Admin');

const safeText = (value, max = 4000) =>
  String(value ?? '')
    .trim()
    .slice(0, max);

const sanitizeHtmlSnippet = (value, max = 150000) =>
  safeText(value, max)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');

const hasField = (obj, key) => Object.prototype.hasOwnProperty.call(obj || {}, key);

const uniqueStrings = (list) =>
  Array.from(
    new Set(
      (Array.isArray(list) ? list : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  );

const parseRoomsInput = (value) => {
  if (value === undefined || value === null || value === '') return [];
  if (Array.isArray(value)) {
    return uniqueStrings(value.map((item) => safeText(item, 120)));
  }
  return uniqueStrings(
    String(value)
      .split(/[,\n;|]/)
      .map((item) => safeText(item, 120))
  );
};

const parseBooleanStrict = (value) => {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true' || normalized === '1' || normalized === 'yes') return true;
    if (normalized === 'false' || normalized === '0' || normalized === 'no') return false;
  }
  return null;
};

const parseKind = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'GENERAL' || normalized === 'HOLIDAY' ? normalized : '';
};

const toDateOrNull = (value) => {
  if (value === null || value === '') return null;
  if (value === undefined) return undefined;
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dt.getTime()) ? 'INVALID' : dt;
};

const parseRetentionDays = (value) => {
  const days = Number(value);
  if (!Number.isFinite(days)) return NaN;
  return Math.max(1, Math.min(365, Math.floor(days)));
};

router.get('/', async (req, res) => {
  try {
    const includeDeleted = String(req.query.includeDeleted || '').trim() === '1';
    const onlyDeleted = String(req.query.onlyDeleted || '').trim() === '1';
    if ((includeDeleted || onlyDeleted) && !isAdmin(req)) {
      return res.status(403).json({ error: 'Only admin can access deleted notices' });
    }

    const notices = await listNotices({
      search: req.query.search,
      sort: req.query.sort,
      kind: req.query.kind,
      limit: req.query.limit,
      includeDeleted,
      onlyDeleted
    });
    return res.status(200).json({ notices });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to list notices' });
  }
});

router.get('/closures', async (req, res) => {
  try {
    const { hall, startDateTime, endDateTime, date } = req.query;
    let resolvedStart = startDateTime ? new Date(startDateTime) : null;
    let resolvedEnd = endDateTime ? new Date(endDateTime) : null;

    if ((!resolvedStart || Number.isNaN(resolvedStart.getTime())) && date) {
      resolvedStart = new Date(`${date}T00:00:00`);
    }
    if ((!resolvedEnd || Number.isNaN(resolvedEnd.getTime())) && date) {
      resolvedEnd = new Date(`${date}T23:59:59.999`);
    }

    if (!resolvedStart || Number.isNaN(resolvedStart.getTime()) || !resolvedEnd || Number.isNaN(resolvedEnd.getTime())) {
      return res.status(400).json({ error: 'startDateTime/endDateTime or date is required' });
    }

    const closures = await getNoticeClosures({
      hallName: hall || '',
      startDateTime: resolvedStart,
      endDateTime: resolvedEnd
    });

    return res.status(200).json({ closures });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch closures' });
  }
});

router.get('/trash', async (req, res) => {
  try {
    await runNoticeTrashCleanup();

    const notices = await listNotices({
      search: req.query.search,
      sort: req.query.sort || 'TRASH_LATEST',
      kind: req.query.kind,
      limit: req.query.limit || 200,
      onlyDeleted: true
    });

    return res.status(200).json({ notices });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch notice trash' });
  }
});

router.get('/trash/retention', async (req, res) => {
  try {
    const retentionDays = await getNoticeTrashRetentionDays();
    return res.status(200).json({ retentionDays, maxDays: 365, defaultDays: 30 });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch notice trash retention' });
  }
});

router.patch('/trash/retention', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Only admin can update trash retention' });
    }

    const requestedDays = parseRetentionDays(req.body?.retentionDays);
    if (!Number.isFinite(requestedDays)) {
      return res.status(400).json({ error: 'retentionDays must be a number between 1 and 365' });
    }

    const updatedBy = req.user?.name || req.user?.email || 'Admin';
    const retentionDays = await setNoticeTrashRetentionDays(requestedDays, updatedBy);
    await runNoticeTrashCleanup({ force: true });

    return res.status(200).json({ success: true, retentionDays, maxDays: 365 });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to update notice trash retention' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const notice = await getNoticeById(req.params.id);
    if (!notice) return res.status(404).json({ error: 'Notice not found' });
    return res.status(200).json({ notice });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to fetch notice' });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Only admin can edit notices' });
    }

    const notice = await Notice.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!notice) return res.status(404).json({ error: 'Notice not found' });

    const body = req.body || {};
    const editTitle = hasField(body, 'title');
    const editSubject = hasField(body, 'subject');
    const editDescription =
      hasField(body, 'description') || hasField(body, 'content') || hasField(body, 'body') || hasField(body, 'summary');
    const editStart = hasField(body, 'startDateTime');
    const editEnd = hasField(body, 'endDateTime');
    const editKind = hasField(body, 'kind');
    const editHolidayName = hasField(body, 'holidayName');
    const editClosureAllHalls = hasField(body, 'closureAllHalls');
    const editRooms = hasField(body, 'rooms') || hasField(body, 'halls');
    const editPublicStyle = hasField(body, 'publicStyle');

    if (
      !editTitle &&
      !editSubject &&
      !editDescription &&
      !editStart &&
      !editEnd &&
      !editKind &&
      !editHolidayName &&
      !editClosureAllHalls &&
      !editRooms &&
      !editPublicStyle
    ) {
      return res.status(400).json({ error: 'No editable notice fields provided' });
    }

    if (editTitle || editSubject) {
      const incomingTitle = safeText(body.title, 240);
      const incomingSubject = safeText(body.subject, 240);
      const merged = incomingTitle || incomingSubject;
      if (!merged) {
        return res.status(400).json({ error: 'Updated title/subject is required' });
      }
      notice.title = merged;
      notice.subject = incomingSubject || merged;
    }

    if (editDescription) {
      const description = safeText(body.description ?? body.content ?? body.body ?? body.summary, 10000);
      notice.content = description;
      notice.body = description;
      notice.summary = description;
      notice.extracted = safeText(description, 500);
    }

    if (editStart || editEnd) {
      const nextStart = editStart ? toDateOrNull(body.startDateTime) : notice.startDateTime;
      const nextEnd = editEnd ? toDateOrNull(body.endDateTime) : notice.endDateTime;

      if (nextStart === 'INVALID' || nextEnd === 'INVALID') {
        return res.status(400).json({ error: 'Invalid startDateTime/endDateTime' });
      }

      if (nextStart && nextEnd && nextEnd <= nextStart) {
        return res.status(400).json({ error: 'endDateTime must be after startDateTime' });
      }

      notice.startDateTime = nextStart || null;
      notice.endDateTime = nextEnd || null;
    }

    if (editKind) {
      const kind = parseKind(body.kind);
      if (!kind) {
        return res.status(400).json({ error: 'Invalid kind. Use GENERAL or HOLIDAY.' });
      }
      notice.kind = kind;
    }

    if (editHolidayName) {
      notice.holidayName = safeText(body.holidayName, 180);
    }

    if (editClosureAllHalls) {
      const closure = parseBooleanStrict(body.closureAllHalls);
      if (closure === null) {
        return res.status(400).json({ error: 'closureAllHalls must be a boolean value' });
      }
      notice.closureAllHalls = closure;
    }

    if (editRooms) {
      const rooms = parseRoomsInput(body.rooms ?? body.halls);
      notice.rooms = rooms;
      notice.halls = rooms;
    }

    if (editPublicStyle) {
      const styleInput = body.publicStyle && typeof body.publicStyle === 'object' ? body.publicStyle : {};
      notice.publicStyle = {
        ...((notice.publicStyle && typeof notice.publicStyle === 'object') ? notice.publicStyle : {}),
        titleColor: safeText(styleInput.titleColor, 40),
        descriptionColor: safeText(styleInput.descriptionColor, 40),
        contentHtml: sanitizeHtmlSnippet(styleInput.contentHtml, 150000),
        updatedAt: new Date(),
        updatedBy: safeText(req.user?.name || req.user?.email || 'Admin', 120)
      };
    }

    await notice.save();

    return res.status(200).json({
      notice: {
        _id: String(notice._id),
        title: notice.title || '',
        subject: notice.subject || '',
        summary: notice.summary || '',
        content: notice.content || '',
        body: notice.body || '',
        startDateTime: notice.startDateTime || null,
        endDateTime: notice.endDateTime || null,
        kind: notice.kind || 'GENERAL',
        holidayName: notice.holidayName || '',
        closureAllHalls: Boolean(notice.closureAllHalls),
        rooms: Array.isArray(notice.rooms) ? notice.rooms : [],
        publicStyle: notice.publicStyle || {}
      }
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to update notice' });
  }
});

router.post('/', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Only admin can post notices' });
    }

    const subject = String(req.body.title || req.body.subject || '').trim();
    const body = String(req.body.content || req.body.body || '').trim();
    if (!subject && !body) {
      return res.status(400).json({ error: 'Notice title or content is required' });
    }

    const { notice } = await createNotice({
      subject,
      body,
      source: 'ADMIN',
      manualOverrides: {
        kind: req.body.kind,
        holidayName: req.body.holidayName,
        startDateTime: req.body.startDateTime,
        endDateTime: req.body.endDateTime,
        closureAllHalls: req.body.closureAllHalls,
        rooms: req.body.rooms,
        title: req.body.title,
        content: req.body.content
      },
      postedBy: {
        id: req.user?._id || null,
        type: req.user?.type || '',
        name: req.user?.name || req.user?.email || 'Admin'
      }
    });

    return res.status(201).json({ notice });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to create notice' });
  }
});

router.post('/sync_email', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Only admin can trigger notice email sync' });
    }
    await runNoticeMailSyncNow();
    return res.status(200).json({ success: true, message: 'Notice email sync triggered.' });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to trigger sync' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Only admin can delete notices' });
    }

    const notice = await Notice.findOne({ _id: req.params.id, isDeleted: { $ne: true } });
    if (!notice) return res.status(404).json({ error: 'Notice not found' });

    notice.isDeleted = true;
    notice.deletedAt = new Date();
    notice.deletedBy = {
      id: req.user?._id || null,
      type: req.user?.type || '',
      name: req.user?.name || req.user?.email || 'Admin'
    };
    await notice.save();

    return res.status(200).json({
      success: true,
      noticeId: String(notice._id),
      deletedAt: notice.deletedAt
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to delete notice' });
  }
});

router.patch('/:id/restore', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Only admin can restore notices' });
    }

    const notice = await Notice.findOne({ _id: req.params.id, isDeleted: true });
    if (!notice) return res.status(404).json({ error: 'Deleted notice not found' });

    notice.isDeleted = false;
    notice.deletedAt = null;
    notice.deletedBy = {
      id: null,
      type: '',
      name: ''
    };
    await notice.save();

    return res.status(200).json({
      success: true,
      noticeId: String(notice._id)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to restore notice' });
  }
});

router.delete('/:id/permanent', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Only admin can permanently delete notices' });
    }

    const notice = await Notice.findOne({ _id: req.params.id, isDeleted: true });
    if (!notice) return res.status(404).json({ error: 'Deleted notice not found' });

    await Notice.deleteOne({ _id: notice._id });

    return res.status(200).json({
      success: true,
      noticeId: String(notice._id)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to permanently delete notice' });
  }
});

router.post('/sync_calendar', async (req, res) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Only admin can trigger calendar sync' });
    }

    const noticeId = String(req.body.noticeId || '').trim();
    const lookbackDays = Math.max(Number(req.body.lookbackDays || 7), 1);
    const maxItems = Math.min(Math.max(Number(req.body.limit || 30), 1), 200);

    let notices = [];
    if (noticeId) {
      const one = await Notice.findOne({ _id: noticeId, isDeleted: { $ne: true } });
      if (!one) return res.status(404).json({ error: 'Notice not found' });
      notices = [one];
    } else {
      const since = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000);
      notices = await Notice.find({ isDeleted: { $ne: true }, createdAt: { $gte: since } })
        .sort({ createdAt: -1 })
        .limit(maxItems);
    }

    const outputs = [];
    for (const notice of notices) {
      // eslint-disable-next-line no-await-in-loop
      const result = await syncNoticeToRegisteredCalendars(notice);
      outputs.push({
        noticeId: String(notice._id),
        sent: result.sent,
        failed: result.failed,
        skipped: result.skipped,
        reason: result.reason || null
      });
    }

    return res.status(200).json({
      success: true,
      processed: outputs.length,
      results: outputs
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to sync notice calendar invites' });
  }
});

module.exports = router;
