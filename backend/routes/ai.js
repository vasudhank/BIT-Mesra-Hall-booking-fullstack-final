const express = require('express');
const chrono = require('chrono-node');
const pdfParse = require('pdf-parse');
const router = express.Router();
const Hall = require('../models/hall');
const Booking_Requests = require('../models/booking_requests');
const Fuse = require('fuse.js');
const { getProjectSupportContext } = require('../services/projectSupportContextService');
const { generateText, cleanResponseText } = require('../services/llmGatewayService');
const { getKnowledgeContextForPrompt } = require('../services/supportKnowledgeService');
const { runSupportWorkflow } = require('../services/supportWorkflowService');
const { beginAiTimer } = require('../services/metricsService');
const {
  getAgentMemoryContext,
  persistAgentTurn,
  extractReplyTextForMemory
} = require('../services/agentMemoryService');
const { captureException } = require('../services/observabilityService');
const {
  getPendingAction,
  setPendingAction,
  clearPendingAction
} = require('../services/agentPendingActionService');
const { getNoticeClosures } = require('../services/noticeService');

const MAX_ATTACHMENT_COUNT = 4;
const MAX_ATTACHMENT_BYTES = 6 * 1024 * 1024;
const MAX_ATTACHMENT_TEXT_CHARS = 7000;
const MAX_TOTAL_ATTACHMENT_CHARS = 18000;
const MAX_ATTACHMENT_IMAGE_CHARS = 2_000_000;

const enrichProjectContextWithMemory = (projectContext, memoryBlock) => [
  String(projectContext || '').trim(),
  'Persistent agent memory:',
  String(memoryBlock || 'No persistent memory available.').trim()
].filter(Boolean).join('\n\n');

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

const isLikelyTextMime = (mime) => {
  const raw = String(mime || '').toLowerCase().trim();
  if (!raw) return false;
  return raw.startsWith('text/')
    || raw.includes('json')
    || raw.includes('xml')
    || raw.includes('yaml')
    || raw.includes('csv')
    || raw.includes('javascript');
};

const decodeBase64Buffer = (contentBase64) => {
  try {
    const raw = String(contentBase64 || '').trim();
    if (!raw) return null;
    const cleanBase64 = raw.includes(',') ? raw.split(',').pop() : raw;
    return Buffer.from(cleanBase64, 'base64');
  } catch (err) {
    return null;
  }
};

const sanitizeAttachmentEntries = (inputLike) => {
  if (!Array.isArray(inputLike)) return [];

  const sanitized = [];
  for (const raw of inputLike.slice(0, MAX_ATTACHMENT_COUNT)) {
    if (!raw || typeof raw !== 'object') continue;

    const name = String(raw.name || 'attachment').trim().slice(0, 120);
    const type = String(raw.type || '').trim().toLowerCase().slice(0, 120);
    const base64 = String(raw.contentBase64 || '').trim();

    if (!base64) continue;
    const buffer = decodeBase64Buffer(base64);
    if (!buffer || !buffer.length) continue;
    if (buffer.length > MAX_ATTACHMENT_BYTES) continue;

    sanitized.push({
      name,
      type,
      size: buffer.length,
      buffer,
      base64: base64.includes(',') ? base64.split(',').pop() : base64
    });
  }

  return sanitized;
};

const normalizeAttachmentText = (text) =>
  String(text || '')
    .replace(/\u0000/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const extractTextFromAttachment = async (attachment) => {
  if (!attachment || !attachment.buffer) return '';

  const mime = String(attachment.type || '').toLowerCase();
  const filename = String(attachment.name || '').toLowerCase();

  if (mime.includes('pdf') || filename.endsWith('.pdf')) {
    try {
      const parsed = await pdfParse(attachment.buffer);
      return normalizeAttachmentText(parsed?.text || '');
    } catch (err) {
      return '';
    }
  }

  if (isLikelyTextMime(mime) || /\.(txt|md|json|csv|tsv|xml|yaml|yml|log|js|ts|jsx|tsx|html|css)$/i.test(filename)) {
    try {
      return normalizeAttachmentText(attachment.buffer.toString('utf8'));
    } catch (err) {
      return '';
    }
  }

  return '';
};

const buildAttachmentContext = async (rawAttachments) => {
  const attachments = sanitizeAttachmentEntries(rawAttachments);
  if (attachments.length === 0) {
    return {
      summaries: [],
      textBlock: 'No attachments provided.',
      images: [],
      hasVisionInput: false
    };
  }

  const summaries = [];
  const textSegments = [];
  const images = [];

  let consumedChars = 0;

  for (const attachment of attachments) {
    const summary = {
      name: attachment.name,
      type: attachment.type || 'application/octet-stream',
      size: attachment.size
    };

    const isImage = String(attachment.type || '').startsWith('image/');
    if (isImage && attachment.base64.length <= MAX_ATTACHMENT_IMAGE_CHARS) {
      images.push(attachment.base64);
      summary.imagePassedToModel = true;
    }

    const extractedText = await extractTextFromAttachment(attachment);
    if (extractedText) {
      const remaining = MAX_TOTAL_ATTACHMENT_CHARS - consumedChars;
      if (remaining > 0) {
        const clipped = extractedText.slice(0, Math.min(MAX_ATTACHMENT_TEXT_CHARS, remaining));
        consumedChars += clipped.length;
        textSegments.push(`Attachment: ${attachment.name}\n${clipped}`);
        summary.textExtracted = clipped.length;
      }
    }

    summaries.push(summary);
  }

  const textBlock = textSegments.length
    ? textSegments.join('\n\n---\n\n')
    : 'No extractable text content found in attachments.';

  return {
    summaries,
    textBlock,
    images,
    hasVisionInput: images.length > 0
  };
};

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
    .slice(-24);
};

const normalizeHistoryRole = (roleLike) => {
  const role = String(roleLike || '').toLowerCase().trim();
  if (role === 'user') return 'user';
  if (role === 'assistant' || role === 'ai' || role === 'tool') return 'ai';
  return '';
};

const mergeThreadHistoryWithPersistentTurns = (threadHistory = [], persistentTurns = []) => {
  const merged = [];
  const pushEntry = (entry) => {
    if (!entry || typeof entry !== 'object') return;
    const role = normalizeHistoryRole(entry.role);
    const text = String(entry.text || '').trim().slice(0, 2000);
    if (!role || !text) return;

    const prev = merged[merged.length - 1];
    if (prev && prev.role === role && prev.text === text) return;
    merged.push({ role, text });
  };

  (Array.isArray(persistentTurns) ? persistentTurns : []).forEach(pushEntry);
  (Array.isArray(threadHistory) ? threadHistory : []).forEach(pushEntry);
  return merged.slice(-40);
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

const ACTION_TOOLCHAIN = {
  BOOK_REQUEST: ['intent-parser', 'payload-normalizer', 'booking-request-executor'],
  ADMIN_EXECUTE: ['intent-parser', 'role-policy-check', 'admin-booking-executor'],
  CREATE_PUBLIC_TASK: ['intent-parser', 'payload-normalizer', 'calendar-task-executor'],
  CREATE_NOTICE: ['intent-parser', 'payload-normalizer', 'notice-publisher'],
  GET_NOTICE: ['intent-parser', 'notice-query-tool'],
  SEND_EMAIL: ['intent-parser', 'payload-normalizer', 'email-executor'],
  VACATE_HALL: ['intent-parser', 'role-policy-check', 'booking-lookup-tool', 'hall-vacate-executor'],
  SHOW_HALL_STATUS: ['intent-parser', 'availability-query-tool'],
  LIST_BOOKING_REQUESTS: ['intent-parser', 'conflict-analyzer', 'pending-list-query-tool'],
  EXPORT_SCHEDULE: ['intent-parser', 'schedule-query-tool', 'artifact-exporter'],
  SEND_SLACK_MESSAGE: ['planner-agent', 'tool-coordinator', 'human-review-gate', 'slack-executor'],
  SEND_WHATSAPP_MESSAGE: ['planner-agent', 'tool-coordinator', 'human-review-gate', 'whatsapp-executor'],
  SYNC_CRM_RECORD: ['planner-agent', 'tool-coordinator', 'human-review-gate', 'crm-sync-executor']
};

const buildReplyMeta = (type, extra = {}) => ({
  orchestrationMode: type === 'ACTION' ? 'AGENTIC' : 'CONVERSATIONAL',
  orchestrationVersion: 'hybrid-router-v3',
  ...extra
});

const chatReply = (message, intent = 'neutral', meta = {}) => ({
  type: 'CHAT',
  action: null,
  message: String(message || ''),
  meta: buildReplyMeta('CHAT', meta)
});

const actionReply = (action, payload, reply, meta = {}) => ({
  type: 'ACTION',
  action,
  payload,
  reply,
  meta: buildReplyMeta('ACTION', {
    plannedTools: ACTION_TOOLCHAIN[action] || [],
    ...meta
  })
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
  const lower = msg.toLowerCase();

  // Week-level prompts should be handled as ranges instead of a single guessed date.
  if (/\b(this|current|next)\s+week\b/i.test(lower) || /\b(whole|full|entire)\s+week\b/i.test(lower)) {
    return null;
  }

  const dateHint = /(today|tomorrow|day after tomorrow|next\s+|this\s+|monday|tuesday|wednesday|thursday|friday|saturday|sunday|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|aaj|kal|parso|\d{1,2}[/-]\d{1,2}|\d{4}-\d{2}-\d{2})/i;
  if (!dateHint.test(msg)) return null;

  const parsedDate = chrono.parseDate(msg, getISTNow(), { forwardDate: true });
  if (!parsedDate || Number.isNaN(parsedDate.getTime())) return null;

  return formatDateYYYYMMDD(parsedDate);
};

const buildDateWindowResult = (startDateObj, endDateObj) => {
  if (!(startDateObj instanceof Date) || Number.isNaN(startDateObj.getTime())) return { date: null, dateFrom: null, dateTo: null };

  const safeEnd = (endDateObj instanceof Date && !Number.isNaN(endDateObj.getTime()))
    ? endDateObj
    : startDateObj;
  const start = new Date(
    startDateObj.getFullYear(),
    startDateObj.getMonth(),
    startDateObj.getDate(),
    0,
    0,
    0,
    0
  );
  const end = new Date(
    safeEnd.getFullYear(),
    safeEnd.getMonth(),
    safeEnd.getDate(),
    23,
    59,
    59,
    999
  );

  if (end.getTime() < start.getTime()) {
    return {
      date: formatDateYYYYMMDD(start),
      dateFrom: null,
      dateTo: null
    };
  }

  const sameDay = start.getFullYear() === end.getFullYear()
    && start.getMonth() === end.getMonth()
    && start.getDate() === end.getDate();

  if (sameDay) {
    return {
      date: formatDateYYYYMMDD(start),
      dateFrom: null,
      dateTo: null
    };
  }

  return {
    date: null,
    dateFrom: formatDateYYYYMMDD(start),
    dateTo: formatDateYYYYMMDD(end)
  };
};

const getWeekBoundsFromDate = (baseDate, weekOffset = 0) => {
  const anchor = baseDate instanceof Date && !Number.isNaN(baseDate.getTime()) ? baseDate : getISTNow();
  const startOfAnchorDay = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate(), 0, 0, 0, 0);
  const day = startOfAnchorDay.getDay(); // Sunday=0 ... Saturday=6
  const diffToMonday = day === 0 ? -6 : 1 - day;
  const weekStart = new Date(startOfAnchorDay);
  weekStart.setDate(weekStart.getDate() + diffToMonday + (weekOffset * 7));
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);

  return {
    start: weekStart,
    end: new Date(weekEnd.getFullYear(), weekEnd.getMonth(), weekEnd.getDate(), 23, 59, 59, 999)
  };
};

const extractDateWindowFromMessage = (message) => {
  const msg = String(message || '').trim();
  if (!msg) return { date: null, dateFrom: null, dateTo: null };
  const lower = msg.toLowerCase();

  if (/\b(next)\s+week\b/i.test(lower)) {
    const bounds = getWeekBoundsFromDate(getISTNow(), 1);
    return buildDateWindowResult(bounds.start, bounds.end);
  }

  if (/\b(this|current)\s+week\b/i.test(lower) || /\b(whole|full|entire)\s+week\b/i.test(lower)) {
    const bounds = getWeekBoundsFromDate(getISTNow(), 0);
    return buildDateWindowResult(bounds.start, bounds.end);
  }

  const rangePattern = /(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)\s*(?:to|till|until|through|-)\s*(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}(?:[/-]\d{2,4})?)/i;
  const rangeMatch = msg.match(rangePattern);
  if (rangeMatch) {
    const start = chrono.parseDate(rangeMatch[1], getISTNow(), { forwardDate: true });
    const end = chrono.parseDate(rangeMatch[2], getISTNow(), { forwardDate: true });
    const built = buildDateWindowResult(start, end);
    if (built.date || built.dateFrom || built.dateTo) return built;
  }

  const parsedItems = chrono.parse(msg, getISTNow(), { forwardDate: true });
  if (Array.isArray(parsedItems) && parsedItems.length > 0) {
    const withRange = parsedItems.find((item) => item?.start && item?.end);
    if (withRange) {
      const start = withRange.start?.date?.() || null;
      const end = withRange.end?.date?.() || null;
      const built = buildDateWindowResult(start, end);
      if (built.date || built.dateFrom || built.dateTo) return built;
    }
  }

  const date = extractDateFromMessage(msg);
  if (date) {
    return {
      date,
      dateFrom: null,
      dateTo: null
    };
  }

  return { date: null, dateFrom: null, dateTo: null };
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

  const hindiRange = msg.match(/(\d{1,2})(?::(\d{2}))?\s*(?:baje|à¤¬à¤œà¥‡)?\s*(?:se|à¤¸à¥‡)\s*(\d{1,2})(?::(\d{2}))?\s*(?:baje|à¤¬à¤œà¥‡)?/i);
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

  const hindiForMatch = msg.match(/(?:à¤•à¥‡\s+à¤²à¤¿à¤|ke\s+liye)\s+(.+?)(?=\s+\b(on|from|at|by|today|tomorrow|next|this|aaj|kal)\b|$)/i);
  if (hindiForMatch && hindiForMatch[1]) {
    const cleaned = hindiForMatch[1].trim();
    if (cleaned.length >= 3) return cleaned;
  }

  return 'AI Booking';
};

const resolveHallTargetsFromMessage = (message, allHalls = [], options = {}) => {
  const msg = String(message || '').trim();
  const lower = msg.toLowerCase();
  const includeAll = options && Object.prototype.hasOwnProperty.call(options, 'includeAll')
    ? Boolean(options.includeAll)
    : true;

  if (!Array.isArray(allHalls) || allHalls.length === 0) return [];

  // Accept natural variants like "all halls", "all the halls", "every hall".
  if (includeAll && /\b(all|every|each)(?:\s+the)?\s+halls?\b/i.test(lower)) {
    return allHalls
      .map((hall) => String(hall?.name || '').trim())
      .filter(Boolean);
  }

  const resolved = [];
  const addHall = (value) => {
    const fixed = fixHallName(value, allHalls) || detectHallFromMessage(value, allHalls) || String(value || '').trim();
    if (!fixed) return;
    if (!resolved.includes(fixed)) resolved.push(fixed);
  };

  const directMentions = detectHallMentions(msg, allHalls);
  directMentions.forEach(addHall);

  // Avoid matching plural "halls" as hall id "s".
  const hallPattern = /\bhall(?!s\b)\s*[-:]?\s*([a-z0-9]+)\b/gi;
  let patternMatch = hallPattern.exec(msg);
  while (patternMatch) {
    addHall(`Hall ${patternMatch[1]}`);
    patternMatch = hallPattern.exec(msg);
  }

  if (resolved.length === 0) {
    const singleHall = detectHallFromMessage(msg, allHalls);
    if (singleHall) addHall(singleHall);
  }

  return resolved;
};

const deriveRecentBookingContextFromHistory = (history = [], allHalls = []) => {
  if (!Array.isArray(history) || history.length === 0) {
    return {
      date: null,
      start: null,
      end: null,
      event: '',
      halls: []
    };
  }

  const context = {
    date: null,
    start: null,
    end: null,
    event: '',
    halls: []
  };

  const recent = [...history].reverse().slice(0, 12);
  for (const entry of recent) {
    const role = String(entry?.role || '').toLowerCase();
    if (role !== 'user') continue;

    const text = String(entry?.text || '').trim();
    if (!text) continue;
    const lower = normalizeText(text);
    const hasBookingCue = /\b(book|booking|reserve|request|schedule|allot|buk|bookk)\b/i.test(lower);
    const mentionedHalls = resolveHallTargetsFromMessage(text, allHalls, { includeAll: true });
    const hasHallCue = mentionedHalls.length > 0;
    if (!hasBookingCue && !hasHallCue) continue;

    if (!context.date) {
      context.date = normalizeDateInput(extractDateFromMessage(text));
    }

    const range = extractTimeRangeFromMessage(text);
    if (!context.start && range.start) context.start = range.start;
    if (!context.end && range.end) context.end = range.end;

    if (!context.event) {
      const evt = String(extractEventFromMessage(text) || '').trim();
      if (evt && evt !== 'AI Booking') context.event = evt;
    }

    if (context.halls.length === 0 && mentionedHalls.length > 0) {
      context.halls = mentionedHalls;
    }

    if (context.date && context.start && context.end) break;
  }

  return context;
};

