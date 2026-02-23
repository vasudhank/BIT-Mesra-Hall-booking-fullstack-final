const express = require('express');
const router = express.Router();
const Hall = require('../models/hall');
const Booking_Requests = require('../models/booking_requests');
const { safeExecute } = require('../utils/safeNotify');
const { generateApprovalToken, getTokenExpiry } = require('../utils/token');

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

const overlaps = (startA, endA, startB, endB) =>
  new Date(startA).getTime() < new Date(endB).getTime() &&
  new Date(endA).getTime() > new Date(startB).getTime();

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
  try {
    if (!req.isAuthenticated()) {
      return res.json({ status: 'ERROR', msg: 'Please log in first to use booking actions.' });
    }

    const intent = req.body?.intent || {};
    const user = req.user;
    const actionType = String(intent.action || '').toUpperCase();
    const payload = intent.payload || {};

    if (!actionType) {
      return res.json({ status: 'ERROR', msg: 'AI action is missing.' });
    }

    if (actionType === 'BOOK_REQUEST') {
      if (user.type !== 'Department') {
        return res.json({ status: 'ERROR', msg: 'Booking requests via AI are allowed only for logged-in faculty/department accounts.' });
      }

      const requests = Array.isArray(payload.requests) ? payload.requests : [];
      if (requests.length === 0) {
        return res.json({ status: 'ERROR', msg: 'AI understood booking intent but required details are missing.' });
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

          const hallDoc = await Hall.findOne({ name: hall });
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

    return res.json({ status: 'ERROR', msg: 'Action not recognized.' });
  } catch (err) {
    console.error('AI execute route error:', err);
    return res.status(500).json({ status: 'ERROR', msg: 'AI action execution failed.' });
  }
});

module.exports = router;
