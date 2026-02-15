const express = require('express');
const fetch = require('node-fetch');
const chrono = require('chrono-node');
const router = express.Router();
const Hall = require('../models/hall');
const Fuse = require('fuse.js');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'phi3';

const getISTNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));

const getISTDateMeta = () => {
  const dateObj = getISTNow();
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'long' });
  const time = dateObj.toLocaleTimeString('en-US', {
    hour12: true,
    hour: 'numeric',
    minute: '2-digit'
  });

  return {
    fullDate: `${yyyy}-${mm}-${dd}`,
    dayName,
    time,
    year: yyyy
  };
};

const formatDateYYYYMMDD = (dateObj) => {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const normalizeText = (text) => String(text || '').toLowerCase().trim();

const tokenize = (text) =>
  normalizeText(text)
    .replace(/[^a-z0-9\s:-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

const hasHindiScript = (text) => /[\u0900-\u097F]/.test(String(text || ''));

const normalizeLanguagePreference = (language) => {
  const raw = String(language || 'auto').trim().toLowerCase();
  if (raw === 'hi' || raw === 'hindi') return 'hi';
  if (raw === 'en' || raw === 'english') return 'en';
  return 'auto';
};

const detectResponseLanguage = (message, preferredLanguage) => {
  const preferred = normalizeLanguagePreference(preferredLanguage);
  if (preferred === 'hi' || preferred === 'en') return preferred;

  const raw = String(message || '');
  const lower = normalizeText(raw);

  const hindiWordHint = /\b(namaste|kaise|aaj|kal|kahani|batao|dikhao|kya|kahan|kripya|kripyaa|hall\s+book|book\s+karo)\b/i.test(lower);
  if (hasHindiScript(raw) || hindiWordHint) return 'hi';
  return 'en';
};

const sanitizeChatHistory = (historyLike) => {
  if (!Array.isArray(historyLike)) return [];

  return historyLike
    .filter((entry) => entry && typeof entry === 'object')
    .map((entry) => {
      const role = String(entry.role || '').toLowerCase();
      const text = String(entry.text || '').trim().slice(0, 2000);
      if (!text) return null;
      if (role !== 'user' && role !== 'ai' && role !== 'assistant') return null;
      return { role: role === 'assistant' ? 'ai' : role, text };
    })
    .filter(Boolean)
    .slice(-14);
};

const buildHistoryPromptBlock = (history) => {
  if (!Array.isArray(history) || history.length === 0) return 'No prior thread messages.';

  const lines = history.map((entry, idx) => {
    const roleLabel = entry.role === 'user' ? 'User' : 'Assistant';
    return `${idx + 1}. ${roleLabel}: ${entry.text}`;
  });

  return lines.join('\n');
};

const levenshteinDistance = (a, b) => {
  const s = String(a || '');
  const t = String(b || '');

  if (!s.length) return t.length;
  if (!t.length) return s.length;

  const matrix = Array.from({ length: s.length + 1 }, () => Array(t.length + 1).fill(0));

  for (let i = 0; i <= s.length; i += 1) matrix[i][0] = i;
  for (let j = 0; j <= t.length; j += 1) matrix[0][j] = j;

  for (let i = 1; i <= s.length; i += 1) {
    for (let j = 1; j <= t.length; j += 1) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost
      );
    }
  }

  return matrix[s.length][t.length];
};

const hasFuzzyKeyword = (tokens, keywords, maxDistance = 2) => {
  if (!Array.isArray(tokens) || !Array.isArray(keywords)) return false;

  for (const token of tokens) {
    for (const keyword of keywords) {
      if (token === keyword) return true;
      const allowedDistance = keyword.length <= 4 ? 1 : maxDistance;
      if (levenshteinDistance(token, keyword) <= allowedDistance) {
        return true;
      }
    }
  }

  return false;
};

const hasConstrainedFuzzyKeyword = (
  tokens,
  keywords,
  { maxDistance = 2, requireSameFirstChar = false, maxLengthDelta = Infinity } = {}
) => {
  if (!Array.isArray(tokens) || !Array.isArray(keywords)) return false;

  for (const tokenRaw of tokens) {
    const token = String(tokenRaw || '').toLowerCase();
    if (!token) continue;

    for (const keywordRaw of keywords) {
      const keyword = String(keywordRaw || '').toLowerCase();
      if (!keyword) continue;

      if (token === keyword) return true;
      if (Math.abs(token.length - keyword.length) > maxLengthDelta) continue;
      if (requireSameFirstChar && token[0] !== keyword[0]) continue;

      const allowedDistance = keyword.length <= 4 ? 1 : maxDistance;
      if (levenshteinDistance(token, keyword) <= allowedDistance) {
        return true;
      }
    }
  }

  return false;
};

const chatReply = (message) => ({
  type: 'CHAT',
  action: null,
  message
});

const actionReply = (action, payload, reply) => ({
  type: 'ACTION',
  action,
  payload,
  reply
});

const to12HourTime = (inputTime) => {
  if (!inputTime) return null;
  const raw = String(inputTime).trim().toUpperCase();

  const twelveHr = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (twelveHr) {
    let hour = Number(twelveHr[1]);
    const minute = Number(twelveHr[2] || '0');
    const suffix = twelveHr[3].toUpperCase();

    if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 1 || hour > 12 || minute < 0 || minute > 59) {
      return null;
    }

    return `${hour}:${String(minute).padStart(2, '0')} ${suffix}`;
  }

  const twentyFourHr = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (twentyFourHr) {
    let hour = Number(twentyFourHr[1]);
    const minute = Number(twentyFourHr[2]);
    const suffix = hour >= 12 ? 'PM' : 'AM';
    hour %= 12;
    if (hour === 0) hour = 12;
    return `${hour}:${String(minute).padStart(2, '0')} ${suffix}`;
  }

  const plainHour = raw.match(/^(\d{1,2})$/);
  if (plainHour) {
    let hour = Number(plainHour[1]);
    if (hour >= 0 && hour <= 23) {
      const suffix = hour >= 12 ? 'PM' : 'AM';
      hour %= 12;
      if (hour === 0) hour = 12;
      return `${hour}:00 ${suffix}`;
    }
  }

  return null;
};

const normalizeDateInput = (inputDate) => {
  if (!inputDate) return null;

  const raw = String(inputDate).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw;
  }

  if (/^\d{1,2}[/-]\d{1,2}[/-]\d{4}$/.test(raw)) {
    const parts = raw.split(/[/-]/).map((x) => Number(x));
    const [first, second, year] = parts;

    if (!Number.isNaN(first) && !Number.isNaN(second) && !Number.isNaN(year)) {
      const date = new Date(year, second - 1, first);
      if (!Number.isNaN(date.getTime())) {
        return formatDateYYYYMMDD(date);
      }
    }
  }

  const parsed = chrono.parseDate(raw, getISTNow(), { forwardDate: true });
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  return formatDateYYYYMMDD(parsed);
};