const deriveBookingContextFromPendingAction = (pendingAction, allHalls = []) => {
  if (!pendingAction || typeof pendingAction !== 'object') return null;
  if (String(pendingAction.action || '').toUpperCase() !== 'BOOK_REQUEST') return null;

  const requests = Array.isArray(pendingAction?.payload?.requests) ? pendingAction.payload.requests : [];
  if (requests.length === 0) return null;

  const first = requests.find((item) =>
    item
    && normalizeDateInput(item.date)
    && to12HourTime(item.start)
    && to12HourTime(item.end)
  ) || requests[0];

  if (!first) return null;

  const halls = requests
    .map((item) => fixHallName(item?.hall, allHalls) || String(item?.hall || '').trim())
    .filter(Boolean);

  return {
    date: normalizeDateInput(first.date) || null,
    start: to12HourTime(first.start) || null,
    end: to12HourTime(first.end) || null,
    event: String(first.event || '').trim(),
    halls: Array.from(new Set(halls))
  };
};

const mergeBookingContexts = (...contexts) => {
  const merged = {
    date: null,
    start: null,
    end: null,
    event: '',
    halls: []
  };

  for (const ctx of contexts) {
    if (!ctx || typeof ctx !== 'object') continue;

    if (!merged.date) {
      merged.date = normalizeDateInput(ctx.date) || null;
    }
    if (!merged.start) {
      merged.start = to12HourTime(ctx.start) || null;
    }
    if (!merged.end) {
      merged.end = to12HourTime(ctx.end) || null;
    }
    if (!merged.event) {
      merged.event = String(ctx.event || '').trim();
    }
    if (Array.isArray(ctx.halls) && ctx.halls.length > 0) {
      ctx.halls.forEach((hall) => {
        const fixed = String(hall || '').trim();
        if (fixed && !merged.halls.includes(fixed)) merged.halls.push(fixed);
      });
    }
  }

  return merged;
};

const dedupeBookingRequests = (requests = []) => {
  const deduped = [];
  const seen = new Set();

  (Array.isArray(requests) ? requests : []).forEach((request) => {
    if (!request || typeof request !== 'object') return;
    const key = [
      String(request?.hall || '').toLowerCase(),
      String(request?.date || ''),
      String(request?.start || ''),
      String(request?.end || '')
    ].join('|');
    if (!key || seen.has(key)) return;
    seen.add(key);
    deduped.push(request);
  });

  return deduped;
};

const buildBookingRequestsFromMessage = (message, allHalls, bookingContext = {}) => {
  const context = bookingContext && typeof bookingContext === 'object' ? bookingContext : {};
  const hallTargets = resolveHallTargetsFromMessage(message, allHalls, { includeAll: true });
  const date = normalizeDateInput(extractDateFromMessage(message)) || normalizeDateInput(context.date) || null;
  const timeRange = extractTimeRangeFromMessage(message);
  const start = timeRange.start || to12HourTime(context.start) || null;
  const end = timeRange.end || to12HourTime(context.end) || null;

  const extractedEvent = String(extractEventFromMessage(message) || '').trim();
  const contextEvent = String(context.event || '').trim();
  const event = extractedEvent && extractedEvent !== 'AI Booking'
    ? extractedEvent
    : (contextEvent || extractedEvent || 'AI Booking');

  const missing = [];
  if (hallTargets.length === 0) missing.push('hall name');
  if (!date) missing.push('booking date');
  if (!start) missing.push('start time');
  if (!end) missing.push('end time');

  if (start && end) {
    const startMinutes = toMinutesFrom12Hour(start);
    const endMinutes = toMinutesFrom12Hour(end);
    if (startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) {
      missing.push('valid time range (end time after start time)');
    }
  }

  if (missing.length > 0) {
    return { requests: [], missing: Array.from(new Set(missing)) };
  }

  return {
    requests: hallTargets.map((hall) => ({
      hall,
      date,
      start,
      end,
      event
    })),
    missing: []
  };
};

const buildBookingRequestFromMessage = (message, allHalls, bookingContext = {}) => {
  const built = buildBookingRequestsFromMessage(message, allHalls, bookingContext);
  return {
    request: built.requests[0] || null,
    missing: built.missing
  };
};

const bookingMissingReply = (missingList = []) => {
  const unique = Array.from(new Set(missingList));
  const missingText = unique.length > 0 ? unique.join(', ') : 'hall name, date, start time and end time';

  return chatReply(
    `I can create that booking request. Please share: ${missingText}. Example: Hall 2 on 2026-02-20 from 10:00 AM to 12:00 PM for Workshop.`
  );
};

const vacateMissingReply = () =>
  chatReply('I can vacate a booked hall, but I need the hall name and date. Example: vacate hall23 on 2026-04-20.');

const hasHallReference = (lower, tokens) => {
  const explicit =
    /\b(hall|halls|auditorium|seminar|room|haal|hallon)\b/i.test(lower) ||
    /\bhall\s*[-:]?\s*[a-z0-9]+\b/i.test(lower) ||
    /(à¤¹à¥‰à¤²|à¤¹à¤¾à¤²)/.test(lower);
  if (explicit) return true;

  const longTokens = (tokens || []).filter((token) => String(token || '').length >= 4);
  return hasConstrainedFuzzyKeyword(longTokens, ['hall', 'halls', 'auditorium', 'seminar', 'room'], {
    maxDistance: 1,
    requireSameFirstChar: true,
    maxLengthDelta: 2
  });
};

const hasReadOnlyIntentSignal = (lower, tokens) => {
  const direct = /\b(show|list|display|view|see|tell|give|fetch|find|get|check|dikhao|dikhana|batao|batado)\b/i.test(lower) || /(à¤¦à¤¿à¤–à¤¾à¤“|à¤¬à¤¤à¤¾à¤“|à¤¸à¥‚à¤šà¥€|à¤²à¤¿à¤¸à¥à¤Ÿ)/.test(lower);
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
  const hasBothConnector = /\b(and|both|all)\b/i.test(lower);
  const nonConflictWord = /(non\s*[-]?\s*conflict|non\s*[-]?\s*conflicting|no\s+conflict|without\s+conflict|zero\s+time\s+conflict|safe|non\s*[-]?\s*overlap|no\s+overlap|no\s+takra|without\s+takra)/i.test(lower) || /(à¤¬à¤¿à¤¨à¤¾\s+à¤Ÿà¤•à¤°à¤¾à¤µ|à¤¨à¥‰à¤¨\s+à¤•à¥‰à¤¨à¤«à¥à¤²à¤¿à¤•à¥à¤Ÿ|à¤¨à¥‹\s+à¤•à¥‰à¤¨à¤«à¥à¤²à¤¿à¤•à¥à¤Ÿ)/.test(lower);
  const conflictWord =
    hasConstrainedFuzzyKeyword(tokens, ['conflict', 'conflicting', 'overlap', 'clash'], {
      maxDistance: 2,
      requireSameFirstChar: true,
      maxLengthDelta: 3
    }) || /\b(conflict|conflicting|overlap|clash|takra)\b/i.test(lower) || /(à¤Ÿà¤•à¤°à¤¾à¤µ|à¤•à¥à¤²à¥ˆà¤¶|à¤“à¤µà¤°à¤²à¥ˆà¤ª)/.test(lower);

  if (explicitBoth || (nonConflictWord && conflictWord && hasBothConnector)) return 'ALL';
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
  const lowerText = String(lower || '').toLowerCase();
  const asksBothBookedAndNotBooked =
    /\b(booked|filled|occupied|busy)\b/.test(lowerText)
    && /\b(not\s+booked|unbooked|available|free|vacant|not\s+filled|not\s+occupied)\b/.test(lowerText);
  if (asksBothBookedAndNotBooked) return 'ALL';

  if (raw === 'OPEN' || raw === 'CLOSED') return raw;
  if (raw.includes('NOT') && (raw.includes('BOOK') || raw.includes('OCCUP') || raw.includes('FILL') || raw.includes('BUSY'))) return 'AVAILABLE';
  if (raw.includes('UNBOOK') || raw.includes('EMPTY')) return 'AVAILABLE';
  if (raw.includes('UNAVAILABLE') || (raw.includes('NOT') && (raw.includes('FREE') || raw.includes('AVAILABLE') || raw.includes('VACANT')))) return 'FILLED';
  if (raw.includes('OPEN')) return 'OPEN';
  if (raw.includes('CLOSE')) return 'CLOSED';
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
  if (/\b(closed|closure|shut|shutdown)\b/i.test(lower)) return 'CLOSED';
  if (/\b(open)\b/i.test(lower)) return 'OPEN';

  const hindiAvailableHint = /(à¤–à¤¾à¤²à¥€|à¤‰à¤ªà¤²à¤¬à¥à¤§|à¤«à¥à¤°à¥€|à¤¬à¥à¤•\s+à¤¨à¤¹à¥€à¤‚|à¤¨à¥‰à¤Ÿ\s+à¤¬à¥à¤•à¥à¤¡)/.test(lower);
  const hindiFilledHint = /(à¤­à¤°à¤¾|à¤¬à¥à¤•à¥à¤¡|à¤µà¥à¤¯à¤¸à¥à¤¤|à¤‘à¤•à¥à¤¯à¥à¤ªà¤¾à¤‡à¤¡)/.test(lower);
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
  const dateWindow = extractDateWindowFromMessage(message);
  return {
    filter,
    targetHall,
    date: dateWindow.date || null,
    dateFrom: dateWindow.dateFrom || null,
    dateTo: dateWindow.dateTo || null
  };
};

const hasRecentHistoryContext = (history = [], pattern) => {
  if (!Array.isArray(history) || history.length === 0) return false;
  const recentText = history
    .slice(-8)
    .map((entry) => String(entry?.text || '').toLowerCase())
    .join(' ');
  return pattern.test(recentText);
};

const inferHallStatusIntent = (message, lower, tokens, allHalls, history = []) => {
  const hasHallWord = hasHallReference(lower, tokens);
  const readOnlySignal = hasReadOnlyIntentSignal(lower, tokens);
  const statusSignal = hasHallStatusSignal(lower, tokens);
  const mentionsRequests = /\brequests?\b/i.test(lower);
  const followUpRangeCue = /\b(this|next|current)\s+week\b|\b(whole|full|entire)\s+week\b|\bnot\s+only\s+tomorrow\b|\bnot\s+just\s+tomorrow\b/i.test(lower);
  const hallStatusInHistory = hasRecentHistoryContext(
    history,
    /\bhall\s+status\b|\b(booked|not\s+booked|available|availability|free|vacant)\s+halls?\b/
  );

  if (!hasHallWord && !(followUpRangeCue && hallStatusInHistory)) return null;
  if (mentionsRequests) return null;
  if (!readOnlySignal && !statusSignal && !(followUpRangeCue && hallStatusInHistory)) return null;

  const mode = normalizeHallStatusMode(null, lower);
  const dateWindow = extractDateWindowFromMessage(message);
  const targetHall = detectHallFromMessage(message, allHalls);

  return {
    mode,
    targetHall,
    date: dateWindow.date || null,
    dateFrom: dateWindow.dateFrom || null,
    dateTo: dateWindow.dateTo || null
  };
};

const toMinutesFrom12Hour = (inputTime) => {
  const raw = String(inputTime || '').trim().toUpperCase();
  const match = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
  if (!match) return null;

  let hour = Number(match[1]);
  const minute = Number(match[2] || '0');
  const suffix = match[3];

  if (Number.isNaN(hour) || Number.isNaN(minute) || hour < 1 || hour > 12 || minute < 0 || minute > 59) {
    return null;
  }

  if (suffix === 'PM' && hour < 12) hour += 12;
  if (suffix === 'AM' && hour === 12) hour = 0;
  return hour * 60 + minute;
};

const inferScheduleExportIntent = (message, lower) => {
  const hasScheduleWord =
    /\b(schedule|timetable|calendar|time[-\s]?table|today\s+schedule)\b/i.test(lower)
    || /(Ã Â¤Â¶Ã Â¥â€¡Ã Â¤Â¡Ã Â¥ÂÃ Â¤Â¯Ã Â¥â€šÃ Â¤Â²|Ã Â¤Â¤Ã Â¤Â¾Ã Â¤Â²Ã Â¤Â¿Ã Â¤â€¢Ã Â¤Â¾|Ã Â¤Â¸Ã Â¤Â®Ã Â¤Â¯\s*Ã Â¤Â¸Ã Â¤Â¾Ã Â¤Â°Ã Â¤Â£Ã Â¥â‚¬)/.test(lower);
  if (!hasScheduleWord) return null;

  const wantsFile =
    /\b(pdf|file|download|export|report|document|doc)\b/i.test(lower)
    || /\b(image|img|png|jpg|jpeg|photo|screenshot|svg)\b/i.test(lower)
    || /\b(csv|excel|sheet|table)\b/i.test(lower);
  if (!wantsFile) return null;

  const requestedDate = normalizeDateInput(extractDateFromMessage(message)) || null;
  let format = 'PDF';

  if (/\b(image|img|png|jpg|jpeg|photo|screenshot|svg)\b/i.test(lower)) {
    format = 'IMAGE';
  } else if (/\b(csv|excel|sheet)\b/i.test(lower)) {
    format = 'CSV';
  } else if (/\btable\b/i.test(lower)) {
    format = 'TABLE';
  }

  return {
    date: requestedDate,
    format
  };
};

const hasHallStatusSignal = (lower, tokens) => {
  const directStatusWord = /\b(status|availability|available|free|occupied|booked|vacant|filled|busy|khali|bhara|mila)\b/i.test(lower) || /(à¤–à¤¾à¤²à¥€|à¤­à¤°à¤¾|à¤¬à¥à¤•|à¤‰à¤ªà¤²à¤¬à¥à¤§)/.test(lower);
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
  const directApprove = /\b(approve|approved|approving|accept|accepted|allow|allowed|confirm|confirmed|manzoor|svikar|sweekar)\b/i.test(lower) || /(à¤®à¤‚à¤œà¥‚à¤°|à¤¸à¥à¤µà¥€à¤•à¤¾à¤°|à¤…à¤ªà¥à¤°à¥‚à¤µ)/.test(lower);
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

  // Supports admin prompts like "book all non-conflicting pending requests",
  // but avoids hijacking normal booking prompts like
  // "book all halls from 10 PM to 11 PM today".
  const hasBulkBookPhrase = /\bbook\s+(all|every|each)\b/i.test(lower) || /\b(all|every|each)\b.*\bbook\b/i.test(lower);
  const hasAdminConflictScope = /\b(non\s*[-]?\s*conflict|no\s+conflict|without\s+conflict|safe|pending\s+requests?|pending\s+bookings?|conflicting)\b/i.test(lower);
  const bulkBookApprove = hasBulkBookPhrase && hasAdminConflictScope;

  return directApprove || fuzzyApprove || fuzzyAllow || bulkBookApprove;
};

const hasAdminRejectVerb = (lower, tokens) => {
  const directReject = /\b(reject|rejected|rejecting|decline|declined|deny|denied|cancel|cancelled|canceled|asvikar|rad)\b/i.test(lower) || /(à¤…à¤¸à¥à¤µà¥€à¤•à¤¾à¤°|à¤°à¤¦à¥à¤¦|à¤°à¤¿à¤œà¥‡à¤•à¥à¤Ÿ)/.test(lower);
  const fuzzyReject = hasConstrainedFuzzyKeyword(tokens, ['reject', 'decline', 'deny', 'cancel'], {
    maxDistance: 2,
    requireSameFirstChar: true,
    maxLengthDelta: 2
  });

  return directReject || fuzzyReject;
};

const hasVacateVerb = (lower, tokens) => {
  const direct = /\b(vacate|clear|remove|free\s+up|release|unbook|cancel\s+booking|cancel\s+the\s+booking)\b/i.test(lower);
  const actionTokens = (tokens || []).filter((token) =>
    !['vacant', 'vacancy', 'unbooked', 'available', 'availability', 'free'].includes(String(token || '').toLowerCase())
  );
  const fuzzy = hasConstrainedFuzzyKeyword(actionTokens, ['vacate', 'clear', 'remove', 'release', 'unbook'], {
    maxDistance: 2,
    requireSameFirstChar: true,
    maxLengthDelta: 2
  });
  return direct || fuzzy;
};

const inferVacateHallIntent = (message, lower, tokens, allHalls) => {
  if (!hasVacateVerb(lower, tokens)) return null;
  if (!hasHallReference(lower, tokens)) return null;
  if (hasReadOnlyIntentSignal(lower, tokens) && !/\b(vacate|clear|remove|free\s+up|release|unbook|cancel\s+booking|cancel\s+the\s+booking)\b/i.test(lower)) {
    return null;
  }

  const targetHall = detectHallFromMessage(message, allHalls);
  const date = extractDateFromMessage(message);

  return {
    targetHall,
    date: normalizeDateInput(date) || date || null
  };
};

const isLikelyBookingIntent = (lower, tokens) => {
  const directBookingVerb = /\b(book|reserve|request|schedule|allot|buk|bookk)\b/i.test(lower) || /(à¤¬à¥à¤•|à¤†à¤°à¤•à¥à¤·à¤¿à¤¤|à¤¶à¥‡à¤¡à¥à¤¯à¥‚à¤²)/.test(lower);
  const longTokens = (tokens || []).filter((token) => String(token || '').length >= 4);
  const fuzzyBookingVerb = hasConstrainedFuzzyKeyword(longTokens, ['book', 'reserve', 'request', 'schedule'], {
    maxDistance: 2,
    requireSameFirstChar: true,
    maxLengthDelta: 2
  });
  const bookingVerb = directBookingVerb || fuzzyBookingVerb || /\bbooking\b/i.test(lower) || /(à¤¬à¥à¤•à¤¿à¤‚à¤—)/.test(lower);
  const hallWord = hasHallReference(lower, tokens);
  const adminWorkflowVerb = hasAdminApproveVerb(lower, tokens) || hasAdminRejectVerb(lower, tokens);
  const pureStatusQuestion = hasHallStatusSignal(lower, tokens) && !directBookingVerb;
  const readOnlyRequestQuery = /\brequests?\b/i.test(lower) && hasReadOnlyIntentSignal(lower, tokens);

  return bookingVerb && hallWord && !adminWorkflowVerb && !pureStatusQuestion && !readOnlyRequestQuery;
};

