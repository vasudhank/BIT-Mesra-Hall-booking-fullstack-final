const express = require('express');
const router = express.Router();

const Notice = require('../models/notice');
const CalendarTask = require('../models/calendar_task');
const CalendarPreference = require('../models/calendar_preference');
const { fetchPublicHolidays } = require('../services/publicHolidayService');

const isFacultyOrAdmin = (req) =>
  Boolean(
    req.isAuthenticated &&
    req.isAuthenticated() &&
    ['Admin', 'Department'].includes(String(req.user?.type || ''))
  );

const isAuthenticatedUser = (req) =>
  Boolean(req.isAuthenticated && req.isAuthenticated() && req.user?.id && req.user?.type);

const isAdminUser = (req) =>
  Boolean(
    req.isAuthenticated &&
    req.isAuthenticated() &&
    String(req.user?.type || '') === 'Admin'
  );

const toDateOrNull = (value) => {
  if (!value) return null;
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const safeText = (value, max = 5000) =>
  String(value || '')
    .trim()
    .slice(0, max);

const toStringId = (value) => {
  if (!value) return '';
  try {
    return String(value);
  } catch (_) {
    return '';
  }
};

const actorFromReq = (req) => ({
  id: toStringId(req?.user?.id || req?.user?._id || ''),
  type: safeText(req?.user?.type || '', 40),
  email: safeText(req?.user?.email || '', 240).toLowerCase()
});

const taskOwnerFromRaw = (rawTask) => ({
  id: toStringId(rawTask?.createdBy?.id || ''),
  type: safeText(rawTask?.createdBy?.type || '', 40),
  email: safeText(rawTask?.createdBy?.email || '', 240).toLowerCase()
});

const canManageTask = (req, taskLike) => {
  if (!isFacultyOrAdmin(req)) return false;
  if (isAdminUser(req)) return true;

  const actor = actorFromReq(req);
  const rawTask = taskLike?.toObject ? taskLike.toObject() : taskLike;
  const owner = taskOwnerFromRaw(rawTask);

  if (actor.id && owner.id && actor.id === owner.id) return true;
  if (actor.email && owner.email && actor.email === owner.email) {
    if (!owner.type || !actor.type) return true;
    return actor.type === owner.type;
  }
  return false;
};

const normalizeThemeMode = (value) => {
  const mode = safeText(value, 20);
  if (mode === 'Light' || mode === 'Dark' || mode === 'Auto') return mode;
  return 'Light';
};

const escapeRegExp = (value) =>
  String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const buildSafeRegex = (value) => {
  const token = safeText(value, 160).trim();
  if (!token) return null;
  return new RegExp(escapeRegExp(token), 'i');
};

const extractSearchYears = (query, anchorYear = new Date().getFullYear()) => {
  const years = new Set([anchorYear - 1, anchorYear, anchorYear + 1, anchorYear + 2]);
  const matches = String(query || '').match(/\b(20\d{2})\b/g) || [];
  matches.forEach((token) => {
    const yr = Number(token);
    if (!Number.isFinite(yr)) return;
    years.add(yr - 1);
    years.add(yr);
    years.add(yr + 1);
  });
  return Array.from(years).filter((yr) => yr >= 2000 && yr <= 2100).sort((a, b) => a - b);
};

const normalizeNoticeTitle = (notice) =>
  safeText(notice?.title || notice?.subject || notice?.holidayName || 'Notice', 240);

const normalizeNoticeBody = (notice) =>
  safeText(notice?.summary || notice?.content || notice?.body || '', 1000);

const ensureNoticeStart = (notice) => toDateOrNull(notice?.startDateTime || notice?.createdAt || null);
const ensureNoticeEnd = (notice) => toDateOrNull(notice?.endDateTime || notice?.startDateTime || notice?.createdAt || null);

const intersectsRange = (start, end, rangeStart, rangeEnd) => {
  if (!start || !end || !rangeStart || !rangeEnd) return false;
  return start < rangeEnd && end > rangeStart;
};

const toAllDayBounds = (start, end) => {
  const startDay = new Date(start);
  startDay.setHours(0, 0, 0, 0);
  const endDay = new Date(end);
  endDay.setHours(0, 0, 0, 0);
  endDay.setDate(endDay.getDate() + 1); // exclusive end
  return { startDay, endDay };
};

const serializeTask = (task, req = null) => {
  const raw = task.toObject ? task.toObject() : task;
  const canEdit = req ? canManageTask(req, raw) : false;
  return {
    id: String(raw._id),
    taskId: String(raw._id),
    title: safeText(raw.title, 240),
    description: safeText(raw.description, 3000),
    start: raw.startDateTime,
    end: raw.endDateTime,
    allDay: Boolean(raw.allDay),
    source: 'TASK',
    color: '#0f766e',
    textColor: '#ffffff',
    createdBy: {
      id: toStringId(raw?.createdBy?.id || ''),
      type: safeText(raw?.createdBy?.type || '', 40),
      name: safeText(raw?.createdBy?.name || '', 160),
      email: safeText(raw?.createdBy?.email || '', 240)
    },
    canEdit,
    canDelete: canEdit
  };
};

const serializeNoticeEvents = (noticeDoc) => {
  const notice = noticeDoc.toObject ? noticeDoc.toObject() : noticeDoc;
  const start = ensureNoticeStart(notice);
  const end = ensureNoticeEnd(notice);
  if (!start || !end) return [];

  const isClosure = String(notice?.kind || '').toUpperCase() === 'HOLIDAY';
  const title = normalizeNoticeTitle(notice);
  const description = normalizeNoticeBody(notice);
  const { startDay, endDay } = toAllDayBounds(start, end);

  const fg = {
    id: `notice-${String(notice._id)}`,
    title: `${isClosure ? 'ALERT' : 'NOTICE'}: ${title}`,
    start: startDay,
    end: endDay,
    allDay: true,
    source: 'NOTICE',
    noticeId: String(notice._id),
    description,
    color: isClosure ? '#b91c1c' : '#1d4ed8',
    textColor: '#ffffff'
  };

  const bg = {
    id: `notice-bg-${String(notice._id)}`,
    start: startDay,
    end: endDay,
    allDay: true,
    display: 'background',
    source: 'NOTICE_BG',
    color: isClosure ? 'rgba(185, 28, 28, 0.18)' : 'rgba(29, 78, 216, 0.18)'
  };

  return [bg, fg];
};

const serializeHolidayEvents = (holiday) => ({
  id: `festival-${holiday.id}`,
  title: safeText(holiday.title, 220),
  start: holiday.startDateTime,
  end: holiday.endDateTime,
  allDay: true,
  source: 'FESTIVAL',
  color: '#15803d',
  textColor: '#ffffff'
});

const parseRange = (req) => {
  const start = toDateOrNull(req.query.start);
  const end = toDateOrNull(req.query.end);
  if (start && end && end > start) return { start, end };

  const now = new Date();
  const rangeStart = new Date(now);
  rangeStart.setMonth(rangeStart.getMonth() - 1);
  rangeStart.setHours(0, 0, 0, 0);
  const rangeEnd = new Date(now);
  rangeEnd.setMonth(rangeEnd.getMonth() + 3);
  rangeEnd.setHours(23, 59, 59, 999);
  return { start: rangeStart, end: rangeEnd };
};

const buildFeedUrl = (req) => {
  const token = safeText(process.env.CALENDAR_FEED_TOKEN || 'bit-booking-shared-feed', 120);
  const host = req.get('host');
  const proto =
    req.headers['x-forwarded-proto'] ||
    (req.protocol === 'https' ? 'https' : 'http');
  return `${proto}://${host}/api/calendar/feed/${token}.ics`;
};

router.get('/events', async (req, res) => {
  try {
    const { start, end } = parseRange(req);

    const notices = await Notice.find({
      isDeleted: { $ne: true },
      startDateTime: { $lt: end },
      endDateTime: { $gt: start }
    }).sort({ startDateTime: 1 });

    const noticeEvents = notices
      .flatMap((notice) => serializeNoticeEvents(notice))
      .filter((event) => intersectsRange(toDateOrNull(event.start), toDateOrNull(event.end), start, end));

    const years = [];
    for (let y = start.getFullYear(); y <= end.getFullYear(); y += 1) years.push(y);
    const holidayBatches = await Promise.all(years.map((year) => fetchPublicHolidays({ year, countryCode: 'IN' })));
    const holidayEvents = holidayBatches
      .flat()
      .map((holiday) => serializeHolidayEvents(holiday))
      .filter((event) => intersectsRange(toDateOrNull(event.start), toDateOrNull(event.end), start, end));

    let taskEvents = [];
    if (isFacultyOrAdmin(req)) {
      const tasks = await CalendarTask.find({
        startDateTime: { $lt: end },
        endDateTime: { $gt: start }
      }).sort({ startDateTime: 1 });
      taskEvents = tasks.map((task) => serializeTask(task, req));
    }

    return res.status(200).json({
      events: [...noticeEvents, ...holidayEvents, ...taskEvents],
      canManageTasks: isFacultyOrAdmin(req),
      feedUrl: buildFeedUrl(req)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to load calendar events' });
  }
});

router.get('/search', async (req, res) => {
  try {
    const query = safeText(req.query.q, 160).trim();
    const maxResults = Math.min(Math.max(Number(req.query.limit) || 160, 20), 400);
    if (!query) {
      return res.status(200).json({
        events: [],
        canManageTasks: isFacultyOrAdmin(req)
      });
    }

    const regex = buildSafeRegex(query);
    if (!regex) {
      return res.status(200).json({
        events: [],
        canManageTasks: isFacultyOrAdmin(req)
      });
    }

    const noticeDocs = await Notice.find({
      isDeleted: { $ne: true },
      $or: [
        { title: regex },
        { subject: regex },
        { body: regex },
        { content: regex },
        { summary: regex },
        { extracted: regex },
        { holidayName: regex }
      ]
    })
      .sort({ startDateTime: 1, createdAt: 1 })
      .limit(maxResults);

    const noticeEvents = noticeDocs
      .flatMap((notice) => serializeNoticeEvents(notice))
      .filter((event) => String(event?.source || '') === 'NOTICE');

    let taskEvents = [];
    if (isFacultyOrAdmin(req)) {
      const tasks = await CalendarTask.find({
        $or: [{ title: regex }, { description: regex }]
      })
        .sort({ startDateTime: 1, createdAt: 1 })
        .limit(maxResults);
      taskEvents = tasks.map((task) => serializeTask(task, req));
    }

    const searchYears = extractSearchYears(query);
    const holidayBatches = await Promise.all(
      searchYears.map((year) => fetchPublicHolidays({ year, countryCode: 'IN' }).catch(() => []))
    );
    const holidayEvents = holidayBatches
      .flat()
      .filter((holiday) => regex.test(String(holiday?.title || '')))
      .map((holiday) => serializeHolidayEvents(holiday));

    const combined = [...noticeEvents, ...taskEvents, ...holidayEvents]
      .sort((a, b) => {
        const aStart = toDateOrNull(a?.start);
        const bStart = toDateOrNull(b?.start);
        if (!aStart && !bStart) return 0;
        if (!aStart) return 1;
        if (!bStart) return -1;
        return aStart - bStart;
      })
      .slice(0, maxResults);

    return res.status(200).json({
      events: combined,
      canManageTasks: isFacultyOrAdmin(req)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to search calendar events' });
  }
});

router.get('/appearance', async (req, res) => {
  try {
    if (!isAuthenticatedUser(req)) {
      return res.status(401).json({ error: 'Login required to load account appearance' });
    }

    const ownerId = String(req.user.id);
    const ownerType = safeText(req.user.type, 40);
    const pref = await CalendarPreference.findOne({ ownerId, ownerType });

    return res.status(200).json({
      themeMode: normalizeThemeMode(pref?.themeMode || 'Light')
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to load calendar appearance' });
  }
});

router.put('/appearance', async (req, res) => {
  try {
    if (!isAuthenticatedUser(req)) {
      return res.status(401).json({ error: 'Login required to save account appearance' });
    }

    const ownerId = String(req.user.id);
    const ownerType = safeText(req.user.type, 40);
    const themeMode = normalizeThemeMode(req.body?.themeMode);

    const pref = await CalendarPreference.findOneAndUpdate(
      { ownerId, ownerType },
      { $set: { themeMode } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.status(200).json({
      themeMode: normalizeThemeMode(pref?.themeMode || themeMode)
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to save calendar appearance' });
  }
});

router.post('/tasks', async (req, res) => {
  try {
    if (!isFacultyOrAdmin(req)) {
      return res.status(403).json({ error: 'Login as admin/faculty to create tasks' });
    }

    const title = safeText(req.body.title, 240);
    const description = safeText(req.body.description, 4000);
    const allDay = Boolean(req.body.allDay);
    const start = toDateOrNull(req.body.startDateTime);
    const end = toDateOrNull(req.body.endDateTime);

    if (!title) return res.status(400).json({ error: 'Task title is required' });
    if (!start || !end) return res.status(400).json({ error: 'Valid startDateTime and endDateTime are required' });
    if (end <= start) return res.status(400).json({ error: 'Task end time must be after start time' });

    const task = await CalendarTask.create({
      title,
      description,
      startDateTime: start,
      endDateTime: end,
      allDay,
      createdBy: {
        id: req.user?.id || req.user?._id || null,
        type: req.user?.type || '',
        name: req.user?.name || req.user?.head || req.user?.department || req.user?.email || 'User',
        email: req.user?.email || ''
      }
    });

    return res.status(201).json({ task: serializeTask(task, req) });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to create task' });
  }
});

router.put('/tasks/:id', async (req, res) => {
  try {
    if (!isFacultyOrAdmin(req)) {
      return res.status(403).json({ error: 'Login as admin/faculty to edit tasks' });
    }

    const task = await CalendarTask.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!canManageTask(req, task)) {
      return res.status(403).json({ error: 'Not allowed to edit this task' });
    }

    const hasTitle = Object.prototype.hasOwnProperty.call(req.body || {}, 'title');
    const hasDescription = Object.prototype.hasOwnProperty.call(req.body || {}, 'description');
    const hasAllDay = Object.prototype.hasOwnProperty.call(req.body || {}, 'allDay');
    const hasStart = Object.prototype.hasOwnProperty.call(req.body || {}, 'startDateTime');
    const hasEnd = Object.prototype.hasOwnProperty.call(req.body || {}, 'endDateTime');

    const nextTitle = hasTitle ? safeText(req.body.title, 240) : safeText(task.title, 240);
    const nextDescription = hasDescription ? safeText(req.body.description, 4000) : safeText(task.description, 4000);
    const nextAllDay = hasAllDay ? Boolean(req.body.allDay) : Boolean(task.allDay);
    const nextStart = hasStart ? toDateOrNull(req.body.startDateTime) : toDateOrNull(task.startDateTime);
    const nextEnd = hasEnd ? toDateOrNull(req.body.endDateTime) : toDateOrNull(task.endDateTime);

    if (!nextTitle) return res.status(400).json({ error: 'Task title is required' });
    if (!nextStart || !nextEnd) {
      return res.status(400).json({ error: 'Valid startDateTime and endDateTime are required' });
    }
    if (nextEnd <= nextStart) {
      return res.status(400).json({ error: 'Task end time must be after start time' });
    }

    task.title = nextTitle;
    task.description = nextDescription;
    task.allDay = nextAllDay;
    task.startDateTime = nextStart;
    task.endDateTime = nextEnd;
    await task.save();

    return res.status(200).json({ task: serializeTask(task, req) });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to update task' });
  }
});

router.delete('/tasks/:id', async (req, res) => {
  try {
    if (!isFacultyOrAdmin(req)) {
      return res.status(403).json({ error: 'Login as admin/faculty to delete tasks' });
    }

    const task = await CalendarTask.findById(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    if (!canManageTask(req, task)) {
      return res.status(403).json({ error: 'Not allowed to delete this task' });
    }

    await CalendarTask.deleteOne({ _id: task._id });
    return res.status(200).json({ success: true, id: String(task._id) });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to delete task' });
  }
});

const formatUtc = (value) => {
  const dt = toDateOrNull(value);
  if (!dt) return '';
  const iso = dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  return iso;
};

const formatDateOnly = (value) => {
  const dt = toDateOrNull(value);
  if (!dt) return '';
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const d = String(dt.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
};

const escapeIcs = (text) =>
  String(text || '')
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');

const toIcsEvent = ({ uid, title, description, start, end, allDay = true }) => {
  const lines = [
    'BEGIN:VEVENT',
    `UID:${escapeIcs(uid)}`,
    `DTSTAMP:${formatUtc(new Date())}`,
    `SUMMARY:${escapeIcs(title)}`
  ];

  if (description) lines.push(`DESCRIPTION:${escapeIcs(description)}`);

  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${formatDateOnly(start)}`);
    lines.push(`DTEND;VALUE=DATE:${formatDateOnly(end)}`);
  } else {
    lines.push(`DTSTART:${formatUtc(start)}`);
    lines.push(`DTEND:${formatUtc(end)}`);
  }

  lines.push('END:VEVENT');
  return lines.join('\r\n');
};

router.get('/feed/:token.ics', async (req, res) => {
  try {
    const incomingToken = safeText(req.params.token, 160);
    const expectedToken = safeText(process.env.CALENDAR_FEED_TOKEN || 'bit-booking-shared-feed', 160);
    if (!incomingToken || incomingToken !== expectedToken) {
      return res.status(403).send('Invalid feed token');
    }

    const now = new Date();
    const start = new Date(now);
    start.setMonth(start.getMonth() - 2);
    const end = new Date(now);
    end.setMonth(end.getMonth() + 12);

    const notices = await Notice.find({
      isDeleted: { $ne: true },
      startDateTime: { $lt: end },
      endDateTime: { $gt: start }
    }).sort({ startDateTime: 1 });

    const tasks = await CalendarTask.find({
      startDateTime: { $lt: end },
      endDateTime: { $gt: start }
    }).sort({ startDateTime: 1 });

    const years = [];
    for (let y = start.getFullYear(); y <= end.getFullYear(); y += 1) years.push(y);
    const holidayBatches = await Promise.all(years.map((year) => fetchPublicHolidays({ year, countryCode: 'IN' })));
    const holidays = holidayBatches.flat();

    const events = [];

    notices.forEach((notice) => {
      const startDt = ensureNoticeStart(notice);
      const endDt = ensureNoticeEnd(notice);
      if (!startDt || !endDt) return;
      const { startDay, endDay } = toAllDayBounds(startDt, endDt);
      events.push(toIcsEvent({
        uid: `notice-${String(notice._id)}@bit-booking`,
        title: `${String(notice.kind || '').toUpperCase() === 'HOLIDAY' ? 'ALERT' : 'NOTICE'}: ${normalizeNoticeTitle(notice)}`,
        description: normalizeNoticeBody(notice),
        start: startDay,
        end: endDay,
        allDay: true
      }));
    });

    tasks.forEach((task) => {
      const startDt = toDateOrNull(task.startDateTime);
      const endDt = toDateOrNull(task.endDateTime);
      if (!startDt || !endDt) return;
      events.push(toIcsEvent({
        uid: `task-${String(task._id)}@bit-booking`,
        title: `TASK: ${safeText(task.title, 240)}`,
        description: safeText(task.description, 3000),
        start: startDt,
        end: endDt,
        allDay: Boolean(task.allDay)
      }));
    });

    holidays.forEach((holiday) => {
      events.push(toIcsEvent({
        uid: `festival-${holiday.id}@bit-booking`,
        title: safeText(holiday.title, 240),
        description: 'Imported public festival/holiday',
        start: holiday.startDateTime,
        end: holiday.endDateTime,
        allDay: true
      }));
    });

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//BIT Booking//Shared Calendar//EN',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      ...events,
      'END:VCALENDAR'
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="bit-booking-calendar.ics"');
    return res.status(200).send(ics);
  } catch (err) {
    return res.status(500).send('Calendar feed failed');
  }
});

module.exports = router;
