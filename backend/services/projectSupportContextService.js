const Hall = require('../models/hall');
const BookingRequest = require('../models/booking_requests');
const Department = require('../models/department');

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
  const dynamic = await summarizeDynamicProjectState();
  return `${CORE_CONTEXT}\n${dynamic}`;
};

module.exports = { getProjectSupportContext };