const fixHallName = (inputName, allHalls) => {
  if (!inputName || !Array.isArray(allHalls) || allHalls.length === 0) return null;
  const fuse = new Fuse(allHalls, {
    keys: ['name'],
    threshold: 0.42,
    ignoreLocation: true,
    includeScore: true
  });

  const result = fuse.search(String(inputName).trim(), { limit: 1 });
  if (!result.length) return null;
  return result[0].item.name;
};

const detectHallFromMessage = (message, allHalls) => {
  const msg = String(message || '').trim();
  if (!msg || !Array.isArray(allHalls) || allHalls.length === 0) return null;

  const lower = msg.toLowerCase();

  const direct = allHalls.find((hall) => lower.includes(String(hall.name || '').toLowerCase()));
  if (direct) return direct.name;

  const hallPattern = msg.match(/\bhall(?!s\b)\s*[-:]?\s*([a-z0-9]+)\b/i);
  if (hallPattern) {
    const candidate = `Hall ${hallPattern[1]}`;
    const fixed = fixHallName(candidate, allHalls);
    if (fixed) return fixed;
  }

  const hasSpecificOtherCue = /\b(auditorium|seminar|room)\s*[-:]?\s*[a-z0-9]+\b/i.test(msg);
  if (!hallPattern && !hasSpecificOtherCue) return null;

  const tokenList = tokenize(msg);
  const phrases = [];
  for (let size = 1; size <= 4; size += 1) {
    for (let i = 0; i <= tokenList.length - size; i += 1) {
      phrases.push(tokenList.slice(i, i + size).join(' '));
    }
  }

  let best = null;
  for (const phrase of phrases) {
    const fixed = fixHallName(phrase, allHalls);
    if (!fixed) continue;
    const score = levenshteinDistance(phrase, fixed.toLowerCase());
    if (!best || score < best.score) {
      best = { hall: fixed, score };
    }
  }

  if (best && best.score <= 4) {
    return best.hall;
  }

  return null;
};

const extractDateFromMessage = (message) => {
  const msg = String(message || '').trim();
  if (!msg) return null;

  const dateHint = /(today|tomorrow|day after tomorrow|next\s+|this\s+|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|aaj|kal|parso|\d{1,2}[/-]\d{1,2}|\d{4}-\d{2}-\d{2})/i;
  if (!dateHint.test(msg)) return null;

  const parsedDate = chrono.parseDate(msg, getISTNow(), { forwardDate: true });
  if (!parsedDate || Number.isNaN(parsedDate.getTime())) return null;

  return formatDateYYYYMMDD(parsedDate);
};

const extractTimeRangeFromMessage = (message) => {
  const msg = String(message || '').trim();
  if (!msg) return { start: null, end: null };

  const twelveHrRange = msg.match(/(\d{1,2}(?::\d{2})?\s*(?:am|pm))\s*(?:to|-|till|until|upto|up\s*to)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm))/i);
  if (twelveHrRange) {
    return {
      start: to12HourTime(twelveHrRange[1]),
      end: to12HourTime(twelveHrRange[2])
    };
  }

  const twentyFourHrRange = msg.match(/([01]?\d|2[0-3]):([0-5]\d)\s*(?:to|-|till|until|upto|up\s*to)\s*([01]?\d|2[0-3]):([0-5]\d)/i);
  if (twentyFourHrRange) {
    return {
      start: to12HourTime(`${twentyFourHrRange[1]}:${twentyFourHrRange[2]}`),
      end: to12HourTime(`${twentyFourHrRange[3]}:${twentyFourHrRange[4]}`)
    };
  }

  const hindiRange = msg.match(/(\d{1,2})(?::(\d{2}))?\s*(?:baje|बजे)?\s*(?:se|से)\s*(\d{1,2})(?::(\d{2}))?\s*(?:baje|बजे)?/i);
  if (hindiRange) {
    const startHour = Number(hindiRange[1]);
    const startMinute = Number(hindiRange[2] || '0');
    const endHour = Number(hindiRange[3]);
    const endMinute = Number(hindiRange[4] || '0');

    if (!Number.isNaN(startHour) && !Number.isNaN(endHour)) {
      return {
        start: to12HourTime(`${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`),
        end: to12HourTime(`${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`)
      };
    }
  }

  const parsed = chrono.parse(msg, getISTNow(), { forwardDate: true });
  for (const item of parsed) {
    if (item.start && item.end && item.start.isCertain('hour') && item.end.isCertain('hour')) {
      const startHour = item.start.get('hour');
      const startMinute = item.start.isCertain('minute') ? item.start.get('minute') : 0;
      const endHour = item.end.get('hour');
      const endMinute = item.end.isCertain('minute') ? item.end.get('minute') : 0;

      return {
        start: to12HourTime(`${String(startHour).padStart(2, '0')}:${String(startMinute).padStart(2, '0')}`),
        end: to12HourTime(`${String(endHour).padStart(2, '0')}:${String(endMinute).padStart(2, '0')}`)
      };
    }
  }

  return { start: null, end: null };
};

