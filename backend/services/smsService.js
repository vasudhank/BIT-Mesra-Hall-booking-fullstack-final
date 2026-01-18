const axios = require('axios');
require('dotenv').config();

// Your existing test phone
const TEST_PHONE = '9155043512';
// Admin phone (falls back to TEST_PHONE if not set in .env)
const ADMIN_PHONE = process.env.ADMIN_PHONE || TEST_PHONE;

const shortId = (id) => id.toString().slice(-5);

const formatDateTime = (date) =>
  new Date(date).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

/* =========================================================
   HELPER FUNCTION (Handles the API Call)
   ========================================================= */
const sendSMS = async (message, numbers) => {
  try {
    await axios.post(
      'https://www.fast2sms.com/dev/bulkV2',
      {
        route: 'q',
        message: message,
        language: 'english',
        numbers: numbers
      },
      {
        headers: {
          authorization: process.env.SMS_API_KEY,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (err) {
    console.error("SMS Failed:", err.message);
  }
};

/* =========================================================
   1. SMS TO ADMIN (HALL BOOKING APPROVAL) - EXISTING
   ========================================================= */
exports.sendBookingApprovalSMS = async ({ booking, token }) => {
  const approveUrl = `${process.env.PUBLIC_BASE_URL}/api/approval/approve/${token}`;
  const rejectUrl  = `${process.env.PUBLIC_BASE_URL}/api/approval/reject/${token}`;

  const message =
`New Hall Booking Request

Hall: ${booking.hall}
Event: ${booking.event}

Time:
${formatDateTime(booking.startDateTime)}
to
${formatDateTime(booking.endDateTime)}

Approve:
${approveUrl}

Reject:
${rejectUrl}`;

  await sendSMS(message, TEST_PHONE);
};

/* =========================================================
   2. SMS TO DEPARTMENT (HALL BOOKING DECISION) - EXISTING
   ========================================================= */
exports.sendDecisionSMSDepartment = async ({ booking, decision }) => {
  const message =
`Hall Booking ${decision} (#${shortId(booking._id)})

Hall: ${booking.hall}
Event: ${booking.event}

Time:
${formatDateTime(booking.startDateTime)}
to
${formatDateTime(booking.endDateTime)}

Status: ${decision}`;

  await sendSMS(message, TEST_PHONE);
};

/* =========================================================
   3. ADMIN: NEW REGISTRATION ALERT - NEW
   ========================================================= */
exports.sendRegistrationAlertToAdmin = async ({ department, head }) => {
  const message = 
`New Department Request

Dept: ${department}
Head: ${head}

Please log in to the portal to Approve or Reject this request.`;

  await sendSMS(message, ADMIN_PHONE);
};

/* =========================================================
   4. DEPARTMENT: WELCOME / APPROVED - NEW
   ========================================================= */
exports.sendDepartmentWelcomeSMS = async ({ email, password, department }) => {
  // Truncate message to fit SMS limits if needed
  const message = 
`Approved: ${department}

Your account is created.
ID: ${email}
Pass: ${password}

Check email for setup link.`;

  // Note: We need the department's phone number to send this effectively. 
  // Currently sending to TEST_PHONE for verification since DB has no phone field.
  await sendSMS(message, TEST_PHONE);
};

/* =========================================================
   5. DEPARTMENT: REJECTED - NEW
   ========================================================= */
exports.sendRejectionSMS = async ({ department }) => {
  const message = 
`Registration Update

Your request for ${department} has been rejected by the admin.
Contact office for details.`;

  // Note: Sending to TEST_PHONE as placeholder
  await sendSMS(message, TEST_PHONE);
};