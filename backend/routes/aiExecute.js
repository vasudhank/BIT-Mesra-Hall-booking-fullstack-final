const express = require('express');
const router = express.Router();
const Hall = require('../models/hall');
const Booking_Requests = require('../models/booking_requests');
const CalendarTask = require('../models/calendar_task');
const PDFDocument = require('pdfkit');
const { safeExecute } = require('../utils/safeNotify');
const { generateApprovalToken, getTokenExpiry } = require('../utils/token');
const { beginAiTimer } = require('../services/metricsService');
const {
  getAgentMemoryContext,
  persistAgentTurn,
  extractReplyTextForMemory
} = require('../services/agentMemoryService');
const { captureException } = require('../services/observabilityService');
const { dispatchSlackNotification } = require('../services/slackIntegrationService');
const { sendWhatsAppTextMessage } = require('../services/whatsappIntegrationService');
const { syncSupportThreadToCrm, syncBookingEventToCrm } = require('../services/crmIntegrationService');
const { getReviewTaskById, markReviewTaskExecuted } = require('../services/agentReviewService');

const {
  sendBookingApprovalMail,
  sendBookingAutoBookedMail,
  sendDecisionToDepartment,
  sendGenericEmail
} = require('../services/emailService');

const {
  sendBookingApprovalSMS,
  sendBookingAutoBookedSMS,
  sendDecisionSMSDepartment
} = require('../services/smsService');
const {
  reserveHallSlotAtomically,
  pullHallBookingsByRequestIds
} = require('../services/bookingMutationService');
const { createNotice, getNoticeClosures, listNotices } = require('../services/noticeService');
const { clearPendingAction } = require('../services/agentPendingActionService');

require('dotenv').config();

const to12 = (time) => {
  if (!time) return null;
  const raw = String(time).trim().toUpperCase();

  if (/(AM|PM)/.test(raw)) {
    const m = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
    if (!m) return null;
    const hour = Number(m[1]);
    const minute = Number(m[2] || '0');
    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
    return `${hour}:${String(minute).padStart(2, '0')} ${m[3]}`;
  }

  const m24 = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (!m24) return null;

  let hour = Number(m24[1]);
  const minute = Number(m24[2]);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  hour %= 12;
  if (hour === 0) hour = 12;
  return `${hour}:${String(minute).padStart(2, '0')} ${suffix}`;
};

const to24 = (time) => {
  if (!time) return null;
  const raw = String(time).trim().toUpperCase();

  const m12 = raw.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/);
  if (m12) {
    let hour = Number(m12[1]);
    const minute = Number(m12[2] || '0');
    const suffix = m12[3];

    if (hour < 1 || hour > 12 || minute < 0 || minute > 59) return null;
    if (suffix === 'PM' && hour < 12) hour += 12;
    if (suffix === 'AM' && hour === 12) hour = 0;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  const m24 = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (m24) {
    return `${String(Number(m24[1])).padStart(2, '0')}:${m24[2]}`;
  }

  return null;
};

const escapeRegex = (value) => String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const findHallByNameLoose = async (name) => {
  const cleanName = String(name || '').trim();
  if (!cleanName) return null;
  return Hall.findOne({ name: cleanName })
    .then((hall) => hall || Hall.findOne({ name: new RegExp(`^${escapeRegex(cleanName)}$`, 'i') }));
};

const normalizeSubAction = (subAction) => {
  const raw = String(subAction || '').toUpperCase().trim();
  const supported = [
    'APPROVE_SAFE',
    'APPROVE_ALL',
    'APPROVE_SPECIFIC',
    'APPROVE_SELECTED',
    'REJECT_CONFLICTS',
    'REJECT_ALL',
    'REJECT_SPECIFIC',
    'REJECT_SELECTED'
  ];

  if (supported.includes(raw)) return raw;
  if (raw.includes('SAFE') || raw.includes('NON')) return 'APPROVE_SAFE';
  if (raw.includes('APPROVE') && raw.includes('ALL')) return 'APPROVE_ALL';
  if (raw.includes('APPROVE')) return 'APPROVE_SPECIFIC';
  if (raw.includes('REJECT') && raw.includes('ALL')) return 'REJECT_ALL';
  if (raw.includes('REJECT') && raw.includes('CONFLICT')) return 'REJECT_CONFLICTS';
  if (raw.includes('REJECT')) return 'REJECT_SPECIFIC';

  return null;
};

const normalizeConflictFilter = (rawFilter) => {
  const raw = String(rawFilter || '').toUpperCase().trim();
  if (raw === 'ALL' || raw === 'CONFLICTING' || raw === 'NON_CONFLICTING') return raw;

  if (raw.includes('NON')) return 'NON_CONFLICTING';
  if (raw.includes('CONFLICT')) return 'CONFLICTING';
  return 'ALL';
};

const normalizeHallStatusMode = (rawMode) => {
  const raw = String(rawMode || '').toUpperCase().trim();
  if (raw === 'OPEN' || raw === 'CLOSED') return raw;
  if (raw.includes('NOT') && (raw.includes('BOOK') || raw.includes('OCCUP') || raw.includes('FILL') || raw.includes('BUSY'))) return 'AVAILABLE';
  if (raw.includes('UNBOOK') || raw.includes('EMPTY')) return 'AVAILABLE';
  if (raw.includes('UNAVAILABLE') || (raw.includes('NOT') && (raw.includes('FREE') || raw.includes('AVAILABLE') || raw.includes('VACANT')))) return 'FILLED';
  if (raw.includes('OPEN')) return 'OPEN';
  if (raw.includes('CLOSE')) return 'CLOSED';
  if (raw === 'ALL' || raw === 'AVAILABLE' || raw === 'FILLED') return raw;

  if (raw.includes('FREE') || raw.includes('VACANT') || raw.includes('AVAILABLE')) return 'AVAILABLE';
  if (raw.includes('BOOKED') || raw.includes('OCCUPIED') || raw.includes('FILLED')) return 'FILLED';
  return 'ALL';
};

