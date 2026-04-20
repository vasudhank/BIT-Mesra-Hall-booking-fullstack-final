const express = require('express');
const router = express.Router();
const Hall = require('../models/hall');
const Booking_Requests = require('../models/booking_requests');
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
  sendDecisionToDepartment
} = require('../services/emailService');

const {
  sendBookingApprovalSMS,
  sendBookingAutoBookedSMS,
  sendDecisionSMSDepartment
} = require('../services/smsService');

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
  if (raw.includes('NOT') && (raw.includes('BOOK') || raw.includes('OCCUP') || raw.includes('FILL') || raw.includes('BUSY'))) return 'AVAILABLE';
  if (raw.includes('UNBOOK') || raw.includes('EMPTY')) return 'AVAILABLE';
  if (raw.includes('UNAVAILABLE') || (raw.includes('NOT') && (raw.includes('FREE') || raw.includes('AVAILABLE') || raw.includes('VACANT')))) return 'FILLED';
  if (raw === 'ALL' || raw === 'AVAILABLE' || raw === 'FILLED') return raw;

  if (raw.includes('FREE') || raw.includes('VACANT') || raw.includes('AVAILABLE')) return 'AVAILABLE';
  if (raw.includes('BOOKED') || raw.includes('OCCUPIED') || raw.includes('FILLED')) return 'FILLED';
  return 'ALL';
};