const extractEventFromMessage = (message) => {
  const msg = String(message || '').trim();
  if (!msg) return 'AI Booking';

  const quoted = msg.match(/\"([^\"]{3,120})\"/);
  if (quoted) return quoted[1].trim();

  const labeled = msg.match(/\bevent\s*[:=-]\s*([^,.;\n]+)/i);
  if (labeled) return labeled[1].trim();

  const forMatch = msg.match(/\bfor\b\s+(.+?)(?=\s+\b(on|from|at|by|today|tomorrow|next|this)\b|$)/i);
  if (forMatch && forMatch[1]) {
    const cleaned = forMatch[1].trim();
    if (cleaned.length >= 3) return cleaned;
  }

  const hindiForMatch = msg.match(/(?:के\s+लिए|ke\s+liye)\s+(.+?)(?=\s+\b(on|from|at|by|today|tomorrow|next|this|aaj|kal)\b|$)/i);
  if (hindiForMatch && hindiForMatch[1]) {
    const cleaned = hindiForMatch[1].trim();
    if (cleaned.length >= 3) return cleaned;
  }

  return 'AI Booking';
};

const buildBookingRequestFromMessage = (message, allHalls) => {
  const hall = detectHallFromMessage(message, allHalls);
  const date = extractDateFromMessage(message);
  const timeRange = extractTimeRangeFromMessage(message);
  const event = extractEventFromMessage(message);

  const missing = [];
  if (!hall) missing.push('hall name');
  if (!date) missing.push('booking date');
  if (!timeRange.start) missing.push('start time');
  if (!timeRange.end) missing.push('end time');

  if (missing.length > 0) {
    return { request: null, missing };
  }

  return {
    request: {
      hall,
      date,
      start: timeRange.start,
      end: timeRange.end,
      event
    },
    missing: []
  };
};

const bookingMissingReply = (missingList = []) => {
  const unique = Array.from(new Set(missingList));
  const missingText = unique.length > 0 ? unique.join(', ') : 'hall name, date, start time and end time';

  return chatReply(
    `I can create that booking request. Please share: ${missingText}. Example: Hall 2 on 2026-02-20 from 10:00 AM to 12:00 PM for Workshop.`
  );
};

const hasHallReference = (lower, tokens) => {
  const explicit = /\b(hall|halls|auditorium|seminar|room|haal|hallon)\b/i.test(lower) || /(हॉल|हाल)/.test(lower);
  if (explicit) return true;

  const longTokens = (tokens || []).filter((token) => String(token || '').length >= 4);
  return hasConstrainedFuzzyKeyword(longTokens, ['hall', 'halls', 'auditorium', 'seminar', 'room'], {
    maxDistance: 1,
    requireSameFirstChar: true,
    maxLengthDelta: 2
  });
};

const hasReadOnlyIntentSignal = (lower, tokens) => {
  const direct = /\b(show|list|display|view|see|tell|give|fetch|find|get|check|dikhao|dikhana|batao|batado)\b/i.test(lower) || /(दिखाओ|बताओ|सूची|लिस्ट)/.test(lower);
  const typo = /\b(hsow|shwo|lsit|chek|avaiable|availabe)\b/i.test(lower);
  const fuzzy = hasConstrainedFuzzyKeyword(tokens, ['show', 'list', 'view', 'check', 'display'], {
    maxDistance: 1,
    requireSameFirstChar: true,
    maxLengthDelta: 2
  });

  const likelyShowViaShall = /\bshall\b.*\b(booking|request|requests|hall|halls)\b/i.test(lower);
  return direct || typo || fuzzy || likelyShowViaShall;
};

const detectConflictFilter = (lower, tokens) => {
  const explicitBoth =
    /\b(conflicting?\s+and\s+non\s*[-]?\s*conflicting?|non\s*[-]?\s*conflicting?\s+and\s+conflicting?|both\s+conflicting\s+and\s+non\s*[-]?\s*conflicting?)\b/i.test(lower) ||
    /\ball\s+conflicting\s+and\s+non\s*[-]?\s*conflicting\b/i.test(lower);
  const nonConflictWord = /(non\s*[-]?\s*conflict|non\s*[-]?\s*conflicting|no\s+conflict|without\s+conflict|zero\s+time\s+conflict|safe|non\s*[-]?\s*overlap|no\s+overlap|no\s+takra|without\s+takra)/i.test(lower) || /(बिना\s+टकराव|नॉन\s+कॉनफ्लिक्ट|नो\s+कॉनफ्लिक्ट)/.test(lower);
  const conflictWord =
    hasConstrainedFuzzyKeyword(tokens, ['conflict', 'conflicting', 'overlap', 'clash'], {
      maxDistance: 2,
      requireSameFirstChar: true,
      maxLengthDelta: 3
    }) || /\b(conflict|conflicting|overlap|clash|takra)\b/i.test(lower) || /(टकराव|क्लैश|ओवरलैप)/.test(lower);

  if (explicitBoth) return 'ALL';
  if (nonConflictWord) return 'NON_CONFLICTING';
  if (conflictWord) return 'CONFLICTING';
  return 'ALL';
};

const normalizeConflictFilter = (rawFilter, lower, tokens) => {
  const raw = String(rawFilter || '').toUpperCase().trim();
  if (raw === 'ALL' || raw === 'CONFLICTING' || raw === 'NON_CONFLICTING') return raw;
  return detectConflictFilter(lower, tokens);
};

const normalizeHallStatusMode = (rawMode, lower) => {
  const raw = String(rawMode || '').toUpperCase().trim();
  if (raw.includes('NOT') && (raw.includes('BOOK') || raw.includes('OCCUP') || raw.includes('FILL') || raw.includes('BUSY'))) return 'AVAILABLE';
  if (raw.includes('UNBOOK') || raw.includes('EMPTY')) return 'AVAILABLE';
  if (raw.includes('UNAVAILABLE') || (raw.includes('NOT') && (raw.includes('FREE') || raw.includes('AVAILABLE') || raw.includes('VACANT')))) return 'FILLED';
  if (raw === 'ALL' || raw === 'AVAILABLE' || raw === 'FILLED') return raw;

  const negatedBookedLike =
    /\bnot\s+(booked|occupied|filled|busy)\b/i.test(lower) ||
    /\b(unbooked|empty)\b/i.test(lower) ||
    /\b(no|without)\s+bookings?\b/i.test(lower);
  if (negatedBookedLike) return 'AVAILABLE';

  const negatedAvailableLike =
    /\bnot\s+(available|free|vacant)\b/i.test(lower) ||
    /\bunavailable\b/i.test(lower);
  if (negatedAvailableLike) return 'FILLED';

  const hindiAvailableHint = /(खाली|उपलब्ध|फ्री|बुक\s+नहीं|नॉट\s+बुक्ड)/.test(lower);
  const hindiFilledHint = /(भरा|बुक्ड|व्यस्त|ऑक्युपाइड)/.test(lower);
  if (hindiAvailableHint) return 'AVAILABLE';
  if (hindiFilledHint) return 'FILLED';

  if (/\b(available|availability|free|vacant)\b/i.test(lower)) return 'AVAILABLE';
  if (/\b(filled|occupied|booked|busy)\b/i.test(lower)) return 'FILLED';
  return 'ALL';
};

const inferBookingListIntent = (message, lower, tokens, allHalls) => {
  const hasRequestWord =
    /\brequests?\b/i.test(lower) ||
    hasConstrainedFuzzyKeyword(tokens, ['request', 'requests'], {
      maxDistance: 2,
      requireSameFirstChar: true,
      maxLengthDelta: 2
    });
  const hasBookingWord =
    /\b(book|booking|bookings|pending)\b/i.test(lower) ||
    hasConstrainedFuzzyKeyword(tokens, ['booking', 'pending'], {
      maxDistance: 2,
      requireSameFirstChar: true,
      maxLengthDelta: 2
    });

  const readOnlySignal = hasReadOnlyIntentSignal(lower, tokens);
  const conflictSignal = /(conflict|conflicting|overlap|clash|safe|non\s*[-]?\s*conflict|no\s+conflict)/i.test(lower);
  const mutatingSignal = hasAdminApproveVerb(lower, tokens) || hasAdminRejectVerb(lower, tokens);

  if (!(hasRequestWord && hasBookingWord)) return null;
  if (!readOnlySignal && !conflictSignal) return null;
  if (mutatingSignal) return null;

  const filter = detectConflictFilter(lower, tokens);
  const targetHall = detectHallFromMessage(message, allHalls);
  const date = extractDateFromMessage(message);
  return { filter, targetHall, date };
};

const inferHallStatusIntent = (message, lower, tokens, allHalls) => {
  const hasHallWord = hasHallReference(lower, tokens);
  const readOnlySignal = hasReadOnlyIntentSignal(lower, tokens);
  const statusSignal = hasHallStatusSignal(lower, tokens);
  const mentionsRequests = /\brequests?\b/i.test(lower);

  if (!hasHallWord || mentionsRequests) return null;
  if (!readOnlySignal && !statusSignal) return null;

  const mode = normalizeHallStatusMode(null, lower);
  const date = extractDateFromMessage(message);
  const targetHall = detectHallFromMessage(message, allHalls);

  return { mode, date, targetHall };
};

const hasHallStatusSignal = (lower, tokens) => {
  const directStatusWord = /\b(status|availability|available|free|occupied|booked|vacant|filled|busy|khali|bhara|mila)\b/i.test(lower) || /(खाली|भरा|बुक|उपलब्ध)/.test(lower);
  const fuzzyStatusWord = hasConstrainedFuzzyKeyword(
    tokens,
    ['status', 'availability', 'available', 'free', 'occupied', 'vacant', 'filled', 'busy'],
    {
      maxDistance: 1,
      requireSameFirstChar: true,
      maxLengthDelta: 2
    }
  );

  return directStatusWord || fuzzyStatusWord;
};

const isLikelyHallStatusIntent = (lower, tokens) => {
  const hallWord = hasHallReference(lower, tokens);
  const statusWord = hasHallStatusSignal(lower, tokens);
  const checkVerb = /\b(check|show|tell|list|see|view|what|is|are)\b/i.test(lower) || /\?/.test(lower);
  const bookingCommandVerb = /\b(book|reserve|request|schedule|allot)\b/i.test(lower);

  return hallWord && statusWord && (checkVerb || !bookingCommandVerb);
};

const hasAdminApproveVerb = (lower, tokens) => {
  const directApprove = /\b(approve|approved|approving|accept|accepted|allow|allowed|confirm|confirmed|manzoor|svikar|sweekar)\b/i.test(lower) || /(मंजूर|स्वीकार|अप्रूव)/.test(lower);
  const longTokens = (tokens || []).filter((token) => String(token || '').length >= 5);
  const fuzzyApprove = hasConstrainedFuzzyKeyword(longTokens, ['approve', 'accept', 'confirm'], {
    maxDistance: 2,
    requireSameFirstChar: true,
    maxLengthDelta: 2
  });
  const fuzzyAllow = hasConstrainedFuzzyKeyword(longTokens, ['allow'], {
    maxDistance: 1,
    requireSameFirstChar: true,
    maxLengthDelta: 1
  });

  // Supports admin prompts like "book all non conflicting halls".
  const bulkBookApprove = /\bbook\s+(all|every|each)\b/i.test(lower) || /\b(all|every|each)\b.*\bbook\b/i.test(lower);

  return directApprove || fuzzyApprove || fuzzyAllow || bulkBookApprove;
};

const hasAdminRejectVerb = (lower, tokens) => {
  const directReject = /\b(reject|rejected|rejecting|decline|declined|deny|denied|cancel|cancelled|canceled|asvikar|rad)\b/i.test(lower) || /(अस्वीकार|रद्द|रिजेक्ट)/.test(lower);
  const fuzzyReject = hasConstrainedFuzzyKeyword(tokens, ['reject', 'decline', 'deny', 'cancel'], {
    maxDistance: 2,
    requireSameFirstChar: true,
    maxLengthDelta: 2
  });

  return directReject || fuzzyReject;
};

const isLikelyBookingIntent = (lower, tokens) => {
  const directBookingVerb = /\b(book|reserve|request|schedule|allot|buk|bookk)\b/i.test(lower) || /(बुक|आरक्षित|शेड्यूल)/.test(lower);
  const longTokens = (tokens || []).filter((token) => String(token || '').length >= 4);
  const fuzzyBookingVerb = hasConstrainedFuzzyKeyword(longTokens, ['book', 'reserve', 'request', 'schedule'], {
    maxDistance: 2,
    requireSameFirstChar: true,
    maxLengthDelta: 2
  });
  const bookingVerb = directBookingVerb || fuzzyBookingVerb || /\bbooking\b/i.test(lower) || /(बुकिंग)/.test(lower);
  const hallWord = hasHallReference(lower, tokens);
  const adminWorkflowVerb = hasAdminApproveVerb(lower, tokens) || hasAdminRejectVerb(lower, tokens);
  const pureStatusQuestion = hasHallStatusSignal(lower, tokens) && !directBookingVerb;

  return bookingVerb && hallWord && !adminWorkflowVerb && !pureStatusQuestion;
};

const inferAdminSubActionFromText = (lower, tokens) => {
  const approveVerb = hasAdminApproveVerb(lower, tokens);
  const rejectVerb = hasAdminRejectVerb(lower, tokens);
  const allScope = /\b(all|every|each|sabhi|saare)\b/i.test(lower) || /(सभी|सारे)/.test(lower) || lower.includes('all pending');
  const conflictWord = hasConstrainedFuzzyKeyword(tokens, ['conflict', 'conflicting', 'overlap', 'clash'], {
    maxDistance: 2,
    requireSameFirstChar: true,
    maxLengthDelta: 3
  });
  const safePhrase = /(non\s*[-]?\s*conflict|no\s+conflict|without\s+conflict|no\s+overlap|without\s+overlap|safe)/i.test(lower);

  if (approveVerb && allScope && (safePhrase || conflictWord)) return 'APPROVE_SAFE';
  if (approveVerb && allScope) return 'APPROVE_ALL';
  if (rejectVerb && allScope) return 'REJECT_ALL';
  if (rejectVerb && (conflictWord || /overlap|clash/i.test(lower))) return 'REJECT_CONFLICTS';

  if (approveVerb && lower.includes('hall')) return 'APPROVE_SPECIFIC';
  if (rejectVerb && lower.includes('hall')) return 'REJECT_SPECIFIC';

  return null;
};

const normalizeAdminSubAction = (rawSubAction, lower, tokens) => {
  const raw = String(rawSubAction || '').toUpperCase().trim();

  const supported = [
    'APPROVE_SAFE',
    'APPROVE_ALL',
    'APPROVE_SPECIFIC',
    'REJECT_CONFLICTS',
    'REJECT_ALL',
    'REJECT_SPECIFIC'
  ];

  if (supported.includes(raw)) return raw;

  if (raw.includes('SAFE') || raw.includes('NON')) return 'APPROVE_SAFE';
  if (raw.includes('APPROVE') && raw.includes('ALL')) return 'APPROVE_ALL';
  if (raw.includes('APPROVE')) return 'APPROVE_SPECIFIC';
  if (raw.includes('REJECT') && raw.includes('ALL')) return 'REJECT_ALL';
  if (raw.includes('REJECT') && raw.includes('CONFLICT')) return 'REJECT_CONFLICTS';
  if (raw.includes('REJECT')) return 'REJECT_SPECIFIC';

  return inferAdminSubActionFromText(lower, tokens);
};

const getQuickGeneralReply = (message) => {
  const lower = normalizeText(message);
  const ist = getISTDateMeta();

  if (/^(hi|hello|hey|namaste|hii|namaskar|hello ji)\b/.test(lower) || /^(नमस्ते|नमस्कार|हैलो)/.test(lower)) {
    return detectResponseLanguage(message, 'auto') === 'hi'
      ? 'Namaste. Main normal conversation bhi kar sakta hoon aur booking/admin actions mein bhi help karta hoon.'
      : 'Hello. I can chat normally and also help with booking actions when you are logged in.';
  }

  if (/how\s+(are\s+you|is\s+your\s+day|is\s+the\s+day|is\s+today)/.test(lower) || /(कैसे हो|कैसा है दिन|आज कैसा)/.test(lower)) {
    return detectResponseLanguage(message, 'auto') === 'hi'
      ? `Main theek hoon. Aaj ${ist.dayName}, ${ist.fullDate} hai aur IST time ${ist.time} hai.`
      : `Doing well. Today is ${ist.dayName}, ${ist.fullDate}, and the current IST time is ${ist.time}.`;
  }

  if (/what\s+day\s+is\s+(today|it)|today\s+day/.test(lower) || /(आज कौन सा दिन|आज का दिन)/.test(lower)) {
    return detectResponseLanguage(message, 'auto') === 'hi'
      ? `Aaj ${ist.dayName} hai, date ${ist.fullDate} (IST).`
      : `Today is ${ist.dayName}, ${ist.fullDate} (IST).`;
  }

  if (/what\s+is\s+the\s+date|today\s+date|date\s+today/.test(lower) || /(आज की तारीख|आज तारीख)/.test(lower)) {
    return detectResponseLanguage(message, 'auto') === 'hi'
      ? `Aaj ki date ${ist.fullDate} hai (IST), aur din ${ist.dayName} hai.`
      : `Today's date is ${ist.fullDate} (IST), and the day is ${ist.dayName}.`;
  }

  if (/\bwhat\s+is\s+today\b|^today\??$/.test(lower) || /^(aaj|आज)\??$/.test(lower)) {
    return detectResponseLanguage(message, 'auto') === 'hi'
      ? `Aaj ${ist.dayName}, ${ist.fullDate} hai (IST). Current IST time ${ist.time} hai.`
      : `Today is ${ist.dayName}, ${ist.fullDate} (IST). Current IST time is ${ist.time}.`;
  }

  if (/\b(tell|write|narrate)\b.*\bstory\b|\bstory\b.*\b(tell|write|narrate)\b/.test(lower) || /(कहानी|story sunao)/.test(lower)) {
    if (detectResponseLanguage(message, 'auto') === 'hi') {
      return 'BIT Mesra mein ek young faculty ko robotics demo conduct karna tha, lekin har hall busy lag raha tha. Unhone panic karne ke bajay students ke saath plan revise kiya, free slots check kiye aur setup ko compact banaya. Raat bhar rehearsal hui, wiring dobara test hui, aur next day session exact time par start hua. Hall chhota tha par execution strong tha, isliye audience engaged rahi. Event ke baad sabne mana kiya ki success ka reason sirf talent nahi tha, balki planning, teamwork aur pressure mein calm decision-making tha. Message simple tha: perfect condition ka wait mat karo, available resources se best delivery karo.';
    }
    return 'A young faculty member at BIT Mesra had to host a robotics demo, but every hall seemed busy. Instead of giving up, she coordinated with students, checked free slots early, and adjusted the session plan. The team prepared overnight, tested every cable twice, and started right on time in a smaller hall. The audience was packed, the demo ran smoothly, and the project won campus recognition. Later, students said the best part was not the result, but the discipline behind it: planning, communication, and calm decisions under pressure. The lesson was simple: progress does not depend on perfect conditions. It depends on showing up prepared, adapting quickly, and finishing what you start.';
  }

  return null;
};

const getWordCount = (text) => {
  const words = String(text || '').match(/\b[\w'-]+\b/g);
  return words ? words.length : 0;
};

const getChatDetailRequirement = (message) => {
  const raw = String(message || '');
  const lower = normalizeText(raw);

  const explicitWordsMatch = raw.match(/\b(\d{2,4})\s*words?\b/i);
  const explicitWords = explicitWordsMatch ? Number(explicitWordsMatch[1]) : null;
  const requestedWords = explicitWords && !Number.isNaN(explicitWords)
    ? Math.min(1200, Math.max(30, explicitWords))
    : null;

  const wantsDetailedAnswer = /\b(in detail|detailed|elaborate|deep dive|comprehensive|long answer|essay|write about|tell me about|describe|biography|history of|overview of|vistaar|detail mein|lamba answer)\b/i.test(lower) || /(विस्तार|डिटेल में|लंबा जवाब)/.test(lower);

  if (requestedWords) {
    return {
      requestedWords,
      targetMinWords: Math.max(25, Math.floor(requestedWords * 0.8)),
      targetMaxWords: Math.ceil(requestedWords * 1.2),
      needsDetailed: true
    };
  }

  if (wantsDetailedAnswer) {
    return {
      requestedWords: null,
      targetMinWords: 90,
      targetMaxWords: 220,
      needsDetailed: true
    };
  }

  return {
    requestedWords: null,
    targetMinWords: 0,
    targetMaxWords: 0,
    needsDetailed: false
  };
};

const getChatLengthInstruction = (detailReq) => {
  if (detailReq.requestedWords) {
    return `For CHAT responses in this turn, user asked for around ${detailReq.requestedWords} words. Keep the answer approximately within ${detailReq.targetMinWords}-${detailReq.targetMaxWords} words.`;
  }

  if (detailReq.needsDetailed) {
    return 'For CHAT responses in this turn, provide a detailed multi-paragraph answer (roughly 100-180 words).';
  }

  return 'For CHAT responses, stay helpful and clear. Keep simple greetings concise.';
};

const cleanLLMText = (text) =>
  String(text || '')
    .replace(/```json/gi, '')
    .replace(/```/g, '')
    .trim();

const generateGeneralChatResponse = async ({
  message,
  userRole,
  detailReq,
  preferredLanguage = 'auto',
  history = []
}) => {
  const targetHint = detailReq.requestedWords
    ? `around ${detailReq.requestedWords} words`
    : detailReq.needsDetailed
      ? 'a detailed answer (roughly 100-180 words)'
      : 'a clear and natural answer';
  const responseLanguage = detectResponseLanguage(message, preferredLanguage);
  const languageInstruction = responseLanguage === 'hi'
    ? 'Respond in Hindi (natural, clear Hindi).'
    : 'Respond in English.';
  const historyBlock = buildHistoryPromptBlock(history);

  const prompt = `
You are a helpful conversational assistant for a hall booking application.

User role: ${userRole}
Task: Reply naturally to the user message.

Guidelines:
- Return plain text only (no JSON, no markdown fences).
- For normal chat, answer clearly and directly.
- If user asks for a story, provide a complete short story.
- If user asks booking/admin action, explain what they should do based on role.
- Keep length: ${targetHint}.
- ${languageInstruction}
- Use prior thread context when relevant.

Recent thread context:
${historyBlock}

User message: "${message}"
Answer:
`.trim();

  const numPredict = detailReq.requestedWords
    ? Math.min(2400, Math.max(900, detailReq.requestedWords * 4))
    : (detailReq.needsDetailed ? 900 : 700);

  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      options: {
        temperature: 0.5,
        num_predict: numPredict
      }
    })
  });

  if (!response.ok) {
    throw new Error(`General chat generation failed: ${response.status}`);
  }

  const data = await response.json();
  return cleanLLMText(data.response);
};

