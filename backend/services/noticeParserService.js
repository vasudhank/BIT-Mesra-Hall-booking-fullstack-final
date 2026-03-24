const chrono = require('chrono-node');

const MAX_NOTICE_TEXT = 20000;
const MAX_SUMMARY_LENGTH = 320;

const STRUCTURED_FIELD_ALIASES = {
  title: ['title', 'notice title', 'subject', 'notice subject', 'heading', 'notice heading'],
  content: ['content', 'description', 'details', 'body', 'message', 'notice content', 'notice body', 'notice description'],
  kind: ['kind', 'type', 'category', 'notice type'],
  holidayName: ['holiday', 'holiday name', 'festival', 'festival name', 'event', 'event name'],
  start: ['start', 'start date', 'start time', 'start datetime', 'start date time', 'starts'],
  end: ['end', 'end date', 'end time', 'end datetime', 'end date time', 'ends'],
  dateRange: ['date', 'date range', 'date time', 'date and time', 'date & time', 'schedule', 'when', 'timing'],
  timeRange: ['time', 'time range', 'hours'],
  rooms: [
    'room',
    'rooms',
    'hall',
    'halls',
    'location',
    'locations',
    'venue',
    'venues',
    'closed hall',
    'closed halls',
    'affected hall',
    'affected halls',
    'halls closed',
    'rooms closed'
  ],
  closureAllHalls: [
    'all halls',
    'all halls closed',
    'closure all halls',
    'campus wide',
    'campus wide closure',
    'closure scope',
    'scope'
  ]
};

const MULTILINE_STRUCTURED_FIELDS = new Set(['content', 'rooms']);

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

const hasGlobalClosureLanguage = (value) =>
  /\b(all halls?|all rooms?|all seminar halls?|campus wide|campus-wide|entire campus|whole campus|entire institute|entire university)\b/i.test(
    String(value || '')
  );

const cleanRoomToken = (value) =>
  String(value || '')
    .replace(/[.,;:]+$/g, '')
    .replace(/\s+(and|will|remain|closed|closure|from|on|during|for|to|at)$/i, '')
    .replace(/\s+/g, ' ')
    .trim();

const parseManualRooms = (roomsInput) => {
  if (!roomsInput) return [];
  if (Array.isArray(roomsInput)) return uniqueStrings(roomsInput.map(cleanRoomToken));
  return uniqueStrings(
    String(roomsInput)
      .split(/[,\n;|]/)
      .map((x) => cleanRoomToken(x))
  );
};