const inferFollowUpBookingRequests = (message, lower, tokens, allHalls, history = [], contextOverride = null) => {
  const hasBookingVerb = /\b(book|reserve|request|schedule|allot|buk|bookk)\b/i.test(lower);
  if (hasBookingVerb) return null;
  if (hasReadOnlyIntentSignal(lower, tokens)) return null;

  const hallTargets = resolveHallTargetsFromMessage(message, allHalls, { includeAll: true });
  if (!Array.isArray(hallTargets) || hallTargets.length === 0) return null;

  const continuationCue =
    /\b(also|too|as well|add|remaining|rest|same|continue|other)\b/i.test(lower)
    || /^\s*(and\s+)?halls?\b/i.test(lower)
    || /^hall\s*[-:]?\s*[a-z0-9]+/i.test(String(message || '').trim());
  if (!continuationCue) return null;

  const context = mergeBookingContexts(
    contextOverride,
    deriveRecentBookingContextFromHistory(history, allHalls)
  );
  if (!context?.date || !context?.start || !context?.end) return null;

  const built = buildBookingRequestsFromMessage(message, allHalls, context);
  if (!Array.isArray(built.requests) || built.requests.length === 0 || (built.missing || []).length > 0) {
    return null;
  }

  return built;
};

const inferAdminSubActionFromText = (lower, tokens) => {
  const approveVerb = hasAdminApproveVerb(lower, tokens);
  const rejectVerb = hasAdminRejectVerb(lower, tokens);
  const allScope = /\b(all|every|each|sabhi|saare)\b/i.test(lower) || /(à¤¸à¤­à¥€|à¤¸à¤¾à¤°à¥‡)/.test(lower) || lower.includes('all pending');
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
  const inHindi = detectResponseLanguage(message, 'auto') === 'hi';
  const asksForJoke = /\b(joke|jokes|funny|make me laugh|hasao|hansa|hansao|chutkula)\b/i.test(lower);

  if (asksForJoke) {
    return inHindi
      ? 'Zaroor. Ek short joke: Programmer ne bola, "Main break pe hoon," aur debugger bola, "Main dekh raha hoon, tum phir bhi loop mein hi ho."'
      : 'Sure. Here is a quick one: Why did the developer go broke? Because he used up all his cache.';
  }

  if (/^(hi|hello|hey|namaste|hii|namaskar|hello ji)(\s+(there|ji|sir|mam|maam|bro|buddy))?[.!?]*$/i.test(lower)) {
    return inHindi
      ? 'Namaste. Main normal conversation bhi kar sakta hoon aur booking/admin actions mein bhi help karta hoon.'
      : 'Hello. I can chat normally and also help with booking actions when you are logged in.';
  }

  if (/how\s+(are\s+you|is\s+your\s+day|is\s+the\s+day|is\s+today)|\bkaise\s+ho\b/.test(lower)) {
    return inHindi
      ? `Main theek hoon. Aaj ${ist.dayName}, ${ist.fullDate} hai aur IST time ${ist.time} hai.`
      : `Doing well. Today is ${ist.dayName}, ${ist.fullDate}, and the current IST time is ${ist.time}.`;
  }

  if (/what\s+day\s+is\s+(today|it)|today\s+day|\baaj\s+ka\s+din\b/.test(lower)) {
    return inHindi
      ? `Aaj ${ist.dayName} hai, date ${ist.fullDate} (IST).`
      : `Today is ${ist.dayName}, ${ist.fullDate} (IST).`;
  }

  if (/what\s+is\s+the\s+date|today\s+date|date\s+today|\baaj\s+ki\s+date\b/.test(lower)) {
    return inHindi
      ? `Aaj ki date ${ist.fullDate} hai (IST), aur din ${ist.dayName} hai.`
      : `Today's date is ${ist.fullDate} (IST), and the day is ${ist.dayName}.`;
  }

  if (/\bwhat\s+is\s+today\b|^today\??$|^aaj\??$/.test(lower)) {
    return inHindi
      ? `Aaj ${ist.dayName}, ${ist.fullDate} hai (IST). Current IST time ${ist.time} hai.`
      : `Today is ${ist.dayName}, ${ist.fullDate} (IST). Current IST time is ${ist.time}.`;
  }

  if (/\b(tell|write|narrate)\b.*\bstory\b|\bstory\b.*\b(tell|write|narrate)\b|\bstory\s+sunao\b/.test(lower)) {
    if (inHindi) {
      return 'BIT Mesra mein ek young faculty ko robotics demo conduct karna tha, lekin har hall busy lag raha tha. Unhone panic karne ke bajay students ke saath plan revise kiya, free slots check kiye aur setup ko compact banaya. Raat bhar rehearsal hui, wiring dobara test hui, aur next day session exact time par start hua. Hall chhota tha par execution strong tha, isliye audience engaged rahi. Event ke baad sabne mana kiya ki success ka reason sirf talent nahi tha, balki planning, teamwork aur pressure mein calm decision-making tha. Message simple tha: perfect condition ka wait mat karo, available resources se best delivery karo.';
    }
    return 'A young faculty member at BIT Mesra had to host a robotics demo, but every hall seemed busy. Instead of giving up, she coordinated with students, checked free slots early, and adjusted the session plan. The team prepared overnight, tested every cable twice, and started right on time in a smaller hall. The audience was packed, the demo ran smoothly, and the project won campus recognition. Later, students said the best part was not the result, but the discipline behind it: planning, communication, and calm decisions under pressure. The lesson was simple: progress does not depend on perfect conditions. It depends on showing up prepared, adapting quickly, and finishing what you start.';
  }

  if (/\b(ms\s*dhoni|mahendra\s+singh\s+dhoni|m\s*\.?\s*s\s*\.?\s*dhoni|dhoni)\b/.test(lower)) {
    return inHindi
      ? 'MS Dhoni India ke sabse successful captains mein se ek maane jaate hain. Unki calm leadership, sharp match-reading, aur pressure mein finish karne ki ability unhe alag banati hai. 2007 T20 World Cup, 2011 ODI World Cup aur 2013 Champions Trophy jeet kar unhone Indian cricket ko historic moments diye.'
      : 'MS Dhoni is widely regarded as one of India\'s greatest captains. He is known for calm leadership, elite game awareness, and finishing matches under pressure. By leading India to the 2007 T20 World Cup, 2011 ODI World Cup, and 2013 Champions Trophy, he built a legacy of composure and results.';
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
  const explicitLinesMatch = raw.match(/\b(\d{1,3})\s*lines?\b/i);
  const explicitLines = explicitLinesMatch ? Number(explicitLinesMatch[1]) : null;
  const requestedLines = explicitLines && !Number.isNaN(explicitLines)
    ? Math.min(30, Math.max(2, explicitLines))
    : null;

  const wantsDetailedAnswer = /\b(in detail|detailed|elaborate|deep dive|comprehensive|long answer|essay|write about|tell me about|describe|biography|history of|overview of|vistaar|detail mein|lamba answer)\b/i.test(lower) || /(à¤µà¤¿à¤¸à¥à¤¤à¤¾à¤°|à¤¡à¤¿à¤Ÿà¥‡à¤² à¤®à¥‡à¤‚|à¤²à¤‚à¤¬à¤¾ à¤œà¤µà¤¾à¤¬)/.test(lower);

  if (requestedWords) {
    return {
      requestedWords,
      requestedLines: null,
      targetMinWords: Math.max(25, Math.floor(requestedWords * 0.8)),
      targetMaxWords: Math.ceil(requestedWords * 1.2),
      needsDetailed: true
    };
  }

  if (requestedLines) {
    const inferredWords = Math.min(1200, Math.max(40, requestedLines * 14));
    return {
      requestedWords: inferredWords,
      requestedLines,
      targetMinWords: Math.max(30, Math.floor(inferredWords * 0.75)),
      targetMaxWords: Math.ceil(inferredWords * 1.2),
      needsDetailed: true
    };
  }

  if (wantsDetailedAnswer) {
    return {
      requestedWords: null,
      requestedLines: null,
      targetMinWords: 90,
      targetMaxWords: 220,
      needsDetailed: true
    };
  }

  return {
    requestedWords: null,
    requestedLines: null,
    targetMinWords: 0,
    targetMaxWords: 0,
    needsDetailed: false
  };
};

const getChatLengthInstruction = (detailReq) => {
  if (detailReq.requestedLines) {
    return `For CHAT responses in this turn, user asked for ${detailReq.requestedLines} lines. Return exactly ${detailReq.requestedLines} standalone lines.`;
  }

  if (detailReq.requestedWords) {
    return `For CHAT responses in this turn, user asked for around ${detailReq.requestedWords} words. Keep the answer approximately within ${detailReq.targetMinWords}-${detailReq.targetMaxWords} words.`;
  }

  if (detailReq.needsDetailed) {
    return 'For CHAT responses in this turn, provide a detailed multi-paragraph answer (roughly 100-180 words).';
  }

  return 'For CHAT responses, stay helpful and clear. Keep simple greetings concise.';
};

const cleanLLMText = (text) => cleanResponseText(text);

const generateGeneralChatResponse = async ({
  message,
  userRole,
  detailReq,
  preferredLanguage = 'auto',
  history = [],
  projectContext = '',
  attachmentContext = null,
  knowledgeContext = ''
}) => {
  const targetHint = detailReq.requestedLines
    ? `exactly ${detailReq.requestedLines} standalone lines`
    : detailReq.requestedWords
    ? `around ${detailReq.requestedWords} words`
    : detailReq.needsDetailed
      ? 'a detailed answer (roughly 100-180 words)'
      : 'a clear and natural answer';
  const responseLanguage = detectResponseLanguage(message, preferredLanguage);
  const languageInstruction = responseLanguage === 'hi'
    ? 'Respond in Hindi (natural, clear Hindi).'
    : 'Respond in English.';
  const historyBlock = buildHistoryPromptBlock(history);
  const attachmentSummary = Array.isArray(attachmentContext?.summaries) && attachmentContext.summaries.length > 0
    ? attachmentContext.summaries.map((item, idx) => `${idx + 1}. ${item.name} (${item.type})`).join('\n')
    : 'No attachments.';
  const attachmentText = String(attachmentContext?.textBlock || 'No extracted attachment text.');
  const lineRequirementInstruction = detailReq.requestedLines
    ? `User explicitly requested ${detailReq.requestedLines} lines. Return exactly ${detailReq.requestedLines} lines in the final answer.`
    : 'If user asks for a fixed number of lines, follow that format exactly.';

  const prompt = `
You are a helpful conversational assistant for a hall booking application.

User role: ${userRole}
Project context: ${projectContext || 'Not available'}
Retrieved FAQ/notice context:
${knowledgeContext || 'No additional retrieval snippets.'}
Task: Reply naturally to the user message.

Guidelines:
- Return plain text only (no JSON, no markdown fences).
- For normal chat, answer clearly and directly.
- If user asks for a story, provide a complete short story.
- If user asks booking/admin action, explain what they should do based on role.
- Keep length: ${targetHint}.
- ${languageInstruction}
- ${lineRequirementInstruction}
- Use prior thread context when relevant.

Recent thread context:
${historyBlock}

Attachment summary:
${attachmentSummary}

Attachment extracted text:
${attachmentText}

User message: "${message}"
Answer:
`.trim();

  const numPredict = detailReq.requestedWords
    ? Math.min(2400, Math.max(900, detailReq.requestedWords * 4))
    : (detailReq.needsDetailed ? 900 : 700);

  const result = await generateText({
    prompt,
    temperature: 0.5,
    maxTokens: numPredict,
    images: Array.isArray(attachmentContext?.images) ? attachmentContext.images : []
  });
  return cleanLLMText(result.text);
};

const cleanOfflineTopic = (value) =>
  String(value || '')
    .replace(/[?.!]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);

const extractGeneralKnowledgeTopic = (message) => {
  const raw = String(message || '').trim();
  const patterns = [
    /\b(?:tell|write|describe|explain|give)\s+(?:(?:me|us|here)\s+)?(?:(?:some|few|\d{1,3})\s+lines?\s+)?(?:an?\s+)?(?:around\s+)?(?:\d{1,4}\s+words?\s+)?(?:for|about|on)\s+(.+)$/i,
    /\b(?:\d{1,3}|some|few)\s+lines?\s+(?:for|about|on)\s+(.+)$/i,
    /\b(?:who|what)\s+is\s+(.+)$/i,
    /\b(?:biography|overview|note|paragraph)\s+(?:of|on|about)\s+(.+)$/i
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match && match[1]) return cleanOfflineTopic(match[1]);
  }

  return '';
};

const trimToApproxWords = (text, targetWords) => {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!targetWords || words.length <= targetWords + 12) return words.join(' ');
  return `${words.slice(0, Math.max(20, targetWords)).join(' ')}.`;
};