const expandChatResponse = async ({
  question,
  draftAnswer,
  detailReq,
  userRole,
  preferredLanguage = 'auto',
  history = []
}) => {
  const targetRange = detailReq.requestedWords
    ? `${detailReq.targetMinWords}-${detailReq.targetMaxWords} words`
    : '100-180 words';
  const responseLanguage = detectResponseLanguage(question, preferredLanguage);
  const languageInstruction = responseLanguage === 'hi'
    ? 'Return the expanded answer in Hindi.'
    : 'Return the expanded answer in English.';
  const historyBlock = buildHistoryPromptBlock(history);

  const expandPrompt = `
You are a helpful assistant.

Task:
Expand and improve the draft answer for the user question while staying accurate.

Question: "${question}"
Draft answer: "${draftAnswer}"
User role: ${userRole}

Requirements:
- Return plain text only (no JSON, no markdown fences).
- Keep the answer around ${targetRange}.
- Keep it coherent and conversational.
- Do not mention these instructions.
- ${languageInstruction}

Recent thread context:
${historyBlock}
`.trim();

  const numPredict = detailReq.requestedWords
    ? Math.min(2400, Math.max(700, detailReq.requestedWords * 4))
    : 900;

  const response = await fetch(OLLAMA_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt: expandPrompt,
      stream: false,
      options: {
        temperature: 0.35,
        num_predict: numPredict
      }
    })
  });

  if (!response.ok) {
    throw new Error(`LLM expansion failed: ${response.status}`);
  }

  const data = await response.json();
  return cleanLLMText(data.response);
};

