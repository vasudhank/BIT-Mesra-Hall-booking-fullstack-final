const chrono = require('chrono-node');

const MAX_NOTICE_TEXT = 20000;
const MAX_SUMMARY_LENGTH = 320;

const sanitizeText = (value) =>
  String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_NOTICE_TEXT);

const stripMailQuotedContent = (value) => {
  const lines = sanitizeText(value).split('\n');
  const stopAt = lines.findIndex((line) => {
    const trimmed = String(line || '').trim();
    return (
      /^On .+ wrote:$/i.test(trimmed) ||
      /^-{2,}\s*Original Message\s*-{2,}$/i.test(trimmed) ||
      /^From:\s+/i.test(trimmed)
    );
  });
  return (stopAt >= 0 ? lines.slice(0, stopAt) : lines).join('\n').trim();
};

const uniqueStrings = (list) =>
  Array.from(
    new Set(
      (Array.isArray(list) ? list : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  );

const normalizeRoomKey = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

const parseRoomsFromText = (text) => {
  const source = sanitizeText(text);
  const explicitAllHalls = /\b(all halls?|all rooms?|entire campus|all seminar halls?)\b/i.test(source);
  const inferredCampusClosure =
    /\b(institute|campus|university)\b/i.test(source) &&
    /\b(remain closed|will remain closed|closed for|closure)\b/i.test(source);
  const closureAllHalls = explicitAllHalls || inferredCampusClosure;

  const directMatches = source.match(/\b(?:hall|room)\s*[-:]?\s*[a-z0-9]+(?:\s*[a-z0-9-]+)?\b/gi) || [];
  const byClause = source.match(/\b(?:halls?|rooms?)\s*[:\-]\s*([^\n.]+)/i);
  const fromClause = byClause
    ? byClause[1]
        .split(/[;,/]| and /i)
        .map((x) => x.trim())
        .filter(Boolean)
    : [];

  const merged = uniqueStrings([...directMatches, ...fromClause]);
  const seen = new Set();
  const rooms = [];

  const cleanRoomToken = (value) =>
    String(value || '')
      .replace(/[.,;:]+$/g, '')
      .replace(/\s+(and|will|remain|closed|closure|from|on|during|for|to|at)$/i, '')
      .replace(/\s+/g, ' ')
      .trim();

  for (const room of merged) {
    const cleaned = cleanRoomToken(room);
    if (!/\b(?:hall|room)\b/i.test(cleaned)) continue;
    const key = normalizeRoomKey(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rooms.push(cleaned);
  }

  return { rooms, closureAllHalls };
};

const isHolidayNotice = (subject, body) => {
  const text = `${subject || ''}\n${body || ''}`;
  return /\b(holiday|closed|closure|not bookable|no booking|suspended|restricted|maintenance shutdown|festival)\b/i.test(text);
};

const extractHolidayName = (subject, body) => {
  const full = `${subject || ''}\n${body || ''}`.trim();
  const patterns = [
    /\bon account of\s+([a-z][a-z\s'-]{2,80}?)(?:\s+holiday|\s+festival|[.,\n]|$)/i,
    /\bholiday\s*(?:for|:|-)\s*([a-z][a-z\s'-]{2,80}?)(?:[.,\n]|$)/i,
    /\bholiday\b.*?\bfor\s+([a-z][a-z\s'-]{2,80}?)(?:[.,\n]|$)/i,
    /\bfestival\s*(?:of|:|-)?\s*([a-z][a-z\s'-]{2,80}?)(?:[.,\n]|$)/i
  ];

  for (const re of patterns) {
    const match = full.match(re);
    if (match && match[1]) return match[1].trim();
  }

  const subjectLine = String(subject || '').trim();
  if (/holiday/i.test(subjectLine)) {
    const fallback = subjectLine.replace(/\bholiday\b/gi, '').replace(/[-:]/g, ' ').trim();
    if (/regarding|notice|closed|closure|institute|campus/i.test(fallback)) return '';
    return fallback;
  }

  return '';
};

const applyStartDefaults = (date, certainHour) => {
  const next = new Date(date.getTime());
  if (!certainHour) {
    next.setHours(0, 0, 0, 0);
  } else {
    next.setSeconds(0, 0);
  }
  return next;
};

const applyEndDefaults = (date, certainHour, hasExplicitEnd) => {
  const next = new Date(date.getTime());
  if (!certainHour) {
    next.setHours(23, 59, 59, 999);
  } else {
    next.setSeconds(0, 0);
  }
  if (!hasExplicitEnd) {
    next.setHours(next.getHours() + 2);
  }
  return next;
};

const parseDateWindow = (subject, body) => {
  const text = sanitizeText(`${subject || ''}\n${body || ''}`);
  if (!text) return { startDateTime: null, endDateTime: null, parsedCandidates: [] };

  const parsed = chrono.parse(text, new Date(), { forwardDate: true }) || [];
  if (!parsed.length) {
    return { startDateTime: null, endDateTime: null, parsedCandidates: [] };
  }

  const first = parsed[0];
  const rawStart = first.start?.date ? first.start.date() : null;
  const rawEnd = first.end?.date ? first.end.date() : null;
  if (!rawStart) {
    return { startDateTime: null, endDateTime: null, parsedCandidates: parsed.slice(0, 3).map((x) => x.text) };
  }

  const startCertainHour = first.start.isCertain('hour');
  const endCertainHour = first.end ? first.end.isCertain('hour') : false;

  const startDateTime = applyStartDefaults(rawStart, startCertainHour);
  let endDateTime = null;

  if (rawEnd) {
    endDateTime = applyEndDefaults(rawEnd, endCertainHour, true);
  } else if (startCertainHour) {
    endDateTime = applyEndDefaults(rawStart, true, false);
  } else {
    const sameDayEnd = new Date(rawStart.getTime());
    sameDayEnd.setHours(23, 59, 59, 999);
    endDateTime = sameDayEnd;
  }

  if (endDateTime <= startDateTime) {
    const adjusted = new Date(startDateTime.getTime());
    adjusted.setHours(adjusted.getHours() + 2);
    endDateTime = adjusted;
  }

  return {
    startDateTime,
    endDateTime,
    parsedCandidates: parsed.slice(0, 3).map((x) => x.text)
  };
};

const coerceDateOrNull = (value) => {
  if (!value) return null;
  const dt = value instanceof Date ? value : new Date(value);
  return Number.isNaN(dt.getTime()) ? null : dt;
};

const buildSummary = (title, body) => {
  const source = sanitizeText(`${title ? `${title}. ` : ''}${body || ''}`);
  if (!source) return '';
  if (source.length <= MAX_SUMMARY_LENGTH) return source;
  return `${source.slice(0, MAX_SUMMARY_LENGTH - 1).trim()}...`;
};

const parseManualRooms = (roomsInput) => {
  if (!roomsInput) return [];
  if (Array.isArray(roomsInput)) return uniqueStrings(roomsInput);
  return uniqueStrings(
    String(roomsInput)
      .split(/[,\n;|]/)
      .map((x) => x.trim())
  );
};

const parseNoticeContent = ({ subject = '', body = '', manualOverrides = {} }) => {
  const cleanSubject = sanitizeText(subject);
  const cleanBody = stripMailQuotedContent(body);
  const detectedHoliday = isHolidayNotice(cleanSubject, cleanBody);
  const parsedWindow = parseDateWindow(cleanSubject, cleanBody);
  const parsedRooms = parseRoomsFromText(`${cleanSubject}\n${cleanBody}`);

  const manualRooms = parseManualRooms(manualOverrides.rooms);
  const manualStart = coerceDateOrNull(manualOverrides.startDateTime);
  const manualEnd = coerceDateOrNull(manualOverrides.endDateTime);
  const manualHolidayName = sanitizeText(manualOverrides.holidayName || '');
  const manualKind = String(manualOverrides.kind || '').toUpperCase();
  const resolvedKind =
    manualKind === 'HOLIDAY' || manualKind === 'GENERAL'
      ? manualKind
      : detectedHoliday
        ? 'HOLIDAY'
        : 'GENERAL';

  const mergedRooms = manualRooms.length > 0 ? manualRooms : parsedRooms.rooms;
  const closureAllHallsExplicit =
    typeof manualOverrides.closureAllHalls === 'boolean'
      ? manualOverrides.closureAllHalls
      : null;

  const title = sanitizeText(manualOverrides.title || cleanSubject || 'Notice');
  const holidayName =
    manualHolidayName ||
    (resolvedKind === 'HOLIDAY' ? extractHolidayName(cleanSubject, cleanBody) : '');

  const content = sanitizeText(manualOverrides.content || cleanBody || cleanSubject);
  const summary = buildSummary(title, content);

  const startDateTime = manualStart || parsedWindow.startDateTime;
  const endDateTime = manualEnd || parsedWindow.endDateTime;
  const inferredHolidayGlobalClosure =
    resolvedKind === 'HOLIDAY' && mergedRooms.length === 0 && /\b(closed|closure|not bookable|no booking|all day)\b/i.test(`${cleanSubject}\n${cleanBody}`);
  const closureAllHalls =
    closureAllHallsExplicit !== null
      ? closureAllHallsExplicit
      : (parsedRooms.closureAllHalls || inferredHolidayGlobalClosure);

  return {
    title,
    subject: cleanSubject || title,
    body: cleanBody || content,
    content,
    summary,
    extracted: summary,
    kind: resolvedKind,
    holidayName,
    startDateTime: startDateTime || null,
    endDateTime: endDateTime || null,
    closureAllHalls,
    rooms: uniqueStrings(mergedRooms),
    halls: uniqueStrings(mergedRooms),
    parsedMeta: {
      parsedCandidates: parsedWindow.parsedCandidates,
      detectedHoliday,
      closureAllHalls
    }
  };
};

module.exports = {
  parseNoticeContent,
  normalizeRoomKey
};
