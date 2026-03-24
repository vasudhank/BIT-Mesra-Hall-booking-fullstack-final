const Notice = require('../models/notice');
const { parseNoticeContent, normalizeRoomKey } = require('./noticeParserService');
const { queueNoticeCalendarSync } = require('./noticeCalendarSyncService');

const DEFAULT_LIMIT = 200;

const parsePositiveInt = (value, fallback) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.floor(num);
};

const toDateOrNull = (value) => {
  if (!value) return null;
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const safeStyleText = (value, max = 160000) =>
  String(value ?? '')
    .trim()
    .slice(0, max);

const sanitizeStyleHtml = (value, max = 150000) =>
  safeStyleText(value, max)
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\son[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/javascript:/gi, '');

const normalizePublicStyle = (value) => {
  const style = value && typeof value === 'object' ? value : {};
  return {
    titleColor: safeStyleText(style.titleColor, 40),
    descriptionColor: safeStyleText(style.descriptionColor, 40),
    contentHtml: sanitizeStyleHtml(style.contentHtml, 150000),
    updatedAt: style.updatedAt || null,
    updatedBy: safeStyleText(style.updatedBy, 120)
  };
};

const normalizeNoticeSort = (sort) => {
  const key = String(sort || '').toUpperCase();
  if (key === 'TRASH_LATEST') return { deletedAt: -1, createdAt: -1 };
  if (key === 'TRASH_OLDEST') return { deletedAt: 1, createdAt: 1 };
  if (key === 'PUBLISHED_LATEST') return { createdAt: -1 };
  if (key === 'PUBLISHED_OLDEST') return { createdAt: 1 };
  if (key === 'OLDEST') return { createdAt: 1 };
  if (key === 'TITLE_ASC') return { title: 1, createdAt: -1 };
  if (key === 'TITLE_DESC') return { title: -1, createdAt: -1 };
  if (key === 'HOLIDAY_FIRST') return { kind: -1, createdAt: -1 };
  return { createdAt: -1 };
};

const buildTextSearchFilter = (query) => {
  const q = String(query || '').trim();
  if (!q) return null;
  return {
    $or: [
      { title: { $regex: q, $options: 'i' } },
      { subject: { $regex: q, $options: 'i' } },
      { summary: { $regex: q, $options: 'i' } },
      { content: { $regex: q, $options: 'i' } },
      { holidayName: { $regex: q, $options: 'i' } }
    ]
  };
};

const buildNoticesQuery = ({ search = '', kind = '', includeDeleted = false, onlyDeleted = false }) => {
  const filters = [];
  if (onlyDeleted) {
    filters.push({ isDeleted: true });
  } else if (!includeDeleted) {
    filters.push({ isDeleted: { $ne: true } });
  }

  const textFilter = buildTextSearchFilter(search);
  if (textFilter) filters.push(textFilter);

  const normalizedKind = String(kind || '').toUpperCase();
  if (normalizedKind === 'GENERAL' || normalizedKind === 'HOLIDAY') {
    filters.push({ kind: normalizedKind });
  }

  if (!filters.length) return {};
  if (filters.length === 1) return filters[0];
  return { $and: filters };
};

const roomMatches = (noticeRooms, hallName) => {
  const hallKey = normalizeRoomKey(hallName);
  if (!hallKey) return false;
  return (Array.isArray(noticeRooms) ? noticeRooms : []).some((room) => {
    const roomKey = normalizeRoomKey(room);
    return roomKey && (hallKey.includes(roomKey) || roomKey.includes(hallKey));
  });
};

const hasAnyRooms = (notice) =>
  (Array.isArray(notice?.rooms) && notice.rooms.length > 0) ||
  (Array.isArray(notice?.halls) && notice.halls.length > 0);

const inferGlobalHolidayClosure = (notice) => {
  const kind = String(notice?.kind || '').toUpperCase();
  if (kind !== 'HOLIDAY') return false;
  if (hasAnyRooms(notice)) return false;
  const text = `${notice?.title || ''}\n${notice?.subject || ''}\n${notice?.summary || ''}\n${notice?.body || ''}\n${notice?.content || ''}`;
  if (!String(text).trim()) return true;
  return /\b(all day|entire day|institute|campus|remain closed|closed|closure|not bookable|no booking)\b/i.test(text);
};

const isNoticeGlobalClosure = (notice) =>
  Boolean(notice?.closureAllHalls) || inferGlobalHolidayClosure(notice);

const cleanHolidayName = (value) => {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^regarding\b/i.test(text)) return '';
  return text;
};

const noticeOverlapsRange = (notice, startDateTime, endDateTime) => {
  const start = toDateOrNull(notice.startDateTime || notice.startDate || null);
  const end = toDateOrNull(notice.endDateTime || notice.endDate || null);
  if (!start || !end) return false;
  return start < endDateTime && end > startDateTime;
};

