const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL,
    pass: process.env.EMAIL_APP_PASSWORD
  }
});

const formatDateTime = (date) =>
  new Date(date).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

/* =========================
   ADMIN APPROVAL EMAIL
   ========================= */
exports.sendBookingApprovalMail = async ({ adminEmail, booking, approveUrl, rejectUrl }) => {
  const html = `
  <div style="background:#f3f4f6;padding:30px;font-family:Inter,Arial;">
    <div style="max-width:600px;margin:auto;background:#ffffff;
      border-radius:14px;box-shadow:0 12px 30px rgba(0,0,0,0.12);
      overflow:hidden;">

      <div style="background:linear-gradient(135deg,#2563eb,#1e40af);
        padding:22px;color:#fff;">
        <h2 style="margin:0;">New Hall Booking Request</h2>
        <p style="margin:6px 0 0;font-size:14px;opacity:.9;">
          Action required
        </p>
      </div>

      <div style="padding:26px;color:#111827;">
        <p><b>Hall:</b> ${booking.hall}</p>
        <p><b>Event:</b> ${booking.event}</p>
        <p><b>Time:</b><br/>
          ${formatDateTime(booking.startDateTime)} –<br/>
          ${formatDateTime(booking.endDateTime)}
        </p>

        <div style="margin:28px 0;text-align:center;">
          <a href="${approveUrl}"
            style="background:#22c55e;color:#fff;
            padding:12px 22px;border-radius:10px;
            text-decoration:none;font-weight:600;margin-right:10px;">
            ✅ Approve
          </a>

          <a href="${rejectUrl}"
            style="background:#ef4444;color:#fff;
            padding:12px 22px;border-radius:10px;
            text-decoration:none;font-weight:600;">
            ❌ Reject
          </a>
        </div>

        <p style="font-size:13px;color:#6b7280;">
          ⏳ These links expire in <b>15 minutes</b>.
        </p>
      </div>

      <div style="background:#f9fafb;padding:14px;
        text-align:center;font-size:12px;color:#6b7280;">
        Seminar Hall Booking System
      </div>
    </div>
  </div>
  `;

  await transporter.sendMail({
    to: adminEmail,
    subject: '📌 Hall Booking Approval Required',
    html
  });
};

/* =========================
   DEPARTMENT DECISION EMAIL
   ========================= */
exports.sendDecisionToDepartment = async ({ email, booking, decision }) => {
  const isApproved = decision === 'APPROVED';

  const html = `
  <div style="background:#f3f4f6;padding:30px;font-family:Inter,Arial;">
    <div style="max-width:560px;margin:auto;background:#ffffff;
      border-radius:14px;box-shadow:0 10px 25px rgba(0,0,0,0.12);">

      <div style="background:${isApproved ? '#16a34a' : '#dc2626'};
        padding:22px;color:#fff;">
        <h2 style="margin:0;">Booking ${decision}</h2>
      </div>

      <div style="padding:26px;color:#111827;">
        <p><b>Hall:</b> ${booking.hall}</p>
        <p><b>Event:</b> ${booking.event}</p>
        <p><b>Time:</b><br/>
          ${formatDateTime(booking.startDateTime)} –<br/>
          ${formatDateTime(booking.endDateTime)}
        </p>

        <p style="margin-top:20px;">
          ${
            isApproved
              ? '✅ Your booking has been successfully approved.'
              : '❌ Your booking request has been rejected.'
          }
        </p>
      </div>

      <div style="background:#f9fafb;padding:14px;
        text-align:center;font-size:12px;color:#6b7280;">
        Seminar Hall Booking System
      </div>
    </div>
  </div>
  `;

  await transporter.sendMail({
    to: email,
    subject: `Hall Booking ${decision}`,
    html
  });
};
