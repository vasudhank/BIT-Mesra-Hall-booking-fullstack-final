const Hall = require('../models/hall');
const BookingRequest = require('../models/booking_requests');
const Department = require('../models/department');
const mongoose = require('mongoose');

const CONTEXT_CACHE_MS = Math.max(Number(process.env.AI_PROJECT_CONTEXT_CACHE_MS || 45 * 1000), 5000);
let cachedContext = { at: 0, text: '' };

const CORE_CONTEXT = `
Project: BIT Seminar Hall Booking System

Known workflows:
1) Department/faculty can raise hall booking requests with hall, event, date-time.
2) Non-conflicting hall booking can be auto-handled with vacate/leave flow in admin dashboard.
3) Conflicting requests appear to admin for manual accept/reject decisions.
4) Admin can manage halls/departments, bulk vacate/delete, and sort/filter lists.
5) System supports complaints, queries, feedback, and FAQ pages.
6) Trusted responses are from Admin or Developer accounts.
7) Department and Admin dashboards provide account, contacts, and schedule flows.
`;

const summarizeDynamicProjectState = async () => {
  try {
    // Avoid buffered DB operations when running offline/test routing logic.
    if (Number(mongoose?.connection?.readyState || 0) !== 1) {
      return 'Live state snapshot unavailable.';
    }

    const [hallCount, pendingBookings, departmentCount] = await Promise.all([
      Hall.countDocuments({}),
      BookingRequest.countDocuments({ status: 'PENDING' }),
      Department.countDocuments({})
    ]);

    return `Live state snapshot: halls=${hallCount}, pendingBookingRequests=${pendingBookings}, departments=${departmentCount}.`;
  } catch (err) {
    return 'Live state snapshot unavailable.';
  }
};

const getProjectSupportContext = async () => {
  const now = Date.now();
  if (cachedContext.text && now - cachedContext.at < CONTEXT_CACHE_MS) {
    return cachedContext.text;
  }

  const dynamic = await summarizeDynamicProjectState();
  const full = `${CORE_CONTEXT}\n${dynamic}`;
  cachedContext = { at: now, text: full };
  return full;
};

module.exports = { getProjectSupportContext };