const formatNumberedLines = (lines = [], requestedLines = 0) => {
  const cleaned = (Array.isArray(lines) ? lines : [])
    .map((line) => String(line || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (cleaned.length === 0) return '';

  const target = requestedLines && Number.isFinite(Number(requestedLines))
    ? Math.min(30, Math.max(2, Number(requestedLines)))
    : cleaned.length;

  const output = [];
  for (let index = 0; index < target; index += 1) {
    const line = cleaned[index] || cleaned[cleaned.length - 1];
    output.push(`${index + 1}. ${line}`);
  }
  return output.join('\n');
};

const buildGenericTopicLines = (topic, lineCount, language = 'en') => {
  if (language === 'hi') {
    return formatNumberedLines([
      `${topic} ek important topic hai jise context ke saath samajhna useful hota hai.`,
      `Is topic ko samajhne ke liye background, key events aur major contributors dekhne chahiye.`,
      `${topic} ka practical impact real life mein alag-alag tarah se dikhta hai.`,
      `Ismein strengths ke saath kuch challenges bhi hote hain jinke solutions evolve hote rehte hain.`,
      `Aaj ke context mein ${topic} ki relevance pehle se kaafi zyada dekhi ja rahi hai.`,
      `Achi explanation mein timeline, examples aur comparison ka mix useful hota hai.`,
      `Reliable sources aur updated references se understanding aur accurate hoti hai.`,
      `${topic} ko best tarike se samajhne ke liye real-world implementation dekhna helpful hota hai.`,
      `Agar chaho to isi topic ko exam-note ya interview-point format mein bhi likh sakta hoon.`,
      `Aap specific angle batao, main uss direction mein focused version de dunga.`
    ], lineCount);
  }

  return formatNumberedLines([
    `${topic} is a relevant topic that is best understood with context and examples.`,
    `A clear way to study ${topic} is to look at key ideas, milestones, and contributors.`,
    `${topic} has practical impact in real-world settings, not just in theory.`,
    `Along with strengths, it also has challenges that need thoughtful handling.`,
    `Its current relevance has increased because user needs and systems keep evolving.`,
    `A good explanation of ${topic} usually includes timeline, examples, and comparisons.`,
    `Reliable and recent references help keep understanding accurate.`,
    `The strongest insights come from seeing how ${topic} is applied in practice.`,
    `If needed, this can be rewritten as exam notes, interview points, or a short article.`,
    `Share a specific angle, and I can provide a sharper next version.`
  ], lineCount);
};

const buildOfflineGeneralChatFallback = ({ message, detailReq, preferredLanguage = 'auto' } = {}) => {
  const topic = extractGeneralKnowledgeTopic(message);
  if (!topic) return '';

  const lowerTopic = topic.toLowerCase();
  const requestedLines = Number(detailReq?.requestedLines || 0);
  const targetWords = detailReq?.requestedWords || (detailReq?.needsDetailed ? 120 : 80);
  const responseLanguage = detectResponseLanguage(message, preferredLanguage);

  if (lowerTopic.includes('virat') && lowerTopic.includes('kohli')) {
    const english = 'Virat Kohli is one of India\'s most influential modern cricketers, known for his aggressive batting, elite fitness, and intense competitiveness. He has captained India across formats and built a reputation for chasing targets under pressure. Kohli is especially admired for his consistency in ODI cricket, his sharp running between wickets, and his ability to turn difficult matches with controlled aggression. Beyond statistics, he changed the fitness culture of Indian cricket and became a global sporting icon. His journey from a passionate Delhi youngster to an international great reflects discipline, confidence, and a relentless hunger to improve.';
    const hindi = 'Virat Kohli Bharat ke sabse prabhavshali modern cricketers mein se ek hain. Unki batting aggression, fitness aur pressure mein chase karne ki ability ke liye mashhoor hai. Kohli ne India ko kai formats mein captain kiya aur ODI cricket mein remarkable consistency dikhayi. Unki running between wickets, match awareness aur discipline ne Indian cricket ki fitness culture ko bhi badla. Delhi ke passionate youngster se global cricket icon banne tak ka safar hard work, confidence aur continuous improvement ka strong example hai.';
    if (requestedLines > 0) {
      const lines = responseLanguage === 'hi'
        ? [
            'Virat Kohli modern Indian cricket ke sabse influential players mein se ek hain.',
            'Unki batting aggression aur fitness standard ne team culture ko transform kiya.',
            'ODI chases mein unki consistency extraordinary level ki mani jati hai.',
            'Pressure situations mein controlled aggression unki strong identity hai.',
            'Kohli ne India ko multiple formats mein leadership di aur clear intent dikhaya.',
            'Unki running between wickets ka pace opposition par lagatar pressure banata hai.',
            'Technique ke saath unki mental discipline bhi unhe alag banati hai.',
            'Unhone young players ke liye professional preparation ka strong benchmark set kiya.',
            'Global stage par Kohli ko modern-era batting icon ke roop mein dekha jata hai.',
            'Unka career talent, hard work aur competitive hunger ka powerful example hai.'
          ]
        : [
            'Virat Kohli is one of the most influential cricketers of modern India.',
            'His batting intensity and elite fitness changed team standards.',
            'He is widely known for exceptional consistency in ODI run chases.',
            'His controlled aggression under pressure became a defining trait.',
            'Kohli led India across formats with clear intent and discipline.',
            'His running between wickets constantly puts pressure on opponents.',
            'Along with technique, his mental discipline sets him apart.',
            'He raised professional preparation standards for younger players.',
            'On the global stage, he is seen as a batting icon of his era.',
            'His journey reflects talent, hard work, and relentless competitiveness.'
          ];
      return formatNumberedLines(lines, requestedLines);
    }

    return trimToApproxWords(responseLanguage === 'hi' ? hindi : english, targetWords);
  }

  if (lowerTopic.includes('dhoni') || lowerTopic.includes('mahendra singh dhoni') || lowerTopic.includes('ms dhoni')) {
    const english = 'MS Dhoni is one of India\'s most respected cricketers and a captain known for composure under pressure. He guided India to three major ICC trophies across formats and earned a reputation as one of the best finishers in limited-overs cricket. Dhoni\'s wicketkeeping, tactical clarity, and ability to stay calm in high-stakes moments made him a defining leader of his era. Beyond records, he is admired for humility, simple communication, and trust in young players.';
    const hindi = 'MS Dhoni Bharat ke sabse respected cricketers mein se ek hain. Unki pehchan calm leadership, pressure mein smart decisions, aur match finish karne ki ability se hoti hai. Unhone India ko multiple ICC trophies jitayi aur wicketkeeping ke saath game reading mein bhi high standard set kiya. Records ke alawa unki simplicity, humility, aur young players par trust unhe ek iconic leader banata hai.';
    if (requestedLines > 0) {
      const lines = responseLanguage === 'hi'
        ? [
            'MS Dhoni Bharat ke sabse successful aur composed captains mein se ek maane jaate hain.',
            'Unki leadership ka sabse bada strength pressure mein bhi calm rehna hai.',
            'Dhoni ne India ko 2007 T20 World Cup jitaya.',
            'Unhone 2011 ODI World Cup jeetkar historic legacy banayi.',
            '2013 Champions Trophy jeetna unki captaincy ka ek aur bada milestone tha.',
            'Wicketkeeper-batsman ke roop mein unka game-reading level bahut high tha.',
            'Limited-overs cricket mein unhe elite finisher ke roop mein dekha jata hai.',
            'Unhone young players ko confidence dekar strong team culture banaya.',
            'Unki simplicity, humility aur discipline fans ko deeply inspire karti hai.',
            'Dhoni ka career consistency, decision-making aur leadership ka strong example hai.'
          ]
        : [
            'MS Dhoni is widely regarded as one of India\'s most successful captains.',
            'His biggest strength is remaining calm under pressure.',
            'He led India to the 2007 T20 World Cup title.',
            'He captained India to the 2011 ODI World Cup victory.',
            'He also won the 2013 Champions Trophy as captain.',
            'As a wicketkeeper-batsman, his game awareness was exceptional.',
            'He is remembered as one of the best finishers in limited-overs cricket.',
            'He built trust in young players and strengthened team culture.',
            'His simplicity and humility earned deep respect from fans.',
            'Dhoni\'s legacy represents leadership, composure, and results.'
          ];
      return formatNumberedLines(lines, requestedLines);
    }

    return trimToApproxWords(responseLanguage === 'hi' ? hindi : english, targetWords);
  }

  if (lowerTopic.includes('suresh raina') || lowerTopic.includes('raina')) {
    if (requestedLines > 0) {
      const lines = responseLanguage === 'hi'
        ? [
            'Suresh Raina India ke sabse dynamic middle-order batsmen mein se ek rahe hain.',
            'Unki aggressive batting aur quick strike-rotation team ko momentum deti thi.',
            'Raina ko India ka pehla T20I century scorer bhi mana jata hai.',
            'Limited-overs cricket mein unki fielding exceptional standard ki thi.',
            'Point aur cover region mein unhone countless runs bachaye.',
            'Unhone pressure situations mein match-finishing innings bhi khelin.',
            'IPL mein Chennai Super Kings ke saath unka role bahut impactful raha.',
            'Raina left-handed batter hone ke saath useful part-time off-spin bhi karte the.',
            'Unki energy aur positive attitude ne dressing room culture ko strong banaya.',
            'Raina ka career Indian white-ball cricket mein consistency aur intent ka symbol hai.'
          ]
        : [
            'Suresh Raina was one of India\'s most dynamic middle-order batters.',
            'His aggressive stroke play and quick running created momentum in tight games.',
            'He is remembered as India\'s first centurion in T20 internationals.',
            'Raina set high standards in fielding, especially in the inner circle.',
            'He saved many runs at point and cover with sharp reflexes.',
            'He played several pressure innings as a dependable finisher.',
            'In the IPL, he was a key pillar of Chennai Super Kings for many seasons.',
            'Along with batting, he contributed useful part-time off-spin.',
            'His energy and team-first attitude made him a strong dressing-room presence.',
            'Raina\'s legacy reflects intent, consistency, and commitment in white-ball cricket.'
          ];
      return formatNumberedLines(lines, requestedLines);
    }

    const english = 'Suresh Raina is remembered as one of India\'s most impactful white-ball cricketers. He brought aggressive intent, quick running, and excellent fielding that often changed momentum in tight matches. Raina was India\'s first T20I centurion and a reliable middle-order batter in major tournaments. In the IPL, he became a defining player for Chennai Super Kings through consistency and fearless stroke play. He also contributed with part-time off-spin and strong on-field energy. His overall legacy reflects versatility, team-first attitude, and high standards in modern limited-overs cricket.';
    const hindi = 'Suresh Raina ko India ke sabse impactful white-ball cricketers mein yaad kiya jata hai. Unki aggressive batting, fast running aur top-level fielding ne kai close matches ka momentum badla. Raina India ke pehle T20I centurion rahe aur middle order mein dependable performer the. IPL mein Chennai Super Kings ke saath unka contribution consistently strong raha. Batting ke alawa unhone useful off-spin aur high energy se team ko support kiya. Unka legacy versatility, team-first mindset aur limited-overs cricket mein commitment ko represent karta hai.';
    return trimToApproxWords(responseLanguage === 'hi' ? hindi : english, targetWords);
  }

  if (requestedLines > 0) {
    return buildGenericTopicLines(topic, requestedLines, responseLanguage);
  }

  const generic = `${topic} is a topic I can discuss conversationally. At a high level, it can be understood by looking at its background, key people or ideas, real-world impact, and why it matters today. If you want a stronger answer, ask for a specific angle such as history, advantages, biography, comparison, or current relevance.`;
  return trimToApproxWords(generic, targetWords);
};

const hasExtractableAttachmentText = (attachmentContext) => {
  const text = String(attachmentContext?.textBlock || '').trim();
  if (!text) return false;

  const lower = text.toLowerCase();
  if (lower === 'no attachments provided.') return false;
  if (lower === 'no extractable text content found in attachments.') return false;
  if (lower === 'no extracted attachment text.') return false;
  return true;
};

const generateAttachmentAnalysisResponse = async ({
  message,
  preferredLanguage = 'auto',
  history = [],
  attachmentContext = null,
  projectContext = '',
  knowledgeContext = ''
}) => {
  const responseLanguage = detectResponseLanguage(message, preferredLanguage);
  const languageInstruction = responseLanguage === 'hi'
    ? 'Respond in Hindi.'
    : 'Respond in English.';
  const historyBlock = buildHistoryPromptBlock(history);

  const attachmentSummary = Array.isArray(attachmentContext?.summaries) && attachmentContext.summaries.length > 0
    ? attachmentContext.summaries
      .map((item, idx) => `${idx + 1}. ${item.name} (${item.type}, ${item.size} bytes)`)
      .join('\n')
    : 'No attachments.';
  const attachmentText = String(attachmentContext?.textBlock || 'No extracted attachment text.');

  const prompt = `
You are a document assistant. The user has uploaded one or more files.

Task:
- Read the extracted file content and answer the user question.
- You are NOT restricted to booking-only topics for this response.
- If the file appears unrelated to bookings, still explain it clearly.
- If extracted text is missing/insufficient, say that clearly and ask for a clearer file scan or text-based file.

Project context:
${projectContext || 'Not available'}

Retrieved FAQ/notice context:
${knowledgeContext || 'No additional retrieval snippets.'}

Output rules:
- Plain text only (no JSON, no markdown fences).
- Give a concise, structured response:
  1) What this file is about
  2) Key points
  3) Any useful next steps (if asked)
- ${languageInstruction}

Recent thread context:
${historyBlock}

Attachment summary:
${attachmentSummary}

Attachment extracted text:
${attachmentText}

User message: "${message}"
Answer:
`.trim();

  const result = await generateText({
    prompt,
    temperature: 0.25,
    maxTokens: 1200,
    images: Array.isArray(attachmentContext?.images) ? attachmentContext.images : []
  });
  return cleanLLMText(result.text);
};

const expandChatResponse = async ({
  question,
  draftAnswer,
  detailReq,
  userRole,
  preferredLanguage = 'auto',
  history = [],
  projectContext = '',
  knowledgeContext = ''
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
Project context: ${projectContext || 'Not available'}
Retrieved FAQ/notice context:
${knowledgeContext || 'No additional retrieval snippets.'}

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

  const result = await generateText({
    prompt: expandPrompt,
    temperature: 0.35,
    maxTokens: numPredict
  });
  return cleanLLMText(result.text);
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

const normalizeModelReply = (replyLike) => {
  const raw = replyLike && typeof replyLike === 'object' ? replyLike : {};

  const inferredType = (() => {
    const typeRaw = String(raw.type || raw.mode || '').toUpperCase().trim();
    if (typeRaw === 'ACTION') return 'ACTION';
    if (typeRaw === 'CHAT') return 'CHAT';
    return raw.action || raw.actionType || raw.tool ? 'ACTION' : 'CHAT';
  })();

  const actionRaw = String(raw.action || raw.actionType || raw.tool || '').toUpperCase().trim();
  const payload =
    raw.payload && typeof raw.payload === 'object'
      ? raw.payload
      : raw.params && typeof raw.params === 'object'
        ? raw.params
        : {};

  const message = raw.message || raw.answer || raw.text || null;
  const reply = raw.reply || raw.response || null;

  return {
    type: inferredType,
    action: actionRaw || null,
    payload,
    message,
    reply
  };
};

const extractActionIntentFromText = (text) => {
  const parsed = extractFirstJSON(text);
  if (!parsed || typeof parsed !== 'object') return null;
  const normalized = normalizeModelReply(parsed);
  if (String(normalized.type || '').toUpperCase() !== 'ACTION') return null;
  if (!normalized.action) return null;
  return normalized;
};

const looksLikeActionJsonLeak = (text) => {
  const raw = String(text || '').trim();
  if (!raw) return false;
  if (!/^\{/.test(raw) && !/^\[/.test(raw)) return false;
  return /"type"\s*:\s*"ACTION"|"\s*action\s*"\s*:|"payload"\s*:/.test(raw);
};

const buildSystemPrompt = ({
  message,
  userRole,
  hallNames,
  detailReq,
  preferredLanguage = 'auto',
  history = [],
  projectContext = '',
  attachmentContext = null,
  knowledgeContext = ''
}) => {
  const ist = getISTDateMeta();
  const chatLengthInstruction = getChatLengthInstruction(detailReq);
  const responseLanguage = detectResponseLanguage(message, preferredLanguage);
  const responseLanguageLine = responseLanguage === 'hi'
    ? 'For CHAT responses, reply in Hindi.'
    : 'For CHAT responses, reply in English.';
  const historyBlock = buildHistoryPromptBlock(history);
  const attachmentSummaries = Array.isArray(attachmentContext?.summaries) && attachmentContext.summaries.length > 0
    ? attachmentContext.summaries
      .map((item, idx) => `${idx + 1}. ${item.name} (${item.type}, ${item.size} bytes)`)
      .join('\n')
    : 'No attachment files.';
  const attachmentTextBlock = String(attachmentContext?.textBlock || 'No attachment text.');

  return `
You are the AI assistant for BIT Mesra hall booking.

Current context:
- Today (IST): ${ist.fullDate} (${ist.dayName})
- Time (IST): ${ist.time}
- User Role: ${userRole}
- Available Halls: [${hallNames}]
- Project support context: ${projectContext || 'Not available'}
- Retrieved FAQ/notice context:
${knowledgeContext || 'No additional retrieval snippets.'}

Core behavior:
1) Support normal conversational chat and general knowledge.
2) Also infer booking/admin action intent from free-form language, spelling mistakes, and varied phrasing.
3) Return exactly one JSON object and no markdown.
4) ${chatLengthInstruction}
5) ${responseLanguageLine}
6) Understand Hindi/Hinglish and English phrasing for both chat and actions.
7) Never hallucinate. If required details are missing or uncertain, ask for the missing details in CHAT mode instead of inventing facts.
8) In CHAT mode, you may use occasional contextual emojis naturally (0-2) when they improve tone. Do not force emojis in every response.

Recent thread context:
${historyBlock}

Attachment summary:
${attachmentSummaries}

Attachment extracted text:
${attachmentTextBlock}

JSON schema:
{
  "type": "CHAT" | "ACTION",
  "message": "string or null",
  "action": "BOOK_REQUEST" | "ADMIN_EXECUTE" | "CREATE_PUBLIC_TASK" | "CREATE_NOTICE" | "GET_NOTICE" | "SEND_EMAIL" | "VACATE_HALL" | "SHOW_HALL_STATUS" | "LIST_BOOKING_REQUESTS" | "EXPORT_SCHEDULE" | null,
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
    "subAction": "APPROVE_SAFE" | "APPROVE_ALL" | "REJECT_CONFLICTS" | "REJECT_ALL" | "APPROVE_SPECIFIC" | "REJECT_SPECIFIC" | "APPROVE_SELECTED" | "REJECT_SELECTED",
    "targetHall": "Hall Name or null",
    "requestIds": ["booking request id"] 
  }
- CREATE_PUBLIC_TASK payload format:
  {
    "title": "Task title",
    "description": "Task description",
    "startDateTime": "ISO datetime string",
    "endDateTime": "ISO datetime string",
    "allDay": false
  }
- CREATE_NOTICE payload format:
  {
    "title": "Notice heading",
    "content": "Notice body",
    "kind": "GENERAL" | "HOLIDAY",
    "startDateTime": "ISO datetime string",
    "endDateTime": "ISO datetime string",
    "closureAllHalls": true | false,
    "rooms": ["Hall name"]
  }
- GET_NOTICE payload format:
  {
    "query": "Notice title, keyword, date, or user search string"
  }
- SEND_EMAIL payload format:
  {
    "to": "recipient@example.com",
    "subject": "Email subject",
    "content": "Exact email body"
  }
- VACATE_HALL payload format:
  {
    "targetHall": "Hall Name",
    "date": "YYYY-MM-DD or null"
  }
- SHOW_HALL_STATUS payload format:
  {
    "mode": "ALL" | "AVAILABLE" | "FILLED" | "OPEN" | "CLOSED",
    "date": "YYYY-MM-DD or null",
    "dateFrom": "YYYY-MM-DD or null",
    "dateTo": "YYYY-MM-DD or null",
    "targetHall": "Hall Name or null"
  }
- LIST_BOOKING_REQUESTS payload format:
  {
    "filter": "ALL" | "CONFLICTING" | "NON_CONFLICTING",
    "date": "YYYY-MM-DD or null",
    "dateFrom": "YYYY-MM-DD or null",
    "dateTo": "YYYY-MM-DD or null",
    "targetHall": "Hall Name or null"
  }
- EXPORT_SCHEDULE payload format:
  {
    "date": "YYYY-MM-DD or null",
    "format": "PDF" | "IMAGE" | "CSV" | "TABLE"
  }

Examples:
User: "hello"
Response: {"type":"CHAT","message":"Hello. How can I help?","action":null,"payload":{},"reply":null}

User: "book hall 2 tomorrow 10 am to 12 pm for workshop"
Response: {"type":"ACTION","message":null,"action":"BOOK_REQUEST","payload":{"requests":[{"hall":"Hall 2","date":"${ist.fullDate}","start":"10:00 AM","end":"12:00 PM","event":"workshop"}]},"reply":"Creating your booking request."}

User: "aproove all non cliflicting bookings"
Response: {"type":"ACTION","message":null,"action":"ADMIN_EXECUTE","payload":{"subAction":"APPROVE_SAFE","targetHall":null},"reply":"Approving all non-conflicting pending bookings."}

User: "vacate hall23 for 20 april"
Response: {"type":"ACTION","message":null,"action":"VACATE_HALL","payload":{"targetHall":"hall23","date":"2026-04-20"},"reply":"Checking and vacating that booked hall if it exists."}

User: "show all conflicting and non conflicting booking requests"
Response: {"type":"ACTION","message":null,"action":"LIST_BOOKING_REQUESTS","payload":{"filter":"ALL","date":null,"targetHall":null},"reply":"Listing pending booking requests."}

User: "show halls booked and not booked this week"
Response: {"type":"ACTION","message":null,"action":"SHOW_HALL_STATUS","payload":{"mode":"ALL","date":null,"dateFrom":"2026-04-20","dateTo":"2026-04-26","targetHall":null},"reply":"Listing hall status for this week."}

User: "show available halls on 2026-02-16"
Response: {"type":"ACTION","message":null,"action":"SHOW_HALL_STATUS","payload":{"mode":"AVAILABLE","date":"2026-02-16","targetHall":null},"reply":"Showing available halls."}

User: "create a public calendar task on 2026-05-02 from 10 am to 12 pm for annual seminar"
Response: {"type":"ACTION","message":null,"action":"CREATE_PUBLIC_TASK","payload":{"title":"annual seminar","description":"","startDateTime":"2026-05-02T10:00:00","endDateTime":"2026-05-02T12:00:00","allDay":false},"reply":"Preparing the public calendar task for confirmation."}

User: "post a holiday notice on 2026-05-05 for all halls heading summer closure content campus will remain closed"
Response: {"type":"ACTION","message":null,"action":"CREATE_NOTICE","payload":{"title":"summer closure","content":"campus will remain closed","kind":"HOLIDAY","startDateTime":"2026-05-05T00:00:00","endDateTime":"2026-05-05T23:59:00","closureAllHalls":true,"rooms":[]},"reply":"Preparing the notice draft for confirmation."}

User: "show me the notice about summer closure and let me download the pdf"
Response: {"type":"ACTION","message":null,"action":"GET_NOTICE","payload":{"query":"summer closure"},"reply":"Looking up the matching notice."}

User: "send email to dean@example.com subject hall update content hall is booked"
Response: {"type":"ACTION","message":null,"action":"SEND_EMAIL","payload":{"to":"dean@example.com","subject":"hall update","content":"hall is booked"},"reply":"Preparing the email draft for confirmation."}

User: "send today's schedule in pdf"
Response: {"type":"ACTION","message":null,"action":"EXPORT_SCHEDULE","payload":{"date":"${ist.fullDate}","format":"PDF"},"reply":"Preparing today's schedule PDF."}

User input: "${message}"
Output JSON:
`.trim();
};

const normalizeSingleBookingRequest = (requestLike, fallbackMessage, allHalls, bookingContext = {}) => {
  const raw = requestLike && typeof requestLike === 'object' ? requestLike : {};
  const context = bookingContext && typeof bookingContext === 'object' ? bookingContext : {};

  const hall =
    fixHallName(raw.hall || detectHallFromMessage(fallbackMessage, allHalls), allHalls) ||
    detectHallFromMessage(fallbackMessage, allHalls);
  const date = normalizeDateInput(raw.date) || normalizeDateInput(extractDateFromMessage(fallbackMessage)) || normalizeDateInput(context.date);

  const fallbackRange = extractTimeRangeFromMessage(fallbackMessage);
  const start = to12HourTime(raw.start || raw.startTime || raw.from) || fallbackRange.start || to12HourTime(context.start);
  const end = to12HourTime(raw.end || raw.endTime || raw.to) || fallbackRange.end || to12HourTime(context.end);

  const extractedEvent = String(raw.event || extractEventFromMessage(fallbackMessage) || '').trim();
  const contextEvent = String(context.event || '').trim();
  const event = String(
    extractedEvent && extractedEvent !== 'AI Booking'
      ? extractedEvent
      : (contextEvent || extractedEvent || 'AI Booking')
  ).slice(0, 150);

  const missing = [];
  if (!hall) missing.push('hall name');
  if (!date) missing.push('booking date');
  if (!start) missing.push('start time');
  if (!end) missing.push('end time');

  if (start && end) {
    const startMinutes = toMinutesFrom12Hour(start);
    const endMinutes = toMinutesFrom12Hour(end);
    if (startMinutes !== null && endMinutes !== null && endMinutes <= startMinutes) {
      missing.push('valid time range (end time after start time)');
    }
  }

  if (missing.length > 0) {
    return { request: null, missing };
  }

  return {
    request: { hall, date, start, end, event },
    missing: []
  };
};

const ensureBookingPayload = (payload, message, allHalls, history = []) => {
  const requests = Array.isArray(payload.requests) ? payload.requests : [];
  const normalizedRequests = [];
  const allMissing = [];
  const bookingContext = deriveRecentBookingContextFromHistory(history, allHalls);

  if (requests.length > 0) {
    for (const request of requests) {
      const normalized = normalizeSingleBookingRequest(request, message, allHalls, bookingContext);
      if (normalized.request) {
        normalizedRequests.push(normalized.request);
      } else {
        allMissing.push(...normalized.missing);
      }
    }
  }

  const inferredFromMessage = buildBookingRequestsFromMessage(message, allHalls, bookingContext);
  if (Array.isArray(inferredFromMessage.requests) && inferredFromMessage.requests.length > 0) {
    normalizedRequests.push(...inferredFromMessage.requests);
  } else if (normalizedRequests.length === 0) {
    allMissing.push(...(inferredFromMessage.missing || []));
  }

  return {
    requests: dedupeBookingRequests(normalizedRequests),
    missing: Array.from(new Set(allMissing))
  };
};

const normalizeDateWindowPayload = (payload = {}, fallbackMessage = '') => {
  const raw = payload && typeof payload === 'object' ? payload : {};
  const normalizedDate = normalizeDateInput(raw.date);
  const normalizedDateFrom = normalizeDateInput(raw.dateFrom || raw.startDate || raw.rangeStart);
  const normalizedDateTo = normalizeDateInput(raw.dateTo || raw.endDate || raw.rangeEnd);

  if (normalizedDateFrom || normalizedDateTo) {
    const dateFrom = normalizedDateFrom || normalizedDateTo;
    const dateTo = normalizedDateTo || normalizedDateFrom;
    if (dateFrom && dateTo && dateFrom !== dateTo) {
      return {
        date: null,
        dateFrom,
        dateTo
      };
    }

    return {
      date: dateFrom || dateTo || null,
      dateFrom: null,
      dateTo: null
    };
  }

  if (normalizedDate) {
    return {
      date: normalizedDate,
      dateFrom: null,
      dateTo: null
    };
  }

  const inferred = extractDateWindowFromMessage(fallbackMessage);
  return {
    date: normalizeDateInput(inferred.date) || null,
    dateFrom: normalizeDateInput(inferred.dateFrom) || null,
    dateTo: normalizeDateInput(inferred.dateTo) || null
  };
};

const extractQuotedValues = (message) => {
  const matches = [];
  const regex = /"([^"]{1,400})"/g;
  let match;
  while ((match = regex.exec(String(message || ''))) !== null) {
    matches.push(String(match[1] || '').trim());
  }
  return matches.filter(Boolean);
};

const extractLabeledValue = (message, labels = [], max = 4000) => {
  const text = String(message || '');
  for (const label of labels) {
    const pattern = new RegExp(`\\b${label}\\b\\s*[:=-]\\s*([^\\n]+)`, 'i');
    const match = text.match(pattern);
    if (match && match[1]) {
      return String(match[1]).trim().slice(0, max);
    }
  }
  return '';
};

const detectHallMentions = (message, allHalls) => {
  if (!Array.isArray(allHalls) || allHalls.length === 0) return [];
  const lower = String(message || '').toLowerCase();
  const matches = [];

  allHalls.forEach((hall) => {
    const hallName = String(hall?.name || '').trim();
    if (!hallName) return;
    if (lower.includes(hallName.toLowerCase())) {
      matches.push(hallName);
    }
  });

  return Array.from(new Set(matches));
};

const extractIsoDateRangeFromMessage = (message) => {
  const parsed = chrono.parse(String(message || ''), getISTNow(), { forwardDate: true });
  if (!Array.isArray(parsed) || parsed.length === 0) {
    return {
      startDate: null,
      endDate: null
    };
  }

  const best = parsed[0];
  const startDate = best?.start?.date();
  const endDate = best?.end?.date() || startDate;

  return {
    startDate: startDate && !Number.isNaN(startDate.getTime()) ? formatDateYYYYMMDD(startDate) : null,
    endDate: endDate && !Number.isNaN(endDate.getTime()) ? formatDateYYYYMMDD(endDate) : null
  };
};

const buildIsoDateTime = (date, time) => {
  const normalizedDate = normalizeDateInput(date);
  const normalizedTime = to12HourTime(time);
  if (!normalizedDate || !normalizedTime) return null;

  const parts = normalizedTime.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!parts) return null;

  let hour = Number(parts[1]);
  const minute = Number(parts[2]);
  const suffix = String(parts[3] || '').toUpperCase();
  if (suffix === 'PM' && hour < 12) hour += 12;
  if (suffix === 'AM' && hour === 12) hour = 0;

  const iso = `${normalizedDate}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : iso;
};

const parseYesNoIntent = (lower) => {
  const normalized = String(lower || '').trim().replace(/[.!?]+$/g, '');

  const yesPattern = /^(yes|y|haan|ha|han|ok|okay|sure|confirm|confirmed|go ahead|proceed|do it|do it now|book it|send it|post it|create it)(\s+please)?$/i;
  const noPattern = /^(no|n|nah|nope|cancel|cancel it|stop|drop|leave it|do not|don't)(\s+please)?$/i;

  if (yesPattern.test(normalized)) {
    return 'YES';
  }
  if (noPattern.test(normalized)) {
    return 'NO';
  }
  return '';
};

const buildConfirmationCard = ({
  confirmationType,
  title,
  summary,
  prompt,
  columns,
  rows,
  editForm,
  plainText = ''
}) => ({
  kind: 'CONFIRMATION',
  confirmationType,
  title: String(title || '').trim(),
  summary: String(summary || '').trim(),
  prompt: String(prompt || '').trim(),
  columns: Array.isArray(columns) ? columns : ['Field', 'Value'],
  rows: Array.isArray(rows) ? rows : [],
  editForm: editForm && typeof editForm === 'object' ? editForm : null,
  plainText: String(plainText || '').trim()
});

const formatConflictPreviewLabel = (conflictLike) => {
  const normalized = String(conflictLike || '').trim().toUpperCase();
  if (normalized === 'TIME_CONFLICT' || normalized === 'APPROVED_BOOKING_CONFLICT') return 'TIME CONFLICT';
  if (normalized === 'DATE_CONFLICT') return 'DATE CONFLICT';
  if (normalized === 'NOTICE_CLOSURE') return 'NOTICE CLOSURE';
  return 'NON-CONFLICTING';
};

const classifyPendingConflictPreview = async (requestDoc, allPending = []) => {
  const hallDoc = await Hall.findOne({ name: requestDoc.hall }).select('name bookings');
  if (!hallDoc) {
    return { conflict: 'CONFLICTING', conflictType: 'HALL_NOT_FOUND', detail: 'Hall not found.' };
  }

  const noticeClosures = await getNoticeClosures({
    hallName: requestDoc.hall,
    startDateTime: requestDoc.startDateTime,
    endDateTime: requestDoc.endDateTime
  });
  if (noticeClosures.length > 0) {
    return {
      conflict: 'CONFLICTING',
      conflictType: 'NOTICE_CLOSURE',
      detail: noticeClosures[0]?.title || noticeClosures[0]?.holidayName || 'Hall closed by notice.'
    };
  }

  const approvedConflict = (hallDoc.bookings || []).find((booking) =>
    new Date(booking.startDateTime).getTime() < new Date(requestDoc.endDateTime).getTime()
    && new Date(booking.endDateTime).getTime() > new Date(requestDoc.startDateTime).getTime()
  );
  if (approvedConflict) {
    return {
      conflict: 'CONFLICTING',
      conflictType: 'APPROVED_BOOKING_CONFLICT',
      detail: approvedConflict.event || 'Overlaps an approved booking.'
    };
  }

  const currentStart = new Date(requestDoc.startDateTime);
  const currentEnd = new Date(requestDoc.endDateTime);
  const currentDayStart = new Date(currentStart);
  currentDayStart.setHours(0, 0, 0, 0);
  const currentDayEnd = new Date(requestDoc.endDate || requestDoc.endDateTime || currentEnd);
  currentDayEnd.setHours(23, 59, 59, 999);
  const currentTimeRange = {
    start: toMinutesFrom12Hour(requestDoc.startTime12 || to12HourTime(requestDoc.startTime24 || '')),
    end: toMinutesFrom12Hour(requestDoc.endTime12 || to12HourTime(requestDoc.endTime24 || ''))
  };

  for (const other of allPending) {
    if (!other || !other._id || String(other._id) === String(requestDoc._id)) continue;
    if (String(other.status || '').toUpperCase() !== 'PENDING') continue;
    if (String(other.hall || '').toLowerCase() !== String(requestDoc.hall || '').toLowerCase()) continue;

    const otherStart = new Date(other.startDateTime);
    const otherEnd = new Date(other.endDateTime);
    if (currentStart.getTime() < otherEnd.getTime() && currentEnd.getTime() > otherStart.getTime()) {
      return {
        conflict: 'CONFLICTING',
        conflictType: 'TIME_CONFLICT',
        detail: `Overlaps pending request ${String(other._id)}.`
      };
    }

    const otherDayStart = new Date(other.startDate || other.startDateTime);
    otherDayStart.setHours(0, 0, 0, 0);
    const otherDayEnd = new Date(other.endDate || other.endDateTime || other.startDateTime);
    otherDayEnd.setHours(23, 59, 59, 999);
    const daysOverlap = currentDayStart.getTime() <= otherDayEnd.getTime()
      && otherDayStart.getTime() <= currentDayEnd.getTime();
    const otherTimeRange = {
      start: toMinutesFrom12Hour(other.startTime12 || to12HourTime(other.startTime24 || '')),
      end: toMinutesFrom12Hour(other.endTime12 || to12HourTime(other.endTime24 || ''))
    };
    const timesOverlap = currentTimeRange.start !== null
      && currentTimeRange.end !== null
      && otherTimeRange.start !== null
      && otherTimeRange.end !== null
      ? currentTimeRange.start < otherTimeRange.end && otherTimeRange.start < currentTimeRange.end
      : false;

    if (daysOverlap && !timesOverlap) {
      return {
        conflict: 'CONFLICTING',
        conflictType: 'DATE_CONFLICT',
        detail: `Date window overlaps pending request ${String(other._id)}.`
      };
    }
  }

  return {
    conflict: 'NON_CONFLICTING',
    conflictType: 'SAFE',
    detail: 'No conflicts detected.'
  };
};

const buildBookingConfirmationData = async (requests, userRole, allHalls) => {
  const normalizedRequests = Array.isArray(requests) ? requests : [];
  const previewRows = [];
  const editFields = [];

  for (let index = 0; index < normalizedRequests.length; index += 1) {
    const request = normalizedRequests[index];
    const hall = fixHallName(request.hall, allHalls) || request.hall;
    const startDateTime = buildIsoDateTime(request.date, request.start);
    const endDateTime = buildIsoDateTime(request.date, request.end);
    let executionPath = userRole === 'ADMIN'
      ? 'Direct admin booking'
      : 'Faculty booking request';

    if (hall && startDateTime && endDateTime) {
      const hallDoc = await Hall.findOne({ name: hall }).select('name bookings');
      if (!hallDoc) {
        executionPath = 'Hall not found';
      } else {
        const overlapsExisting = (hallDoc.bookings || []).some((booking) =>
          new Date(booking.startDateTime).getTime() < new Date(endDateTime).getTime()
          && new Date(booking.endDateTime).getTime() > new Date(startDateTime).getTime()
        );
        const noticeClosures = await getNoticeClosures({
          hallName: hallDoc.name,
          startDateTime,
          endDateTime
        });

        if (noticeClosures.length > 0) {
          executionPath = userRole === 'ADMIN'
            ? 'Blocked by closure notice'
            : 'Will go to admin review (closure notice)';
        } else if (overlapsExisting) {
          executionPath = userRole === 'ADMIN'
            ? 'Blocked by existing booking'
            : 'Will go to admin review (time conflict)';
        } else {
          executionPath = 'Will auto-book immediately';
        }
      }
    }

    previewRows.push([
      hall || '',
      request.date || '',
      request.date || '',
      request.start || '',
      request.end || '',
      request.event || '',
      executionPath
    ]);

    if (index === 0) {
      editFields.push(
        { key: 'hall', label: 'Hall Name', input: 'text', value: hall || '' },
        { key: 'fromDate', label: 'From Date', input: 'date', value: request.date || '' },
        { key: 'toDate', label: 'To Date', input: 'date', value: request.date || '' },
        { key: 'fromTime', label: 'From Time', input: 'text', value: request.start || '' },
        { key: 'toTime', label: 'To Time', input: 'text', value: request.end || '' },
        { key: 'event', label: 'Event', input: 'text', value: request.event || '' }
      );
    }
  }

  const single = normalizedRequests.length === 1;
  const rows = single
    ? [
        ['Hall Name', previewRows[0]?.[0] || ''],
        ['From Date', previewRows[0]?.[1] || ''],
        ['To Date', previewRows[0]?.[2] || ''],
        ['From Time', previewRows[0]?.[3] || ''],
        ['To Time', previewRows[0]?.[4] || ''],
        ['Event', previewRows[0]?.[5] || ''],
        ['Execution Path', previewRows[0]?.[6] || '']
      ]
    : previewRows;

  return buildConfirmationCard({
    confirmationType: 'BOOK_REQUEST',
    title: single ? 'Confirm Hall Booking' : 'Confirm Hall Bookings',
    summary: single
      ? 'Please review the booking details before the AI proceeds.'
      : `Please review ${normalizedRequests.length} booking requests before the AI proceeds.`,
    prompt: 'Is the above information right? Do you want to book this?',
    columns: single ? ['Field', 'Value'] : ['Hall Name', 'From Date', 'To Date', 'From Time', 'To Time', 'Event', 'Execution Path'],
    rows,
    editForm: {
      fields: editFields
    },
    plainText: single
      ? rows.map((row) => `${row[0]} - ${row[1]}`).join('\n')
      : previewRows.map((row) => row.join(' | ')).join('\n')
  });
};

const buildAdminExecuteConfirmationData = async (payload) => {
  const subAction = String(payload.subAction || '').toUpperCase();
  const targetHall = String(payload.targetHall || '').trim();
  const selectedRequestIds = Array.isArray(payload.requestIds)
    ? payload.requestIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];

  const pendingRequests = await Booking_Requests
    .find({ status: 'PENDING' })
    .populate('department')
    .sort({ startDateTime: 1, createdAt: 1 });

  const hallScoped = targetHall
    ? pendingRequests.filter((requestDoc) => String(requestDoc.hall || '').toLowerCase() === targetHall.toLowerCase())
    : pendingRequests;

  const items = [];
  for (const requestDoc of hallScoped) {
    const conflictMeta = await classifyPendingConflictPreview(requestDoc, pendingRequests);
    items.push({
      id: String(requestDoc._id),
      hall: requestDoc.hall,
      date: requestDoc.startDate || formatDateYYYYMMDD(new Date(requestDoc.startDateTime)),
      start: requestDoc.startTime12 || '',
      end: requestDoc.endTime12 || '',
      event: requestDoc.event || '',
      requestedBy: requestDoc.department?.head || requestDoc.department?.department || 'Unknown',
      requestedEmail: requestDoc.department?.email || 'N/A',
      conflictType: conflictMeta.conflictType,
      conflictLabel: formatConflictPreviewLabel(conflictMeta.conflictType)
    });
  }

  const defaultSelected = selectedRequestIds.length > 0
    ? items.filter((item) => selectedRequestIds.includes(item.id))
    : subAction === 'APPROVE_SAFE'
      ? items.filter((item) => item.conflictType === 'SAFE')
      : subAction === 'REJECT_CONFLICTS'
        ? items.filter((item) => item.conflictType !== 'SAFE')
        : items;

  return {
    nextPayload: {
      subAction: subAction === 'APPROVE_SAFE' ? 'APPROVE_SELECTED' : subAction === 'REJECT_CONFLICTS' ? 'REJECT_SELECTED' : subAction,
      targetHall: targetHall || null,
      requestIds: defaultSelected.map((item) => item.id)
    },
    confirmationData: buildConfirmationCard({
      confirmationType: 'ADMIN_EXECUTE',
      title: 'Confirm Booking Request Action',
      summary: defaultSelected.length > 0
        ? `The AI selected ${defaultSelected.length} request(s) for ${subAction.replace(/_/g, ' ').toLowerCase()}.`
        : 'No matching requests were selected for this action.',
      prompt: 'Do you want to proceed with the selected requests, or edit the selection first?',
      columns: ['Hall', 'Date', 'Time', 'Event', 'Requested By', 'Conflict'],
      rows: defaultSelected.map((item) => [
        item.hall,
        item.date,
        `${item.start} - ${item.end}`.trim(),
        item.event,
        `${item.requestedBy} (${item.requestedEmail})`,
        item.conflictLabel
      ]),
      editForm: {
        fields: [
          {
            key: 'requestIds',
            label: 'Requests',
            input: 'checkbox_list',
            options: items.map((item) => ({
              value: item.id,
              label: `${item.hall} | ${item.date} | ${item.start} - ${item.end} | ${item.requestedBy} | ${item.conflictLabel}`,
              checked: defaultSelected.some((selected) => selected.id === item.id)
            }))
          }
        ]
      },
      plainText: defaultSelected.map((item) => `${item.hall} | ${item.date} | ${item.start} - ${item.end} | ${item.conflictLabel}`).join('\n')
    })
  };
};

const buildCalendarTaskDraftFromMessage = (message) => {
  const quoted = extractQuotedValues(message);
  const title = extractLabeledValue(message, ['title', 'task', 'event'], 240)
    || quoted[0]
    || extractEventFromMessage(message)
    || 'Public Task';
  const description = extractLabeledValue(message, ['description', 'details'], 3000)
    || quoted[1]
    || '';
  const { startDate, endDate } = extractIsoDateRangeFromMessage(message);
  const timeRange = extractTimeRangeFromMessage(message);
  const allDay = !timeRange.start || !timeRange.end;
  const fallbackEndDate = endDate || startDate;

  const payload = {
    title: String(title || '').trim().slice(0, 240),
    description: String(description || '').trim().slice(0, 4000),
    allDay,
    startDateTime: allDay
      ? (startDate ? `${startDate}T00:00:00.000Z` : null)
      : buildIsoDateTime(startDate, timeRange.start),
    endDateTime: allDay
      ? (fallbackEndDate ? `${fallbackEndDate}T23:59:59.999Z` : null)
      : buildIsoDateTime(fallbackEndDate, timeRange.end)
  };

  const missing = [];
  if (!payload.title) missing.push('task title');
  if (!payload.startDateTime) missing.push('task start date/time');
  if (!payload.endDateTime) missing.push('task end date/time');
  return { payload, missing };
};

const buildCalendarTaskConfirmationData = (payload) =>
  buildConfirmationCard({
    confirmationType: 'CREATE_PUBLIC_TASK',
    title: 'Confirm Public Calendar Task',
    summary: 'Please review the public calendar task before the AI creates it.',
    prompt: 'Is the above information right? Do you want to create this public task?',
    columns: ['Field', 'Value'],
    rows: [
      ['Task Title', payload.title || ''],
      ['From Date', String(payload.startDateTime || '').slice(0, 10)],
      ['To Date', String(payload.endDateTime || '').slice(0, 10)],
      ['From Time', String(payload.startDateTime || '').slice(11, 16) || (payload.allDay ? 'All day' : '')],
      ['To Time', String(payload.endDateTime || '').slice(11, 16) || (payload.allDay ? 'All day' : '')],
      ['Description', payload.description || '-']
    ],
    editForm: {
      fields: [
        { key: 'title', label: 'Task Title', input: 'text', value: payload.title || '' },
        { key: 'description', label: 'Description', input: 'textarea', value: payload.description || '' },
        { key: 'fromDate', label: 'From Date', input: 'date', value: String(payload.startDateTime || '').slice(0, 10) },
        { key: 'toDate', label: 'To Date', input: 'date', value: String(payload.endDateTime || '').slice(0, 10) },
        { key: 'fromTime', label: 'From Time', input: 'text', value: to12HourTime(String(payload.startDateTime || '').slice(11, 16)) || '' },
        { key: 'toTime', label: 'To Time', input: 'text', value: to12HourTime(String(payload.endDateTime || '').slice(11, 16)) || '' }
      ]
    }
  });

const buildNoticeDraftFromMessage = (message, allHalls) => {
  const quoted = extractQuotedValues(message);
  const title = extractLabeledValue(message, ['title', 'heading', 'subject'], 240) || quoted[0] || 'Notice';
  const content = extractLabeledValue(message, ['content', 'body', 'message'], 7000) || quoted[1] || '';
  const { startDate, endDate } = extractIsoDateRangeFromMessage(message);
  const timeRange = extractTimeRangeFromMessage(message);
  const rooms = detectHallMentions(message, allHalls);
  const closureAllHalls = /\b(all halls|all rooms|institute wide|campus wide|whole institute|entire institute)\b/i.test(message);
  const kind = /\b(holiday|closure|closed|shutdown)\b/i.test(message) ? 'HOLIDAY' : 'GENERAL';

  const startDateTime = startDate
    ? (timeRange.start ? buildIsoDateTime(startDate, timeRange.start) : `${startDate}T00:00:00.000Z`)
    : null;
  const endDateTime = (endDate || startDate)
    ? (timeRange.end ? buildIsoDateTime(endDate || startDate, timeRange.end) : `${endDate || startDate}T23:59:59.999Z`)
    : null;

  const payload = {
    title: String(title || '').trim().slice(0, 240),
    content: String(content || '').trim().slice(0, 8000),
    kind,
    closureAllHalls,
    rooms,
    startDateTime,
    endDateTime
  };

  const missing = [];
  if (!payload.title) missing.push('notice heading');
  if (!payload.content) missing.push('notice content');
  if (!payload.startDateTime) missing.push('notice start date');
  if (!payload.endDateTime) missing.push('notice end date/time');
  return { payload, missing };
};

const buildNoticeConfirmationData = (payload) =>
  buildConfirmationCard({
    confirmationType: 'CREATE_NOTICE',
    title: 'Confirm Notice Posting',
    summary: 'Please review the notice before the AI posts it to the notice dashboard.',
    prompt: 'Is the above information right? Do you want to post this notice?',
    columns: ['Field', 'Value'],
    rows: [
      ['Heading', payload.title || ''],
      ['Type', payload.kind || 'GENERAL'],
      ['From Date', String(payload.startDateTime || '').slice(0, 10)],
      ['To Date', String(payload.endDateTime || '').slice(0, 10)],
      ['From Time', String(payload.startDateTime || '').slice(11, 16) || 'All day'],
      ['To Time', String(payload.endDateTime || '').slice(11, 16) || 'All day'],
      ['Institute-wide Closure', payload.closureAllHalls ? 'Yes' : 'No'],
      ['Rooms', Array.isArray(payload.rooms) && payload.rooms.length > 0 ? payload.rooms.join(', ') : '-'],
      ['Content', payload.content || '-']
    ],
    editForm: {
      fields: [
        { key: 'title', label: 'Heading', input: 'text', value: payload.title || '' },
        { key: 'content', label: 'Content', input: 'textarea', value: payload.content || '' },
        { key: 'kind', label: 'Type', input: 'select', value: payload.kind || 'GENERAL', options: [
          { value: 'GENERAL', label: 'GENERAL' },
          { value: 'HOLIDAY', label: 'HOLIDAY / CLOSURE' }
        ] },
        { key: 'fromDate', label: 'From Date', input: 'date', value: String(payload.startDateTime || '').slice(0, 10) },
        { key: 'toDate', label: 'To Date', input: 'date', value: String(payload.endDateTime || '').slice(0, 10) },
        { key: 'fromTime', label: 'From Time', input: 'text', value: to12HourTime(String(payload.startDateTime || '').slice(11, 16)) || '' },
        { key: 'toTime', label: 'To Time', input: 'text', value: to12HourTime(String(payload.endDateTime || '').slice(11, 16)) || '' },
        { key: 'closureAllHalls', label: 'Institute-wide Closure', input: 'select', value: payload.closureAllHalls ? 'yes' : 'no', options: [
          { value: 'no', label: 'No' },
          { value: 'yes', label: 'Yes' }
        ] },
        { key: 'rooms', label: 'Rooms', input: 'text', value: Array.isArray(payload.rooms) ? payload.rooms.join(', ') : '' }
      ]
    }
  });

const buildEmailDraftFromMessage = (message) => {
  const emailMatch = String(message || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const quoted = extractQuotedValues(message);
  const to = emailMatch ? emailMatch[0] : extractLabeledValue(message, ['to', 'email'], 240);
  const subject = extractLabeledValue(message, ['subject'], 200) || (quoted.length > 1 ? quoted[0] : 'BIT Booking AI Message');
  const content = extractLabeledValue(message, ['content', 'body', 'message', 'mail'], 5000)
    || (quoted.length > 1 ? quoted[1] : quoted[0] || '');
  const payload = {
    to: String(to || '').trim(),
    subject: String(subject || '').trim().slice(0, 200),
    content: String(content || '').trim().slice(0, 5000)
  };

  const missing = [];
  if (!payload.to) missing.push('recipient email');
  if (!payload.content) missing.push('email content');
  return { payload, missing };
};

const buildEmailConfirmationData = (payload) =>
  buildConfirmationCard({
    confirmationType: 'SEND_EMAIL',
    title: 'Confirm Email Sending',
    summary: 'Please review the email before the AI sends it exactly as written.',
    prompt: 'Is the above information right? Do you want to send this email?',
    columns: ['Field', 'Value'],
    rows: [
      ['To', payload.to || ''],
      ['Subject', payload.subject || 'BIT Booking AI Message'],
      ['Content', payload.content || '']
    ],
    editForm: {
      fields: [
        { key: 'to', label: 'To', input: 'text', value: payload.to || '' },
        { key: 'subject', label: 'Subject', input: 'text', value: payload.subject || '' },
        { key: 'content', label: 'Content', input: 'textarea', value: payload.content || '' }
      ]
    }
  });

const createPendingActionReply = async ({
  context,
  userRole,
  action,
  payload,
  reply,
  confirmationData,
  extraMeta = {}
}) => {
  await setPendingAction({
    ownerKey: context?.ownerKey,
    threadId: context?.threadId,
    userRole,
    pendingAction: {
      action,
      payload,
      reply,
      confirmation: confirmationData,
      metadata: extraMeta
    }
  });

  return actionReply(action, payload, reply, {
    awaitingConfirmation: true,
    resultData: confirmationData,
    ...extraMeta
  });
};

const buildPendingActionFromPatch = async (pendingAction, patch, allHalls, userRole = 'GUEST') => {
  const action = String(pendingAction?.action || '').toUpperCase();
  const payload = pendingAction?.payload && typeof pendingAction.payload === 'object'
    ? { ...pendingAction.payload }
    : {};
  const nextPatch = patch && typeof patch === 'object' ? patch : {};

  if (action === 'BOOK_REQUEST') {
    const request = Array.isArray(payload.requests) && payload.requests[0] ? { ...payload.requests[0] } : {};
    const nextRequest = {
      hall: fixHallName(nextPatch.hall || request.hall, allHalls) || String(nextPatch.hall || request.hall || '').trim(),
      date: normalizeDateInput(nextPatch.fromDate || request.date || ''),
      start: to12HourTime(nextPatch.fromTime || request.start || ''),
      end: to12HourTime(nextPatch.toTime || request.end || ''),
      event: String(nextPatch.event || request.event || '').trim().slice(0, 150)
    };

    const nextPayload = { requests: [nextRequest] };
    const confirmationData = await buildBookingConfirmationData(nextPayload.requests, userRole, allHalls);
    return {
      action,
      payload: nextPayload,
      confirmationData
    };
  }

  if (action === 'CREATE_PUBLIC_TASK') {
    const fromDate = normalizeDateInput(nextPatch.fromDate || String(payload.startDateTime || '').slice(0, 10));
    const toDate = normalizeDateInput(nextPatch.toDate || String(payload.endDateTime || '').slice(0, 10));
    const fromTime = to12HourTime(nextPatch.fromTime || to12HourTime(String(payload.startDateTime || '').slice(11, 16)) || '');
    const toTime = to12HourTime(nextPatch.toTime || to12HourTime(String(payload.endDateTime || '').slice(11, 16)) || '');
    const nextPayload = {
      title: String(nextPatch.title || payload.title || '').trim().slice(0, 240),
      description: String(nextPatch.description || payload.description || '').trim().slice(0, 4000),
      allDay: false,
      startDateTime: buildIsoDateTime(fromDate, fromTime),
      endDateTime: buildIsoDateTime(toDate || fromDate, toTime)
    };
    return {
      action,
      payload: nextPayload,
      confirmationData: buildCalendarTaskConfirmationData(nextPayload)
    };
  }

  if (action === 'CREATE_NOTICE') {
    const fromDate = normalizeDateInput(nextPatch.fromDate || String(payload.startDateTime || '').slice(0, 10));
    const toDate = normalizeDateInput(nextPatch.toDate || String(payload.endDateTime || '').slice(0, 10));
    const fromTime = to12HourTime(nextPatch.fromTime || to12HourTime(String(payload.startDateTime || '').slice(11, 16)) || '');
    const toTime = to12HourTime(nextPatch.toTime || to12HourTime(String(payload.endDateTime || '').slice(11, 16)) || '');
    const nextPayload = {
      title: String(nextPatch.title || payload.title || '').trim().slice(0, 240),
      content: String(nextPatch.content || payload.content || '').trim().slice(0, 8000),
      kind: String(nextPatch.kind || payload.kind || 'GENERAL').toUpperCase(),
      closureAllHalls: String(nextPatch.closureAllHalls || (payload.closureAllHalls ? 'yes' : 'no')).toLowerCase() === 'yes',
      rooms: String(nextPatch.rooms || (Array.isArray(payload.rooms) ? payload.rooms.join(', ') : ''))
        .split(/[,\n;|]/)
        .map((item) => fixHallName(item.trim(), allHalls) || item.trim())
        .filter(Boolean),
      startDateTime: buildIsoDateTime(fromDate, fromTime || '12:00 AM'),
      endDateTime: buildIsoDateTime(toDate || fromDate, toTime || '11:59 PM')
    };
    return {
      action,
      payload: nextPayload,
      confirmationData: buildNoticeConfirmationData(nextPayload)
    };
  }

  if (action === 'SEND_EMAIL') {
    const nextPayload = {
      to: String(nextPatch.to || payload.to || '').trim(),
      subject: String(nextPatch.subject || payload.subject || '').trim().slice(0, 200),
      content: String(nextPatch.content || payload.content || '').trim().slice(0, 5000)
    };
    return {
      action,
      payload: nextPayload,
      confirmationData: buildEmailConfirmationData(nextPayload)
    };
  }

  if (action === 'ADMIN_EXECUTE') {
    const nextPayload = {
      ...payload,
      requestIds: Array.isArray(nextPatch.requestIds)
        ? nextPatch.requestIds.map((id) => String(id || '').trim()).filter(Boolean)
        : Array.isArray(payload.requestIds)
          ? payload.requestIds
          : []
    };
    const nextPreview = await buildAdminExecuteConfirmationData(nextPayload);
    return {
      action,
      payload: nextPreview.nextPayload,
      confirmationData: nextPreview.confirmationData
    };
  }

  return {
    action,
    payload,
    confirmationData: pendingAction?.confirmation || null
  };
};

const looksLikeCalendarTaskIntent = (lower, tokens) => {
  const createVerb = /\b(create|add|post|make|schedule|put)\b/i.test(lower);
  const taskWord = /\b(calendar|task|public task|public event|event)\b/i.test(lower);
  const hallBookingWord = /\bhall\b/i.test(lower) && /\bbook|reserve|request\b/i.test(lower);
  return createVerb && taskWord && !hallBookingWord;
};

const looksLikeNoticeCreateIntent = (lower) =>
  /\b(create|post|publish|add)\b/i.test(lower) && /\bnotice\b/i.test(lower);

const looksLikeNoticeReadIntent = (lower) =>
  /\b(show|read|open|get|find|download|pdf)\b/i.test(lower) && /\bnotice\b/i.test(lower);

const looksLikeSendEmailIntent = (lower) =>
  /\b(send)\b/i.test(lower) && /\b(email|mail)\b/i.test(lower);

const hasProjectKeywordHint = (lower) =>
  /\b(hall|halls|booking|reserve|request|availability|vacate|notice|notices|calendar|task|pending|approve|reject|admin|faculty|department|schedule|slot|conflict)\b/i.test(lower)
  || /\bbook\s+(?:hall|halls|slot|room|auditorium)\b/i.test(lower);

const isLikelyProjectPrompt = ({
  message,
  lower,
  tokens,
  halls = [],
  history = []
} = {}) => {
  if (hasProjectKeywordHint(lower)) return true;
  if (inferScheduleExportIntent(message, lower)) return true;
  if (inferVacateHallIntent(message, lower, tokens, halls)) return true;
  if (inferBookingListIntent(message, lower, tokens, halls)) return true;
  if (inferHallStatusIntent(message, lower, tokens, halls, history)) return true;
  if (isLikelyBookingIntent(lower, tokens)) return true;
  if (looksLikeCalendarTaskIntent(lower, tokens)) return true;
  if (looksLikeNoticeCreateIntent(lower) || looksLikeNoticeReadIntent(lower)) return true;
  if (looksLikeSendEmailIntent(lower)) return true;
  if (inferAdminSubActionFromText(lower, tokens)) return true;

  const shortFollowUp = /^\s*(also|and|same|continue|yes|no|ok|okay|proceed|confirm)\b/i.test(String(message || '').trim());
  if (shortFollowUp) {
    return hasRecentHistoryContext(
      history,
      /\b(hall|booking|book|request|notice|calendar|approve|reject|vacate|schedule|slot)\b/
    );
  }

  return false;
};

router.post('/pending-action/update', async (req, res) => {
  try {
    const userRole = req.isAuthenticated && req.isAuthenticated()
      ? String(req.user?.type || '').toUpperCase()
      : 'GUEST';
    const halls = await Hall.find({}, 'name');
    const agentMemoryContext = await getAgentMemoryContext({
      req,
      message: 'Update pending AI confirmation',
      history: [],
      userRole,
      threadId: req.body?.threadId,
      accountKey: req.body?.accountKey,
      channel: 'http_pending_update'
    });

    const pendingAction = await getPendingAction({
      ownerKey: agentMemoryContext?.ownerKey,
      threadId: agentMemoryContext?.threadId
    });

    if (!pendingAction) {
      return res.status(404).json({ error: 'No pending AI confirmation found for this thread.' });
    }

    const updated = await buildPendingActionFromPatch(
      pendingAction,
      req.body?.patch || {},
      halls,
      userRole
    );

    await setPendingAction({
      ownerKey: agentMemoryContext?.ownerKey,
      threadId: agentMemoryContext?.threadId,
      userRole,
      pendingAction: {
        action: updated.action,
        payload: updated.payload,
        reply: pendingAction.reply || 'I updated the draft. Please review it again.',
        confirmation: updated.confirmationData,
        metadata: pendingAction.metadata || {}
      }
    });

    return res.json({
      ok: true,
      confirmation: updated.confirmationData
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Failed to update pending confirmation.' });
  }
});

router.post('/chat', async (req, res) => {
  const finalizeAi = beginAiTimer('http_chat');
  let hadAiError = false;
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
    const historyQueryText = history
      .slice(-6)
      .map((entry) => `${entry.role}: ${entry.text}`)
      .join('\n');

    const [attachmentContext, projectContextBase, halls, knowledgeBundle, agentMemoryContext] = await Promise.all([
      buildAttachmentContext(req.body?.attachments || []),
      getProjectSupportContext(),
      Hall.find({}, 'name'),
      getKnowledgeContextForPrompt({
        query: `${message}\n${historyQueryText}`,
        maxFaq: 5,
        maxNotices: 3
      }),
      getAgentMemoryContext({
        req,
        message,
        history,
        userRole,
        threadId: req.body?.threadId,
        accountKey: req.body?.accountKey,
        channel: 'http_chat'
      })
    ]);

    const knowledgeContext = String(knowledgeBundle?.block || 'No retrieval snippets available.').trim();
    const projectContext = enrichProjectContextWithMemory(projectContextBase, agentMemoryContext?.block);

    const originalJson = res.json.bind(res);
    let memoryPersistQueued = false;
    res.json = (body) => {
      if (!memoryPersistQueued) {
        memoryPersistQueued = true;
        const reply = body?.reply && typeof body.reply === 'object' ? body.reply : null;
        persistAgentTurn({
          context: agentMemoryContext,
          userMessage: message,
          assistantReply: extractReplyTextForMemory(body),
          replyType: reply?.type || 'CHAT',
          action: reply?.action || null,
          status: res.statusCode >= 400 || body?.error ? 'ERROR' : 'OK',
          metadata: {
            userRole,
            channel: 'http_chat',
            replyMeta: reply?.meta || null
          }
        }).catch((memoryErr) => {
          captureException(memoryErr, { area: 'ai_chat_memory_persist' });
        });
      }
      return originalJson(body);
    };

    const hallNames = halls.map((h) => h.name);

    const lower = normalizeText(message);
    const tokens = tokenize(message);
    const detailReq = getChatDetailRequirement(message);
    const pendingAction = await getPendingAction({
      ownerKey: agentMemoryContext?.ownerKey,
      threadId: agentMemoryContext?.threadId
    });
    const effectiveHistory = mergeThreadHistoryWithPersistentTurns(history, agentMemoryContext?.recentMessages);
    const bookingContext = mergeBookingContexts(
      deriveRecentBookingContextFromHistory(effectiveHistory, halls),
      deriveBookingContextFromPendingAction(pendingAction, halls)
    );
    const yesNoDecision = parseYesNoIntent(lower);

    if (pendingAction && yesNoDecision === 'YES') {
      return res.json({
        reply: actionReply(
          pendingAction.action,
          pendingAction.payload || {},
          'Confirmed. Executing now.',
          {
            confirmedPendingAction: true,
            confirmationResolved: true
          }
        )
      });
    }

    if (pendingAction && yesNoDecision === 'NO') {
      await clearPendingAction({
        ownerKey: agentMemoryContext?.ownerKey,
        threadId: agentMemoryContext?.threadId
      });

      return res.json({
        reply: chatReply('Okay, I cancelled that pending AI action for this thread.')
      });
    }

    if (pendingAction && String(pendingAction.action || '').toUpperCase() === 'BOOK_REQUEST') {
      const followUpToPending = inferFollowUpBookingRequests(
        message,
        lower,
        tokens,
        halls,
        effectiveHistory,
        bookingContext
      );

      if (followUpToPending) {
        if (userRole !== 'DEPARTMENT' && userRole !== 'ADMIN') {
          return res.json({
            reply: chatReply('To book a hall with AI, please log in as admin or faculty/department first.')
          });
        }

        const existing = ensureBookingPayload(pendingAction.payload || {}, '', halls, effectiveHistory);
        const combinedRequests = dedupeBookingRequests([
          ...(existing.requests || []),
          ...(followUpToPending.requests || [])
        ]);
        const addedCount = Math.max(0, combinedRequests.length - (existing.requests || []).length);

        return res.json({
          reply: await createPendingActionReply({
            context: agentMemoryContext,
            userRole,
            action: 'BOOK_REQUEST',
            payload: { requests: combinedRequests },
            reply: addedCount > 0
              ? `Added ${addedCount} additional hall booking request(s). Total queued: ${combinedRequests.length}. Please confirm before I proceed.`
              : 'Those hall(s) are already included in the pending booking draft. Please confirm before I proceed.',
            confirmationData: await buildBookingConfirmationData(combinedRequests, userRole, halls)
          })
        });
      }
    }

    const scheduleExportIntent = inferScheduleExportIntent(message, lower);
    if (scheduleExportIntent) {
      return res.json({
        reply: actionReply(
          'EXPORT_SCHEDULE',
          {
            date: scheduleExportIntent.date || null,
            format: scheduleExportIntent.format || 'PDF'
          },
          'Preparing the schedule export now.'
        )
      });
    }

    const vacateHallIntent = inferVacateHallIntent(message, lower, tokens, halls);
    if (vacateHallIntent) {
      if (userRole !== 'ADMIN') {
        return res.json({
          reply: chatReply('Vacating a booked hall requires admin access. Please log in as admin first.')
        });
      }

      if (!vacateHallIntent.targetHall) {
        return res.json({ reply: vacateMissingReply() });
      }

      return res.json({
        reply: actionReply(
          'VACATE_HALL',
          {
            targetHall: vacateHallIntent.targetHall,
            date: vacateHallIntent.date || null
          },
          vacateHallIntent.date
            ? `Checking ${vacateHallIntent.targetHall} on ${vacateHallIntent.date} and vacating matching booking(s).`
            : `Checking current bookings in ${vacateHallIntent.targetHall} and vacating matching booking(s).`
        )
      });
    }

    const strongBookingVerb = /\b(book|reserve|request|schedule|allot|buk|bookk)\b/i.test(lower) || /(à¤¬à¥à¤•|à¤†à¤°à¤•à¥à¤·à¤¿à¤¤|à¤¶à¥‡à¤¡à¥à¤¯à¥‚à¤²)/.test(lower);
    const hallMentioned = lower.includes('hall') || /(à¤¹à¥‰à¤²|à¤¹à¤¾à¤²)/.test(lower) || Boolean(detectHallFromMessage(message, halls));
    if (userRole === 'ADMIN') {
      const adminSubAction = inferAdminSubActionFromText(lower, tokens);
      if (adminSubAction && !hasReadOnlyIntentSignal(lower, tokens)) {
        const adminPreview = await buildAdminExecuteConfirmationData({
          subAction: adminSubAction,
          targetHall: detectHallFromMessage(message, halls) || null
        });

        if ((adminPreview?.confirmationData?.rows || []).length === 0) {
          return res.json({
            reply: chatReply('I did not find any matching pending booking requests for that admin action.')
          });
        }

        return res.json({
          reply: await createPendingActionReply({
            context: agentMemoryContext,
            userRole,
            action: 'ADMIN_EXECUTE',
            payload: adminPreview.nextPayload,
            reply: 'I reviewed the pending booking requests. Please confirm before I execute this admin action.',
            confirmationData: adminPreview.confirmationData
          })
        });
      }
    }

    if (looksLikeCalendarTaskIntent(lower, tokens) && /\b(calendar|task|public)\b/i.test(lower)) {
      if (userRole !== 'DEPARTMENT' && userRole !== 'ADMIN') {
        return res.json({
          reply: chatReply('Creating public calendar tasks via AI requires admin or faculty login.')
        });
      }

      const taskDraft = buildCalendarTaskDraftFromMessage(message);
      if (taskDraft.missing.length > 0) {
        return res.json({
          reply: chatReply(`I can create that public calendar task. Please share: ${taskDraft.missing.join(', ')}.`)
        });
      }

      return res.json({
        reply: await createPendingActionReply({
          context: agentMemoryContext,
          userRole,
          action: 'CREATE_PUBLIC_TASK',
          payload: taskDraft.payload,
          reply: 'I captured the public calendar task. Please confirm before I create it.',
          confirmationData: buildCalendarTaskConfirmationData(taskDraft.payload)
        })
      });
    }

    if (looksLikeNoticeCreateIntent(lower)) {
      if (userRole !== 'ADMIN') {
        return res.json({
          reply: chatReply('Posting notices via AI requires admin login.')
        });
      }

      const noticeDraft = buildNoticeDraftFromMessage(message, halls);
      if (noticeDraft.missing.length > 0) {
        return res.json({
          reply: chatReply(`I can post that notice. Please share: ${noticeDraft.missing.join(', ')}.`)
        });
      }

      return res.json({
        reply: await createPendingActionReply({
          context: agentMemoryContext,
          userRole,
          action: 'CREATE_NOTICE',
          payload: noticeDraft.payload,
          reply: 'I captured the notice details. Please confirm before I post it.',
          confirmationData: buildNoticeConfirmationData(noticeDraft.payload)
        })
      });
    }

    if (looksLikeNoticeReadIntent(lower)) {
      return res.json({
        reply: actionReply(
          'GET_NOTICE',
          { query: message },
          'Looking up the matching notice now.'
        )
      });
    }

    if (looksLikeSendEmailIntent(lower)) {
      if (userRole !== 'DEPARTMENT' && userRole !== 'ADMIN') {
        return res.json({
          reply: chatReply('Sending email via AI requires admin or faculty login.')
        });
      }

      const emailDraft = buildEmailDraftFromMessage(message);
      if (emailDraft.missing.length > 0) {
        return res.json({
          reply: chatReply(`I can send that email. Please share: ${emailDraft.missing.join(', ')}.`)
        });
      }

      return res.json({
        reply: await createPendingActionReply({
          context: agentMemoryContext,
          userRole,
          action: 'SEND_EMAIL',
          payload: emailDraft.payload,
          reply: 'I captured the email draft. Please confirm before I send it.',
          confirmationData: buildEmailConfirmationData(emailDraft.payload)
        })
      });
    }

    if (strongBookingVerb && hallMentioned) {
      const built = buildBookingRequestsFromMessage(message, halls, bookingContext);

      if (Array.isArray(built.requests) && built.requests.length > 0 && built.missing.length === 0) {
        if (userRole !== 'DEPARTMENT' && userRole !== 'ADMIN') {
          return res.json({
            reply: chatReply('To book a hall with AI, please log in as admin or faculty/department first.')
          });
        }

        const summaryReply = built.requests.length === 1
          ? `I understood your request for ${built.requests[0].hall}. Please confirm before I proceed.`
          : `I captured ${built.requests.length} hall booking requests. Please confirm before I proceed.`;

        return res.json({
          reply: await createPendingActionReply({
            context: agentMemoryContext,
            userRole,
            action: 'BOOK_REQUEST',
            payload: { requests: built.requests },
            reply: summaryReply,
            confirmationData: await buildBookingConfirmationData(built.requests, userRole, halls)
          })
        });
      }
    }

    if (isLikelyBookingIntent(lower, tokens)) {
      if (userRole !== 'DEPARTMENT' && userRole !== 'ADMIN') {
        return res.json({
          reply: chatReply('To book a hall with AI, please log in as admin or faculty/department first.')
        });
      }

      const built = buildBookingRequestsFromMessage(message, halls, bookingContext);
      if (Array.isArray(built.requests) && built.requests.length > 0 && built.missing.length === 0) {
        const summaryReply = built.requests.length === 1
          ? 'I captured the booking details. Please confirm before I proceed.'
          : `I captured ${built.requests.length} hall booking requests. Please confirm before I proceed.`;
        return res.json({
          reply: await createPendingActionReply({
            context: agentMemoryContext,
            userRole,
            action: 'BOOK_REQUEST',
            payload: { requests: built.requests },
            reply: summaryReply,
            confirmationData: await buildBookingConfirmationData(built.requests, userRole, halls)
          })
        });
      }
    }

    const followUpBookingIntent = inferFollowUpBookingRequests(
      message,
      lower,
      tokens,
      halls,
      effectiveHistory,
      bookingContext
    );
    if (followUpBookingIntent) {
      if (userRole !== 'DEPARTMENT' && userRole !== 'ADMIN') {
        return res.json({
          reply: chatReply('To book a hall with AI, please log in as admin or faculty/department first.')
        });
      }

      return res.json({
        reply: await createPendingActionReply({
          context: agentMemoryContext,
          userRole,
          action: 'BOOK_REQUEST',
          payload: { requests: followUpBookingIntent.requests },
          reply: `Added ${followUpBookingIntent.requests.length} more hall booking request(s) using your previous date/time context. Please confirm before I proceed.`,
          confirmationData: await buildBookingConfirmationData(followUpBookingIntent.requests, userRole, halls)
        })
      });
    }

    const bookingListIntent = inferBookingListIntent(message, lower, tokens, halls);
    if (bookingListIntent) {
      if (userRole !== 'ADMIN' && userRole !== 'DEPARTMENT') {
        return res.json({
          reply: chatReply('Viewing booking request conflict lists requires admin or faculty login.')
        });
      }

      return res.json({
        reply: actionReply(
          'LIST_BOOKING_REQUESTS',
          {
            filter: bookingListIntent.filter,
            date: bookingListIntent.date || null,
            dateFrom: bookingListIntent.dateFrom || null,
            dateTo: bookingListIntent.dateTo || null,
            targetHall: bookingListIntent.targetHall || null
          },
          'Listing pending booking requests now.'
        )
      });
    }

    const hallStatusIntent = inferHallStatusIntent(message, lower, tokens, halls, effectiveHistory);
    if (hallStatusIntent) {
      return res.json({
        reply: actionReply(
          'SHOW_HALL_STATUS',
          {
            mode: hallStatusIntent.mode || 'ALL',
            date: hallStatusIntent.date || null,
            dateFrom: hallStatusIntent.dateFrom || null,
            dateTo: hallStatusIntent.dateTo || null,
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
      const adminPreview = await buildAdminExecuteConfirmationData(payload);

      return res.json({
        reply: await createPendingActionReply({
          context: agentMemoryContext,
          userRole,
          action: 'ADMIN_EXECUTE',
          payload: adminPreview.nextPayload,
          reply: 'I reviewed the pending booking requests. Please confirm before I execute this admin action.',
          confirmationData: adminPreview.confirmationData
        })
      });
    }

    if (isLikelyHallStatusIntent(lower, tokens)) {
      return res.json({
        reply: actionReply('SHOW_HALL_STATUS', {}, 'Checking current hall status now.')
      });
    }

    const hasAttachments = Array.isArray(attachmentContext?.summaries) && attachmentContext.summaries.length > 0;

    if (hasAttachments) {
      try {
        const attachmentReply = await generateAttachmentAnalysisResponse({
          message,
          preferredLanguage,
          history: effectiveHistory,
          attachmentContext,
          projectContext,
          knowledgeContext
        });

        if (attachmentReply) {
          return res.json({ reply: chatReply(attachmentReply) });
        }
      } catch (attachmentErr) {
        console.error('Attachment analysis fallback error:', attachmentErr.message || attachmentErr);

        if (hasExtractableAttachmentText(attachmentContext)) {
          const attachmentTextPreview = String(attachmentContext.textBlock || '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 1400);
          return res.json({
            reply: chatReply(
              `I could not run full document analysis right now, but I extracted text from your file:\n\n${attachmentTextPreview}`
            )
          });
        }
      }
    }

    const conversationDomain = isLikelyProjectPrompt({
      message,
      lower,
      tokens,
      halls,
      history: effectiveHistory
    }) ? 'PROJECT' : 'GENERAL';

    if (conversationDomain === 'GENERAL') {
      const quickGeneral = getQuickGeneralReply(message);
      if (quickGeneral && !detailReq.needsDetailed && !detailReq.requestedWords && !detailReq.requestedLines) {
        return res.json({
          reply: chatReply(quickGeneral, 'neutral', { intentDomain: 'GENERAL' })
        });
      }

      try {
        const generalChat = await generateGeneralChatResponse({
          message,
          userRole,
          detailReq,
          preferredLanguage,
          history: effectiveHistory,
          projectContext,
          attachmentContext,
          knowledgeContext
        });
        if (generalChat) {
          return res.json({
            reply: chatReply(generalChat, 'neutral', { intentDomain: 'GENERAL' })
          });
        }
      } catch (generalErr) {
        console.error('General domain routing error:', generalErr.message || generalErr);
      }

      const offlineFallback = buildOfflineGeneralChatFallback({
        message,
        detailReq,
        preferredLanguage
      });
      if (offlineFallback) {
        return res.json({
          reply: chatReply(offlineFallback, 'neutral', {
            intentDomain: 'GENERAL',
            fallback: 'offline_general_knowledge'
          })
        });
      }
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
        history: effectiveHistory,
        projectContext,
        attachmentContext,
        knowledgeContext
      });

      const jsonNumPredict = detailReq.requestedWords
        ? Math.min(2400, Math.max(900, detailReq.requestedWords * 4))
        : (detailReq.needsDetailed ? 900 : 600);

      const result = await generateText({
        prompt,
        temperature: 0.2,
        maxTokens: jsonNumPredict,
        stop: ['User input:', 'Output JSON:', '<|end|>'],
        images: Array.isArray(attachmentContext?.images) ? attachmentContext.images : []
      });

      const rawText = String(result.text || '').trim();

      parsed = extractFirstJSON(rawText);
      if (!parsed) {
        const cleaned = cleanLLMText(rawText);
        parsed = {
          type: 'CHAT',
          message: cleaned || 'I could not parse that request.'
        };
      }

      parsed = normalizeModelReply(parsed);
    } catch (modelErr) {
      console.error('AI model error:', modelErr.message || modelErr);

      if (isLikelyBookingIntent(lower, tokens)) {
        if (userRole !== 'DEPARTMENT' && userRole !== 'ADMIN') {
          return res.json({
            reply: chatReply('To book a hall with AI, please log in as admin or faculty/department first.')
          });
        }

        const built = buildBookingRequestsFromMessage(message, halls, bookingContext);
        if (Array.isArray(built.requests) && built.requests.length > 0 && built.missing.length === 0) {
          return res.json({
            reply: actionReply(
              'BOOK_REQUEST',
              { requests: built.requests },
              built.requests.length === 1
                ? 'Sending your booking request to admin.'
                : `Sending your ${built.requests.length} booking requests to admin.`
            )
          });
        }

        return res.json({ reply: bookingMissingReply(built.missing) });
      }

      const quickFallback = getQuickGeneralReply(message);
      if (quickFallback) {
        return res.json({ reply: chatReply(quickFallback) });
      }

      const offlineFallback = buildOfflineGeneralChatFallback({
        message,
        detailReq,
        preferredLanguage
      });
      if (offlineFallback) {
        return res.json({
          reply: chatReply(offlineFallback, 'neutral', { fallback: 'offline_general_knowledge' })
        });
      }

      try {
        const plainChat = await generateGeneralChatResponse({
          message,
          userRole,
          detailReq,
          preferredLanguage,
          history: effectiveHistory,
          projectContext,
          attachmentContext,
          knowledgeContext
        });

        if (plainChat) {
          return res.json({ reply: chatReply(plainChat) });
        }
      } catch (plainErr) {
        console.error('General chat fallback error:', plainErr.message || plainErr);
      }

      return res.json({
        reply: chatReply('I could not reach the AI model right now. Please try again in a moment.')
      });
    }

    const type = String(parsed.type || 'CHAT').toUpperCase();

    if (type !== 'ACTION') {
      let messageText = cleanLLMText(parsed.message || parsed.reply || '').trim();
      let chatMeta = {};

      const asksForReasoning =
        /\b(analyze|analysis|reason|reasoning|plan|planner|compare|deep dive|investigate|step by step|explain why)\b/i.test(lower)
        || /(à¤µà¤¿à¤¶à¥à¤²à¥‡à¤·à¤£|à¤¸à¥à¤Ÿà¥‡à¤ª à¤¬à¤¾à¤¯ à¤¸à¥à¤Ÿà¥‡à¤ª|à¤•à¤¾à¤°à¤£|à¤¸à¤®à¤à¤¾à¤“)/.test(message);
      const shouldUseAgentGraph =
        detailReq.needsDetailed
        || detailReq.requestedWords
        || asksForReasoning
        || !messageText;

      if (shouldUseAgentGraph) {
        try {
          const workflow = await runSupportWorkflow({
            message,
            userRole,
            preferredLanguage,
            history: effectiveHistory,
            projectContext,
            memoryContext: agentMemoryContext?.block || '',
            ownerKey: agentMemoryContext?.ownerKey || '',
            threadId: agentMemoryContext?.threadId || ''
          });

          if (workflow?.answer) {
            messageText = workflow.answer;
          }
          if (workflow?.meta) {
            if (workflow.meta.actionIntent && !workflow.meta.reviewTask) {
              const workflowActionMeta = {
                agentWorkflow: workflow.meta
              };
              if (Array.isArray(workflow.meta.toolCalls)) {
                workflowActionMeta.plannedTools = workflow.meta.toolCalls.map((item) => item.name).filter(Boolean);
              }

              return res.json({
                reply: actionReply(
                  workflow.meta.actionIntent.action,
                  workflow.meta.actionIntent.payload || {},
                  workflow.meta.actionIntent.reply || workflow.answer || 'Prepared action for execution.',
                  workflowActionMeta
                )
              });
            }

            chatMeta = {
              ...chatMeta,
              agentWorkflow: workflow.meta,
              agentGraph: workflow.meta
            };
          }
        } catch (graphErr) {
          console.error('Agent graph fallback error:', graphErr.message || graphErr);
        }
      }

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
              history: effectiveHistory,
              projectContext,
              knowledgeContext
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
            history: effectiveHistory,
            projectContext,
            attachmentContext,
            knowledgeContext
          });
          if (plainChat) messageText = plainChat;
        } catch (plainErr) {
          console.error('General chat completion fallback error:', plainErr.message || plainErr);
        }
      }

      if (!messageText) {
        messageText = buildOfflineGeneralChatFallback({
          message,
          detailReq,
          preferredLanguage
        });
        if (messageText) {
          chatMeta = { ...chatMeta, fallback: 'offline_general_knowledge' };
        }
      }

      const recoveredActionIntent = extractActionIntentFromText(messageText);
      if (recoveredActionIntent) {
        return res.json({
          reply: actionReply(
            recoveredActionIntent.action,
            recoveredActionIntent.payload || {},
            recoveredActionIntent.reply || 'Processing your request now.'
          )
        });
      }

      if (looksLikeActionJsonLeak(messageText)) {
        messageText = 'I understood your request. Please confirm and I will execute it.';
      }

      return res.json({
        reply: chatReply(messageText || 'I can help with normal conversation, booking requests, hall availability, admin actions, and schedule exports. Please share the exact thing you want to do.', 'neutral', chatMeta)
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
          if (userRole !== 'ADMIN' && userRole !== 'DEPARTMENT') {
            return res.json({
              reply: chatReply('Viewing booking request conflict lists requires admin or faculty login.')
            });
          }

          return res.json({
            reply: actionReply(
              'LIST_BOOKING_REQUESTS',
              {
                filter: bookingListIntent.filter,
                date: bookingListIntent.date || null,
                dateFrom: bookingListIntent.dateFrom || null,
                dateTo: bookingListIntent.dateTo || null,
                targetHall: bookingListIntent.targetHall || null
              },
              'Listing pending booking requests now.'
            )
          });
        }

        const hallStatusIntent = inferHallStatusIntent(message, lower, tokens, halls, effectiveHistory);
        if (hallStatusIntent) {
          return res.json({
            reply: actionReply(
              'SHOW_HALL_STATUS',
              {
                mode: hallStatusIntent.mode || 'ALL',
                date: hallStatusIntent.date || null,
                dateFrom: hallStatusIntent.dateFrom || null,
                dateTo: hallStatusIntent.dateTo || null,
                targetHall: hallStatusIntent.targetHall || null
              },
              'Checking hall availability now.'
            )
          });
        }
      }
    }

    if (action === 'BOOK_REQUEST') {
      if (userRole !== 'DEPARTMENT' && userRole !== 'ADMIN') {
        return res.json({
          reply: chatReply('To book a hall with AI, please log in as admin or faculty/department first.')
        });
      }

      const ensured = ensureBookingPayload(payload, message, halls, effectiveHistory);
      if (ensured.requests.length === 0 || ensured.missing.length > 0) {
        return res.json({ reply: bookingMissingReply(ensured.missing) });
      }

      return res.json({
        reply: await createPendingActionReply({
          context: agentMemoryContext,
          userRole,
          action: 'BOOK_REQUEST',
          payload: { requests: ensured.requests },
          reply: reply || (ensured.requests.length === 1
            ? `I understood your request for ${ensured.requests[0]?.hall || 'the hall'}. Please confirm before I proceed.`
            : `I captured ${ensured.requests.length} hall booking requests. Please confirm before I proceed.`),
          confirmationData: await buildBookingConfirmationData(ensured.requests, userRole, halls)
        })
      });
    }

    if (action === 'CREATE_PUBLIC_TASK') {
      if (userRole !== 'DEPARTMENT' && userRole !== 'ADMIN') {
        return res.json({
          reply: chatReply('Creating public calendar tasks via AI requires admin or faculty login.')
        });
      }

      const taskPayload = {
        title: String(payload.title || payload.event || '').trim().slice(0, 240),
        description: String(payload.description || '').trim().slice(0, 4000),
        allDay: Boolean(payload.allDay),
        startDateTime: payload.startDateTime || null,
        endDateTime: payload.endDateTime || null
      };

      if (!taskPayload.title || !taskPayload.startDateTime || !taskPayload.endDateTime) {
        return res.json({
          reply: chatReply('I can create that public calendar task. Please share the task title, from date/time, and to date/time.')
        });
      }

      return res.json({
        reply: await createPendingActionReply({
          context: agentMemoryContext,
          userRole,
          action: 'CREATE_PUBLIC_TASK',
          payload: taskPayload,
          reply: reply || 'I captured the public calendar task. Please confirm before I create it.',
          confirmationData: buildCalendarTaskConfirmationData(taskPayload)
        })
      });
    }

    if (action === 'CREATE_NOTICE') {
      if (userRole !== 'ADMIN') {
        return res.json({
          reply: chatReply('Posting notices via AI requires admin login.')
        });
      }

      const noticePayload = {
        title: String(payload.title || payload.subject || '').trim().slice(0, 240),
        content: String(payload.content || payload.body || payload.summary || '').trim().slice(0, 8000),
        kind: String(payload.kind || 'GENERAL').trim().toUpperCase() || 'GENERAL',
        startDateTime: payload.startDateTime || null,
        endDateTime: payload.endDateTime || null,
        closureAllHalls: Boolean(payload.closureAllHalls),
        rooms: Array.isArray(payload.rooms) ? payload.rooms : []
      };

      if (!noticePayload.title || !noticePayload.content || !noticePayload.startDateTime || !noticePayload.endDateTime) {
        return res.json({
          reply: chatReply('I can post that notice. Please share the heading, content, from date/time, and to date/time.')
        });
      }

      return res.json({
        reply: await createPendingActionReply({
          context: agentMemoryContext,
          userRole,
          action: 'CREATE_NOTICE',
          payload: noticePayload,
          reply: reply || 'I captured the notice details. Please confirm before I post it.',
          confirmationData: buildNoticeConfirmationData(noticePayload)
        })
      });
    }

    if (action === 'GET_NOTICE') {
      const query = String(payload.query || message || '').trim().slice(0, 240);
      if (!query) {
        return res.json({
          reply: chatReply('Please tell me which notice you want to open or download.')
        });
      }

      return res.json({
        reply: actionReply(
          'GET_NOTICE',
          { query },
          reply || 'Looking up the matching notice now.'
        )
      });
    }

    if (action === 'SEND_EMAIL') {
      if (userRole !== 'DEPARTMENT' && userRole !== 'ADMIN') {
        return res.json({
          reply: chatReply('Sending email via AI requires admin or faculty login.')
        });
      }

      const emailPayload = {
        to: String(payload.to || payload.email || '').trim(),
        subject: String(payload.subject || 'BIT Booking AI Message').trim().slice(0, 200),
        content: String(payload.content || payload.body || payload.text || '').trim().slice(0, 5000)
      };

      if (!emailPayload.to || !emailPayload.content) {
        return res.json({
          reply: chatReply('I can send that email. Please share the recipient email address and the exact email content.')
        });
      }

      return res.json({
        reply: await createPendingActionReply({
          context: agentMemoryContext,
          userRole,
          action: 'SEND_EMAIL',
          payload: emailPayload,
          reply: reply || 'I captured the email draft. Please confirm before I send it.',
          confirmationData: buildEmailConfirmationData(emailPayload)
        })
      });
    }

    if (action === 'VACATE_HALL') {
      if (userRole !== 'ADMIN') {
        return res.json({
          reply: chatReply('Vacating a booked hall requires admin access. Please log in as admin first.')
        });
      }

      const targetHall = fixHallName(payload.targetHall || detectHallFromMessage(message, halls), halls);
      const date = normalizeDateInput(payload.date || extractDateFromMessage(message));
      if (!targetHall) {
        return res.json({ reply: vacateMissingReply() });
      }

      return res.json({
        reply: actionReply(
          'VACATE_HALL',
          {
            targetHall,
            date: date || null
          },
          date
            ? `Checking ${targetHall} on ${date} and vacating matching booking(s).`
            : `Checking current bookings in ${targetHall} and vacating matching booking(s).`
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
      if (Array.isArray(payload.requestIds) && payload.requestIds.length > 0) {
        normalizedPayload.requestIds = payload.requestIds.map((id) => String(id || '').trim()).filter(Boolean);
      }
      const adminPreview = await buildAdminExecuteConfirmationData(normalizedPayload);

      return res.json({
        reply: await createPendingActionReply({
          context: agentMemoryContext,
          userRole,
          action: 'ADMIN_EXECUTE',
          payload: adminPreview.nextPayload,
          reply: reply || 'I reviewed the pending booking requests. Please confirm before I execute this admin action.',
          confirmationData: adminPreview.confirmationData
        })
      });
    }

    if (action === 'LIST_BOOKING_REQUESTS') {
      if (userRole !== 'ADMIN' && userRole !== 'DEPARTMENT') {
        return res.json({
          reply: chatReply('Viewing booking request conflict lists requires admin or faculty login.')
        });
      }

      const normalizedFilter = normalizeConflictFilter(payload.filter, lower, tokens);
      const targetHall = fixHallName(payload.targetHall || detectHallFromMessage(message, halls), halls);
      const dateWindow = normalizeDateWindowPayload(payload, message);

      const normalizedPayload = {
        filter: normalizedFilter,
        date: dateWindow.date || null,
        dateFrom: dateWindow.dateFrom || null,
        dateTo: dateWindow.dateTo || null,
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
      const dateWindow = normalizeDateWindowPayload(payload, message);

      return res.json({
        reply: actionReply(
          'SHOW_HALL_STATUS',
          {
            mode: normalizedMode,
            date: dateWindow.date || null,
            dateFrom: dateWindow.dateFrom || null,
            dateTo: dateWindow.dateTo || null,
            targetHall: targetHall || null
          },
          reply || 'Checking hall availability now.'
        )
      });
    }

    if (action === 'EXPORT_SCHEDULE') {
      const normalizedDate = normalizeDateInput(payload.date || extractDateFromMessage(message));
      const rawFormat = String(payload.format || '').toUpperCase().trim();
      const format = ['PDF', 'IMAGE', 'CSV', 'TABLE'].includes(rawFormat) ? rawFormat : 'PDF';

      return res.json({
        reply: actionReply(
          'EXPORT_SCHEDULE',
          {
            date: normalizedDate || null,
            format
          },
          'Preparing your schedule export now.'
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
        history: effectiveHistory,
        projectContext,
        attachmentContext,
        knowledgeContext
      });
      if (plainChat) {
        return res.json({ reply: chatReply(plainChat) });
      }
    } catch (plainErr) {
      console.error('General chat unknown-action fallback error:', plainErr.message || plainErr);
    }

    const offlineFallback = buildOfflineGeneralChatFallback({
      message,
      detailReq,
      preferredLanguage
    });
    if (offlineFallback) {
      return res.json({
        reply: chatReply(offlineFallback, 'neutral', { fallback: 'offline_general_knowledge' })
      });
    }

    return res.json({
      reply: chatReply('I understood the message but could not map it to a supported action.')
    });
  } catch (err) {
    hadAiError = true;
    console.error('AI route error:', err);
    return res.status(500).json({ error: 'AI service failed' });
  } finally {
    finalizeAi({ error: hadAiError });
  }
});

module.exports = router;