const serializeNotice = (noticeDoc) => {
  if (!noticeDoc) return null;
  const notice = noticeDoc.toObject ? noticeDoc.toObject() : noticeDoc;
  const globalClosure = isNoticeGlobalClosure(notice);
  return {
    _id: String(notice._id),
    title: notice.title || notice.subject || 'Notice',
    subject: notice.subject || notice.title || 'Notice',
    summary: notice.summary || notice.extracted || '',
    body: notice.body || notice.content || '',
    content: notice.content || notice.body || '',
    source: notice.source || 'ADMIN',
    emailFrom: notice.emailFrom || '',
    emailMessageId: notice.emailMessageId || '',
    kind: notice.kind || 'GENERAL',
    holidayName: cleanHolidayName(notice.holidayName),
    startDateTime: notice.startDateTime || null,
    endDateTime: notice.endDateTime || null,
    closureAllHalls: globalClosure,
    rooms: Array.isArray(notice.rooms) ? notice.rooms : [],
    halls: Array.isArray(notice.halls) ? notice.halls : [],
    postedBy: {
      id: notice?.postedBy?.id || null,
      type: notice?.postedBy?.type || '',
      name: notice?.postedBy?.name || ''
    },
    parsedMeta: notice?.parsedMeta && typeof notice.parsedMeta === 'object' ? notice.parsedMeta : {},
    publicStyle: normalizePublicStyle(notice.publicStyle),
    isDeleted: Boolean(notice.isDeleted),
    deletedAt: notice.deletedAt || null,
    deletedBy: {
      type: notice?.deletedBy?.type || '',
      name: notice?.deletedBy?.name || ''
    },
    createdAt: notice.createdAt || null,
    updatedAt: notice.updatedAt || null
  };
};

const serializeNoticeConflict = (noticeDoc, hallName) => {
  const n = serializeNotice(noticeDoc);
  return {
    noticeId: n._id,
    title: n.title,
    holidayName: n.holidayName || n.title,
    kind: n.kind,
    startDateTime: n.startDateTime,
    endDateTime: n.endDateTime,
    closureAllHalls: n.closureAllHalls,
    rooms: n.rooms,
    source: n.source,
    summary: n.summary,
    hall: hallName
  };
};

const createNotice = async ({
  subject = '',
  body = '',
  source = 'ADMIN',
  emailMessageId = '',
  emailFrom = '',
  manualOverrides = {},
  postedBy = {}
}) => {
  const parsed = parseNoticeContent({ subject, body, manualOverrides });

  if (emailMessageId) {
    const existing = await Notice.findOne({ emailMessageId: String(emailMessageId).trim() });
    if (existing) return { notice: existing, created: false };
  }

  const notice = await Notice.create({
    ...parsed,
    source: String(source || 'ADMIN').toUpperCase(),
    emailMessageId: String(emailMessageId || '').trim(),
    emailFrom: String(emailFrom || '').trim(),
    postedBy: {
      id: postedBy?.id || null,
      type: postedBy?.type || '',
      name: postedBy?.name || ''
    }
  });

  // Async fan-out: push new notice as calendar invite to all registered accounts.
  queueNoticeCalendarSync(notice);

  return { notice, created: true };
};

const listNotices = async ({ search, sort, kind, limit, includeDeleted = false, onlyDeleted = false }) => {
  const maxLimit = Math.min(parsePositiveInt(limit, DEFAULT_LIMIT), 500);
  const query = buildNoticesQuery({ search, kind, includeDeleted, onlyDeleted });
  const docs = await Notice.find(query).sort(normalizeNoticeSort(sort)).limit(maxLimit);
  return docs.map(serializeNotice);
};

const getNoticeById = async (id, { includeDeleted = false } = {}) => {
  const query = includeDeleted
    ? { _id: id }
    : { _id: id, isDeleted: { $ne: true } };
  const doc = await Notice.findOne(query);
  return serializeNotice(doc);
};

const getNoticeConflictsForRange = async ({ hallName, startDateTime, endDateTime }) => {
  const start = toDateOrNull(startDateTime);
  const end = toDateOrNull(endDateTime);
  if (!start || !end || !hallName) return [];
  if (end <= start) return [];

  const candidates = await Notice.find({
    isDeleted: { $ne: true },
    kind: 'HOLIDAY',
    startDateTime: { $lt: end },
    endDateTime: { $gt: start }
  }).sort({ startDateTime: 1 });

  const filtered = candidates.filter((notice) => {
    if (isNoticeGlobalClosure(notice)) return true;
    if (roomMatches(notice.rooms, hallName)) return true;
    if (roomMatches(notice.halls, hallName)) return true;
    return false;
  });

  return filtered.map((notice) => serializeNoticeConflict(notice, hallName));
};

const getNoticeClosures = async ({ startDateTime, endDateTime, hallName = '' }) => {
  const start = toDateOrNull(startDateTime);
  const end = toDateOrNull(endDateTime);
  if (!start || !end || end <= start) return [];

  const candidates = await Notice.find({
    isDeleted: { $ne: true },
    kind: 'HOLIDAY',
    startDateTime: { $lt: end },
    endDateTime: { $gt: start }
  }).sort({ startDateTime: 1 });

  return candidates
    .filter((notice) => {
      if (!noticeOverlapsRange(notice, start, end)) return false;
      if (!hallName) return true;
      if (isNoticeGlobalClosure(notice)) return true;
      return roomMatches(notice.rooms, hallName) || roomMatches(notice.halls, hallName);
    })
    .map((notice) => serializeNoticeConflict(notice, hallName || ''));
};

module.exports = {
  createNotice,
  listNotices,
  getNoticeById,
  getNoticeClosures,
  getNoticeConflictsForRange,
  normalizeRoomKey
};
