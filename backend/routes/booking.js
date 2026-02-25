const express = require('express');
const router = express.Router();

const Booking_Requests = require('../models/booking_requests');
const Hall = require('../models/hall');
const { safeExecute } = require('../utils/safeNotify');
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

const { generateApprovalToken, getTokenExpiry } = require('../utils/token');

const isTimeOverlap = (startA, endA, startB, endB) =>
  new Date(startA).getTime() < new Date(endB).getTime() &&
  new Date(endA).getTime() > new Date(startB).getTime();

const buildHallBooking = (requestDoc, departmentId) => ({
  bookingRequest: requestDoc._id,
  department: departmentId,
  event: requestDoc.event,
  startDateTime: requestDoc.startDateTime,
  endDateTime: requestDoc.endDateTime
});

const normalizeDecision = (decision) => String(decision || '').trim().toUpperCase();

const isApproveDecision = (decision) =>
  ['YES', 'Y', 'APPROVE', 'ACCEPT', 'APPROVED'].includes(decision);

const isRejectDecision = (decision) =>
  ['NO', 'N', 'REJECT', 'REJECTED', 'DECLINE'].includes(decision);

const isVacateDecision = (decision) =>
  ['VACATE', 'REVOKE', 'REMOVE', 'CLEAR'].includes(decision);

const isLeaveDecision = (decision) =>
  ['LEAVE', 'KEEP'].includes(decision);

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
      endDateTime
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
    const hasConflict = conflictBookings.length > 0;

    const approvalToken = generateApprovalToken();
    const tokenExpiry = getTokenExpiry(15);

    const newRequest = new Booking_Requests({
      hall,
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
      status: hasConflict ? 'PENDING' : 'AUTO_BOOKED'
    });

    const saved = await newRequest.save();
    const approvalBaseUrl = `${process.env.PUBLIC_BASE_URL}/api/approval`;

    if (!hasConflict) {
      hallDoc.bookings.push(buildHallBooking(saved, req.user.id));
      hallDoc.status = hallDoc.isFilledAt(new Date()) ? 'Filled' : 'Not Filled';
      await hallDoc.save();

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
      message: 'Time conflict found. Booking request sent to admin for accept/reject.',
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

        return res.status(200).json({ status: 'Rejected' });
      }

      if (isApproveDecision(parsedDecision)) {
        const hallDoc = await Hall.findOne({ name: requestDoc.hall });
        if (!hallDoc) {
          return res.status(404).json({ msg: `Hall not found: ${requestDoc.hall}` });
        }

        const hasOverlap = (hallDoc.bookings || []).some((booking) =>
          isTimeOverlap(
            requestDoc.startDateTime,
            requestDoc.endDateTime,
            booking.startDateTime,
            booking.endDateTime
          )
        );

        if (hasOverlap) {
          return res.status(409).json({
            msg: 'Cannot approve because the hall is already booked for this time range.'
          });
        }

        hallDoc.bookings.push(buildHallBooking(requestDoc, requestDoc.department._id));
        hallDoc.status = hallDoc.isFilledAt(new Date()) ? 'Filled' : 'Not Filled';
        await hallDoc.save();

        requestDoc.status = 'APPROVED';
        requestDoc.approvalToken = null;
        requestDoc.tokenExpiry = null;
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

        return res.status(200).json({ status: 'Approved' });
      }

      return res.status(400).json({ msg: 'Invalid decision for a pending request.' });
    }

    if (requestDoc.status === 'AUTO_BOOKED') {
      if (isVacateDecision(parsedDecision)) {
        await Hall.findOneAndUpdate(
          { name: requestDoc.hall },
          { $pull: { bookings: { bookingRequest: requestDoc._id } } }
        );

        requestDoc.status = 'VACATED';
        requestDoc.approvalToken = null;
        requestDoc.tokenExpiry = null;
        await requestDoc.save();

        safeExecute(
          () => sendDecisionToDepartment({
            email: requestDoc.department.email,
            booking: requestDoc,
            decision: 'VACATED'
          }),
          'DEPARTMENT EMAIL'
        );

        safeExecute(
          () => sendDecisionSMSDepartment({
            booking: requestDoc,
            decision: 'VACATED'
          }),
          'DEPARTMENT SMS'
        );

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
