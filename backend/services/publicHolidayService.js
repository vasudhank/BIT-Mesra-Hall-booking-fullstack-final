const fetch = require('node-fetch');

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const cache = new Map();

const GOOGLE_INDIA_HOLIDAY_ICS =
  'https://calendar.google.com/calendar/ical/en.indian%23holiday%40group.v.calendar.google.com/public/basic.ics';

const normalizeHoliday = (item, countryCode) => {
  const dateStr = String(item?.date || '').trim();
  if (!dateStr) return null;
  const start = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(start.getTime())) return null;
  const end = new Date(start);
  end.setDate(end.getDate() + 1);

  return {
    id: `${countryCode}-${dateStr}-${String(item?.localName || item?.name || 'holiday').replace(/\s+/g, '-').toLowerCase()}`,
    title: String(item?.localName || item?.name || 'Holiday').trim(),
    startDateTime: start,
    endDateTime: end,
    allDay: true,
    source: 'FESTIVAL'
  };
};

const decodeIcsText = (value) =>
  String(value || '')
    .replace(/\\n/gi, ' ')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();

const unfoldIcsLines = (icsText) => {
  const sourceLines = String(icsText || '')
    .replace(/\r\n/g, '\n')
    .split('\n');

  const lines = [];
  sourceLines.forEach((line) => {
    if ((line.startsWith(' ') || line.startsWith('\t')) && lines.length > 0) {
      lines[lines.length - 1] += line.slice(1);
    } else {
      lines.push(line);
    }
  });
  return lines;
};

const parseIcsDate = (value, key) => {
  const token = String(value || '').trim();
  if (!token) return null;

  const isDateOnly = String(key || '').includes('VALUE=DATE') || /^\d{8}$/.test(token);
  if (isDateOnly) {
    const y = Number(token.slice(0, 4));
    const m = Number(token.slice(4, 6));
    const d = Number(token.slice(6, 8));
    const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  if (/^\d{8}T\d{6}Z$/.test(token)) {
    const iso = `${token.slice(0, 4)}-${token.slice(4, 6)}-${token.slice(6, 8)}T${token.slice(9, 11)}:${token.slice(11, 13)}:${token.slice(13, 15)}Z`;
    const dt = new Date(iso);
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  if (/^\d{8}T\d{6}$/.test(token)) {
    const dt = new Date(
      Number(token.slice(0, 4)),
      Number(token.slice(4, 6)) - 1,
      Number(token.slice(6, 8)),
      Number(token.slice(9, 11)),
      Number(token.slice(11, 13)),
      Number(token.slice(13, 15)),
      0
    );
    return Number.isNaN(dt.getTime()) ? null : dt;
  }

  const generic = new Date(token);
  return Number.isNaN(generic.getTime()) ? null : generic;
};

const splitIcsEntry = (line) => {
  const idx = line.indexOf(':');
  if (idx < 0) return { key: line.trim(), value: '' };
  return {
    key: line.slice(0, idx).trim(),
    value: line.slice(idx + 1).trim()
  };
};

const parseGoogleIcsFestivals = (icsText, year) => {
  const lines = unfoldIcsLines(icsText);
  const rangeStart = new Date(year, 0, 1, 0, 0, 0, 0);
  const rangeEnd = new Date(year + 1, 0, 1, 0, 0, 0, 0);

  const festivals = [];
  let active = null;

  lines.forEach((line) => {
    if (line === 'BEGIN:VEVENT') {
      active = {};
      return;
    }

    if (line === 'END:VEVENT') {
      if (!active) return;
      const title = decodeIcsText(active.summary || '');
      const start = parseIcsDate(active.dtstartValue, active.dtstartKey);
      let end = parseIcsDate(active.dtendValue, active.dtendKey);
      const allDay = String(active.dtstartKey || '').includes('VALUE=DATE');

      if (start && !end) {
        end = new Date(start);
        end.setDate(end.getDate() + 1);
      }

      if (start && end && end <= start) {
        end = new Date(start);
        end.setDate(end.getDate() + 1);
      }

      const intersectsYear = Boolean(start && end && start < rangeEnd && end > rangeStart);
      if (intersectsYear && title) {
        const dayToken = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
        festivals.push({
          id: `google-in-${dayToken}-${title.replace(/\s+/g, '-').toLowerCase()}`,
          title,
          startDateTime: start,
          endDateTime: end,
          allDay,
          source: 'FESTIVAL'
        });
      }

      active = null;
      return;
    }

    if (!active) return;

    const { key, value } = splitIcsEntry(line);
    if (key.startsWith('SUMMARY')) active.summary = value;
    if (key.startsWith('DTSTART')) {
      active.dtstartKey = key;
      active.dtstartValue = value;
    }
    if (key.startsWith('DTEND')) {
      active.dtendKey = key;
      active.dtendValue = value;
    }
  });

  return festivals;
};

const fetchNagerPublicHolidays = async ({ year, countryCode }) => {
  const url = `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`;
  const response = await fetch(url, { method: 'GET', timeout: 12000 });
  if (!response.ok) throw new Error(`Holiday fetch failed (${response.status})`);
  const raw = await response.json();
  return (Array.isArray(raw) ? raw : [])
    .map((item) => normalizeHoliday(item, countryCode))
    .filter(Boolean);
};

const fetchGoogleIndiaFestivals = async (year) => {
  const response = await fetch(GOOGLE_INDIA_HOLIDAY_ICS, { method: 'GET', timeout: 15000 });
  if (!response.ok) throw new Error(`Google holiday fetch failed (${response.status})`);
  const icsText = await response.text();
  return parseGoogleIcsFestivals(icsText, year);
};

const dedupeHolidays = (items) => {
  const byKey = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const start = item?.startDateTime instanceof Date ? item.startDateTime : new Date(item?.startDateTime);
    if (!start || Number.isNaN(start.getTime())) return;
    const dayToken = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    const titleToken = String(item?.title || '').trim().toLowerCase();
    const key = `${dayToken}::${titleToken}`;
    if (!titleToken) return;
    if (!byKey.has(key)) byKey.set(key, item);
  });
  return Array.from(byKey.values()).sort((a, b) => new Date(a.startDateTime) - new Date(b.startDateTime));
};

const fetchPublicHolidays = async ({ year, countryCode = 'IN' }) => {
  const numericYear = Number(year);
  if (!Number.isFinite(numericYear) || numericYear < 2000 || numericYear > 2100) return [];

  const key = `${countryCode}-${numericYear}`;
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > now) return cached.data;

  try {
    const [googleFestivals, nagerHolidays] = await Promise.all([
      fetchGoogleIndiaFestivals(numericYear),
      fetchNagerPublicHolidays({ year: numericYear, countryCode }).catch(() => [])
    ]);

    const merged = dedupeHolidays([
      ...googleFestivals,
      ...nagerHolidays
    ]);

    cache.set(key, { data: merged, expiresAt: now + ONE_DAY_MS });
    return merged;
  } catch (err) {
    // Keep backend resilient if external holiday source is unavailable.
    cache.set(key, { data: [], expiresAt: now + 30 * 60 * 1000 });
    return [];
  }
};

module.exports = {
  fetchPublicHolidays
};
