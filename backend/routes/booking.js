// backend/routes/booking.js
const express = require('express');
const router = express.Router();

const Booking_Requests = require('../models/booking_requests');
const Hall = require('../models/hall');
const { safeExecute } = require('../utils/safeNotify');
require('dotenv').config();

// SMS services
const {
  sendBookingApprovalSMS,
  sendDecisionSMSDepartment
} = require('../services/smsService');

// Email services
const {
  sendBookingApprovalMail,
  sendDecisionToDepartment
} = require('../services/emailService');

// Token utils
const { generateApprovalToken, getTokenExpiry } = require('../utils/token');

/* ================= ROOT CHECK ================= */
router.get('/', (req, res) => {
  res.send({ msg: 'Inside Booking Route' });
});

/* =================================================
   🔹 SHOW ALL BOOKING REQUESTS (ADMIN ONLY)
   🔹 THIS WAS MISSING → CAUSED 404
   ================================================= */
router.get('/show_booking_requests', async (req, res) => {
  try {
    if (!(req.isAuthenticated && req.isAuthenticated() && req.user.type === 'Admin')) {
      return res.status(403).json({ msg: 'You are not authorized' });
    }

    const requests = await Booking_Requests
      .find({ status: 'PENDING' })   // only pending requests
      .populate('department')
      .sort({ createdAt: -1 });

    return res.status(200).json({ booking_requests: requests });
  } catch (err) {
    console.error('show_booking_requests error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/* =========================================
   CREATE BOOKING REQUEST BY DEPARTMENT
   ========================================= */
router.post('/create_booking', async (req, res) => {
  try {
    if (!(req.isAuthenticated && req.isAuthenticated() && req.user.type === 'Department')) {
      return res.status(403).json({ msg: 'Not Authorized to Make booking requests' });
    }

    const {
      hall,
      event,
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

    if (endDT <= startDT) {
      return res.status(400).json({ msg: 'endDateTime must be after startDateTime' });
    }

    const existingOverlap = await Hall.findOne({
      name: hall,
      bookings: {
        $elemMatch: {
          startDateTime: { $lt: endDT },
          endDateTime: { $gt: startDT }
        }
      }
    });

    if (existingOverlap) {
      return res.status(409).json({ msg: 'Requested time overlaps an existing accepted booking' });
    }

    const approvalToken = generateApprovalToken();
    const tokenExpiry = getTokenExpiry(15);

    const newRequest = new Booking_Requests({
      hall,
      department: req.user.id,
      event,
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
      status: 'PENDING'
    });

    const saved = await newRequest.save();
    const baseUrl = `${process.env.PUBLIC_BASE_URL}/api/approval`;

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

    return res.status(201).json({
      message: 'Booking request created and sent for approval',
      bookingRequest: saved
    });

  } catch (err) {
    console.error('create_booking error:', err);
    return res.status(500).json({ msg: 'Server error' });
  }
});

/* =================================================
   ADMIN ACCEPT / REJECT BOOKING
   ================================================= */
router.post('/change_booking_request', async (req, res) => {
  try {
    if (!(req.isAuthenticated && req.isAuthenticated() && req.user.type === 'Admin')) {
      return res.status(403).json({ msg: 'You are not authorized' });
    }

    const { decision, id, name } = req.body;
    const requestDoc = await Booking_Requests.findById(id).populate('department');

    if (!requestDoc) {
      return res.status(404).json({ msg: 'Booking request not found' });
    }

    /* ---------- REJECT ---------- */
    if (decision !== 'Yes') {
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

      return res.status(200).json({ status: 'Rejected' });
    }

    /* ---------- APPROVE ---------- */
    const bookingObj = {
      bookingRequest: requestDoc._id,
      department: requestDoc.department._id,
      event: requestDoc.event,
      startDateTime: requestDoc.startDateTime,
      endDateTime: requestDoc.endDateTime
    };

    await Hall.findOneAndUpdate(
      { name },
      { $push: { bookings: bookingObj } }
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

    return res.status(200).json({ status: 'Approved' });

  } catch (err) {
    console.error('change_booking_request error:', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