const parseDateRange = (dateText) => {
  const raw = String(dateText || '').trim();
  if (!raw) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;

  const start = new Date(`${raw}T00:00:00.000`);
  const end = new Date(`${raw}T23:59:59.999`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;

  return { date: raw, start, end };
};

const parseOptionalDateRange = (dateText) => {
  const raw = String(dateText || '').trim();
  if (!raw) return null;
  return parseDateRange(raw);
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
  const startA = new Date(requestDoc.startDateTime).getTime();
  const endA = new Date(requestDoc.endDateTime).getTime();

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

  for (const other of allPending) {
    if (!other || !other._id || requestDoc._id.equals(other._id)) continue;
    if (other.status !== 'PENDING') continue;
    if (String(other.hall).toLowerCase() !== String(requestDoc.hall).toLowerCase()) continue;

    const startB = new Date(other.startDateTime).getTime();
    const endB = new Date(other.endDateTime).getTime();
    if (startA < endB && endA > startB) return 'TIME_CONFLICT';
  }

  return 'SAFE';
};

const approveRequest = async (requestDoc) => {
  await Hall.findOneAndUpdate(
    { name: requestDoc.hall },
    {
      $push: {
        bookings: {
          bookingRequest: requestDoc._id,
          department: requestDoc.department._id || requestDoc.department,
          event: requestDoc.event,
          startDateTime: requestDoc.startDateTime,
          endDateTime: requestDoc.endDateTime
        }
      }
    }
  );

  requestDoc.status = 'APPROVED';
  await requestDoc.save();

  safeExecute(
    () => sendDecisionToDepartment({
      email: requestDoc.department.email,
      booking: requestDoc,
      decision: 'APPROVED'
    }),
    'DEPARTMENT EMAIL'
  );

  safeExecute(
    () => sendDecisionSMSDepartment({
      booking: requestDoc,
      decision: 'APPROVED'
    }),
    'DEPARTMENT SMS'
  );
};

const rejectRequest = async (requestDoc) => {
  requestDoc.status = 'REJECTED';
  await requestDoc.save();

  safeExecute(
    () => sendDecisionToDepartment({
      email: requestDoc.department.email,
      booking: requestDoc,
      decision: 'REJECTED'
    }),
    'DEPARTMENT EMAIL'
  );

  safeExecute(
    () => sendDecisionSMSDepartment({
      booking: requestDoc,
      decision: 'REJECTED'
    }),
    'DEPARTMENT SMS'
  );
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

            const hasConflict = (hallDoc.bookings || []).some((booking) =>
              overlaps(startDateTime, endDateTime, booking.startDateTime, booking.endDateTime)
            );
            if (hasConflict) {
              failMessages.push(`${hallDoc.name} is already booked for the requested time range.`);
              continue;
            }

            hallDoc.bookings.push({
              bookingRequest: null,
              department: null,
              event,
              startDateTime,
              endDateTime
            });
            hallDoc.status = hallDoc.isFilledAt(new Date()) ? 'Filled' : 'Not Filled';
            await hallDoc.save();
            successCount += 1;
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
          message: `Admin booked ${successCount} hall slot(s) directly.${suffix}`
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
          const hasConflict = overlappingBookings.length > 0;

          const approvalToken = generateApprovalToken();
          const tokenExpiry = getTokenExpiry(15);

          const newRequest = new Booking_Requests({
            hall,
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
            status: hasConflict ? 'PENDING' : 'AUTO_BOOKED'
          });

          const saved = await newRequest.save();
          const baseUrl = `${process.env.PUBLIC_BASE_URL}/api/approval`;

          if (hasConflict) {
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
            hallDoc.bookings.push({
              bookingRequest: saved._id,
              department: user.id,
              event,
              startDateTime,
              endDateTime
            });
            hallDoc.status = hallDoc.isFilledAt(new Date()) ? 'Filled' : 'Not Filled';
            await hallDoc.save();

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
        message: `Created ${successCount} booking request(s). Auto-booked: ${autoBookedCount}, pending admin approval: ${pendingApprovalCount}.${suffix}`
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

      const matchingSubdocIds = new Set(matchingBookings.map((booking) => String(booking._id || '')));
      const matchingRequestIds = matchingBookings
        .map((booking) => booking.bookingRequest)
        .filter(Boolean);

      hallDoc.bookings = (hallDoc.bookings || []).filter((booking) => {
        const subdocId = String(booking._id || '');
        return !matchingSubdocIds.has(subdocId);
      });
      hallDoc.status = hallDoc.isFilledAt(new Date()) ? 'Filled' : 'Not Filled';
      hallDoc.department = null;
      hallDoc.event = '';
      await hallDoc.save();

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

      if (scopedRequests.length === 0) {
        return res.json({
          status: 'DONE',
          message: targetHall
            ? `No pending requests found for ${targetHall}.`
            : 'No pending requests to process.'
        });
      }

      const stats = { approved: 0, rejected: 0, skipped: 0, failed: 0 };

      for (const requestDoc of scopedRequests) {
        try {
          const needsConflictCheck = subAction === 'APPROVE_SAFE' || subAction === 'REJECT_CONFLICTS';
          const conflictStatus = needsConflictCheck
            ? await analyzeRequestConflict(requestDoc, scopedRequests)
            : 'SAFE';

          const shouldApprove =
            subAction === 'APPROVE_ALL' ||
            subAction === 'APPROVE_SPECIFIC' ||
            (subAction === 'APPROVE_SAFE' && conflictStatus === 'SAFE');

          const shouldReject =
            subAction === 'REJECT_ALL' ||
            subAction === 'REJECT_SPECIFIC' ||
            (subAction === 'REJECT_CONFLICTS' && conflictStatus === 'TIME_CONFLICT');

          if (shouldApprove) {
            await approveRequest(requestDoc);
            stats.approved += 1;
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
        message: `Processed pending requests. Approved: ${stats.approved}, Rejected: ${stats.rejected}, Skipped: ${stats.skipped}, Failed: ${stats.failed}.`
      });
    }

    if (actionType === 'LIST_BOOKING_REQUESTS') {
      if (user.type !== 'Admin') {
        return res.json({ status: 'ERROR', msg: 'This AI action is admin-only.' });
      }

      const filter = normalizeConflictFilter(payload.filter);
      const targetHall = String(payload.targetHall || '').trim();
      const dateRange = parseDateRange(payload.date);

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
            summary: { total: 0, conflicting: 0, nonConflicting: 0 },
            items: []
          }
        });
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
          start: requestDoc.startTime12 || to12(new Date(requestDoc.startDateTime).toTimeString().slice(0, 5)),
          end: requestDoc.endTime12 || to12(new Date(requestDoc.endDateTime).toTimeString().slice(0, 5)),
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
          summary,
          items: filteredItems
        }
      });
    }

    if (actionType === 'SHOW_HALL_STATUS') {
      const mode = normalizeHallStatusMode(payload.mode);
      const targetHall = String(payload.targetHall || '').trim();
      const dateRange = parseDateRange(payload.date);
      const halls = targetHall ? await Hall.find({ name: targetHall }) : await Hall.find();
      const now = new Date();

      const items = halls.map((hall) => {
        if (dateRange) {
          const dayBookings = (hall.bookings || []).filter((booking) =>
            overlaps(booking.startDateTime, booking.endDateTime, dateRange.start, dateRange.end)
          );
          const status = dayBookings.length > 0 ? 'FILLED' : 'AVAILABLE';

          return {
            hall: hall.name,
            status,
            currentEvent: dayBookings[0]?.event || 'None'
          };
        }

        const currentBooking = (hall.bookings || []).find((booking) =>
          new Date(booking.startDateTime) <= now && new Date(booking.endDateTime) >= now
        );

        return {
          hall: hall.name,
          status: currentBooking ? 'FILLED' : 'AVAILABLE',
          currentEvent: currentBooking ? currentBooking.event : 'None'
        };
      });

      const filteredItems = mode === 'AVAILABLE'
        ? items.filter((item) => item.status === 'AVAILABLE')
        : mode === 'FILLED'
          ? items.filter((item) => item.status === 'FILLED')
          : items;

      return res.json({
        status: 'INFO',
        data: {
          kind: 'HALL_STATUS',
          mode,
          date: dateRange ? dateRange.date : null,
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
