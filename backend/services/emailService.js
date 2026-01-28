const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL,
    pass: process.env.EMAIL_APP_PASSWORD
  },
  // 🟢 FIX: Allow connection through Antivirus/Firewall
  tls: {
    rejectUnauthorized: false
  }
});

const formatDateTime = (date) =>
  new Date(date).toLocaleString('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

/* =========================================================
   1. ADMIN: NEW DEPARTMENT REGISTRATION ALERT
   ========================================================= */
exports.sendRegistrationRequestToAdmin = async ({ adminEmails, requestData, approveUrl, rejectUrl }) => {
  const html = `
  <div style="background:#f1f5f9;padding:40px 0;font-family:'Segoe UI', Tahoma, sans-serif;">
    <div style="max-width:600px;margin:auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0, 0, 0, 0.1);">
      
      <div style="background:#0f172a;padding:24px;text-align:center;">
        <h2 style="margin:0;color:#f8fafc;font-size:20px;letter-spacing:0.5px;">New Department Registration</h2>
        <p style="margin:6px 0 0;color:#94a3b8;font-size:14px;">Action Required</p>
      </div>

      <div style="padding:32px;color:#334155;">
        <p style="font-size:16px;margin-bottom:24px;">Hello Admin,</p>
        <p style="margin-bottom:24px;line-height:1.5;">
          A new department registration request has been received. Please review the details below.
        </p>

        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin-bottom:28px;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#64748b;font-weight:600;width:120px;">DEPARTMENT</td>
              <td style="padding:6px 0;font-size:15px;color:#0f172a;font-weight:600;">${requestData.department}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#64748b;font-weight:600;">HEAD</td>
              <td style="padding:6px 0;font-size:15px;color:#0f172a;font-weight:600;">${requestData.head}</td>
            </tr>
            <tr>
              <td style="padding:6px 0;font-size:13px;color:#64748b;font-weight:600;">EMAIL</td>
              <td style="padding:6px 0;font-size:15px;color:#0f172a;font-weight:600;">${requestData.email}</td>
            </tr>
          </table>
        </div>

        <div style="text-align:center; margin-top:30px;">
          <a href="${approveUrl}" 
             style="background:#22c55e;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;font-size:15px;display:inline-block;margin-right:15px;">
             ✅ Approve & Set Password
          </a>

          <a href="${rejectUrl}" 
             style="background:#ef4444;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:600;font-size:15px;display:inline-block;">
             ❌ Reject Request
          </a>
        </div>
        
        <p style="margin-top:24px;font-size:13px;color:#94a3b8;text-align:center;">
          These links expire in 24 hours.
        </p>
      </div>
    </div>
  </div>`;

  await transporter.sendMail({
    to: adminEmails,
    subject: '🔔 Action Required: New Department Registration',
    html
  });
};

/* =========================================================
   2. DEPARTMENT: REJECTION NOTICE
   ========================================================= */
exports.sendRejectionEmail = async ({ email, department }) => {
  const html = `
  <div style="background:#fff1f2;padding:40px 0;font-family:'Segoe UI', Tahoma, sans-serif;">
    <div style="max-width:550px;margin:auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 10px 15px -3px rgba(0, 0, 0, 0.1);">
      
      <div style="background:#e11d48;padding:20px;text-align:center;">
        <h2 style="margin:0;color:#ffffff;font-size:20px;">Registration Update</h2>
      </div>

      <div style="padding:32px;color:#334155;text-align:center;">
        <div style="font-size:48px;margin-bottom:16px;">❌</div>
        
        <h3 style="margin:0 0 16px;color:#0f172a;font-size:18px;">Request Rejected</h3>
        
        <p style="line-height:1.6;margin-bottom:24px;">
          We regret to inform you that your registration request for <b>${department}</b> has been declined by the administrator.
        </p>

        <div style="background:#f8fafc;padding:12px;border-radius:6px;font-size:14px;color:#64748b;">
          Please contact the administration office for further details.
        </div>
      </div>
    </div>
  </div>`;

  await transporter.sendMail({
    to: email,
    subject: 'Registration Request Status Update',
    html
  });
};

/* =========================================================
   3. DEPARTMENT: WELCOME / APPROVED WITH SETUP LINK
   ========================================================= */
exports.sendDepartmentWelcomeEmail = async ({ email, password, departmentName, headName, setupUrl }) => {
  const html = `
  <div style="background:#f3f4f6;padding:40px 0;font-family:'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;">
    <div style="max-width:600px;margin:auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 10px 25px rgba(0,0,0,0.1);">
      
      <div style="background:linear-gradient(135deg, #0f172a 0%, #334155 100%);padding:30px;text-align:center;">
        <h1 style="margin:0;color:#ffffff;font-size:24px;letter-spacing:1px;">Welcome to the Portal</h1>
        <p style="margin:10px 0 0;color:#cbd5e1;font-size:14px;">Department Account Approved</p>
      </div>

      <div style="padding:40px 30px;color:#334155;">
        <p style="margin-top:0;font-size:16px;">Hello <b>${headName}</b>,</p>
        <p style="font-size:16px;line-height:1.6;">
          Your department account for <b>${departmentName}</b> has been approved. 
          Please find your initial login credentials below.
        </p>

        <div style="background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:20px;margin:25px 0;">
          <table style="width:100%;border-collapse:collapse;">
            <tr>
              <td style="padding:5px 0;color:#64748b;font-size:13px;font-weight:600;text-transform:uppercase;">Email ID</td>
              <td style="padding:5px 0;color:#0f172a;font-weight:600;text-align:right;">${email}</td>
            </tr>
            <tr>
              <td style="padding:5px 0;color:#64748b;font-size:13px;font-weight:600;text-transform:uppercase;">Temporary Password</td>
              <td style="padding:5px 0;color:#0f172a;font-weight:600;text-align:right;">${password}</td>
            </tr>
          </table>
        </div>

        <p style="font-size:15px;line-height:1.6;margin-bottom:30px;">
          For security reasons, click the button below to change your password immediately.
        </p>

        <div style="text-align:center;margin-bottom:30px;">
          <a href="${setupUrl}" 
             style="background:#2563eb;color:#ffffff;text-decoration:none;padding:14px 28px;border-radius:6px;font-weight:bold;font-size:16px;display:inline-block;box-shadow:0 4px 6px rgba(37, 99, 235, 0.2);">
            Secure Account & Change Password
          </a>
        </div>

        <p style="font-size:13px;color:#94a3b8;text-align:center;">
          ⚠️ This setup link is valid for <b>1 hour</b>.
        </p>
      </div>

      <div style="background:#f8fafc;padding:20px;text-align:center;border-top:1px solid #e2e8f0;">
        <p style="margin:0;font-size:12px;color:#94a3b8;">
          Seminar Hall Booking System &copy; ${new Date().getFullYear()}
        </p>
      </div>
    </div>
  </div>`;

  await transporter.sendMail({
    to: email,
    subject: '🚀 Account Approved: Setup your Department Account',
    html
  });
};

/* =========================================================
   4. ADMIN: HALL BOOKING APPROVAL REQUEST (EXISTING)
   ========================================================= */
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

/* =========================================================
   5. DEPARTMENT: BOOKING DECISION NOTICE (EXISTING)
   ========================================================= */
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