const parseRoomsFromText = (text) => {
  const source = sanitizeText(text);
  const explicitAllHalls = hasGlobalClosureLanguage(source);
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

const normalizeStructuredFieldLabel = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[&_]/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const resolveStructuredFieldKey = (label) => {
  const normalized = normalizeStructuredFieldLabel(label);
  if (!normalized) return '';
  for (const [key, aliases] of Object.entries(STRUCTURED_FIELD_ALIASES)) {
    if (aliases.includes(normalized)) return key;
  }
  return '';
};

const parseStructuredFieldLine = (line) => {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  const match = trimmed.match(/^([A-Za-z][A-Za-z0-9 &/_()'-]{1,40}?)(?:\s*:\s*|\s*=\s*|\s+-\s+)(.*)$/);
  if (!match) return null;
  const rawLabel = String(match[1] || '').trim();
  const key = resolveStructuredFieldKey(rawLabel);
  if (!key) return null;
  return {
    key,
    rawLabel,
    initialValue: String(match[2] || '').trim()
  };
};

const pickLastNonEmpty = (list) => {
  const items = Array.isArray(list) ? list : [];
  for (let idx = items.length - 1; idx >= 0; idx -= 1) {
    const value = sanitizeText(items[idx]);
    if (value) return value;
  }
  return '';
};

const normalizeKindValue = (value) => {
  const normalized = String(value || '').trim().toUpperCase();
  if (!normalized) return '';
  if (normalized === 'GENERAL' || normalized === 'HOLIDAY') return normalized;
  if (/\b(HOLIDAY|CLOSURE|CLOSED|FESTIVAL|ALERT)\b/i.test(normalized)) return 'HOLIDAY';
  if (/\b(GENERAL|NOTICE|ANNOUNCEMENT|INFORMATION|INFO)\b/i.test(normalized)) return 'GENERAL';
  return '';
};

const parseExplicitBoolean = (value) => {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (['true', '1', 'yes', 'y', 'closed', 'all'].includes(normalized)) return true;
  if (['false', '0', 'no', 'n', 'open', 'partial', 'specific'].includes(normalized)) return false;
  if (hasGlobalClosureLanguage(normalized)) return true;
  return null;
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

const parseDateWindowFromText = (value) => {
  const text = sanitizeText(value);
  if (!text) return { startDateTime: null, endDateTime: null, parsedCandidates: [] };

  const parsed = chrono.parse(text, new Date(), { forwardDate: true }) || [];
  if (!parsed.length) {
    return { startDateTime: null, endDateTime: null, parsedCandidates: [] };
  }

  const first = parsed[0];
  const rawStart = first.start?.date ? first.start.date() : null;
  const rawEnd = first.end?.date ? first.end.date() : null;
  if (!rawStart) {
    return {
      startDateTime: null,
      endDateTime: null,
      parsedCandidates: parsed.slice(0, 3).map((x) => x.text)
    };
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

const parseDateWindow = (subject, body) => parseDateWindowFromText(`${subject || ''}\n${body || ''}`);

const extractStructuredNoticeFields = (body) => {
  const sourceBody = stripMailQuotedContent(body);
  const lines = sourceBody.split('\n');
  const buckets = {
    title: [],
    content: [],
    kind: [],
    holidayName: [],
    start: [],
    end: [],
    dateRange: [],
    timeRange: [],
    rooms: [],
    closureAllHalls: []
  };
  const matchedFields = [];
  const residualLines = [];

  for (let idx = 0; idx < lines.length;) {
    const rawLine = lines[idx];
    const trimmed = String(rawLine || '').trim();
    const field = parseStructuredFieldLine(trimmed);

    if (!field) {
      residualLines.push(rawLine);
      idx += 1;
      continue;
    }

    const values = [];
    if (field.initialValue) values.push(field.initialValue);

    const allowMultiline = MULTILINE_STRUCTURED_FIELDS.has(field.key);
    let nextIndex = idx + 1;

    while (nextIndex < lines.length) {
      const nextRaw = lines[nextIndex];
      const nextTrimmed = String(nextRaw || '').trim();
      if (!nextTrimmed) {
        if (allowMultiline && values.length > 0) {
          values.push('');
          nextIndex += 1;
          continue;
        }
        break;
      }
      if (parseStructuredFieldLine(nextTrimmed)) break;
      if (!allowMultiline && field.initialValue) break;
      values.push(nextTrimmed.replace(/^[*-]\s*/, '').trim());
      nextIndex += 1;
      if (!allowMultiline) break;
    }

    const value = sanitizeText(
      allowMultiline
        ? values.join('\n')
        : values.join(' ')
    );

    if (value) {
      buckets[field.key].push(value);
      matchedFields.push({ key: field.key, label: field.rawLabel, value });
    }

    idx = nextIndex;
  }

  const title = pickLastNonEmpty(buckets.title);
  const content = pickLastNonEmpty(buckets.content);
  const kind = normalizeKindValue(pickLastNonEmpty(buckets.kind));
  const holidayName = pickLastNonEmpty(buckets.holidayName);
  const roomsRaw = pickLastNonEmpty(buckets.rooms);
  const structuredRooms = hasGlobalClosureLanguage(roomsRaw) ? [] : parseManualRooms(roomsRaw);
  const explicitClosure = parseExplicitBoolean(pickLastNonEmpty(buckets.closureAllHalls));

  const dateCandidates = uniqueStrings([
    pickLastNonEmpty(buckets.dateRange) && `${pickLastNonEmpty(buckets.dateRange)} ${pickLastNonEmpty(buckets.timeRange)}`.trim(),
    pickLastNonEmpty(buckets.dateRange),
    pickLastNonEmpty(buckets.timeRange),
    pickLastNonEmpty(buckets.start) && pickLastNonEmpty(buckets.end)
      ? `${pickLastNonEmpty(buckets.start)} to ${pickLastNonEmpty(buckets.end)}`
      : '',
    pickLastNonEmpty(buckets.dateRange) && pickLastNonEmpty(buckets.start) && pickLastNonEmpty(buckets.end)
      ? `${pickLastNonEmpty(buckets.dateRange)} ${pickLastNonEmpty(buckets.start)} to ${pickLastNonEmpty(buckets.end)}`
      : '',
    pickLastNonEmpty(buckets.dateRange) && pickLastNonEmpty(buckets.start)
      ? `${pickLastNonEmpty(buckets.dateRange)} ${pickLastNonEmpty(buckets.start)}`
      : '',
    pickLastNonEmpty(buckets.start),
    pickLastNonEmpty(buckets.end)
  ]);

  let structuredWindow = { startDateTime: null, endDateTime: null, parsedCandidates: [] };
  let structuredDateSource = '';
  for (const candidate of dateCandidates) {
    const parsed = parseDateWindowFromText(candidate);
    if (parsed.startDateTime) {
      structuredWindow = parsed;
      structuredDateSource = candidate;
      break;
    }
    if (!structuredWindow.parsedCandidates.length && parsed.parsedCandidates.length) {
      structuredWindow = parsed;
      structuredDateSource = candidate;
    }
  }

  return {
    title,
    content,
    kind,
    holidayName,
    startDateTime: structuredWindow.startDateTime || null,
    endDateTime: structuredWindow.endDateTime || null,
    closureAllHalls:
      explicitClosure !== null
        ? explicitClosure
        : (hasGlobalClosureLanguage(roomsRaw) ? true : null),
    rooms: structuredRooms,
    residualBody: sanitizeText(residualLines.join('\n')),
    matchedFields,
    parsedCandidates: structuredWindow.parsedCandidates,
    structuredDateSource
  };
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

const parseNoticeContent = ({ subject = '', body = '', manualOverrides = {} }) => {
  const cleanSubject = sanitizeText(subject);
  const cleanBody = stripMailQuotedContent(body);
  const structuredFields = extractStructuredNoticeFields(cleanBody);
  const detectedHoliday = structuredFields.kind === 'HOLIDAY' || isHolidayNotice(cleanSubject, cleanBody);
  const parsedWindow = parseDateWindow(cleanSubject, cleanBody);
  const parsedRooms = parseRoomsFromText(`${cleanSubject}\n${cleanBody}`);

  const manualRooms = parseManualRooms(manualOverrides.rooms);
  const manualStart = coerceDateOrNull(manualOverrides.startDateTime);
  const manualEnd = coerceDateOrNull(manualOverrides.endDateTime);
  const manualHolidayName = sanitizeText(manualOverrides.holidayName || '');
  const manualKind = normalizeKindValue(manualOverrides.kind);
  const resolvedKind =
    manualKind ||
    structuredFields.kind ||
    (detectedHoliday ? 'HOLIDAY' : 'GENERAL');

  const mergedRooms =
    manualRooms.length > 0
      ? manualRooms
      : (structuredFields.rooms.length > 0 ? structuredFields.rooms : parsedRooms.rooms);
  const closureAllHallsExplicit =
    typeof manualOverrides.closureAllHalls === 'boolean'
      ? manualOverrides.closureAllHalls
      : structuredFields.closureAllHalls;

  const title = sanitizeText(manualOverrides.title || structuredFields.title || cleanSubject || 'Notice');
  const holidayName =
    manualHolidayName ||
    structuredFields.holidayName ||
    (resolvedKind === 'HOLIDAY' ? extractHolidayName(cleanSubject || title, cleanBody) : '');

  const content = sanitizeText(
    manualOverrides.content ||
    structuredFields.content ||
    structuredFields.residualBody ||
    cleanBody ||
    cleanSubject
  );
  const summary = buildSummary(title, content);

  const startDateTime = manualStart || structuredFields.startDateTime || parsedWindow.startDateTime;
  const endDateTime = manualEnd || structuredFields.endDateTime || parsedWindow.endDateTime;
  const inferredHolidayGlobalClosure =
    resolvedKind === 'HOLIDAY' &&
    mergedRooms.length === 0 &&
    /\b(closed|closure|not bookable|no booking|all day)\b/i.test(`${cleanSubject}\n${cleanBody}`);
  const closureAllHalls =
    closureAllHallsExplicit !== null
      ? closureAllHallsExplicit
      : (parsedRooms.closureAllHalls || inferredHolidayGlobalClosure);

  return {
    title,
    subject: cleanSubject || title,
    body: content || cleanBody || cleanSubject,
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
      parsedCandidates: uniqueStrings([
        ...structuredFields.parsedCandidates,
        ...parsedWindow.parsedCandidates
      ]).slice(0, 6),
      detectedHoliday,
      closureAllHalls,
      structuredDateSource: structuredFields.structuredDateSource,
      structuredFields: structuredFields.matchedFields
    }
  };
};

module.exports = {
  parseNoticeContent,
  normalizeRoomKey
};
