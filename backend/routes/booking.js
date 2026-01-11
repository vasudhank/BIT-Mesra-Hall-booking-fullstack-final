// backend/routes/booking.js
const express = require('express');
const router = express.Router();

const Booking_Requests = require('../models/booking_requests');
const Hall = require('../models/hall');
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

/* Root check */
router.get('/', (req, res) => {
  res.send({ msg: 'Inside Booking Route' });
});

/* =========================================
   CREATE BOOKING REQUEST BY DEPARTMENT
   ========================================= */
router.post('/create_booking', async (req, res) => {
  try {
    console.log('🔥 CREATE BOOKING ROUTE HIT');

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

    if (isNaN(startDT.getTime()) || isNaN(endDT.getTime())) {
      return res.status(400).json({ msg: 'Invalid startDateTime or endDateTime' });
    }

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
      startTime12: startTime12 || null,
      endTime12: endTime12 || null,
      startTime24: startTime24 || null,
      endTime24: endTime24 || null,
      startDate: startDate || null,
      endDate: endDate || null,
      createdBy: req.user.id,
      approvalToken,
      tokenExpiry,
      status: 'PENDING'
    });

    const saved = await newRequest.save();
    console.log('🔥 ABOUT TO SEND EMAIL + SMS');

    const baseUrl = `${process.env.PUBLIC_BASE_URL}/api/approval`;

    // 📧 Email to Admin
    await sendBookingApprovalMail({
      adminEmail: process.env.EMAIL,
      booking: saved,
      approveUrl: `${baseUrl}/approve/${approvalToken}`,
      rejectUrl: `${baseUrl}/reject/${approvalToken}`
    });

    // 📱 SMS to Admin
    await sendBookingApprovalSMS({
  booking: saved,
  token: approvalToken
});


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
   SHOW ALL BOOKING REQUESTS (ADMIN ONLY)
   ================================================= */
router.get('/show_booking_requests', async (req, res) => {
  try {
    if (!(req.isAuthenticated && req.isAuthenticated() && req.user.type === 'Admin')) {
      return res.status(403).json({ msg: 'You are not authorized' });
    }

    const requests = await Booking_Requests
      .find()
      .populate('department')
      .sort({ createdAt: -1 });

    return res.status(200).json({ booking_requests: requests });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

/* =================================================
   ADMIN ACCEPTS / REJECTS BOOKING
   ================================================= */
router.post('/change_booking_request', async (req, res) => {
  try {
    if (!(req.isAuthenticated && req.isAuthenticated() && req.user.type === 'Admin')) {
      return res.status(403).json({ msg: 'You are not authorized' });
    }

    const { decision, id, name } = req.body;
    if (!id || !decision) {
      return res.status(400).json({ msg: 'id and decision are required' });
    }

    const requestDoc = await Booking_Requests.findById(id).populate('department');
    if (!requestDoc) {
      return res.status(404).json({ msg: 'Booking request not found' });
    }

    /* ---------- REJECT ---------- */
    if (decision !== 'Yes') {
      await Booking_Requests.findByIdAndDelete(id);

      // 📧 Email to Department
      await sendDecisionToDepartment({
        email: requestDoc.department.email,
        booking: requestDoc,
        decision: 'REJECTED'
      });

      // 📱 SMS to Department
      await sendDecisionSMSDepartment({
        booking: requestDoc,
        decision: 'REJECTED'
      });

      return res.status(200).json({ status: 'Not Accepted' });
    }

    /* ---------- APPROVE ---------- */
    const startDT = new Date(requestDoc.startDateTime);
    const endDT = new Date(requestDoc.endDateTime);

    const existingOverlap = await Hall.findOne({
      name,
      bookings: {
        $elemMatch: {
          startDateTime: { $lt: endDT },
          endDateTime: { $gt: startDT }
        }
      }
    });

    if (existingOverlap) {
      await Booking_Requests.findByIdAndDelete(id);
      return res.status(409).json({ msg: 'Time overlaps existing booking' });
    }

    const bookingObj = {
      bookingRequest: requestDoc._id,
      department: requestDoc.department._id,
      event: requestDoc.event,
      startDateTime: startDT,
      endDateTime: endDT
    };

    const updatedHall = await Hall.findOneAndUpdate(
      { name },
      { $push: { bookings: bookingObj } },
      { new: true }
    );

    await Booking_Requests.findByIdAndDelete(id);

    // 📧 Email to Department
    await sendDecisionToDepartment({
      email: requestDoc.department.email,
      booking: requestDoc,
      decision: 'APPROVED'
    });

    // 📱 SMS to Department
    await sendDecisionSMSDepartment({
      booking: requestDoc,
      decision: 'APPROVED'
    });

    return res.status(200).json({
      status: 'Booking Accepted',
      updates: updatedHall
    });

  } catch (err) {
    console.error('change_booking_request error:', err);
    return res.status(500).json({ error: err.message });
  }
});

/* =================================================
   DEPARTMENT BOOKING HISTORY
   ================================================= */
router.get('/department_history', async (req, res) => {
  if (!(req.isAuthenticated && req.user.type === 'Department')) {
    return res.status(403).json({ msg: 'Unauthorized' });
  }

  const history = await Booking_Requests
    .find({ department: req.user.id })
    .sort({ createdAt: -1 });

  res.json({ history });
});

module.exports = router;