const extractFirstJSON = (txt) => {
  const text = String(txt || '');
  const start = text.indexOf('{');
  if (start === -1) return null;

  let balance = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === '{') balance += 1;
    if (ch === '}') balance -= 1;

    if (balance === 0) {
      const candidate = text.substring(start, i + 1);
      try {
        return JSON.parse(candidate);
      } catch (err) {
        return null;
      }
    }
  }

  return null;
};

const buildSystemPrompt = ({
  message,
  userRole,
  hallNames,
  detailReq,
  preferredLanguage = 'auto',
  history = []
}) => {
  const ist = getISTDateMeta();
  const chatLengthInstruction = getChatLengthInstruction(detailReq);
  const responseLanguage = detectResponseLanguage(message, preferredLanguage);
  const responseLanguageLine = responseLanguage === 'hi'
    ? 'For CHAT responses, reply in Hindi.'
    : 'For CHAT responses, reply in English.';
  const historyBlock = buildHistoryPromptBlock(history);

  return `
You are the AI assistant for BIT Mesra hall booking.

Current context:
- Today (IST): ${ist.fullDate} (${ist.dayName})
- Time (IST): ${ist.time}
- User Role: ${userRole}
- Available Halls: [${hallNames}]

Core behavior:
1) Support normal conversational chat and general knowledge.
2) Also infer booking/admin action intent from free-form language, spelling mistakes, and varied phrasing.
3) Return exactly one JSON object and no markdown.
4) ${chatLengthInstruction}
5) ${responseLanguageLine}
6) Understand Hindi/Hinglish and English phrasing for both chat and actions.

Recent thread context:
${historyBlock}

JSON schema:
{
  "type": "CHAT" | "ACTION",
  "message": "string or null",
  "action": "BOOK_REQUEST" | "ADMIN_EXECUTE" | "SHOW_HALL_STATUS" | "LIST_BOOKING_REQUESTS" | null,
  "payload": object,
  "reply": "string or null"
}

Action guidance:
- BOOK_REQUEST payload format:
  {
    "requests": [
      { "hall": "Hall Name", "date": "YYYY-MM-DD", "start": "10:00 AM", "end": "12:00 PM", "event": "Event Name" }
    ]
  }
- ADMIN_EXECUTE payload format:
  {
    "subAction": "APPROVE_SAFE" | "APPROVE_ALL" | "REJECT_CONFLICTS" | "REJECT_ALL" | "APPROVE_SPECIFIC" | "REJECT_SPECIFIC",
    "targetHall": "Hall Name or null"
  }
- SHOW_HALL_STATUS payload format:
  {
    "mode": "ALL" | "AVAILABLE" | "FILLED",
    "date": "YYYY-MM-DD or null",
    "targetHall": "Hall Name or null"
  }
- LIST_BOOKING_REQUESTS payload format:
  {
    "filter": "ALL" | "CONFLICTING" | "NON_CONFLICTING",
    "date": "YYYY-MM-DD or null",
    "targetHall": "Hall Name or null"
  }

Examples:
User: "hello"
Response: {"type":"CHAT","message":"Hello. How can I help?","action":null,"payload":{},"reply":null}

User: "book hall 2 tomorrow 10 am to 12 pm for workshop"
Response: {"type":"ACTION","message":null,"action":"BOOK_REQUEST","payload":{"requests":[{"hall":"Hall 2","date":"${ist.fullDate}","start":"10:00 AM","end":"12:00 PM","event":"workshop"}]},"reply":"Creating your booking request."}

User: "aproove all non cliflicting bookings"
Response: {"type":"ACTION","message":null,"action":"ADMIN_EXECUTE","payload":{"subAction":"APPROVE_SAFE","targetHall":null},"reply":"Approving all non-conflicting pending bookings."}

User: "show all conflicting and non conflicting booking requests"
Response: {"type":"ACTION","message":null,"action":"LIST_BOOKING_REQUESTS","payload":{"filter":"ALL","date":null,"targetHall":null},"reply":"Listing pending booking requests."}

User: "show available halls on 2026-02-16"
Response: {"type":"ACTION","message":null,"action":"SHOW_HALL_STATUS","payload":{"mode":"AVAILABLE","date":"2026-02-16","targetHall":null},"reply":"Showing available halls."}

User input: "${message}"
Output JSON:
`.trim();
};

