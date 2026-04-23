const Hall = require('../models/hall');
const BookingRequest = require('../models/booking_requests');
const Department = require('../models/department');
const mongoose = require('mongoose');

const CONTEXT_CACHE_MS = Math.max(Number(process.env.AI_PROJECT_CONTEXT_CACHE_MS || 45 * 1000), 5000);
let cachedContext = { at: 0, text: '' };

const CORE_CONTEXT = `
Project: BIT Seminar Hall Booking System

Workflow map (must be treated as source-of-truth context for support answers):
1) Department booking path:
   - Route: /department/booking
   - User opens hall card -> BOOK HALL.
   - Required fields: hall, event, start/end date, start/end time.
   - Optional: description.
2) Booking outcomes:
   - If no overlap: request status becomes AUTO_BOOKED and hall booking is created.
   - If overlap with booking or closure notice: conflict details are shown and user may FORCE BOOK.
   - Forced conflict request is sent for admin decision.
3) Admin booking review path:
   - Route: /admin/booking
   - PENDING requests: ACCEPT (Yes) or REJECT (No).
   - AUTO_BOOKED requests: VACATE or LEAVE.
4) Booking status vocabulary:
   - PENDING, APPROVED, REJECTED, AUTO_BOOKED, LEFT, VACATED.
5) Availability and history:
   - Hall list/status route: /hall/view_halls (status Filled / Not Filled).
   - Department history route: /department/booking/history.
   - Schedule page route: /schedule.
6) Calendar and public tasks:
   - Calendar page route: /calendar
   - Events API: /calendar/events
   - Search API: /calendar/search
   - Public task CRUD: /calendar/tasks and /calendar/tasks/:id
   - Calendar print workflow: Settings -> Print (or Ctrl+P/Cmd+P), then choose view and date/month range.
   - Only Admin or Department can create/edit/delete public tasks.
7) Notices and alerts:
   - Notice routes: /notices, /notices/:id
   - Notice trash routes: /notices/trash, /notices/:id/restore, /notices/:id/permanent
   - Only Admin can create/edit/delete/restore/permanently-delete notices.
   - Notice kind values: GENERAL or HOLIDAY, with optional closure scope and rooms.
8) Support threads:
   - Queries: /queries and /queries/:id
   - Complaints: /complaints and /complaints/:id
   - FAQ: /faqs
9) Complaint reopen flow:
   - OTP request: /complaints/:id/reopen/request-otp
   - OTP verify: /complaints/:id/reopen/verify-otp
10) Feedback:
   - Feedback route: /feedback
   - Types: BUG, SUGGESTION, PRAISE
   - Status values: NEW, IN_REVIEW, DONE
11) Department onboarding:
   - Department request: /department/request_department
   - Admin approval route: /admin/department/approve/:token
   - Account create/setup verify: /department/create, /department/verify_setup_token, /department/complete_setup
12) Hall and contacts management:
   - Hall management route: /admin/hall with APIs /hall/create_hall, /hall/view_halls, /hall/clear_hall, /hall/delete_hall/:id
   - Contacts route: /admin/contacts with APIs /contact/get_contacts, /contact/add, /contact/admin_update/:id
   - Quick menu contacts overlay flow exists in UI:
     1) 3-line quick menu -> Contacts
     2) Wish Your Day popup opens with contact checkboxes and Select All behavior
     3) Download button exports selected contacts (or all when none selected) as VCF
   - Admin Contacts page focuses on contact management (add/edit/search/sort), not direct CSV export.
13) Global navigation:
   - QuickPageMenu appears across public/admin/department/developer pages and includes shortcuts for Admin, Faculty, Schedule, Notices, Calendar, AI Mode, Contacts, Queries, Complaints, and Feedback.
14) Public routes and role routes:
   - Public: /, /about, /faqs, /schedule, /calendar, /notices, /queries, /complaints, /feedback, /ai
   - Admin: /admin/hall, /admin/booking, /admin/department, /admin/department/request, /admin/contacts, /admin/notices, /admin/queries, /admin/complaints, /admin/feedback, /admin/account
   - Department: /department/booking, /department/booking/history, /department/account, /department/queries, /department/complaints, /department/feedback
   - Developer: /developer/monitoring, /developer/account, /developer/queries, /developer/complaints, /developer/feedback
15) Trusted responders:
   - Trusted answers are from ADMIN or DEVELOPER roles.
   - AI-generated answers exist but should still follow real workflow details above.
`;

const summarizeDynamicProjectState = async () => {
  try {
    // Avoid buffered DB operations when running offline/test routing logic.
    if (Number(mongoose?.connection?.readyState || 0) !== 1) {
      return 'Live state snapshot unavailable.';
    }

    const [hallCount, pendingBookings, departmentCount, hallNameDocs] = await Promise.all([
      Hall.countDocuments({}),
      BookingRequest.countDocuments({ status: 'PENDING' }),
      Department.countDocuments({}),
      Hall.find({}, 'name').sort({ name: 1 }).limit(24).lean()
    ]);

    const hallNames = (Array.isArray(hallNameDocs) ? hallNameDocs : [])
      .map((doc) => String(doc?.name || '').trim())
      .filter(Boolean);
    const hallNamesLine = hallNames.length > 0
      ? `Known halls: ${hallNames.join(', ')}.`
      : 'Known halls: unavailable.';

    return `Live state snapshot: halls=${hallCount}, pendingBookingRequests=${pendingBookings}, departments=${departmentCount}. ${hallNamesLine}`;
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
