const express = require('express');
const router = express.Router();

const Booking_Requests = require('../models/booking_requests');
const Hall = require('../models/hall');
const Department = require('../models/department');
const { safeExecute } = require('../utils/safeNotify');
const {
  isTimeOverlap,
  reserveHallSlotAtomically,
  pullHallBookingsByRequestIds
} = require('../services/bookingMutationService');
require('dotenv').config();

const {
  sendBookingApprovalSMS,
  sendBookingAutoBookedSMS,
  sendDecisionSMSDepartment
} = require('../services/smsService');

const {
  sendBookingApprovalMail,
  sendBookingAutoBookedMail,
  sendDecisionToDepartment
} = require('../services/emailService');
const { runBookingCleanup } = require('../services/bookingCleanupService');
const { getNoticeConflictsForRange } = require('../services/noticeService');

const { generateApprovalToken, getTokenExpiry } = require('../utils/token');

const serializeBookingConflicts = async (bookings) => {
  const deptIds = Array.from(
    new Set(
      (bookings || [])
        .map((b) => (b.department ? String(b.department) : ''))
        .filter(Boolean)
    )
  );
  const departments = deptIds.length
    ? await Department.find({ _id: { $in: deptIds } }).select('head department email').lean()
    : [];
  const deptMap = new Map(departments.map((d) => [String(d._id), d]));

  return (bookings || []).map((booking) => {
    const dept = booking.department ? deptMap.get(String(booking.department)) : null;
    return {
      bookingRequestId: booking.bookingRequest || null,
      event: booking.event || 'Booked',
      startDateTime: booking.startDateTime,
      endDateTime: booking.endDateTime,
      requestedBy: dept?.head || dept?.department || dept?.email || ''
    };
  });
};

const normalizeDecision = (decision) => String(decision || '').trim().toUpperCase();

const isApproveDecision = (decision) =>
  ['YES', 'Y', 'APPROVE', 'ACCEPT', 'APPROVED'].includes(decision);

const isRejectDecision = (decision) =>
  ['NO', 'N', 'REJECT', 'REJECTED', 'DECLINE'].includes(decision);

const isVacateDecision = (decision) =>
  ['VACATE', 'REVOKE', 'REMOVE', 'CLEAR'].includes(decision);

const isLeaveDecision = (decision) =>
  ['LEAVE', 'KEEP'].includes(decision);

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

  const hasDepartment = Boolean(requestDoc?.department);
  if (hasDepartment) {
    safeExecute(
      () => sendDecisionSMSDepartment({
        booking: requestDoc,
        decision
      }),
      'DEPARTMENT SMS'
    );
  }
};

router.get('/', (req, res) => {
  res.send({ msg: 'Inside Booking Route' });
});

router.get('/show_booking_requests', async (req, res) => {
  try {
    if (!(req.isAuthenticated && req.isAuthenticated() && req.user.type === 'Admin')) {
      return res.status(403).json({ msg: 'You are not authorized' });
    }

    await runBookingCleanup();
    const now = new Date();

    const requests = await Booking_Requests
      .find({
        $or: [
          { status: 'PENDING', startDateTime: { $gt: now } },
          { status: 'AUTO_BOOKED', endDateTime: { $gt: now } }
        ]
      })
      .populate({ path: 'department', select: 'department head email' })
      .sort({ createdAt: -1 });

    return res.status(200).json({ booking_requests: requests });
  } catch (err) {
    console.error('show_booking_requests error:', err);
    return res.status(500).json({ error: err.message });
  }
});

