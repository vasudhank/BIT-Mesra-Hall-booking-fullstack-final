const express = require('express');
const router = express.Router();
const Hall = require('../models/hall');
const Booking_Requests = require('../models/booking_requests');
const { safeExecute } = require('../utils/safeNotify');
const { generateApprovalToken, getTokenExpiry } = require('../utils/token');

// IMPORT EMAIL & SMS SERVICES
const {
  sendBookingApprovalMail,
  sendDecisionToDepartment
} = require('../services/emailService');

const {
  sendBookingApprovalSMS,
  sendDecisionSMSDepartment
} = require('../services/smsService');

require('dotenv').config();

// --- TIME HELPERS ---
const to12 = (t) => {
  if (!t) return "";
  if (t.toLowerCase().includes('m')) return t; 
  let [h, m] = t.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return t;
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${m.toString().padStart(2, '0')} ${ampm}`;
};

const to24 = (t) => {
   if (!t) return "00:00";
   if (!t.toLowerCase().includes('m')) return t; 
   const match = t.match(/^(\d{1,2})(:(\d{2}))?\s*(AM|PM)$/i);
   if (!match) return t;
   let h = parseInt(match[1]);
   const m = match[3] || "00";
   const ampm = match[4].toUpperCase();
   if (ampm === 'PM' && h < 12) h += 12;
   if (ampm === 'AM' && h === 12) h = 0;
   return `${h.toString().padStart(2, '0')}:${m}`;
}

// --- CONFLICT CHECK HELPER ---
// Checks a specific request against the DB + other pending requests
const analyzeRequestConflict = async (req, allPending) => {
    const startA = new Date(req.startDateTime).getTime();
    const endA = new Date(req.endDateTime).getTime();
    
    // 1. Check DB (Approved Bookings)
    const dbConflict = await Hall.findOne({
        name: req.hall,
        bookings: {
            $elemMatch: {
                startDateTime: { $lt: req.endDateTime },
                endDateTime: { $gt: req.startDateTime }
            }
        }
    });
    if (dbConflict) return "TIME_CONFLICT";

    // 2. Check against other Pending Requests in the same batch
    for (let other of allPending) {
        if (req._id.equals(other._id)) continue;
        if (req.hall !== other.hall) continue;

        const startB = new Date(other.startDateTime).getTime();
        const endB = new Date(other.endDateTime).getTime();

        // Exact time overlap
        if (startA < endB && endA > startB) return "TIME_CONFLICT";
        
        // Date overlap (Same day, different time)
        // Note: Simple logic - if dates match but times don't.
        if (req.startDate === other.startDate) return "DATE_OVERLAP"; 
    }

    return "SAFE";
};

router.post('/execute', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.json({ status: 'ERROR', msg: 'You must be logged in.' });
  }

  const { intent } = req.body;
  const user = req.user;
  const actionType = intent.action;
  const payload = intent.payload || {};

  /* =======================
     ACTION: BOOK_REQUEST (Handles Single & Multiple)
  ======================= */
  if (actionType === 'BOOK_REQUEST') {
    if (user.type !== 'Department' && user.type !== 'Admin') {
      return res.json({ status: 'ERROR', msg: 'Permission Denied.' });
    }

    const requests = payload.requests || [];
    if (requests.length === 0) return res.json({ status: 'ERROR', msg: 'No booking details found.' });

    let successCount = 0;
    let failMsg = "";

    for (let reqItem of requests) {
      try {
        if (!reqItem.hall || !reqItem.date || !reqItem.start || !reqItem.end) continue;

        const start24 = to24(reqItem.start);
        const end24 = to24(reqItem.end);
        const startDateTime = `${reqItem.date}T${start24}:00`;
        const endDateTime = `${reqItem.date}T${end24}:00`;

        const startDT = new Date(startDateTime);
        const endDT = new Date(endDateTime);
        
        // Immediate conflict check
        const existingOverlap = await Hall.findOne({
          name: reqItem.hall,
          bookings: {
            $elemMatch: {
              startDateTime: { $lt: endDT },
              endDateTime: { $gt: startDT }
            }
          }
        });

        if (existingOverlap) {
          failMsg += `${reqItem.hall} on ${reqItem.date} occupied. `;
          continue;
        }

        const approvalToken = generateApprovalToken();
        const tokenExpiry = getTokenExpiry(15);

        const newRequest = new Booking_Requests({
          hall: reqItem.hall,
          department: user.id,
          event: reqItem.event || 'AI Booking',
          description: "AI Generated",
          startDateTime: startDT,
          endDateTime: endDT,
          startTime12: to12(start24),
          endTime12: to12(end24),
          startTime24: start24 + ":00",
          endTime24: end24 + ":00",
          startDate: reqItem.date,
          endDate: reqItem.date,
          approvalToken,
          tokenExpiry,
          status: 'PENDING'
        });

        const saved = await newRequest.save();

        // Notification
        const baseUrl = `${process.env.PUBLIC_BASE_URL}/api/approval`;
        safeExecute(() => sendBookingApprovalMail({
            adminEmail: process.env.EMAIL,
            booking: saved,
            approveUrl: `${baseUrl}/approve/${approvalToken}`,
            rejectUrl: `${baseUrl}/reject/${approvalToken}`
        }), 'ADMIN EMAIL');

        safeExecute(() => sendBookingApprovalSMS({
            booking: saved, token: approvalToken
        }), 'ADMIN SMS');

        successCount++;

      } catch (err) {
        console.error("Single Booking Error:", err);
      }
    }

    if (successCount === 0) return res.json({ status: 'ERROR', msg: failMsg || 'Failed to book.' });
    
    return res.json({ 
      status: 'DONE', 
      message: `Successfully created ${successCount} booking request(s). ${failMsg}` 
    });
  }

  /* =======================
     ACTION: ADMIN_QUERY (Filter & Show)
  ======================= */
  if (actionType === 'ADMIN_QUERY') {
    if (user.type !== 'Admin') return res.json({ status: 'ERROR', msg: 'Admin Only.' });
    
    const filter = payload.filter; // "TIME_CONFLICT", "DATE_OVERLAP", "SAFE"
    const requests = await Booking_Requests.find({ status: 'PENDING' }).populate('department');
    
    // Categorize
    const results = [];
    for (let req of requests) {
        const status = await analyzeRequestConflict(req, requests);
        if (filter === "SAFE" && status === "SAFE") results.push(req);
        if (filter === "TIME_CONFLICT" && status === "TIME_CONFLICT") results.push(req);
        if (filter === "DATE_OVERLAP" && status === "DATE_OVERLAP") results.push(req);
    }

    if(results.length === 0) {
        return res.json({ status: 'DONE', message: `No requests found with status: ${filter}` });
    }

    // Return format suitable for AI Chat table
    const formattedData = results.map(r => ({
        hall: r.hall,
        status: `${r.event} (${r.startDate})`,
        currentEvent: filter // reusing field for display
    }));

    return res.json({ status: 'INFO', data: formattedData });
  }

  /* =======================
     ACTION: ADMIN_EXECUTE (Bulk Approve/Reject)
  ======================= */
  if (actionType === 'ADMIN_EXECUTE') {
    if (user.type !== 'Admin') return res.json({ status: 'ERROR', msg: 'Admin Only.' });
    
    const subAction = payload.subAction; // "APPROVE_SAFE", "REJECT_CONFLICTS"
    const requests = await Booking_Requests.find({ status: 'PENDING' }).populate('department');
    let count = 0;

    for (let reqDoc of requests) {
      const status = await analyzeRequestConflict(reqDoc, requests);

      // APPROVE SAFE LOGIC
      if (subAction === "APPROVE_SAFE" && status === "SAFE") {
        reqDoc.status = 'APPROVED';
        await reqDoc.save();

        await Hall.findOneAndUpdate(
          { name: reqDoc.hall },
          { $push: { bookings: {
              bookingRequest: reqDoc._id,
              department: reqDoc.department._id,
              event: reqDoc.event,
              startDateTime: reqDoc.startDateTime,
              endDateTime: reqDoc.endDateTime
          }}}
        );

        safeExecute(() => sendDecisionToDepartment({
            email: reqDoc.department.email, booking: reqDoc, decision: 'APPROVED'
        }), 'DEPT EMAIL');
        count++;
      }
      
      // REJECT CONFLICT LOGIC
      else if (subAction === "REJECT_CONFLICTS" && status === "TIME_CONFLICT") {
        reqDoc.status = 'REJECTED';
        await reqDoc.save();
        
        safeExecute(() => sendDecisionToDepartment({
            email: reqDoc.department.email, booking: reqDoc, decision: 'REJECTED'
        }), 'DEPT EMAIL');
        count++;
      }
    }

    return res.json({ status: 'DONE', message: `Processed ${count} requests via ${subAction}.` });
  }

  /* =======================
     ACTION: SHOW_HALL_STATUS
  ======================= */
  if (actionType === "SHOW_HALL_STATUS") {
    const halls = await Hall.find();
    const now = new Date();

    const data = halls.map(h => {
        const currentBooking = h.bookings.find(b => 
            new Date(b.startDateTime) <= now && new Date(b.endDateTime) >= now
        );
        return {
            hall: h.name,
            status: currentBooking ? "BOOKED" : "FREE",
            currentEvent: currentBooking ? currentBooking.event : "None"
        };
    });

    return res.json({ status: 'INFO', data: data });
  }

  return res.json({ status: 'ERROR', msg: 'Action not recognized.' });
});

module.exports = router;