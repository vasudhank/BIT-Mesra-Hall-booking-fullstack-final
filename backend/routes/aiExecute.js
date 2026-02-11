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
   if (!t.toLowerCase().includes('m')) {
       return t.length === 4 ? `0${t}` : t; 
   }
   const match = t.match(/^(\d{1,2})(:(\d{2}))?\s*(AM|PM)$/i);
   if (!match) return "00:00"; 
   let h = parseInt(match[1]);
   const m = match[3] || "00";
   const ampm = match[4].toUpperCase();
   if (ampm === 'PM' && h < 12) h += 12;
   if (ampm === 'AM' && h === 12) h = 0;
   return `${h.toString().padStart(2, '0')}:${m}`;
}

// --- CONFLICT CHECK HELPER ---
const analyzeRequestConflict = async (req, allPending) => {
    const startA = new Date(req.startDateTime).getTime();
    const endA = new Date(req.endDateTime).getTime();
    
    // Check DB (Approved Bookings)
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

    // Check against other Pending Requests
    for (let other of allPending) {
        if (req._id.equals(other._id)) continue;
        if (req.hall !== other.hall) continue;

        const startB = new Date(other.startDateTime).getTime();
        const endB = new Date(other.endDateTime).getTime();

        if (startA < endB && endA > startB) return "TIME_CONFLICT";
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
     ACTION: BOOK_REQUEST
     ======================= */
  if (actionType === 'BOOK_REQUEST') {
    if (user.type !== 'Department' && user.type !== 'Admin') {
      return res.json({ status: 'ERROR', msg: 'Permission Denied. Only Departments can book.' });
    }

    const requests = payload.requests || [];
    if (requests.length === 0) return res.json({ status: 'ERROR', msg: 'AI understood booking, but missed details.' });

    let successCount = 0;
    let failMsg = "";

    for (let reqItem of requests) {
      try {
        if (!reqItem.hall || !reqItem.date || !reqItem.start || !reqItem.end) {
             failMsg += `Missing details for one request. `;
             continue;
        }

        const start24 = to24(reqItem.start);
        const end24 = to24(reqItem.end);
        
        const startDateTimeStr = `${reqItem.date}T${start24}:00`;
        const endDateTimeStr = `${reqItem.date}T${end24}:00`;

        const startDT = new Date(startDateTimeStr);
        const endDT = new Date(endDateTimeStr);
        
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
          failMsg += `${reqItem.hall} is occupied on ${reqItem.date}. `;
          continue;
        }

        const approvalToken = generateApprovalToken();
        const tokenExpiry = getTokenExpiry(15);

        const newRequest = new Booking_Requests({
          hall: reqItem.hall,
          department: user.id,
          event: reqItem.event || 'AI Booking',
          description: "Booked via AI Assistant",
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
        failMsg += `Error processing ${reqItem.hall}. `;
      }
    }

    if (successCount === 0) return res.json({ status: 'ERROR', msg: failMsg || 'Failed to book.' });
    return res.json({ status: 'DONE', message: `Created ${successCount} booking request(s). ${failMsg}` });
  }

  /* =======================
     ACTION: ADMIN_EXECUTE
     ======================= */
  if (actionType === 'ADMIN_EXECUTE') {
    if (user.type !== 'Admin') return res.json({ status: 'ERROR', msg: 'Admin Only.' });
    
    const subAction = payload.subAction; 
    const targetHall = payload.targetHall; // e.g., "Hall 20"
    
    const requests = await Booking_Requests.find({ status: 'PENDING' }).populate('department');
    let count = 0;

    for (let reqDoc of requests) {
      // If a specific hall was targeted, skip others
      if (targetHall && reqDoc.hall.toLowerCase() !== targetHall.toLowerCase()) {
          continue; 
      }

      const status = await analyzeRequestConflict(reqDoc, requests);

      // APPROVE
      if ((subAction === "APPROVE_SAFE" && status === "SAFE") || subAction === "APPROVE_SPECIFIC") {
        
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

      // REJECT
      else if ((subAction === "REJECT_CONFLICTS" && status === "TIME_CONFLICT") || subAction === "REJECT_SPECIFIC") {
        reqDoc.status = 'REJECTED';
        await reqDoc.save();
        
        safeExecute(() => sendDecisionToDepartment({
            email: reqDoc.department.email, booking: reqDoc, decision: 'REJECTED'
        }), 'DEPT EMAIL');
        count++;
      }
    }

    if (count === 0 && targetHall) {
        return res.json({ status: 'DONE', message: `No pending requests found for ${targetHall}.` });
    }

    return res.json({ status: 'DONE', message: `Processed ${count} requests.` });
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