const normalizeSingleBookingRequest = (requestLike, fallbackMessage, allHalls) => {
  const raw = requestLike && typeof requestLike === 'object' ? requestLike : {};

  const hall =
    fixHallName(raw.hall || detectHallFromMessage(fallbackMessage, allHalls), allHalls) ||
    detectHallFromMessage(fallbackMessage, allHalls);
  const date = normalizeDateInput(raw.date) || extractDateFromMessage(fallbackMessage);

  const fallbackRange = extractTimeRangeFromMessage(fallbackMessage);
  const start = to12HourTime(raw.start || raw.startTime || raw.from) || fallbackRange.start;
  const end = to12HourTime(raw.end || raw.endTime || raw.to) || fallbackRange.end;

  const event = String(raw.event || extractEventFromMessage(fallbackMessage) || 'AI Booking').trim().slice(0, 150);

  const missing = [];
  if (!hall) missing.push('hall name');
  if (!date) missing.push('booking date');
  if (!start) missing.push('start time');
  if (!end) missing.push('end time');

  if (missing.length > 0) {
    return { request: null, missing };
  }

  return {
    request: { hall, date, start, end, event },
    missing: []
  };
};

const ensureBookingPayload = (payload, message, allHalls) => {
  const requests = Array.isArray(payload.requests) ? payload.requests : [];
  const normalizedRequests = [];
  const allMissing = [];

  if (requests.length === 0) {
    const built = buildBookingRequestFromMessage(message, allHalls);
    if (built.request) normalizedRequests.push(built.request);
    allMissing.push(...built.missing);
  } else {
    for (const request of requests) {
      const normalized = normalizeSingleBookingRequest(request, message, allHalls);
      if (normalized.request) {
        normalizedRequests.push(normalized.request);
      } else {
        allMissing.push(...normalized.missing);
      }
    }
  }

  return {
    requests: normalizedRequests,
    missing: Array.from(new Set(allMissing))
  };
};

