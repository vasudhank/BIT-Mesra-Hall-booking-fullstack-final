const chrono = require('chrono-node');
const mongoose = require('mongoose');
const { tool } = require('@langchain/core/tools');
const { convertToOpenAITool } = require('@langchain/core/utils/function_calling');
const zod = require('zod');
const Hall = require('../models/hall');
const BookingRequests = require('../models/booking_requests');
const { getKnowledgeContextForPrompt } = require('./supportKnowledgeService');
const { getAgentMemoryContext } = require('./agentMemoryService');
const { observeAgentToolCall } = require('./metricsService');

const { z } = zod;
const toJsonSchema = typeof zod.toJSONSchema === 'function' ? zod.toJSONSchema : () => ({
  type: 'object',
  additionalProperties: true
});

const isMongoReady = () => Number(mongoose?.connection?.readyState || 0) === 1;

const clip = (text, limit = 600) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit);

const formatDateYYYYMMDD = (dateObj) => {
  const yyyy = dateObj.getFullYear();
  const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
  const dd = String(dateObj.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const getTodayISTDate = () => {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  return formatDateYYYYMMDD(now);
};

const parseDateValue = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;

  const parsed = chrono.parseDate(raw, new Date(), { forwardDate: true });
  if (!parsed || Number.isNaN(parsed.getTime())) return null;
  return formatDateYYYYMMDD(parsed);
};

const parseDateRange = (dateText) => {
  const normalizedDate = parseDateValue(dateText);
  if (!normalizedDate) return null;

  const start = new Date(`${normalizedDate}T00:00:00.000`);
  const end = new Date(`${normalizedDate}T23:59:59.999`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  return { date: normalizedDate, dateFrom: null, dateTo: null, start, end };
};

const parseDateWindow = ({ date = '', dateFrom = '', dateTo = '' } = {}) => {
  const single = parseDateRange(date);
  if (single) return single;

  const startRange = parseDateRange(dateFrom);
  const endRange = parseDateRange(dateTo);
  if (!startRange && !endRange) return null;

  const start = startRange ? startRange.start : endRange.start;
  const end = endRange ? endRange.end : startRange.end;
  if (!(start instanceof Date) || Number.isNaN(start.getTime()) || !(end instanceof Date) || Number.isNaN(end.getTime())) {
    return null;
  }

  const normalizedStart = start.getTime() <= end.getTime() ? start : end;
  const normalizedEnd = start.getTime() <= end.getTime() ? end : start;
  const startKey = formatDateYYYYMMDD(normalizedStart);
  const endKey = formatDateYYYYMMDD(normalizedEnd);

  if (startKey === endKey) {
    return parseDateRange(startKey);
  }

  return {
    date: null,
    dateFrom: startKey,
    dateTo: endKey,
    start: normalizedStart,
    end: normalizedEnd
  };
};

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

  return null;
};

const to24HourTime = (inputTime) => {
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

    if (suffix === 'PM' && hour < 12) hour += 12;
    if (suffix === 'AM' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  const twentyFourHr = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!twentyFourHr) return null;
  return `${String(Number(twentyFourHr[1])).padStart(2, '0')}:${twentyFourHr[2]}`;
};

const overlaps = (startA, endA, startB, endB) =>
  new Date(startA).getTime() < new Date(endB).getTime()
  && new Date(endA).getTime() > new Date(startB).getTime();

const formatTimeRange = (startDateTime, endDateTime) => {
  const formatOne = (value) =>
    new Date(value).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  return `${formatOne(startDateTime)} - ${formatOne(endDateTime)}`;
};

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findHallByNameLoose = async (name) => {
  if (!isMongoReady()) return null;
  const cleanName = String(name || '').trim();
  if (!cleanName) return null;

  return Hall.findOne({ name: cleanName })
    .then((hall) => hall || Hall.findOne({ name: new RegExp(`^${escapeRegex(cleanName)}$`, 'i') }));
};

const normalizeHallStatusMode = (modeLike) => {
  const raw = String(modeLike || '').trim().toUpperCase();
  if (['ALL', 'AVAILABLE', 'FILLED'].includes(raw)) return raw;
  if (raw.includes('FREE') || raw.includes('VACANT') || raw.includes('AVAILABLE')) return 'AVAILABLE';
  if (raw.includes('BOOKED') || raw.includes('OCCUPIED') || raw.includes('FILLED')) return 'FILLED';
  return 'ALL';
};

const normalizeConflictFilter = (filterLike) => {
  const raw = String(filterLike || '').trim().toUpperCase();
  if (['ALL', 'CONFLICTING', 'NON_CONFLICTING'].includes(raw)) return raw;
  if (raw.includes('NON') || raw.includes('SAFE')) return 'NON_CONFLICTING';
  if (raw.includes('CONFLICT')) return 'CONFLICTING';
  return 'ALL';
};

const analyzeRequestConflict = async (requestDoc, allPending) => {
  if (!isMongoReady()) return 'SAFE';
  const approvedConflict = await Hall.findOne({
    name: requestDoc.hall,
    bookings: {
      $elemMatch: {
        startDateTime: { $lt: requestDoc.endDateTime },
        endDateTime: { $gt: requestDoc.startDateTime }
      }
    }
  });

  if (approvedConflict) return 'TIME_CONFLICT';

  const startA = new Date(requestDoc.startDateTime).getTime();
  const endA = new Date(requestDoc.endDateTime).getTime();
  for (const other of allPending) {
    if (!other || !other._id || requestDoc._id.equals(other._id)) continue;
    if (String(other.status || '').toUpperCase() !== 'PENDING') continue;
    if (String(other.hall || '').toLowerCase() !== String(requestDoc.hall || '').toLowerCase()) continue;

    const startB = new Date(other.startDateTime).getTime();
    const endB = new Date(other.endDateTime).getTime();
    if (startA < endB && endA > startB) return 'TIME_CONFLICT';
  }

  return 'SAFE';
};

const buildScheduleRows = async (dateRange) => {
  if (!isMongoReady() || !dateRange) return [];

  const halls = await Hall.find().populate({ path: 'bookings.department', select: 'head department email' });
  const rows = [];

  for (const hall of halls) {
    const relevantBookings = (hall.bookings || [])
      .filter((booking) => overlaps(booking.startDateTime, booking.endDateTime, dateRange.start, dateRange.end))
      .sort((a, b) => new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime());

    if (relevantBookings.length === 0) {
      rows.push({
        hall: hall.name,
        status: 'AVAILABLE',
        event: 'None',
        department: 'N/A',
        timeRange: '-'
      });
      continue;
    }

    relevantBookings.forEach((booking) => {
      rows.push({
        hall: hall.name,
        status: 'FILLED',
        event: booking.event || 'Booked',
        department: booking.department?.head || booking.department?.department || 'N/A',
        timeRange: formatTimeRange(booking.startDateTime, booking.endDateTime)
      });
    });
  }

  return rows;
};

const listHallStatusData = async ({ targetHall = '', mode = 'ALL', date = '', dateFrom = '', dateTo = '' } = {}) => {
  const dateRange = parseDateWindow({ date, dateFrom, dateTo }) || parseDateRange(getTodayISTDate());

  if (!isMongoReady()) {
    return {
      kind: 'HALL_STATUS',
      mode: normalizeHallStatusMode(mode),
      targetHall: targetHall || null,
      date: dateRange ? dateRange.date : null,
      dateFrom: dateRange ? dateRange.dateFrom || null : null,
      dateTo: dateRange ? dateRange.dateTo || null : null,
      items: []
    };
  }

  const normalizedMode = normalizeHallStatusMode(mode);
  const halls = targetHall
    ? await Hall.find({ name: new RegExp(`^${escapeRegex(targetHall)}$`, 'i') })
    : await Hall.find();

  const items = halls.map((hall) => {
    const dayBookings = (hall.bookings || []).filter((booking) =>
      overlaps(booking.startDateTime, booking.endDateTime, dateRange.start, dateRange.end)
    );

    return {
      hall: hall.name,
      status: dayBookings.length > 0 ? 'FILLED' : 'AVAILABLE',
      currentEvent: dayBookings.length <= 1
        ? (dayBookings[0]?.event || 'None')
        : `${dayBookings.length} bookings in selected range`
    };
  });

  const filteredItems = normalizedMode === 'AVAILABLE'
    ? items.filter((item) => item.status === 'AVAILABLE')
    : normalizedMode === 'FILLED'
      ? items.filter((item) => item.status === 'FILLED')
      : items;

  return {
    kind: 'HALL_STATUS',
    mode: normalizedMode,
    targetHall: targetHall || null,
    date: dateRange ? dateRange.date : null,
    dateFrom: dateRange ? dateRange.dateFrom || null : null,
    dateTo: dateRange ? dateRange.dateTo || null : null,
    items: filteredItems
  };
};

const listPendingBookingRequestsData = async ({ filter = 'ALL', targetHall = '', date = '', dateFrom = '', dateTo = '' } = {}) => {
  const normalizedFilter = normalizeConflictFilter(filter);
  const dateRange = parseDateWindow({ date, dateFrom, dateTo });

  if (!isMongoReady()) {
    return {
      kind: 'BOOKING_REQUESTS',
      filter: normalizedFilter,
      targetHall: targetHall || null,
      date: dateRange ? dateRange.date : null,
      dateFrom: dateRange ? dateRange.dateFrom || null : null,
      dateTo: dateRange ? dateRange.dateTo || null : null,
      summary: { total: 0, conflicting: 0, nonConflicting: 0 },
      items: []
    };
  }

  const pendingRequests = await BookingRequests.find({ status: 'PENDING' })
    .populate('department')
    .sort({ startDateTime: 1, createdAt: 1 });

  let scoped = targetHall
    ? pendingRequests.filter((requestDoc) => String(requestDoc.hall || '').toLowerCase() === String(targetHall).toLowerCase())
    : pendingRequests;

  if (dateRange) {
    scoped = scoped.filter((requestDoc) =>
      overlaps(requestDoc.startDateTime, requestDoc.endDateTime, dateRange.start, dateRange.end)
    );
  }

  const items = [];
  for (const requestDoc of scoped) {
    const conflictStatus = await analyzeRequestConflict(requestDoc, pendingRequests);
    const conflict = conflictStatus === 'TIME_CONFLICT' ? 'CONFLICTING' : 'NON_CONFLICTING';
    items.push({
      id: String(requestDoc._id),
      hall: requestDoc.hall,
      event: requestDoc.event,
      date: requestDoc.startDate || (new Date(requestDoc.startDateTime).toISOString().slice(0, 10)),
      start: requestDoc.startTime12 || to12HourTime(new Date(requestDoc.startDateTime).toTimeString().slice(0, 5)),
      end: requestDoc.endTime12 || to12HourTime(new Date(requestDoc.endDateTime).toTimeString().slice(0, 5)),
      requestedBy: requestDoc.department?.head || requestDoc.department?.department || 'Unknown',
      requestedEmail: requestDoc.department?.email || 'N/A',
      requestedPhone: requestDoc.department?.phone || '',
      department: requestDoc.department?.department || '',
      conflict
    });
  }

  const summary = {
    total: items.length,
    conflicting: items.filter((item) => item.conflict === 'CONFLICTING').length,
    nonConflicting: items.filter((item) => item.conflict === 'NON_CONFLICTING').length
  };

  const filteredItems = normalizedFilter === 'CONFLICTING'
    ? items.filter((item) => item.conflict === 'CONFLICTING')
    : normalizedFilter === 'NON_CONFLICTING'
      ? items.filter((item) => item.conflict === 'NON_CONFLICTING')
      : items;

  return {
    kind: 'BOOKING_REQUESTS',
    filter: normalizedFilter,
    targetHall: targetHall || null,
    date: dateRange ? dateRange.date : null,
    dateFrom: dateRange ? dateRange.dateFrom || null : null,
    dateTo: dateRange ? dateRange.dateTo || null : null,
    summary,
    items: filteredItems
  };
};

const roleIsTrusted = (roleLike) => ['ADMIN', 'DEVELOPER'].includes(String(roleLike || '').toUpperCase());
const roleCanBook = (roleLike) => ['ADMIN', 'DEPARTMENT'].includes(String(roleLike || '').toUpperCase());

const resolveToolResult = ({
  kind = 'lookup',
  status = 'ok',
  title = '',
  summary = '',
  data = {},
  actionIntent = null,
  reviewRequired = false,
  riskLevel = 'LOW',
  missing = []
} = {}) => ({
  kind,
  status,
  title,
  summary,
  data,
  actionIntent,
  reviewRequired: Boolean(reviewRequired),
  riskLevel: String(riskLevel || 'LOW').toUpperCase(),
  missing: Array.isArray(missing) ? missing.filter(Boolean) : []
});

const buildBookingActionIntent = (normalized) => ({
  type: 'ACTION',
  action: 'BOOK_REQUEST',
  payload: {
    requests: [{
      hall: normalized.hall,
      date: normalized.date,
      start: normalized.start,
      end: normalized.end,
      event: normalized.event,
      description: normalized.description
    }]
  },
  reply: `Prepared booking request for ${normalized.hall} on ${normalized.date}.`
});

const buildVacateActionIntent = (normalized) => ({
  type: 'ACTION',
  action: 'VACATE_HALL',
  payload: {
    targetHall: normalized.targetHall,
    date: normalized.date || null
  },
  reply: normalized.date
    ? `Prepared hall vacate action for ${normalized.targetHall} on ${normalized.date}.`
    : `Prepared hall vacate action for ${normalized.targetHall}.`
});

const buildAdminActionIntent = (normalized) => ({
  type: 'ACTION',
  action: 'ADMIN_EXECUTE',
  payload: {
    subAction: normalized.subAction,
    requestIds: normalized.targetRequestIds,
    targetHall: normalized.targetHall || null,
    date: normalized.date || null
  },
  reply: `Prepared admin action ${normalized.subAction}.`
});

const buildSlackActionIntent = (normalized) => ({
  type: 'ACTION',
  action: 'SEND_SLACK_MESSAGE',
  payload: normalized,
  reply: 'Prepared Slack notification for human approval.'
});

const buildWhatsAppActionIntent = (normalized) => ({
  type: 'ACTION',
  action: 'SEND_WHATSAPP_MESSAGE',
  payload: normalized,
  reply: 'Prepared WhatsApp message for human approval.'
});

const buildCrmActionIntent = (normalized) => ({
  type: 'ACTION',
  action: 'SYNC_CRM_RECORD',
  payload: normalized,
  reply: 'Prepared CRM sync action for human approval.'
});

const createCatalogEntry = ({ name, description, schema, handler, risk = 'LOW', humanReview = false }) => {
  const langChainTool = tool(
    async (input) => ({
      acknowledged: true,
      input
    }),
    { name, description, schema }
  );

  return {
    name,
    description,
    schema,
    handler,
    risk,
    humanReview,
    langChainTool,
    openAiTool: convertToOpenAITool(langChainTool),
    anthropicTool: {
      name,
      description,
      input_schema: toJsonSchema(schema)
    }
  };
};

const toolCatalog = [
  createCatalogEntry({
    name: 'knowledge_search',
    description: 'Retrieve FAQ, notice, and vector knowledge relevant to the user question.',
    schema: z.object({
      query: z.string().min(2).describe('The question or search phrase to retrieve knowledge for.')
    }),
    handler: async ({ query }) => {
      const knowledge = await getKnowledgeContextForPrompt({
        query,
        maxFaq: 4,
        maxNotices: 3,
        maxVector: 3
      });
      return resolveToolResult({
        kind: 'lookup',
        title: 'Knowledge retrieval',
        summary: clip(knowledge?.block || 'No knowledge snippets found.', 320),
        data: knowledge || {}
      });
    }
  }),
  createCatalogEntry({
    name: 'memory_lookup',
    description: 'Retrieve persistent conversation memory and long-term context for the current user and thread.',
    schema: z.object({
      query: z.string().min(2).describe('The memory query to search the persistent conversation store.')
    }),
    handler: async ({ query }, context) => {
      const memory = await getAgentMemoryContext({
        message: query,
        history: context.history || [],
        userRole: context.userRole || 'GUEST',
        threadId: context.threadId || '',
        accountKey: context.ownerKey || '',
        channel: 'agent_tool_memory_lookup'
      });

      return resolveToolResult({
        kind: 'lookup',
        title: 'Persistent memory',
        summary: clip(memory?.block || 'No memory available.', 320),
        data: {
          ownerKey: memory?.ownerKey || context.ownerKey || '',
          threadId: memory?.threadId || context.threadId || '',
          block: memory?.block || ''
        }
      });
    }
  }),
  createCatalogEntry({
    name: 'hall_status_lookup',
    description: 'Look up hall availability for now or for a specific date.',
    schema: z.object({
      targetHall: z.string().optional().describe('Optional exact hall name when the user asks about one hall.'),
      mode: z.enum(['ALL', 'AVAILABLE', 'FILLED']).optional().describe('Optional filter for available or filled halls.'),
      date: z.string().optional().describe('Optional single date in YYYY-MM-DD or natural language.'),
      dateFrom: z.string().optional().describe('Optional range start date in YYYY-MM-DD or natural language.'),
      dateTo: z.string().optional().describe('Optional range end date in YYYY-MM-DD or natural language.')
    }),
    handler: async ({ targetHall, mode, date, dateFrom, dateTo }) => {
      const data = await listHallStatusData({ targetHall, mode, date, dateFrom, dateTo });
      return resolveToolResult({
        kind: 'lookup',
        title: 'Hall status lookup',
        summary: `${data.items.length} hall record(s) matched the availability query.`,
        data
      });
    }
  }),
  createCatalogEntry({
    name: 'pending_request_lookup',
    description: 'List pending booking requests and identify conflicts for admin review.',
    schema: z.object({
      filter: z.enum(['ALL', 'CONFLICTING', 'NON_CONFLICTING']).optional().describe('Filter for all, conflicting, or non-conflicting requests.'),
      targetHall: z.string().optional().describe('Optional hall name to scope the list.'),
      date: z.string().optional().describe('Optional single date in YYYY-MM-DD or natural language.'),
      dateFrom: z.string().optional().describe('Optional range start date in YYYY-MM-DD or natural language.'),
      dateTo: z.string().optional().describe('Optional range end date in YYYY-MM-DD or natural language.')
    }),
    handler: async ({ filter, targetHall, date, dateFrom, dateTo }, context) => {
      if (String(context.userRole || '').toUpperCase() !== 'ADMIN') {
        return resolveToolResult({
          kind: 'policy',
          status: 'denied',
          title: 'Pending requests',
          summary: 'Only admin users can inspect pending booking-request conflicts.'
        });
      }

      const data = await listPendingBookingRequestsData({ filter, targetHall, date, dateFrom, dateTo });
      return resolveToolResult({
        kind: 'lookup',
        title: 'Pending booking requests',
        summary: `${data.summary.total} pending request(s); ${data.summary.conflicting} conflicting and ${data.summary.nonConflicting} non-conflicting.`,
        data
      });
    }
  }),
  createCatalogEntry({
    name: 'schedule_export_preview',
    description: 'Preview the schedule export rows before generating a final export artifact.',
    schema: z.object({
      date: z.string().optional().describe('Date for schedule export in YYYY-MM-DD or natural language.'),
      format: z.enum(['PDF', 'IMAGE', 'CSV', 'TABLE']).optional().describe('Preferred export format.')
    }),
    handler: async ({ date, format }) => {
      const dateRange = parseDateRange(date || getTodayISTDate());
      const rows = await buildScheduleRows(dateRange);
      return resolveToolResult({
        kind: 'lookup',
        title: 'Schedule export preview',
        summary: `Prepared ${rows.length} schedule row(s) for ${dateRange?.date || getTodayISTDate()} in ${String(format || 'PDF').toUpperCase()} mode.`,
        data: {
          kind: 'SCHEDULE_EXPORT_PREVIEW',
          date: dateRange?.date || getTodayISTDate(),
          formatRequested: String(format || 'PDF').toUpperCase(),
          rows
        }
      });
    }
  }),
  createCatalogEntry({
    name: 'prepare_booking_request',
    description: 'Prepare a booking request action from the user request with normalized date and time fields.',
    schema: z.object({
      hall: z.string().optional().describe('Target hall name.'),
      date: z.string().optional().describe('Booking date in YYYY-MM-DD or natural language.'),
      start: z.string().optional().describe('Start time such as 1:00 PM or 13:00.'),
      end: z.string().optional().describe('End time such as 2:00 PM or 14:00.'),
      event: z.string().optional().describe('Short event title.'),
      description: z.string().optional().describe('Optional event description.')
    }),
    handler: async ({ hall, date, start, end, event, description }, context) => {
      if (!roleCanBook(context.userRole)) {
        return resolveToolResult({
          kind: 'policy',
          status: 'denied',
          title: 'Booking request',
          summary: 'Only admin or department accounts can create booking requests.'
        });
      }

      const matchedHall = await findHallByNameLoose(hall);
      const normalized = {
        hall: matchedHall?.name || String(hall || '').trim(),
        date: parseDateValue(date),
        start: to12HourTime(start),
        end: to12HourTime(end),
        event: clip(event || 'AI Booking', 140),
        description: clip(description || 'Prepared by agentic AI workflow.', 280)
      };

      const missing = [];
      if (!normalized.hall) missing.push('hall');
      if (!normalized.date) missing.push('date');
      if (!normalized.start) missing.push('start');
      if (!normalized.end) missing.push('end');
      if (!normalized.event) missing.push('event');

      if (missing.length > 0) {
        return resolveToolResult({
          kind: 'action_intent',
          status: 'missing_fields',
          title: 'Booking request',
          summary: `Need ${missing.join(', ')} before a booking request can be prepared.`,
          missing
        });
      }

      const actionIntent = buildBookingActionIntent(normalized);
      return resolveToolResult({
        kind: 'action_intent',
        title: 'Booking request prepared',
        summary: `Prepared booking request for ${normalized.hall} on ${normalized.date} from ${normalized.start} to ${normalized.end}.`,
        actionIntent,
        reviewRequired: false,
        riskLevel: 'MEDIUM',
        data: { normalized }
      });
    }
  }),
  createCatalogEntry({
    name: 'prepare_vacate_hall',
    description: 'Prepare a hall vacate action for admin approval.',
    schema: z.object({
      targetHall: z.string().optional().describe('Hall name to vacate.'),
      date: z.string().optional().describe('Optional date in YYYY-MM-DD or natural language.'),
      reason: z.string().optional().describe('Short reason for the vacate action.')
    }),
    handler: async ({ targetHall, date, reason }, context) => {
      if (String(context.userRole || '').toUpperCase() !== 'ADMIN') {
        return resolveToolResult({
          kind: 'policy',
          status: 'denied',
          title: 'Vacate hall',
          summary: 'Only admin users can vacate halls.'
        });
      }

      const matchedHall = await findHallByNameLoose(targetHall);
      const normalized = {
        targetHall: matchedHall?.name || String(targetHall || '').trim(),
        date: parseDateValue(date),
        reason: clip(reason || 'Prepared by agentic AI workflow.', 220)
      };

      const missing = [];
      if (!normalized.targetHall) missing.push('targetHall');

      if (missing.length > 0) {
        return resolveToolResult({
          kind: 'action_intent',
          status: 'missing_fields',
          title: 'Vacate hall',
          summary: 'Need the hall name before a vacate action can be prepared.',
          missing
        });
      }

      const actionIntent = buildVacateActionIntent(normalized);
      return resolveToolResult({
        kind: 'action_intent',
        title: 'Vacate hall prepared',
        summary: normalized.date
          ? `Prepared vacate action for ${normalized.targetHall} on ${normalized.date}.`
          : `Prepared vacate action for ${normalized.targetHall}.`,
        actionIntent,
        reviewRequired: true,
        riskLevel: 'HIGH',
        data: { normalized }
      });
    }
  }),
  createCatalogEntry({
    name: 'prepare_admin_decision',
    description: 'Prepare an admin approval or rejection action for booking requests.',
    schema: z.object({
      subAction: z.enum([
        'APPROVE_SAFE',
        'APPROVE_ALL',
        'APPROVE_SPECIFIC',
        'REJECT_CONFLICTS',
        'REJECT_ALL',
        'REJECT_SPECIFIC'
      ]).optional().describe('The admin action to prepare.'),
      targetRequestIds: z.array(z.string()).optional().describe('Optional request IDs for specific approve/reject operations.'),
      targetHall: z.string().optional().describe('Optional hall filter.'),
      date: z.string().optional().describe('Optional date scope in YYYY-MM-DD or natural language.')
    }),
    handler: async ({ subAction, targetRequestIds, targetHall, date }, context) => {
      if (String(context.userRole || '').toUpperCase() !== 'ADMIN') {
        return resolveToolResult({
          kind: 'policy',
          status: 'denied',
          title: 'Admin decision',
          summary: 'Only admin users can approve or reject booking requests.'
        });
      }

      const normalized = {
        subAction: String(subAction || '').trim().toUpperCase(),
        targetRequestIds: Array.isArray(targetRequestIds) ? targetRequestIds.filter(Boolean).slice(0, 20) : [],
        targetHall: String(targetHall || '').trim(),
        date: parseDateValue(date)
      };

      if (!normalized.subAction) {
        return resolveToolResult({
          kind: 'action_intent',
          status: 'missing_fields',
          title: 'Admin decision',
          summary: 'Need the exact admin subAction before this decision can be prepared.',
          missing: ['subAction']
        });
      }

      const actionIntent = buildAdminActionIntent(normalized);
      return resolveToolResult({
        kind: 'action_intent',
        title: 'Admin decision prepared',
        summary: `Prepared admin action ${normalized.subAction}.`,
        actionIntent,
        reviewRequired: true,
        riskLevel: 'HIGH',
        data: { normalized }
      });
    }
  }),
  createCatalogEntry({
    name: 'prepare_slack_notification',
    description: 'Prepare a Slack notification action for trusted users.',
    schema: z.object({
      text: z.string().optional().describe('Slack message text.'),
      channel: z.string().optional().describe('Optional Slack channel like #ops.'),
      threadTs: z.string().optional().describe('Optional Slack thread timestamp.')
    }),
    handler: async ({ text, channel, threadTs }, context) => {
      if (!roleIsTrusted(context.userRole)) {
        return resolveToolResult({
          kind: 'policy',
          status: 'denied',
          title: 'Slack notification',
          summary: 'Only admin or developer users can send Slack notifications.'
        });
      }

      const normalized = {
        text: clip(text, 3000),
        channel: clip(channel, 120),
        threadTs: clip(threadTs, 120)
      };
      if (!normalized.text) {
        return resolveToolResult({
          kind: 'action_intent',
          status: 'missing_fields',
          title: 'Slack notification',
          summary: 'Need the message text before Slack notification can be prepared.',
          missing: ['text']
        });
      }

      return resolveToolResult({
        kind: 'action_intent',
        title: 'Slack notification prepared',
        summary: normalized.channel
          ? `Prepared Slack notification for ${normalized.channel}.`
          : 'Prepared Slack notification for the configured default destination.',
        actionIntent: buildSlackActionIntent(normalized),
        reviewRequired: true,
        riskLevel: 'HIGH',
        data: { normalized }
      });
    }
  }),
  createCatalogEntry({
    name: 'prepare_whatsapp_message',
    description: 'Prepare a WhatsApp message send action for trusted users.',
    schema: z.object({
      to: z.string().optional().describe('Recipient phone number including country code.'),
      text: z.string().optional().describe('WhatsApp message text.'),
      contextMessageId: z.string().optional().describe('Optional context message ID for replies.')
    }),
    handler: async ({ to, text, contextMessageId }, context) => {
      if (!roleIsTrusted(context.userRole)) {
        return resolveToolResult({
          kind: 'policy',
          status: 'denied',
          title: 'WhatsApp message',
          summary: 'Only admin or developer users can send WhatsApp messages.'
        });
      }

      const normalized = {
        to: String(to || '').replace(/[^\d+]/g, '').trim(),
        text: clip(text, 3000),
        contextMessageId: clip(contextMessageId, 120)
      };
      const missing = [];
      if (!normalized.to) missing.push('to');
      if (!normalized.text) missing.push('text');

      if (missing.length > 0) {
        return resolveToolResult({
          kind: 'action_intent',
          status: 'missing_fields',
          title: 'WhatsApp message',
          summary: `Need ${missing.join(', ')} before WhatsApp send can be prepared.`,
          missing
        });
      }

      return resolveToolResult({
        kind: 'action_intent',
        title: 'WhatsApp message prepared',
        summary: `Prepared WhatsApp message for ${normalized.to}.`,
        actionIntent: buildWhatsAppActionIntent(normalized),
        reviewRequired: true,
        riskLevel: 'HIGH',
        data: { normalized }
      });
    }
  }),
  createCatalogEntry({
    name: 'prepare_crm_sync',
    description: 'Prepare a CRM synchronization action for support threads or booking records.',
    schema: z.object({
      mode: z.enum(['SUPPORT_THREAD', 'BOOKING_EVENT']).optional().describe('The CRM sync type.'),
      email: z.string().optional().describe('Primary contact email used for CRM upsert.'),
      title: z.string().optional().describe('Support thread title.'),
      message: z.string().optional().describe('Support thread message body.'),
      aiAnswer: z.string().optional().describe('Assistant response text for support-thread sync.'),
      threadId: z.string().optional().describe('Conversation thread ID.'),
      bookingId: z.string().optional().describe('Booking record ID when syncing booking events.'),
      department: z.string().optional().describe('Department name for booking events.'),
      hall: z.string().optional().describe('Hall name for booking events.'),
      event: z.string().optional().describe('Event name for booking events.'),
      startDateTime: z.string().optional().describe('Booking start time as an ISO string.'),
      endDateTime: z.string().optional().describe('Booking end time as an ISO string.'),
      status: z.string().optional().describe('Booking or support status label.')
    }),
    handler: async (input, context) => {
      if (!roleIsTrusted(context.userRole)) {
        return resolveToolResult({
          kind: 'policy',
          status: 'denied',
          title: 'CRM sync',
          summary: 'Only admin or developer users can trigger CRM synchronization.'
        });
      }

      const normalized = {
        mode: String(input.mode || '').trim().toUpperCase() || 'SUPPORT_THREAD',
        email: clip(input.email, 240).toLowerCase(),
        title: clip(input.title, 220),
        message: clip(input.message, 6000),
        aiAnswer: clip(input.aiAnswer, 6000),
        threadId: clip(input.threadId || context.threadId, 160),
        bookingId: clip(input.bookingId, 120),
        department: clip(input.department, 200),
        hall: clip(input.hall, 120),
        event: clip(input.event, 220),
        startDateTime: clip(input.startDateTime, 140),
        endDateTime: clip(input.endDateTime, 140),
        status: clip(input.status, 80)
      };

      const missing = ['email'];
      if (normalized.email) missing.shift();

      if (missing.length > 0) {
        return resolveToolResult({
          kind: 'action_intent',
          status: 'missing_fields',
          title: 'CRM sync',
          summary: 'Need email before CRM sync can be prepared.',
          missing
        });
      }

      return resolveToolResult({
        kind: 'action_intent',
        title: 'CRM sync prepared',
        summary: normalized.mode === 'BOOKING_EVENT'
          ? `Prepared CRM sync for booking ${normalized.bookingId || normalized.event || 'event'}.`
          : `Prepared CRM sync for support thread ${normalized.threadId || 'current conversation'}.`,
        actionIntent: buildCrmActionIntent(normalized),
        reviewRequired: true,
        riskLevel: 'HIGH',
        data: { normalized }
      });
    }
  })
];

const getAgentToolCatalog = () =>
  toolCatalog.map((entry) => ({
    name: entry.name,
    description: entry.description,
    risk: entry.risk,
    humanReview: entry.humanReview,
    schema: entry.schema,
    openAiTool: entry.openAiTool,
    anthropicTool: entry.anthropicTool
  }));

const getOpenAIToolSpecs = () => toolCatalog.map((entry) => entry.openAiTool);
const getAnthropicToolSpecs = () => toolCatalog.map((entry) => entry.anthropicTool);

const runAgentToolByName = async (name, rawInput = {}, context = {}) => {
  const entry = toolCatalog.find((candidate) => candidate.name === name);
  if (!entry) {
    throw new Error(`Unknown agent tool: ${name}`);
  }

  const started = Date.now();
  try {
    const output = await entry.handler(rawInput || {}, context || {});
    observeAgentToolCall({ tool: entry.name, error: false });
    return {
      name: entry.name,
      durationMs: Date.now() - started,
      ...(output && typeof output === 'object'
        ? output
        : resolveToolResult({
            kind: 'lookup',
            summary: clip(String(output || 'Tool completed.'), 320),
            data: { raw: output }
          }))
    };
  } catch (err) {
    observeAgentToolCall({ tool: entry.name, error: true });
    return {
      name: entry.name,
      kind: 'error',
      status: 'failed',
      title: entry.name,
      summary: clip(err.message || err, 320),
      data: {},
      reviewRequired: false,
      riskLevel: entry.risk,
      durationMs: Date.now() - started
    };
  }
};

module.exports = {
  getAgentToolCatalog,
  getOpenAIToolSpecs,
  getAnthropicToolSpecs,
  runAgentToolByName
};
