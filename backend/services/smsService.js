const axios = require('axios');
require('dotenv').config();

const TEST_PHONE = '9155043512';
const BASE_URL = process.env.PUBLIC_BASE_URL;
const shortId = (id) => id.toString().slice(-5);

const formatDateTime = (date) =>
  new Date(date).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

/* =========================
   📱 SMS TO ADMIN (APPROVAL)
   ========================= */
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

  await axios.post(
    'https://www.fast2sms.com/dev/bulkV2',
    {
      route: 'q',
      message,
      language: 'english',
      numbers: TEST_PHONE
    },
    {
      headers: {
        authorization: process.env.SMS_API_KEY,
        'Content-Type': 'application/json'
      }
    }
  );
};


/* =========================
   📱 SMS TO DEPARTMENT (DECISION)
   ========================= */
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

  await axios.post(
    'https://www.fast2sms.com/dev/bulkV2',
    {
      route: 'q',
      message,
      language: 'english',
      numbers: TEST_PHONE
    },
    {
      headers: {
        authorization: process.env.SMS_API_KEY,
        'Content-Type': 'application/json'
      }
    }
  );
};