router.post('/chat', async (req, res) => {
  try {
    const message = String(req.body?.message || '').trim();
    if (!message) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const history = sanitizeChatHistory(req.body?.history);
    const preferredLanguage = normalizeLanguagePreference(req.body?.language);

    const userRole = req.isAuthenticated && req.isAuthenticated()
      ? String(req.user?.type || '').toUpperCase()
      : 'GUEST';

    const halls = await Hall.find({}, 'name');
    const hallNames = halls.map((h) => h.name);

    const lower = normalizeText(message);
    const tokens = tokenize(message);
    const detailReq = getChatDetailRequirement(message);

    const strongBookingVerb = /\b(book|reserve|request|schedule|allot|buk|bookk)\b/i.test(lower) || /(बुक|आरक्षित|शेड्यूल)/.test(lower);
    const hallMentioned = lower.includes('hall') || /(हॉल|हाल)/.test(lower) || Boolean(detectHallFromMessage(message, halls));
    if (strongBookingVerb && hallMentioned) {
      const built = buildBookingRequestFromMessage(message, halls);

      if (built.request && built.missing.length === 0) {
        if (userRole !== 'DEPARTMENT') {
          return res.json({
            reply: chatReply('To place a hall booking request, please log in as faculty/department first.')
          });
        }

        return res.json({
          reply: actionReply(
            'BOOK_REQUEST',
            { requests: [built.request] },
            `I understood your request for ${built.request.hall}. Sending it to admin for approval now.`
          )
        });
      }
    }

    if (isLikelyBookingIntent(lower, tokens)) {
      if (userRole !== 'DEPARTMENT') {
        return res.json({
          reply: chatReply('To place a hall booking request, please log in as faculty/department first.')
        });
      }

      const built = buildBookingRequestFromMessage(message, halls);
      if (built.request && built.missing.length === 0) {
        return res.json({
          reply: actionReply(
            'BOOK_REQUEST',
            { requests: [built.request] },
            `I understood your request for ${built.request.hall}. Sending it to admin for approval now.`
          )
        });
      }
    }

    const bookingListIntent = inferBookingListIntent(message, lower, tokens, halls);
    if (bookingListIntent) {
      if (userRole !== 'ADMIN') {
        return res.json({
          reply: chatReply('Viewing booking request conflict lists requires admin access. Please log in as admin.')
        });
      }

      return res.json({
        reply: actionReply(
          'LIST_BOOKING_REQUESTS',
          {
            filter: bookingListIntent.filter,
            date: bookingListIntent.date || null,
            targetHall: bookingListIntent.targetHall || null
          },
          'Listing pending booking requests now.'
        )
      });
    }

    const hallStatusIntent = inferHallStatusIntent(message, lower, tokens, halls);
    if (hallStatusIntent) {
      return res.json({
        reply: actionReply(
          'SHOW_HALL_STATUS',
          {
            mode: hallStatusIntent.mode || 'ALL',
            date: hallStatusIntent.date || null,
            targetHall: hallStatusIntent.targetHall || null
          },
          'Checking hall availability now.'
        )
      });
    }

    const adminSubActionHeuristic = inferAdminSubActionFromText(lower, tokens);
    if (adminSubActionHeuristic) {
      if (userRole !== 'ADMIN') {
        return res.json({
          reply: chatReply('This command needs admin access. Please log in as admin first.')
        });
      }

      const targetHall = detectHallFromMessage(message, halls);
      const payload = { subAction: adminSubActionHeuristic };
      if (targetHall) payload.targetHall = targetHall;

      return res.json({
        reply: actionReply(
          'ADMIN_EXECUTE',
          payload,
          'Understood. Executing the admin booking action now.'
        )
      });
    }

    if (isLikelyHallStatusIntent(lower, tokens)) {
      return res.json({
        reply: actionReply('SHOW_HALL_STATUS', {}, 'Checking current hall status now.')
      });
    }

    const quickGeneral = getQuickGeneralReply(message);
    if (quickGeneral && !detailReq.needsDetailed && !detailReq.requestedWords) {
      return res.json({ reply: chatReply(quickGeneral) });
    }

    let parsed = null;

    try {
      const prompt = buildSystemPrompt({
        message,
        userRole,
        hallNames: hallNames.join(', '),
        detailReq,
        preferredLanguage,
        history
      });

      const jsonNumPredict = detailReq.requestedWords
        ? Math.min(2400, Math.max(900, detailReq.requestedWords * 4))
        : (detailReq.needsDetailed ? 900 : 600);

      const response = await fetch(OLLAMA_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: OLLAMA_MODEL,
          prompt,
          stream: false,
          options: {
            temperature: 0.2,
            num_predict: jsonNumPredict,
            stop: ['User input:', 'Output JSON:', '<|end|>']
          }
        })
      });

      if (!response.ok) {
        throw new Error(`LLM request failed: ${response.status}`);
      }

      const data = await response.json();
      const rawText = String(data.response || '').trim();

      parsed = extractFirstJSON(rawText);
      if (!parsed) {
        const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
        parsed = {
          type: 'CHAT',
          message: cleaned || 'I could not parse that request.'
        };
      }
    } catch (modelErr) {
      console.error('AI model error:', modelErr.message || modelErr);

      if (isLikelyBookingIntent(lower, tokens)) {
        if (userRole !== 'DEPARTMENT') {
          return res.json({
            reply: chatReply('To place a hall booking request, please log in as faculty/department first.')
          });
        }

        const built = buildBookingRequestFromMessage(message, halls);
        if (built.request && built.missing.length === 0) {
          return res.json({
            reply: actionReply('BOOK_REQUEST', { requests: [built.request] }, 'Sending your booking request to admin.')
          });
        }

        return res.json({ reply: bookingMissingReply(built.missing) });
      }

      const quickFallback = getQuickGeneralReply(message);
      if (quickFallback) {
        return res.json({ reply: chatReply(quickFallback) });
      }

      try {
        const plainChat = await generateGeneralChatResponse({
          message,
          userRole,
          detailReq,
          preferredLanguage,
          history
        });

        if (plainChat) {
          return res.json({ reply: chatReply(plainChat) });
        }
      } catch (plainErr) {
        console.error('General chat fallback error:', plainErr.message || plainErr);
      }

      return res.json({
        reply: chatReply('I can chat and help with booking workflows. Please try again with clear details.')
      });
    }

    const type = String(parsed.type || 'CHAT').toUpperCase();

    if (type !== 'ACTION') {
      let messageText = cleanLLMText(parsed.message || parsed.reply || '').trim();

      if (detailReq.targetMinWords > 0 && getWordCount(messageText) < detailReq.targetMinWords) {
        const minAcceptWords = Math.max(20, Math.floor(detailReq.targetMinWords * 0.7));
        try {
          for (let attempt = 0; attempt < 2; attempt += 1) {
            const expanded = await expandChatResponse({
              question: message,
              draftAnswer: messageText || 'Please answer the user query.',
              detailReq,
              userRole,
              preferredLanguage,
              history
            });

            const expandedWords = getWordCount(expanded);
            const currentWords = getWordCount(messageText);

            if (expanded && expandedWords > currentWords) {
              messageText = expanded;
            }

            if (expanded && expandedWords >= minAcceptWords) {
              break;
            }
          }
        } catch (expandErr) {
          console.error('AI expansion error:', expandErr.message || expandErr);
        }
      }

      if (!messageText) {
        const quickFallback = getQuickGeneralReply(message);
        if (quickFallback) {
          messageText = quickFallback;
        }
      }

      if (!messageText) {
        try {
          const plainChat = await generateGeneralChatResponse({
            message,
            userRole,
            detailReq,
            preferredLanguage,
            history
          });
          if (plainChat) messageText = plainChat;
        } catch (plainErr) {
          console.error('General chat completion fallback error:', plainErr.message || plainErr);
        }
      }

      return res.json({
        reply: chatReply(messageText || 'I can help with chat, booking requests, and admin booking workflows.')
      });
    }

    const action = String(parsed.action || '').toUpperCase();
    const payload = parsed.payload && typeof parsed.payload === 'object' ? parsed.payload : {};
    const reply = String(parsed.reply || '').trim();

    if (action === 'ADMIN_EXECUTE') {
      const readOnlySignal = hasReadOnlyIntentSignal(lower, tokens);
      const mutatingSignal = hasAdminApproveVerb(lower, tokens) || hasAdminRejectVerb(lower, tokens);

      if (readOnlySignal && !mutatingSignal) {
        const bookingListIntent = inferBookingListIntent(message, lower, tokens, halls);
        if (bookingListIntent) {
          if (userRole !== 'ADMIN') {
            return res.json({
              reply: chatReply('Viewing booking request conflict lists requires admin access. Please log in as admin.')
            });
          }

          return res.json({
            reply: actionReply(
              'LIST_BOOKING_REQUESTS',
              {
                filter: bookingListIntent.filter,
                date: bookingListIntent.date || null,
                targetHall: bookingListIntent.targetHall || null
              },
              'Listing pending booking requests now.'
            )
          });
        }

        const hallStatusIntent = inferHallStatusIntent(message, lower, tokens, halls);
        if (hallStatusIntent) {
          return res.json({
            reply: actionReply(
              'SHOW_HALL_STATUS',
              {
                mode: hallStatusIntent.mode || 'ALL',
                date: hallStatusIntent.date || null,
                targetHall: hallStatusIntent.targetHall || null
              },
              'Checking hall availability now.'
            )
          });
        }
      }
    }

    if (action === 'BOOK_REQUEST') {
      if (userRole !== 'DEPARTMENT') {
        return res.json({
          reply: chatReply('To place a hall booking request, please log in as faculty/department first.')
        });
      }

      const ensured = ensureBookingPayload(payload, message, halls);
      if (ensured.requests.length === 0 || ensured.missing.length > 0) {
        return res.json({ reply: bookingMissingReply(ensured.missing) });
      }

      return res.json({
        reply: actionReply(
          'BOOK_REQUEST',
          { requests: ensured.requests },
          reply || `Sending ${ensured.requests.length} booking request(s) to admin for approval.`
        )
      });
    }

    if (action === 'ADMIN_EXECUTE') {
      if (userRole !== 'ADMIN') {
        return res.json({
          reply: chatReply('This command needs admin access. Please log in as admin first.')
        });
      }

      const normalizedSubAction = normalizeAdminSubAction(payload.subAction, lower, tokens);
      if (!normalizedSubAction) {
        return res.json({
          reply: chatReply('Please specify: approve safe requests, approve all, reject conflicts, or reject all.')
        });
      }

      const targetHall = fixHallName(payload.targetHall || detectHallFromMessage(message, halls), halls);
      const normalizedPayload = { subAction: normalizedSubAction };
      if (targetHall) normalizedPayload.targetHall = targetHall;

      return res.json({
        reply: actionReply(
          'ADMIN_EXECUTE',
          normalizedPayload,
          reply || 'Understood. Executing the admin booking action now.'
        )
      });
    }

    if (action === 'LIST_BOOKING_REQUESTS') {
      if (userRole !== 'ADMIN') {
        return res.json({
          reply: chatReply('Viewing booking request conflict lists requires admin access. Please log in as admin.')
        });
      }

      const normalizedFilter = normalizeConflictFilter(payload.filter, lower, tokens);
      const targetHall = fixHallName(payload.targetHall || detectHallFromMessage(message, halls), halls);
      const date = normalizeDateInput(payload.date || extractDateFromMessage(message));

      const normalizedPayload = {
        filter: normalizedFilter,
        date: date || null,
        targetHall: targetHall || null
      };

      return res.json({
        reply: actionReply(
          'LIST_BOOKING_REQUESTS',
          normalizedPayload,
          reply || 'Listing pending booking requests now.'
        )
      });
    }

    if (action === 'SHOW_HALL_STATUS') {
      const normalizedMode = normalizeHallStatusMode(payload.mode, lower);
      const targetHall = fixHallName(payload.targetHall || detectHallFromMessage(message, halls), halls);
      const date = normalizeDateInput(payload.date || extractDateFromMessage(message));

      return res.json({
        reply: actionReply(
          'SHOW_HALL_STATUS',
          {
            mode: normalizedMode,
            date: date || null,
            targetHall: targetHall || null
          },
          reply || 'Checking hall availability now.'
        )
      });
    }

    const quickFallback = getQuickGeneralReply(message);
    if (quickFallback) {
      return res.json({ reply: chatReply(quickFallback) });
    }

    try {
      const plainChat = await generateGeneralChatResponse({
        message,
        userRole,
        detailReq,
        preferredLanguage,
        history
      });
      if (plainChat) {
        return res.json({ reply: chatReply(plainChat) });
      }
    } catch (plainErr) {
      console.error('General chat unknown-action fallback error:', plainErr.message || plainErr);
    }

    return res.json({
      reply: chatReply('I understood the message but could not map it to a supported action.')
    });
  } catch (err) {
    console.error('AI route error:', err);
    return res.status(500).json({ error: 'AI service failed' });
  }
});

module.exports = router;