router.post('/create_booking', async (req, res) => {
  try {
    if (!(req.isAuthenticated && req.isAuthenticated() && req.user.type === 'Department')) {
      return res.status(403).json({ msg: 'Not Authorized to Make booking requests' });
    }

    await runBookingCleanup();

    const {
      hall,
      event,
      description,
      startDate,
      endDate,
      startTime12,
      endTime12,
      startTime24,
      endTime24,
      startDateTime,
      endDateTime,
      force
    } = req.body;

    if (!hall || !event || !startDateTime || !endDateTime) {
      return res.status(400).json({ msg: 'hall, event, startDateTime and endDateTime are required' });
    }

    const startDT = new Date(startDateTime);
    const endDT = new Date(endDateTime);
    if (Number.isNaN(startDT.getTime()) || Number.isNaN(endDT.getTime())) {
      return res.status(400).json({ msg: 'Invalid date/time format' });
    }
    const now = new Date();
    if (startDT <= now) {
      return res.status(400).json({ msg: 'Cannot create booking for a date/time that has already passed' });
    }

    if (endDT <= startDT) {
      return res.status(400).json({ msg: 'endDateTime must be after startDateTime' });
    }

    const hallDoc = await Hall.findOne({ name: hall });
    if (!hallDoc) {
      return res.status(404).json({ msg: 'Hall not found' });
    }

    const conflictBookings = (hallDoc.bookings || []).filter((booking) =>
      isTimeOverlap(startDT, endDT, booking.startDateTime, booking.endDateTime)
    );

    const noticeConflicts = await getNoticeConflictsForRange({
      hallName: hallDoc.name,
      startDateTime: startDT,
      endDateTime: endDT
    });

    const hasBookingConflict = conflictBookings.length > 0;
    const hasNoticeConflict = noticeConflicts.length > 0;
    const hasConflict = hasBookingConflict || hasNoticeConflict;
    const serializedBookingConflicts = hasBookingConflict
      ? await serializeBookingConflicts(conflictBookings)
      : [];

    if (hasConflict && !Boolean(force)) {
      return res.status(409).json({
        canForce: true,
        message: 'This hall has a scheduling conflict for the selected time range.',
        conflicts: {
          hall: hallDoc.name,
          bookings: serializedBookingConflicts,
          notices: noticeConflicts
        }
      });
    }

    const approvalToken = generateApprovalToken();
    const tokenExpiry = getTokenExpiry(15);

    let shouldAutoBook = !hasConflict;
    const newRequest = new Booking_Requests({
      hall: hallDoc.name,
      department: req.user.id,
      event,
      description,
      startDateTime: startDT,
      endDateTime: endDT,
      startTime12,
      endTime12,
      startTime24,
      endTime24,
      startDate,
      endDate,
      approvalToken,
      tokenExpiry,
      status: shouldAutoBook ? 'AUTO_BOOKED' : 'PENDING',
      forceRequested: Boolean(force && hasConflict),
      conflictDetails: hasConflict
        ? {
            bookings: serializedBookingConflicts,
            notices: noticeConflicts
          }
        : {}
    });

    let reservationCreated = false;
    if (shouldAutoBook) {
      const reservationResult = await reserveHallSlotAtomically({
        hallName: hallDoc.name,
        bookingRequestId: newRequest._id,
        departmentId: req.user.id,
        event,
        startDateTime: startDT,
        endDateTime: endDT
      });

      if (!reservationResult.reserved) {
        shouldAutoBook = false;
        newRequest.status = 'PENDING';
        newRequest.forceRequested = false;
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
    } catch (saveError) {
      if (reservationCreated) {
        await pullHallBookingsByRequestIds({
          hallName: hallDoc.name,
          requestIds: [newRequest._id]
        });
      }
      throw saveError;
    }
    const approvalBaseUrl = `${process.env.PUBLIC_BASE_URL}/api/approval`;

    if (shouldAutoBook) {
      safeExecute(
        () => sendBookingAutoBookedMail({
          adminEmail: process.env.EMAIL,
          booking: saved,
          vacateUrl: `${approvalBaseUrl}/vacate/${approvalToken}`,
          leaveUrl: `${approvalBaseUrl}/leave/${approvalToken}`
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
          email: req.user.email,
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

      return res.status(201).json({
        message: 'Hall auto-booked (no conflict). Admin notified with vacate/leave actions.',
        bookingRequest: saved
      });
    }

    const overlappingRequestIds = conflictBookings
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
        approveUrl: `${approvalBaseUrl}/approve/${approvalToken}`,
        rejectUrl: `${approvalBaseUrl}/reject/${approvalToken}`
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

    return res.status(201).json({
      message: 'Conflict found (existing booking and/or closure notice). Booking request sent to admin for accept/reject.',
      bookingRequest: saved
    });
  } catch (err) {
    console.error('create_booking error:', err);
    return res.status(500).json({ msg: 'Server error' });
  }
});

router.post('/change_booking_request', async (req, res) => {
  try {
    if (!(req.isAuthenticated && req.isAuthenticated() && req.user.type === 'Admin')) {
      return res.status(403).json({ msg: 'You are not authorized' });
    }

    const { decision, id } = req.body;
    const requestDoc = await Booking_Requests.findById(id).populate('department');
    if (!requestDoc) {
      return res.status(404).json({ msg: 'Booking request not found' });
    }

    const parsedDecision = normalizeDecision(decision);

    if (requestDoc.status === 'PENDING') {
      if (isRejectDecision(parsedDecision)) {
        requestDoc.status = 'REJECTED';
        requestDoc.approvalToken = null;
        requestDoc.tokenExpiry = null;
        await requestDoc.save();
        notifyDepartmentDecision(requestDoc, 'REJECTED');

        return res.status(200).json({ status: 'Rejected' });
      }

      if (isApproveDecision(parsedDecision)) {
        const reservationResult = await reserveHallSlotAtomically({
          hallName: requestDoc.hall,
          bookingRequestId: requestDoc._id,
          departmentId: requestDoc.department?._id || requestDoc.department || null,
          event: requestDoc.event,
          startDateTime: requestDoc.startDateTime,
          endDateTime: requestDoc.endDateTime
        });

        if (!reservationResult.reserved && reservationResult.reason === 'HALL_NOT_FOUND') {
          return res.status(404).json({ msg: `Hall not found: ${requestDoc.hall}` });
        }

        if (!reservationResult.reserved) {
          return res.status(409).json({
            msg: 'Cannot approve because the hall is already booked for this time range.'
          });
        }

        requestDoc.status = 'APPROVED';
        requestDoc.approvalToken = null;
        requestDoc.tokenExpiry = null;
        await requestDoc.save();
        notifyDepartmentDecision(requestDoc, 'APPROVED');

        return res.status(200).json({ status: 'Approved' });
      }

      return res.status(400).json({ msg: 'Invalid decision for a pending request.' });
    }

    if (requestDoc.status === 'AUTO_BOOKED') {
      if (isVacateDecision(parsedDecision)) {
        await pullHallBookingsByRequestIds({
          hallName: requestDoc.hall,
          requestIds: [requestDoc._id]
        });

        requestDoc.status = 'VACATED';
        requestDoc.approvalToken = null;
        requestDoc.tokenExpiry = null;
        await requestDoc.save();
        notifyDepartmentDecision(requestDoc, 'VACATED');

        return res.status(200).json({ status: 'Vacated' });
      }

      if (isLeaveDecision(parsedDecision)) {
        requestDoc.status = 'LEFT';
        requestDoc.approvalToken = null;
        requestDoc.tokenExpiry = null;
        await requestDoc.save();
        return res.status(200).json({ status: 'Left' });
      }

      return res.status(400).json({ msg: 'Invalid decision for an auto-booked request.' });
    }

    return res.status(409).json({
      msg: `This request is already processed (status: ${requestDoc.status}).`
    });
  } catch (err) {
    console.error('change_booking_request error:', err);
    return res.status(500).json({ error: err.message });
  }
});

router.get('/hall_status', async (req, res) => {
  await runBookingCleanup();
  const halls = await Hall.find();
  const now = new Date();

  const result = halls.map((hall) => ({
    hall: hall.name,
    status: hall.isFilledAt(now) ? 'BOOKED' : 'FREE'
  }));

  res.json(result);
});

module.exports = router;