const formatDateYYYYMMDD = (value) => {
  const dt = value instanceof Date ? value : new Date(value);
  if (!(dt instanceof Date) || Number.isNaN(dt.getTime())) return null;
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const parseDateRange = (dateText) => {
  const raw = String(dateText || '').trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;

  const start = new Date(`${raw}T00:00:00.000`);
  const end = new Date(`${raw}T23:59:59.999`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  return { date: raw, dateFrom: null, dateTo: null, start, end };
};

const parseOptionalDateRange = (dateText) => {
  const raw = String(dateText || '').trim();
  if (!raw) return null;
  return parseDateRange(raw);
};

const parseDateWindow = (payload = {}) => {
  const raw = payload && typeof payload === 'object' ? payload : {};
  const single = parseDateRange(raw.date);
  if (single) return single;

  const startRange = parseOptionalDateRange(raw.dateFrom || raw.startDate || raw.rangeStart);
  const endRange = parseOptionalDateRange(raw.dateTo || raw.endDate || raw.rangeEnd);
  if (!startRange && !endRange) return null;

  const start = startRange ? startRange.start : endRange.start;
  const end = endRange ? endRange.end : startRange.end;
  if (!(start instanceof Date) || Number.isNaN(start.getTime()) || !(end instanceof Date) || Number.isNaN(end.getTime())) {
    return null;
  }

  const normalizedStart = start.getTime() <= end.getTime() ? start : end;
  const normalizedEnd = start.getTime() <= end.getTime() ? end : start;
  const dateFrom = formatDateYYYYMMDD(normalizedStart);
  const dateTo = formatDateYYYYMMDD(normalizedEnd);
  if (!dateFrom || !dateTo) return null;

  if (dateFrom === dateTo) {
    return parseDateRange(dateFrom);
  }

  return {
    date: null,
    dateFrom,
    dateTo,
    start: normalizedStart,
    end: normalizedEnd
  };
};

const getTodayISTDate = () => {
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

const formatTimeRange = (startDateTime, endDateTime) => {
  const formatOne = (value) =>
    new Date(value).toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });

  return `${formatOne(startDateTime)} - ${formatOne(endDateTime)}`;
};

const htmlEscape = (input) =>
  String(input || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const clipText = (value, limit = 4000) =>
  String(value || '')
    .trim()
    .slice(0, limit);

const isValidEmail = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

const toDateOnlyBounds = (requestDoc) => {
  const startSource = requestDoc?.startDate || requestDoc?.startDateTime;
  const endSource = requestDoc?.endDate || requestDoc?.endDateTime || startSource;
  const start = new Date(startSource);
  const end = new Date(endSource);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
};

const toMinutesFromRequestTime = (value, fallbackDateTime) => {
  const raw = String(value || '').trim();
  const fromTime = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (fromTime) {
    return Number(fromTime[1]) * 60 + Number(fromTime[2]);
  }

  const fallback = fallbackDateTime ? new Date(fallbackDateTime) : null;
  if (!fallback || Number.isNaN(fallback.getTime())) return null;
  return fallback.getHours() * 60 + fallback.getMinutes();
};

const getRequestTimeWindow = (requestDoc) => ({
  start: toMinutesFromRequestTime(requestDoc?.startTime24, requestDoc?.startDateTime),
  end: toMinutesFromRequestTime(requestDoc?.endTime24, requestDoc?.endDateTime)
});

const buildConflictLabel = (conflictType) => {
  const normalized = String(conflictType || '').trim().toUpperCase();
  if (normalized === 'TIME_CONFLICT' || normalized === 'APPROVED_BOOKING_CONFLICT') return 'TIME CONFLICT';
  if (normalized === 'DATE_CONFLICT') return 'DATE CONFLICT';
  if (normalized === 'NOTICE_CLOSURE') return 'NOTICE CLOSURE';
  return 'NON-CONFLICTING';
};

const classifyBookingRequestConflict = async (requestDoc, allPending = []) => {
  const hallDoc = await Hall.findOne({ name: requestDoc.hall }).select('name bookings');
  if (!hallDoc) {
    return {
      conflict: 'CONFLICTING',
      conflictType: 'HALL_NOT_FOUND',
      detail: 'Hall no longer exists.'
    };
  }

  const noticeConflicts = await getNoticeClosures({
    hallName: requestDoc.hall,
    startDateTime: requestDoc.startDateTime,
    endDateTime: requestDoc.endDateTime
  });
  if (noticeConflicts.length > 0) {
    const first = noticeConflicts[0];
    return {
      conflict: 'CONFLICTING',
      conflictType: 'NOTICE_CLOSURE',
      detail: first?.title || first?.holidayName || 'Hall is closed for a notice/holiday.',
      notices: noticeConflicts
    };
  }

  const approvedConflict = (hallDoc.bookings || []).find((booking) =>
    overlaps(booking.startDateTime, booking.endDateTime, requestDoc.startDateTime, requestDoc.endDateTime)
  );
  if (approvedConflict) {
    return {
      conflict: 'CONFLICTING',
      conflictType: 'APPROVED_BOOKING_CONFLICT',
      detail: approvedConflict.event || 'Overlaps an existing approved booking.'
    };
  }

  const requestDayBounds = toDateOnlyBounds(requestDoc);
  const requestTimeWindow = getRequestTimeWindow(requestDoc);

  for (const other of allPending) {
    if (!other || !other._id || requestDoc._id.equals(other._id)) continue;
    if (String(other.status || '').toUpperCase() !== 'PENDING') continue;
    if (String(other.hall || '').toLowerCase() !== String(requestDoc.hall || '').toLowerCase()) continue;

    if (overlaps(requestDoc.startDateTime, requestDoc.endDateTime, other.startDateTime, other.endDateTime)) {
      return {
        conflict: 'CONFLICTING',
        conflictType: 'TIME_CONFLICT',
        detail: `Overlaps pending request ${String(other._id)}.`
      };
    }

    const otherDayBounds = toDateOnlyBounds(other);
    const otherTimeWindow = getRequestTimeWindow(other);
    const datesOverlap = requestDayBounds && otherDayBounds
      ? requestDayBounds.start.getTime() <= otherDayBounds.end.getTime()
        && otherDayBounds.start.getTime() <= requestDayBounds.end.getTime()
      : false;
    const timesOverlap = requestTimeWindow.start !== null
      && requestTimeWindow.end !== null
      && otherTimeWindow.start !== null
      && otherTimeWindow.end !== null
      ? requestTimeWindow.start < otherTimeWindow.end && otherTimeWindow.start < requestTimeWindow.end
      : false;

    if (datesOverlap && !timesOverlap) {
      return {
        conflict: 'CONFLICTING',
        conflictType: 'DATE_CONFLICT',
        detail: `Date range overlaps pending request ${String(other._id)}.`
      };
    }
  }

  return {
    conflict: 'NON_CONFLICTING',
    conflictType: 'SAFE',
    detail: 'No time/date/closure conflicts detected.'
  };
};

const notifyDepartmentDecision = (requestDoc, decision) => {
  const departmentEmail = requestDoc?.department?.email || '';
  if (departmentEmail) {
    safeExecute(
      () => sendDecisionToDepartment({
        email: departmentEmail,
        booking: requestDoc,
        decision
      }),
      'DEPARTMENT EMAIL'
    );
  }

  if (requestDoc?.department) {
    safeExecute(
      () => sendDecisionSMSDepartment({
        booking: requestDoc,
        decision
      }),
      'DEPARTMENT SMS'
    );
  }
};

const buildScheduleCsv = (rows) => {
  const header = ['Hall', 'Status', 'Event', 'Department', 'Time'];
  const csvRows = [header]
    .concat(
      (rows || []).map((row) => [
        row.hall,
        row.status,
        row.event,
        row.department,
        row.timeRange
      ])
    )
    .map((cells) => cells.map((cell) => `"${String(cell || '').replace(/"/g, '""')}"`).join(','));
  return csvRows.join('\n');
};

const buildScheduleSvg = (rows, date) => {
  const safeRows = Array.isArray(rows) ? rows : [];
  const rowHeight = 28;
  const width = 1200;
  const tableTop = 84;
  const height = Math.max(220, tableTop + rowHeight * (safeRows.length + 2));
  const colX = [20, 180, 340, 620, 850];

  const headerCells = ['Hall', 'Status', 'Event', 'Department', 'Time'];
  const rowLines = safeRows
    .map((row, idx) => {
      const y = tableTop + rowHeight * (idx + 1);
      const values = [row.hall, row.status, row.event, row.department, row.timeRange];
      const textNodes = values
        .map((value, colIdx) => `<text x="${colX[colIdx]}" y="${y}" font-size="13" fill="#dbe7ff">${htmlEscape(value)}</text>`)
        .join('');
      return textNodes;
    })
    .join('');

  const headerNodes = headerCells
    .map((value, idx) => `<text x="${colX[idx]}" y="${tableTop}" font-size="13" fill="#9ec2ff" font-weight="700">${value}</text>`)
    .join('');

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="${width}" height="${height}" fill="#0b1f44"/>
  <text x="20" y="34" font-size="24" fill="#ffffff" font-weight="700">Hall Schedule Export</text>
  <text x="20" y="58" font-size="14" fill="#9ec2ff">Date: ${htmlEscape(date)}</text>
  <line x1="20" y1="66" x2="${width - 20}" y2="66" stroke="#214a8c"/>
  ${headerNodes}
  <line x1="20" y1="${tableTop + 8}" x2="${width - 20}" y2="${tableTop + 8}" stroke="#214a8c"/>
  ${rowLines}
</svg>`.trim();
};

const buildSchedulePdf = (rows, date) =>
  new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ size: 'A4', margin: 40 });
      const chunks = [];
      doc.on('data', (chunk) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      doc.fontSize(18).text('Hall Schedule Export', { underline: true });
      doc.moveDown(0.2);
      doc.fontSize(11).text(`Date: ${date}`);
      doc.moveDown(0.8);

      const columns = ['Hall', 'Status', 'Event', 'Department', 'Time'];
      const x = [40, 115, 195, 330, 450];
      let y = 110;

      doc.fontSize(10).fillColor('#1b3f74');
      columns.forEach((col, idx) => doc.text(col, x[idx], y));
      y += 16;
      doc.moveTo(40, y).lineTo(555, y).stroke('#8aa8d8');
      y += 6;

      doc.fillColor('#111827').fontSize(9.5);
      (rows || []).forEach((row) => {
        if (y > 760) {
          doc.addPage();
          y = 50;
        }

        const values = [row.hall, row.status, row.event, row.department, row.timeRange];
        values.forEach((value, idx) => {
          doc.text(String(value || ''), x[idx], y, { width: idx === 2 ? 125 : 100, ellipsis: true });
        });

        y += 14;
      });

      doc.end();
    } catch (err) {
      reject(err);
    }
  });

const buildScheduleRows = async (dateRange) => {
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

    for (const booking of relevantBookings) {
      rows.push({
        hall: hall.name,
        status: 'FILLED',
        event: booking.event || 'Booked',
        department: booking.department?.head || booking.department?.department || 'N/A',
        timeRange: formatTimeRange(booking.startDateTime, booking.endDateTime)
      });
    }
  }

  return rows;
};

const overlaps = (startA, endA, startB, endB) =>
  new Date(startA).getTime() < new Date(endB).getTime() &&
  new Date(endA).getTime() > new Date(startB).getTime();

const formatDateLabel = (dateRange) => dateRange?.date || 'the current active time';

const analyzeRequestConflict = async (requestDoc, allPending) => {
  const result = await classifyBookingRequestConflict(requestDoc, allPending);
  return result?.conflictType || 'SAFE';
};

const approveRequest = async (requestDoc) => {
  const reservationResult = await reserveHallSlotAtomically({
    hallName: requestDoc.hall,
    bookingRequestId: requestDoc._id,
    departmentId: requestDoc.department?._id || requestDoc.department || null,
    event: requestDoc.event,
    startDateTime: requestDoc.startDateTime,
    endDateTime: requestDoc.endDateTime
  });

  if (!reservationResult.reserved) {
    return { approved: false, reason: reservationResult.reason || 'OVERLAP' };
  }

  requestDoc.status = 'APPROVED';
  await requestDoc.save();
  notifyDepartmentDecision(requestDoc, 'APPROVED');
  return { approved: true, reason: 'OK' };
};

const rejectRequest = async (requestDoc) => {
  requestDoc.status = 'REJECTED';
  await requestDoc.save();
  notifyDepartmentDecision(requestDoc, 'REJECTED');
};

router.post('/execute', async (req, res) => {
  const finalizeAi = beginAiTimer('http_execute');
  let hadAiError = false;
  try {
    const intent = req.body?.intent || {};
    const reviewId = String(req.body?.reviewId || intent?.meta?.reviewTaskId || '').trim();
    const user = req.isAuthenticated && req.isAuthenticated()
      ? req.user
      : { type: 'Guest', id: null, email: '' };
    const normalizedUserRole = String(user.type || 'Guest').toUpperCase();
    let actionType = String(intent.action || '').toUpperCase();
    let payload = intent.payload || {};
    let reviewTask = null;

    if (!actionType && reviewId) {
      reviewTask = await getReviewTaskById(reviewId);
      if (!reviewTask) {
        return res.json({ status: 'ERROR', msg: 'Review task not found.' });
      }
      if (reviewTask.status !== 'APPROVED') {
        return res.json({ status: 'ERROR', msg: 'Review task must be approved before execution.' });
      }

      actionType = String(reviewTask.actionIntent?.action || '').toUpperCase();
      payload = reviewTask.actionIntent?.payload || {};
    }

    if (!actionType) {
      return res.json({ status: 'ERROR', msg: 'AI action is missing.' });
    }

    const agentMemoryContext = await getAgentMemoryContext({
      req,
      message: `Execute AI action: ${actionType}`,
      history: [],
      userRole: String(user.type || 'Guest').toUpperCase(),
      threadId: req.body?.threadId,
      accountKey: req.body?.accountKey,
      channel: 'http_execute'
    });
    const fromConfirmedPendingAction = Boolean(intent?.meta?.confirmedPendingAction);

    const originalJson = res.json.bind(res);
    let memoryPersistQueued = false;
    res.json = (body) => {
      if (!memoryPersistQueued) {
        memoryPersistQueued = true;
        const status = body?.status || (res.statusCode >= 400 ? 'ERROR' : 'OK');
        persistAgentTurn({
          context: agentMemoryContext,
          userMessage: `Execute AI action: ${actionType}`,
          assistantReply: extractReplyTextForMemory({
            reply: body?.message || body?.msg || body?.data?.kind || JSON.stringify(body || {})
          }),
          replyType: 'ACTION_RESULT',
          action: actionType,
          status,
          metadata: {
            userRole: user.type || 'Guest',
            channel: 'http_execute',
            payload,
            reviewId: reviewTask?.id || reviewId || null
          }
        }).catch((memoryErr) => {
          captureException(memoryErr, { area: 'ai_execute_memory_persist' });
        });

        const finalStatus = String(body?.status || '').toUpperCase();
        if ((reviewTask?.id || reviewId) && ['DONE', 'ERROR'].includes(finalStatus)) {
          markReviewTaskExecuted({
            reviewId: reviewTask?.id || reviewId,
            error: finalStatus === 'ERROR'
          }).catch((reviewErr) => {
            captureException(reviewErr, { area: 'ai_execute_review_mark' });
          });
        }

        if (fromConfirmedPendingAction && ['DONE', 'INFO'].includes(finalStatus)) {
          clearPendingAction({
            ownerKey: agentMemoryContext?.ownerKey,
            threadId: agentMemoryContext?.threadId
          }).catch((pendingErr) => {
            captureException(pendingErr, { area: 'ai_execute_pending_clear' });
          });
        }
      }
      return originalJson(body);
    };

    if (actionType === 'EXPORT_SCHEDULE') {
      const requestedDate = String(payload.date || '').trim();
      const normalizedDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate)
        ? requestedDate
        : getTodayISTDate();

      const format = ['PDF', 'IMAGE', 'CSV', 'TABLE'].includes(String(payload.format || '').toUpperCase().trim())
        ? String(payload.format || '').toUpperCase().trim()
        : 'PDF';

      const dateRange = parseDateRange(normalizedDate);
      if (!dateRange) {
        return res.json({ status: 'ERROR', msg: 'Invalid date format for schedule export. Use YYYY-MM-DD.' });
      }

      const rows = await buildScheduleRows(dateRange);
      const summary = {
        totalRows: rows.length,
        filledRows: rows.filter((row) => row.status === 'FILLED').length,
        availableRows: rows.filter((row) => row.status === 'AVAILABLE').length
      };

      const artifacts = [];

      if (format === 'PDF') {
        const pdfBuffer = await buildSchedulePdf(rows, normalizedDate);
        artifacts.push({
          type: 'PDF',
          name: `hall-schedule-${normalizedDate}.pdf`,
          mimeType: 'application/pdf',
          base64: pdfBuffer.toString('base64')
        });
      }

      if (format === 'IMAGE') {
        const svg = buildScheduleSvg(rows, normalizedDate);
        artifacts.push({
          type: 'IMAGE',
          name: `hall-schedule-${normalizedDate}.svg`,
          mimeType: 'image/svg+xml',
          base64: Buffer.from(svg, 'utf8').toString('base64')
        });
      }

      if (format === 'CSV') {
        const csv = buildScheduleCsv(rows);
        artifacts.push({
          type: 'CSV',
          name: `hall-schedule-${normalizedDate}.csv`,
          mimeType: 'text/csv',
          base64: Buffer.from(csv, 'utf8').toString('base64')
        });
      }

      return res.json({
        status: 'INFO',
        data: {
          kind: 'SCHEDULE_EXPORT',
          date: normalizedDate,
          formatRequested: format,
          summary,
          columns: ['Hall', 'Status', 'Event', 'Department', 'Time'],
          rows,
          artifacts
        }
      });
    }

    if (actionType === 'BOOK_REQUEST') {
      const requests = Array.isArray(payload.requests) ? payload.requests : [];
      if (requests.length === 0) {
        return res.json({ status: 'ERROR', msg: 'AI understood booking intent but required details are missing.' });
      }

      if (user.type === 'Admin') {
        let successCount = 0;
        let autoBookedCount = 0;
        const failMessages = [];

        for (const requestItem of requests) {
          try {
            const hall = String(requestItem.hall || '').trim();
            const date = String(requestItem.date || '').trim();
            const start12 = to12(requestItem.start || requestItem.startTime || requestItem.from);
            const end12 = to12(requestItem.end || requestItem.endTime || requestItem.to);
            const event = String(requestItem.event || 'Admin AI Booking').trim().slice(0, 150);

            if (!hall || !date || !start12 || !end12) {
              failMessages.push('One admin booking had missing hall/date/time details.');
              continue;
            }

            const start24 = to24(start12);
            const end24 = to24(end12);
            if (!start24 || !end24) {
              failMessages.push(`Invalid time format for ${hall}.`);
              continue;
            }

            const startDateTime = new Date(`${date}T${start24}:00`);
            const endDateTime = new Date(`${date}T${end24}:00`);
            if (Number.isNaN(startDateTime.getTime()) || Number.isNaN(endDateTime.getTime())) {
              failMessages.push(`Invalid date/time for ${hall}.`);
              continue;
            }

            if (endDateTime <= startDateTime) {
              failMessages.push(`End time must be after start time for ${hall}.`);
              continue;
            }

            const hallDoc = await findHallByNameLoose(hall);
            if (!hallDoc) {
              failMessages.push(`Hall not found: ${hall}.`);
              continue;
            }

            const hasBookingConflict = (hallDoc.bookings || []).some((booking) =>
              overlaps(startDateTime, endDateTime, booking.startDateTime, booking.endDateTime)
            );
            const noticeConflicts = await getNoticeClosures({
              hallName: hallDoc.name,
              startDateTime,
              endDateTime
            });
            if (hasBookingConflict || noticeConflicts.length > 0) {
              const reason = noticeConflicts.length > 0
                ? `${hallDoc.name} is closed for the requested time range.`
                : `${hallDoc.name} is already booked for the requested time range.`;
              failMessages.push(reason);
              continue;
            }

            const approvalToken = generateApprovalToken();
            const tokenExpiry = getTokenExpiry(15);
            const requestDoc = new Booking_Requests({
              hall: hallDoc.name,
              department: null,
              event,
              description: 'Booked via AI Assistant by admin',
              startDateTime,
              endDateTime,
              startTime12: start12,
              endTime12: end12,
              startTime24: `${start24}:00`,
              endTime24: `${end24}:00`,
              startDate: date,
              endDate: date,
              approvalToken,
              tokenExpiry,
              status: 'AUTO_BOOKED'
            });

            const reservationResult = await reserveHallSlotAtomically({
              hallName: hallDoc.name,
              bookingRequestId: requestDoc._id,
              departmentId: null,
              event,
              startDateTime,
              endDateTime
            });

            if (!reservationResult.reserved) {
              const reason = reservationResult.reason === 'HALL_NOT_FOUND'
                ? `Hall not found: ${hallDoc.name}.`
                : `${hallDoc.name} is already booked for the requested time range.`;
              failMessages.push(reason);
              continue;
            }

            try {
              await requestDoc.save();
            } catch (saveErr) {
              await pullHallBookingsByRequestIds({
                hallName: hallDoc.name,
                requestIds: [requestDoc._id]
              });
              throw saveErr;
            }
            successCount += 1;
            autoBookedCount += 1;

            const baseUrl = `${process.env.PUBLIC_BASE_URL}/api/approval`;
            safeExecute(
              () => sendBookingAutoBookedMail({
                adminEmail: process.env.EMAIL,
                booking: requestDoc,
                vacateUrl: `${baseUrl}/vacate/${approvalToken}`,
                leaveUrl: `${baseUrl}/leave/${approvalToken}`
              }),
              'ADMIN EMAIL'
            );

            safeExecute(
              () => sendBookingAutoBookedSMS({
                booking: requestDoc,
                token: approvalToken
              }),
              'ADMIN SMS'
            );
          } catch (err) {
            console.error('AI admin direct booking error:', err);
            failMessages.push('An unexpected error happened for one admin booking.');
          }
        }

        if (successCount === 0) {
          return res.json({
            status: 'ERROR',
            msg: failMessages.join(' ') || 'Admin booking failed.'
          });
        }

        const suffix = failMessages.length > 0 ? ` ${failMessages.join(' ')}` : '';
      return res.json({
        status: 'DONE',
        message: `I have booked ${successCount} hall ${successCount === 1 ? 'slot' : 'slots'} directly as requested. The admin dashboard cards were updated for ${autoBookedCount} ${autoBookedCount === 1 ? 'entry' : 'entries'}.${suffix}`
      });
      }

      if (user.type !== 'Department') {
        return res.json({ status: 'ERROR', msg: 'Booking via AI is allowed only for logged-in admin or faculty/department accounts.' });
      }

      let successCount = 0;
      let autoBookedCount = 0;
      let pendingApprovalCount = 0;
      const failMessages = [];

      for (const requestItem of requests) {
        try {
          const hall = String(requestItem.hall || '').trim();
          const date = String(requestItem.date || '').trim();
          const start12 = to12(requestItem.start || requestItem.startTime || requestItem.from);
          const end12 = to12(requestItem.end || requestItem.endTime || requestItem.to);
          const event = String(requestItem.event || 'AI Booking').trim().slice(0, 150);

          if (!hall || !date || !start12 || !end12) {
            failMessages.push('One request had missing hall/date/time details.');
            continue;
          }

          const start24 = to24(start12);
          const end24 = to24(end12);
          if (!start24 || !end24) {
            failMessages.push(`Invalid time format for ${hall}.`);
            continue;
          }

          const startDateTime = new Date(`${date}T${start24}:00`);
          const endDateTime = new Date(`${date}T${end24}:00`);

          if (Number.isNaN(startDateTime.getTime()) || Number.isNaN(endDateTime.getTime())) {
            failMessages.push(`Invalid date/time for ${hall}.`);
            continue;
          }

          if (endDateTime <= startDateTime) {
            failMessages.push(`End time must be after start time for ${hall}.`);
            continue;
          }

          const hallDoc = await findHallByNameLoose(hall);
          if (!hallDoc) {
            failMessages.push(`Hall not found: ${hall}.`);
            continue;
          }

          const overlappingBookings = (hallDoc.bookings || []).filter((booking) =>
            overlaps(startDateTime, endDateTime, booking.startDateTime, booking.endDateTime)
          );
          const noticeConflicts = await getNoticeClosures({
            hallName: hallDoc.name,
            startDateTime,
            endDateTime
          });
          const hasConflict = overlappingBookings.length > 0 || noticeConflicts.length > 0;

          const approvalToken = generateApprovalToken();
          const tokenExpiry = getTokenExpiry(15);

          let finalHasConflict = hasConflict;
          const newRequest = new Booking_Requests({
            hall: hallDoc.name,
            department: user.id,
            event,
            description: 'Booked via AI Assistant',
            startDateTime,
            endDateTime,
            startTime12: start12,
            endTime12: end12,
            startTime24: `${start24}:00`,
            endTime24: `${end24}:00`,
            startDate: date,
            endDate: date,
            approvalToken,
            tokenExpiry,
            status: finalHasConflict ? 'PENDING' : 'AUTO_BOOKED',
            forceRequested: false,
            conflictDetails: finalHasConflict
              ? {
                  bookings: overlappingBookings.map((booking) => ({
                    bookingRequest: booking.bookingRequest || null,
                    event: booking.event || 'Booked',
                    startDateTime: booking.startDateTime,
                    endDateTime: booking.endDateTime
                  })),
                  notices: noticeConflicts
                }
              : {}
          });

          let reservationCreated = false;
          if (!finalHasConflict) {
            const reservationResult = await reserveHallSlotAtomically({
              hallName: hallDoc.name,
              bookingRequestId: newRequest._id,
              departmentId: user.id,
              event,
              startDateTime,
              endDateTime
            });

            if (!reservationResult.reserved) {
              finalHasConflict = true;
              newRequest.status = 'PENDING';
              newRequest.conflictDetails = {
                runtimeConflict: reservationResult.reason || 'OVERLAP'
              };
            } else {
              reservationCreated = true;
            }
          }

          let saved;
          try {
            saved = await newRequest.save();
          } catch (saveErr) {
            if (reservationCreated) {
              await pullHallBookingsByRequestIds({
                hallName: hallDoc.name,
                requestIds: [newRequest._id]
              });
            }
            throw saveErr;
          }
          const baseUrl = `${process.env.PUBLIC_BASE_URL}/api/approval`;

          if (finalHasConflict) {
            const overlappingRequestIds = overlappingBookings
              .map((booking) => booking.bookingRequest)
              .filter(Boolean);

            if (overlappingRequestIds.length > 0) {
              await Booking_Requests.updateMany(
                {
                  _id: { $in: overlappingRequestIds },
                  status: { $in: ['APPROVED', 'LEFT'] }
                },
                { $set: { status: 'AUTO_BOOKED' } }
              );
            }

            safeExecute(
              () => sendBookingApprovalMail({
                adminEmail: process.env.EMAIL,
                booking: saved,
                approveUrl: `${baseUrl}/approve/${approvalToken}`,
                rejectUrl: `${baseUrl}/reject/${approvalToken}`
              }),
              'ADMIN EMAIL'
            );

            safeExecute(
              () => sendBookingApprovalSMS({
                booking: saved,
                token: approvalToken
              }),
              'ADMIN SMS'
            );

            pendingApprovalCount += 1;
          } else {
            safeExecute(
              () => sendBookingAutoBookedMail({
                adminEmail: process.env.EMAIL,
                booking: saved,
                vacateUrl: `${baseUrl}/vacate/${approvalToken}`,
                leaveUrl: `${baseUrl}/leave/${approvalToken}`
              }),
              'ADMIN EMAIL'
            );

            safeExecute(
              () => sendBookingAutoBookedSMS({
                booking: saved,
                token: approvalToken
              }),
              'ADMIN SMS'
            );

            safeExecute(
              () => sendDecisionToDepartment({
                email: user.email,
                booking: saved,
                decision: 'AUTO_BOOKED'
              }),
              'DEPARTMENT EMAIL'
            );

            safeExecute(
              () => sendDecisionSMSDepartment({
                booking: saved,
                decision: 'AUTO_BOOKED'
              }),
              'DEPARTMENT SMS'
            );

            autoBookedCount += 1;
          }

          successCount += 1;
        } catch (err) {
          console.error('AI single booking error:', err);
          failMessages.push('An unexpected error happened for one booking request.');
        }
      }

      if (successCount === 0) {
        return res.json({ status: 'ERROR', msg: failMessages.join(' ') || 'Failed to create booking request.' });
      }

      const suffix = failMessages.length > 0 ? ` ${failMessages.join(' ')}` : '';
      return res.json({
        status: 'DONE',
        message: `I created ${successCount} booking ${successCount === 1 ? 'request' : 'requests'}. ${autoBookedCount} ${autoBookedCount === 1 ? 'was' : 'were'} auto-booked, and ${pendingApprovalCount} ${pendingApprovalCount === 1 ? 'is' : 'are'} pending admin approval.${suffix}`
      });
    }

    if (actionType === 'CREATE_PUBLIC_TASK') {
      if (!['Admin', 'Department'].includes(String(user.type || ''))) {
        return res.json({ status: 'ERROR', msg: 'Creating public calendar tasks requires admin or faculty login.' });
      }

      const title = clipText(payload.title || payload.event || 'Public Task', 240);
      const description = clipText(payload.description || '', 4000);
      const startDateTime = payload.startDateTime ? new Date(payload.startDateTime) : null;
      const endDateTime = payload.endDateTime ? new Date(payload.endDateTime) : null;
      const allDay = Boolean(payload.allDay);

      if (!title || !startDateTime || !endDateTime) {
        return res.json({ status: 'ERROR', msg: 'Task title, startDateTime, and endDateTime are required.' });
      }
      if (Number.isNaN(startDateTime.getTime()) || Number.isNaN(endDateTime.getTime())) {
        return res.json({ status: 'ERROR', msg: 'Task date/time is invalid.' });
      }
      if (endDateTime <= startDateTime) {
        return res.json({ status: 'ERROR', msg: 'Task end time must be after start time.' });
      }

      const task = await CalendarTask.create({
        title,
        description,
        startDateTime,
        endDateTime,
        allDay,
        createdBy: {
          id: user.id || user._id || null,
          type: user.type || '',
          name: user.name || user.head || user.department || user.email || 'User',
          email: user.email || ''
        }
      });

      return res.json({
        status: 'INFO',
        data: {
          kind: 'CALENDAR_TASK',
          title: task.title,
          summary: 'Public task created successfully.',
          columns: ['Field', 'Value'],
          rows: [
            ['Title', task.title],
            ['From', String(task.startDateTime || '')],
            ['To', String(task.endDateTime || '')],
            ['All Day', allDay ? 'Yes' : 'No'],
            ['Description', task.description || '-']
          ]
        }
      });
    }

    if (actionType === 'CREATE_NOTICE') {
      if (user.type !== 'Admin') {
        return res.json({ status: 'ERROR', msg: 'Posting notices via AI requires admin login.' });
      }

      const title = clipText(payload.title || payload.subject || '', 240);
      const content = clipText(payload.content || payload.body || payload.summary || '', 8000);
      if (!title && !content) {
        return res.json({ status: 'ERROR', msg: 'Notice title or content is required.' });
      }

      const { notice } = await createNotice({
        subject: title,
        body: content,
        source: 'ADMIN',
        manualOverrides: {
          kind: String(payload.kind || 'GENERAL').trim().toUpperCase(),
          holidayName: clipText(payload.holidayName || '', 240),
          startDateTime: payload.startDateTime || null,
          endDateTime: payload.endDateTime || null,
          closureAllHalls: Boolean(payload.closureAllHalls),
          rooms: Array.isArray(payload.rooms) ? payload.rooms : [],
          title,
          content
        },
        postedBy: {
          id: user._id || user.id || null,
          type: user.type || '',
          name: user.name || user.email || 'Admin'
        }
      });

      return res.json({
        status: 'INFO',
        data: {
          kind: 'NOTICE_RESULT',
          noticeId: String(notice._id),
          title: notice.title || title,
          content: notice.content || content,
          summary: `Notice posted as ${notice.kind || 'GENERAL'}.`,
          columns: ['Field', 'Value'],
          rows: [
            ['Title', notice.title || title],
            ['Type', notice.kind || 'GENERAL'],
            ['From', String(notice.startDateTime || '') || '-'],
            ['To', String(notice.endDateTime || '') || '-'],
            ['Institute-wide Closure', notice.closureAllHalls ? 'Yes' : 'No'],
            ['Rooms', Array.isArray(notice.rooms) && notice.rooms.length > 0 ? notice.rooms.join(', ') : '-']
          ]
        }
      });
    }

    if (actionType === 'GET_NOTICE') {
      const query = clipText(payload.query || payload.title || payload.notice || '', 240);
      if (!query) {
        return res.json({ status: 'ERROR', msg: 'Please specify which notice you want to open or download.' });
      }

      const matches = await listNotices({ search: query, limit: 5 });
      if (!matches.length) {
        return res.json({ status: 'ERROR', msg: `No notice matched "${query}".` });
      }

      const notice = matches[0];
      return res.json({
        status: 'INFO',
        data: {
          kind: 'NOTICE_RESULT',
          noticeId: String(notice._id),
          title: notice.title || 'Notice',
          content: notice.content || notice.body || notice.summary || '',
          summary: matches.length > 1
            ? `Showing the best match out of ${matches.length} notice results for "${query}".`
            : `Showing the matching notice for "${query}".`,
          columns: ['Field', 'Value'],
          rows: [
            ['Title', notice.title || 'Notice'],
            ['Type', notice.kind || 'GENERAL'],
            ['From', String(notice.startDateTime || '') || '-'],
            ['To', String(notice.endDateTime || '') || '-'],
            ['Institute-wide Closure', notice.closureAllHalls ? 'Yes' : 'No'],
            ['Rooms', Array.isArray(notice.rooms) && notice.rooms.length > 0 ? notice.rooms.join(', ') : '-'],
            ['Content', notice.content || notice.body || notice.summary || '-']
          ]
        }
      });
    }

    if (actionType === 'SEND_EMAIL') {
      if (!['Admin', 'Department'].includes(String(user.type || ''))) {
        return res.json({ status: 'ERROR', msg: 'Sending email via AI requires admin or faculty login.' });
      }

      const to = String(payload.to || payload.email || '').trim();
      const subject = clipText(payload.subject || 'BIT Booking AI Message', 200);
      const text = String(payload.content || payload.body || payload.text || '').trim();

      if (!isValidEmail(to)) {
        return res.json({ status: 'ERROR', msg: 'A valid recipient email address is required.' });
      }
      if (!text) {
        return res.json({ status: 'ERROR', msg: 'Email content is required.' });
      }

      await sendGenericEmail({
        to,
        subject,
        text,
        replyTo: user.email || ''
      });

      return res.json({
        status: 'INFO',
        data: {
          kind: 'EMAIL_RESULT',
          title: 'Email Sent',
          summary: `Email sent to ${to}.`,
          columns: ['Field', 'Value'],
          rows: [
            ['To', to],
            ['Subject', subject],
            ['Reply-To', user.email || '-'],
            ['Content', text]
          ]
        }
      });
    }

    if (actionType === 'VACATE_HALL') {
      if (user.type !== 'Admin') {
        return res.json({ status: 'ERROR', msg: 'Vacating booked halls via AI is admin-only.' });
      }

      const targetHall = String(payload.targetHall || payload.hall || '').trim();
      if (!targetHall) {
        return res.json({ status: 'ERROR', msg: 'Please specify which hall should be vacated.' });
      }

      const hallDoc = await findHallByNameLoose(targetHall);
      if (!hallDoc) {
        return res.json({
          status: 'ERROR',
          msg: `Sorry, but there is no such hall named ${targetHall}. So, I can't vacate the hall.`
        });
      }

      const dateRange = parseOptionalDateRange(payload.date);
      if (payload.date && !dateRange) {
        return res.json({ status: 'ERROR', msg: 'Invalid date format for hall vacation. Use YYYY-MM-DD.' });
      }

      const now = new Date();
      const matchingBookings = (hallDoc.bookings || []).filter((booking) => {
        if (dateRange) {
          return overlaps(booking.startDateTime, booking.endDateTime, dateRange.start, dateRange.end);
        }
        return new Date(booking.startDateTime) <= now && new Date(booking.endDateTime) > now;
      });

      if (matchingBookings.length === 0) {
        return res.json({
          status: 'ERROR',
          msg: `Sorry, but ${hallDoc.name} is not booked on ${formatDateLabel(dateRange)}. So, I can't vacate the hall.`
        });
      }

      const matchingSubdocIds = matchingBookings
        .map((booking) => String(booking._id || '').trim())
        .filter(Boolean);
      const matchingRequestIds = matchingBookings
        .map((booking) => booking.bookingRequest)
        .filter(Boolean);

      if (matchingRequestIds.length > 0) {
        await pullHallBookingsByRequestIds({
          hallName: hallDoc.name,
          requestIds: matchingRequestIds
        });
      }

      if (matchingSubdocIds.length > 0) {
        await Hall.updateOne(
          { _id: hallDoc._id },
          {
            $pull: {
              bookings: {
                _id: { $in: matchingSubdocIds }
              }
            }
          }
        );
      }

      const refreshedHall = await Hall.findById(hallDoc._id);
      if (refreshedHall) {
        refreshedHall.status = refreshedHall.isFilledAt(new Date()) ? 'Filled' : 'Not Filled';
        if (!refreshedHall.isFilledAt(new Date())) {
          refreshedHall.department = null;
          refreshedHall.event = '';
        }
        await refreshedHall.save();
      }

      if (matchingRequestIds.length > 0) {
        await Booking_Requests.updateMany(
          { _id: { $in: matchingRequestIds } },
          { $set: { status: 'VACATED', approvalToken: null, tokenExpiry: null } }
        );
      }

      return res.json({
        status: 'DONE',
        message: `Vacated ${matchingBookings.length} booking(s) from ${hallDoc.name} for ${formatDateLabel(dateRange)}.`
      });
    }

    if (actionType === 'ADMIN_EXECUTE') {
      if (user.type !== 'Admin') {
        return res.json({ status: 'ERROR', msg: 'This AI action is admin-only.' });
      }

      const subAction = normalizeSubAction(payload.subAction);
      const targetHall = String(payload.targetHall || '').trim();
      const selectedRequestIds = Array.isArray(payload.requestIds)
        ? payload.requestIds.map((id) => String(id || '').trim()).filter(Boolean)
        : [];

      if (!subAction) {
        return res.json({ status: 'ERROR', msg: 'Admin action was not clear. Please try again.' });
      }

      if ((subAction === 'APPROVE_SPECIFIC' || subAction === 'REJECT_SPECIFIC') && !targetHall) {
        return res.json({
          status: 'ERROR',
          msg: 'Please specify which hall should be targeted for this action.'
        });
      }

      const pendingRequests = await Booking_Requests
        .find({ status: 'PENDING' })
        .populate('department')
        .sort({ createdAt: 1 });

      const scopedRequests = targetHall
        ? pendingRequests.filter((requestDoc) => requestDoc.hall.toLowerCase() === targetHall.toLowerCase())
        : pendingRequests;
      const executableRequests = selectedRequestIds.length > 0
        ? scopedRequests.filter((requestDoc) => selectedRequestIds.includes(String(requestDoc._id)))
        : scopedRequests;

      if (executableRequests.length === 0) {
        return res.json({
          status: 'DONE',
          message: targetHall
            ? `No pending requests found for ${targetHall}.`
            : 'No pending requests to process.'
        });
      }

      const stats = { approved: 0, rejected: 0, skipped: 0, failed: 0 };

      for (const requestDoc of executableRequests) {
        try {
          const conflictMeta = await classifyBookingRequestConflict(requestDoc, pendingRequests);
          const isSafe = conflictMeta.conflict === 'NON_CONFLICTING';
          const isConflicting = !isSafe;

          const shouldApprove =
            subAction === 'APPROVE_ALL' ||
            subAction === 'APPROVE_SPECIFIC' ||
            subAction === 'APPROVE_SELECTED' ||
            (subAction === 'APPROVE_SAFE' && isSafe);

          const shouldReject =
            subAction === 'REJECT_ALL' ||
            subAction === 'REJECT_SPECIFIC' ||
            subAction === 'REJECT_SELECTED' ||
            (subAction === 'REJECT_CONFLICTS' && isConflicting);

          if (shouldApprove) {
            const approvalResult = await approveRequest(requestDoc);
            if (approvalResult.approved) {
              stats.approved += 1;
            } else {
              stats.skipped += 1;
            }
            continue;
          }

          if (shouldReject) {
            await rejectRequest(requestDoc);
            stats.rejected += 1;
            continue;
          }

          stats.skipped += 1;
        } catch (err) {
          console.error('AI admin execute item error:', err);
          stats.failed += 1;
        }
      }

      return res.json({
        status: 'DONE',
        message: `I have processed the pending requests. Approved: ${stats.approved}, rejected: ${stats.rejected}, skipped: ${stats.skipped}, failed: ${stats.failed}.`
      });
    }

    if (actionType === 'LIST_BOOKING_REQUESTS') {
      if (!['Admin', 'Department'].includes(String(user.type || ''))) {
        return res.json({ status: 'ERROR', msg: 'Viewing booking request lists requires admin or faculty login.' });
      }

      const filter = normalizeConflictFilter(payload.filter);
      const targetHall = String(payload.targetHall || '').trim();
      const dateRange = parseDateWindow(payload);

      const pendingRequests = await Booking_Requests
        .find({ status: 'PENDING' })
        .populate('department')
        .sort({ startDateTime: 1, createdAt: 1 });

      let scoped = targetHall
        ? pendingRequests.filter((requestDoc) => requestDoc.hall.toLowerCase() === targetHall.toLowerCase())
        : pendingRequests;

      if (dateRange) {
        scoped = scoped.filter((requestDoc) =>
          overlaps(requestDoc.startDateTime, requestDoc.endDateTime, dateRange.start, dateRange.end)
        );
      }

      if (scoped.length === 0) {
        return res.json({
          status: 'INFO',
          data: {
            kind: 'BOOKING_REQUESTS',
            filter,
            targetHall: targetHall || null,
            date: dateRange ? dateRange.date : null,
            dateFrom: dateRange ? dateRange.dateFrom || null : null,
            dateTo: dateRange ? dateRange.dateTo || null : null,
            summary: { total: 0, conflicting: 0, nonConflicting: 0, timeConflicts: 0, dateConflicts: 0, closureConflicts: 0 },
            items: []
          }
        });
      }

      const items = [];
      for (const requestDoc of scoped) {
        const conflictMeta = await classifyBookingRequestConflict(requestDoc, pendingRequests);
        const conflict = conflictMeta.conflict;
        const conflictType = conflictMeta.conflictType;

        items.push({
          id: String(requestDoc._id),
          hall: requestDoc.hall,
          event: requestDoc.event,
          date: requestDoc.startDate || (new Date(requestDoc.startDateTime).toISOString().slice(0, 10)),
          start: requestDoc.startTime12 || to12(new Date(requestDoc.startDateTime).toTimeString().slice(0, 5)),
          end: requestDoc.endTime12 || to12(new Date(requestDoc.endDateTime).toTimeString().slice(0, 5)),
          requestedBy: requestDoc.department?.head || requestDoc.department?.department || 'Unknown',
          requestedEmail: requestDoc.department?.email || 'N/A',
          requestedPhone: requestDoc.department?.phone || '',
          department: requestDoc.department?.department || '',
          conflict,
          conflictType,
          conflictDetail: conflictMeta.detail || ''
        });
      }

      const summary = {
        total: items.length,
        conflicting: items.filter((item) => item.conflict === 'CONFLICTING').length,
        nonConflicting: items.filter((item) => item.conflict === 'NON_CONFLICTING').length,
        timeConflicts: items.filter((item) => ['TIME_CONFLICT', 'APPROVED_BOOKING_CONFLICT'].includes(item.conflictType)).length,
        dateConflicts: items.filter((item) => item.conflictType === 'DATE_CONFLICT').length,
        closureConflicts: items.filter((item) => item.conflictType === 'NOTICE_CLOSURE').length
      };

      const filteredItems = filter === 'CONFLICTING'
        ? items.filter((item) => item.conflict === 'CONFLICTING')
        : filter === 'NON_CONFLICTING'
          ? items.filter((item) => item.conflict === 'NON_CONFLICTING')
          : items;

      return res.json({
        status: 'INFO',
        data: {
          kind: 'BOOKING_REQUESTS',
          filter,
          targetHall: targetHall || null,
          date: dateRange ? dateRange.date : null,
          dateFrom: dateRange ? dateRange.dateFrom || null : null,
          dateTo: dateRange ? dateRange.dateTo || null : null,
          summary,
          items: filteredItems
        }
      });
    }

    if (actionType === 'SHOW_HALL_STATUS') {
      const mode = normalizeHallStatusMode(payload.mode);
      const targetHall = String(payload.targetHall || '').trim();
      const dateRange = parseDateWindow(payload);
      const halls = targetHall ? await Hall.find({ name: targetHall }) : await Hall.find();
      const activeRange = dateRange || parseDateRange(getTodayISTDate());

      const items = [];
      for (const hall of halls) {
        const bookings = (hall.bookings || []).filter((booking) =>
          overlaps(booking.startDateTime, booking.endDateTime, activeRange.start, activeRange.end)
        );
        const sortedBookings = [...bookings].sort(
          (a, b) => new Date(a.startDateTime).getTime() - new Date(b.startDateTime).getTime()
        );
        const bookingTimeRanges = sortedBookings.map((booking) =>
          formatTimeRange(booking.startDateTime, booking.endDateTime)
        );
        const bookingEvents = sortedBookings
          .map((booking) => String(booking?.event || '').trim() || 'Booked')
          .filter(Boolean);
        const closures = await getNoticeClosures({
          hallName: hall.name,
          startDateTime: activeRange.start,
          endDateTime: activeRange.end
        });

        const isClosed = closures.length > 0;
        const isFilled = bookings.length > 0;
        const status = isClosed ? 'CLOSED' : isFilled ? 'FILLED' : 'AVAILABLE';
        const bookingLabel = bookingEvents.length === 0
          ? 'None'
          : bookingEvents.length <= 2
            ? bookingEvents.join(', ')
            : `${bookingEvents.slice(0, 2).join(', ')} (+${bookingEvents.length - 2} more)`;
        const bookingTimingsText = bookingTimeRanges.length > 0 ? bookingTimeRanges.join(', ') : 'None';
        const closureLabel = closures.length <= 1
          ? (closures[0]?.title || closures[0]?.holidayName || 'None')
          : `${closures.length} closures in selected range`;

        items.push({
          hall: hall.name,
          status,
          bookingStatus: isFilled ? 'BOOKED' : 'NOT_BOOKED',
          closureStatus: isClosed ? 'CLOSED' : 'OPEN',
          currentEvent: bookingLabel,
          bookingTimings: bookingTimeRanges,
          bookingTimingsText,
          closureReason: closureLabel
        });
      }

      const filteredItems = mode === 'AVAILABLE'
        ? items.filter((item) => item.status === 'AVAILABLE')
        : mode === 'FILLED'
          ? items.filter((item) => item.status === 'FILLED')
          : mode === 'OPEN'
            ? items.filter((item) => item.closureStatus === 'OPEN')
            : mode === 'CLOSED'
              ? items.filter((item) => item.closureStatus === 'CLOSED')
              : items;

      return res.json({
        status: 'INFO',
        data: {
          kind: 'HALL_STATUS',
          mode,
          date: activeRange ? activeRange.date : null,
          dateFrom: activeRange ? activeRange.dateFrom || null : null,
          dateTo: activeRange ? activeRange.dateTo || null : null,
          targetHall: targetHall || null,
          items: filteredItems
        }
      });
    }

    if (actionType === 'SEND_SLACK_MESSAGE') {
      if (!['ADMIN', 'DEVELOPER'].includes(normalizedUserRole)) {
        return res.json({ status: 'ERROR', msg: 'Slack notification via AI is allowed only for admin or developer users.' });
      }

      const text = String(payload.text || '').trim();
      const channel = String(payload.channel || '').trim();
      const threadTs = String(payload.threadTs || '').trim();

      if (!text) {
        return res.json({ status: 'ERROR', msg: 'Slack notification text is required.' });
      }

      await dispatchSlackNotification({
        text,
        channel,
        threadTs
      });

      return res.json({
        status: 'DONE',
        message: channel
          ? `Slack notification sent to ${channel}.`
          : 'Slack notification sent using the configured default destination.'
      });
    }

    if (actionType === 'SEND_WHATSAPP_MESSAGE') {
      if (!['ADMIN', 'DEVELOPER'].includes(normalizedUserRole)) {
        return res.json({ status: 'ERROR', msg: 'WhatsApp message via AI is allowed only for admin or developer users.' });
      }

      const to = String(payload.to || '').replace(/[^\d+]/g, '').trim();
      const text = String(payload.text || '').trim();
      const contextMessageId = String(payload.contextMessageId || '').trim();

      if (!to || !text) {
        return res.json({ status: 'ERROR', msg: 'Both recipient phone number and message text are required.' });
      }

      await sendWhatsAppTextMessage({
        to,
        text,
        contextMessageId
      });

      return res.json({
        status: 'DONE',
        message: `WhatsApp message sent to ${to}.`
      });
    }

    if (actionType === 'SYNC_CRM_RECORD') {
      if (!['ADMIN', 'DEVELOPER'].includes(normalizedUserRole)) {
        return res.json({ status: 'ERROR', msg: 'CRM sync via AI is allowed only for admin or developer users.' });
      }

      const mode = String(payload.mode || 'SUPPORT_THREAD').trim().toUpperCase();
      const summary = mode === 'BOOKING_EVENT'
        ? await syncBookingEventToCrm({
            bookingId: payload.bookingId || '',
            department: payload.department || '',
            email: payload.email || '',
            hall: payload.hall || '',
            event: payload.event || '',
            startDateTime: payload.startDateTime || '',
            endDateTime: payload.endDateTime || '',
            status: payload.status || ''
          })
        : await syncSupportThreadToCrm({
            kind: payload.kind || 'SUPPORT',
            title: payload.title || '',
            message: payload.message || '',
            email: payload.email || '',
            threadId: payload.threadId || req.body?.threadId || '',
            aiAnswer: payload.aiAnswer || '',
            source: payload.source || 'BIT-Booking3'
          });

      if (summary?.skipped) {
        return res.json({
          status: 'DONE',
          message: `CRM sync skipped: ${summary.reason || 'not_configured'}.`
        });
      }

      return res.json({
        status: 'DONE',
        message: mode === 'BOOKING_EVENT'
          ? 'CRM booking event synced successfully.'
          : 'CRM support thread synced successfully.'
      });
    }

    return res.json({ status: 'ERROR', msg: 'Action not recognized.' });
  } catch (err) {
    hadAiError = true;
    console.error('AI execute route error:', err);
    return res.status(500).json({ status: 'ERROR', msg: 'AI action execution failed.' });
  } finally {
    finalizeAi({ error: hadAiError });
  }
});

module.exports = router;
