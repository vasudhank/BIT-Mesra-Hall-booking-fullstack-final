// backend/index1.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { hashSync, compareSync } = require('bcrypt');


const Admin = require("./models/admin");
const Department = require('./models/department');
const Department_Requests = require('./models/department_requests');

const adminPassport = require('./config/passport');
const departmentPassport = require('./config/department_passport');
const details = require('./routes/constants');

require('dotenv').config();

// Basic test route
router.get('/', (req, res) => {
  res.send({ "HELLO WORLD": "SERVER STARTED" });
});

// Create admin (unchanged)
router.post('/create_admin', (req, res) => {
  const newUser = new Admin({
    email: req.body.email,
    password: hashSync(req.body.password, 10)
  });

  newUser.save()
    .then((user) => res.status(201).json(user))
    .catch((error) => res.status(500).json({ error: 'Failed to create user' }));
});

// Admin Login Route (unchanged)
router.post('/admin_login', (req, res, next) => {
  adminPassport.authenticate('admin', (err, user, info) => {
    if (err) {
      return res.status(500).json({ error: 'Internal server error', details: err });
    }
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.logIn(user, (err) => {
      if (err) {
        return res.status(500).json({ error: 'Login failed', details: err });
      }
      return res.status(200).json({ msg: 'Successfully Logged In', admin: user });
    });
  })(req, res, next);
});
// SEND OTP
// SEND OTP - Admin
router.post('/admin/send_otp', async (req, res) => {
  const { email } = req.body;
  const admin = await Admin.findOne({ email });
  if (!admin) return res.status(404).send({ success: false });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  admin.otp = hashSync(otp, 10);
  admin.otpExpiry = Date.now() + 10 * 60 * 1000;
  await admin.save();

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL,
      pass: process.env.EMAIL_APP_PASSWORD
    }
  });

  const html = `
  <div style="margin:0;padding:0;background:#f3f4f6;">
    <div style="max-width:520px;margin:30px auto;background:#ffffff;
      border-radius:12px;overflow:hidden;
      font-family:Arial,Helvetica,sans-serif;
      box-shadow:0 10px 25px rgba(0,0,0,0.15);">

      <div style="background:linear-gradient(135deg,#ff8a00,#e52e71);
        padding:20px;text-align:center;color:#fff;">
        <h1 style="margin:0;font-size:22px;">Admin Password Reset</h1>
      </div>

      <div style="padding:28px;color:#111;">
        <p style="font-size:15px;">Hello Admin,</p>

        <p style="font-size:15px;">
          We received a request to reset your password. Use the OTP below:
        </p>

        <div style="margin:25px auto;
          text-align:center;
          font-size:32px;
          letter-spacing:6px;
          font-weight:bold;
          background:#f9fafb;
          border:2px dashed #e52e71;
          color:#e52e71;
          width:fit-content;
          padding:12px 24px;
          border-radius:10px;">
          ${otp}
        </div>

        <p style="font-size:14px;color:#374151;">
          ⏳ This OTP is valid for <b>10 minutes</b>.
        </p>

        <p style="font-size:14px;color:#6b7280;">
          If you didn’t request this, you can safely ignore this email.
        </p>

        <p style="margin-top:30px;font-size:14px;">
          Regards,<br/>
          <b>Seminar Hall Booking System</b>
        </p>
      </div>

      <div style="background:#f3f4f6;
        text-align:center;
        padding:12px;
        font-size:12px;
        color:#6b7280;">
        © ${new Date().getFullYear()} Seminar Hall Booking System
      </div>

    </div>
  </div>
  `;

  await transporter.sendMail({
    to: email,
    subject: "🔐 Admin Password Reset OTP",
    html
  });

  res.send({ success: true });
});

// RESET PASSWORD
router.post('/admin/reset_password', async (req,res)=>{
  const { email, otp, password } = req.body;
  const admin = await Admin.findOne({ email });

  if(!admin || !admin.otpExpiry || admin.otpExpiry < Date.now())
    return res.status(400).send({success:false, msg:"OTP expired"});

  if(!compareSync(otp, admin.otp))
    return res.status(400).send({success:false, msg:"Invalid OTP"});

  admin.password = hashSync(password,10);
  admin.otp = null;
  admin.otpExpiry = null;
  await admin.save();

  res.send({success:true});
});
// SEND OTP - Department
// SEND OTP - Department
router.post('/department/send_otp', async (req, res) => {
  const { email } = req.body;
  const dept = await Department.findOne({ email });
  if (!dept) return res.status(404).send({ success: false });

  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  dept.otp = hashSync(otp, 10);
  dept.otpExpiry = Date.now() + 10 * 60 * 1000;
  await dept.save();

  const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL,
      pass: process.env.EMAIL_APP_PASSWORD
    }
  });

  const html = `
  <div style="margin:0;padding:0;background:#f3f4f6;">
    <div style="max-width:520px;margin:30px auto;background:#ffffff;
      border-radius:12px;overflow:hidden;
      font-family:Arial,Helvetica,sans-serif;
      box-shadow:0 10px 25px rgba(0,0,0,0.15);">

      <div style="background:linear-gradient(135deg,#4ade80,#16a34a);
        padding:20px;text-align:center;color:#fff;">
        <h1 style="margin:0;font-size:22px;">Department Password Reset</h1>
      </div>

      <div style="padding:28px;color:#111;">
        <p style="font-size:15px;">Hello,</p>

        <p style="font-size:15px;">
          You requested to reset your department account password.  
          Use the OTP below:
        </p>

        <div style="margin:25px auto;
          text-align:center;
          font-size:32px;
          letter-spacing:6px;
          font-weight:bold;
          background:#f0fdf4;
          border:2px dashed #16a34a;
          color:#16a34a;
          width:fit-content;
          padding:12px 24px;
          border-radius:10px;">
          ${otp}
        </div>

        <p style="font-size:14px;color:#374151;">
          ⏳ This OTP is valid for <b>10 minutes</b>.
        </p>

        <p style="font-size:14px;color:#6b7280;">
          If you didn’t request this, please ignore this email.
        </p>

        <p style="margin-top:30px;font-size:14px;">
          Regards,<br/>
          <b>Seminar Hall Booking System</b>
        </p>
      </div>

      <div style="background:#f3f4f6;
        text-align:center;
        padding:12px;
        font-size:12px;
        color:#6b7280;">
        © ${new Date().getFullYear()} Seminar Hall Booking System
      </div>

    </div>
  </div>
  `;

  await transporter.sendMail({
    to: email,
    subject: "🔐 Department Password Reset OTP",
    html
  });

  res.send({ success: true });
});

// SEND OTP - Department
router.post('/department/send_otp', async (req,res)=>{
  const { email } = req.body;
  const dept = await Department.findOne({ email });
  if(!dept) return res.status(404).send({success:false});

  const otp = Math.floor(100000 + Math.random()*900000).toString();
  dept.otp = hashSync(otp,10);
  dept.otpExpiry = Date.now() + 10*60*1000;
  await dept.save();

  const transporter = nodemailer.createTransport({
    host:'smtp.gmail.com',
    port:465,
    secure:true,
    auth:{ user:process.env.EMAIL, pass:process.env.EMAIL_APP_PASSWORD }
  });

  await transporter.sendMail({
    to: email,
    subject: "Department Password Reset OTP",
    html: `<p>Your OTP is <b>${otp}</b>. It expires in 10 minutes.</p>`
  });

  res.send({success:true});
});

// RESET PASSWORD - Department
router.post('/department/reset_password', async (req,res)=>{
  const { email, otp, password } = req.body;
  const dept = await Department.findOne({ email });

  if(!dept || !dept.otpExpiry || dept.otpExpiry < Date.now())
    return res.status(400).send({success:false, msg:"OTP expired"});

  if(!compareSync(otp, dept.otp))
    return res.status(400).send({success:false, msg:"Invalid OTP"});

  dept.password = hashSync(password,10);
  dept.otp = null;
  dept.otpExpiry = null;
  await dept.save();

  res.send({success:true});
});

// RESET PASSWORD - Department
router.post('/department/reset_password', async (req,res)=>{
  const { email, otp, password } = req.body;
  const dept = await Department.findOne({ email });

  if(!dept || !dept.otpExpiry || dept.otpExpiry < Date.now())
    return res.status(400).send({success:false, msg:"OTP expired"});

  if(!compareSync(otp, dept.otp))
    return res.status(400).send({success:false, msg:"Invalid OTP"});

  dept.password = hashSync(password,10);
  dept.otp = null;
  dept.otpExpiry = null;
  await dept.save();

  res.send({success:true});
});

// Department Login Route (unchanged)
router.post('/department_login', (req, res, next) => {
  departmentPassport.authenticate('department', (err, user, info) => {
    if (err) {
      return res.status(500).json({ error: 'Internal server error', details: err });
    }
    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.logIn(user, (err) => {
      if (err) {
        return res.status(500).json({ error: 'Login failed', details: err });
      }
      return res.status(200).json({ msg: 'Successfully Logged In', department: user });
    });
  })(req, res, next);
});

// Get Details of Authenticated User Route
router.get('/details', async (req, res) => {
  if (req.isAuthenticated()) {
    return res.send({ status: "Authenticated", details: req.user });
  } else {
    return res.send({ status: "Not Authenticated", msg: 'Not Authenticated' });
  }
});

/**
 * CREATE DEPARTMENT (Admin approves a department request)
 * - Generates a single-use token and expiry stored on the Department document.
 * - Sends email with button linking to frontend /department/account?token=...
 *
 * Note: Department model must have resetToken and resetTokenExpiry fields.
 */
router.post('/create_department', async (req, res) => {
  if (!(req.isAuthenticated() && req.user.type === 'Admin')) {
    return res.status(403).send({ msg: "You are not authorized to create department" });
  }

  // generate secure single-use token and expiry (1 hour)
  const token = crypto.randomBytes(32).toString('hex');
  const expiry = Date.now() + 1000 * 60 * 60; // 1 hour

  const newUser = new Department({
    email: req.body.email,
    password: hashSync(req.body.password, 10),
    department: req.body.department,
    head: req.body.head,
    resetToken: token,
    resetTokenExpiry: expiry
  });

  try {
    // remove the request record (admin approved)
    const deletedDocument = await Department_Requests.findOneAndDelete({ email: req.body.email });

    // save new department (with token)
    await newUser.save();

    // Build one-click URL
    const frontendOrigin = process.env.FRONTEND_URL || 'http://localhost:3000';
    const oneClickUrl = `${frontendOrigin}/department/account?token=${encodeURIComponent(token)}`;

    // prepare email content
    const fromEmail = process.env.EMAIL || details.EMAIL || 'no-reply@example.com';
    const subject = 'Your Department Has Been Approved';
    const html = `
      <div style="font-family: Arial, Helvetica, sans-serif; color:#111; line-height:1.4;">
        <h2 style="color:#1f2937; margin-bottom:0.5rem;">Department Approved</h2>
        <p>Hello ${req.body.head || ''},</p>
        <p>Your department <strong>${req.body.department}</strong> has been created in the Seminar Hall Booking system.</p>
        <p><strong>Login email:</strong> ${req.body.email}</p>
        <p><strong>Temporary password:</strong> <code style="background:#f3f4f6;padding:4px 6px;border-radius:4px;">${req.body.password}</code></p>
        <p>Please change your password immediately for security. For convenience you can click the button below to open the account page and sign in automatically (link valid for 1 hour):</p>

        <p style="margin: 1rem 0;">
          <a href="${oneClickUrl}" style="display:inline-block;background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;">
            Open account & change password
          </a>
        </p>

        <p style="font-size:12px;color:#6b7280;">
          If you did not request this, ignore this email or contact your administrator. The link expires in 1 hour.
        </p>
      </div>
    `;

    // send email
    if (!process.env.EMAIL || !process.env.EMAIL_APP_PASSWORD) {
      console.warn('EMAIL or EMAIL_APP_PASSWORD not set in environment. Email will not be sent.');
    }

    const transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 465,
      secure: true,
      auth: {
        user: process.env.EMAIL,
        pass: process.env.EMAIL_APP_PASSWORD
      }
    });

    const mailOptions = {
      from: fromEmail,
      to: req.body.email,
      subject,
      html
    };

    const info = await transporter.sendMail(mailOptions);

    return res.send({
      department: newUser,
      mail: { success: true, messageId: info.messageId },
      deleted_request: deletedDocument
    });

  } catch (error) {
    console.error('create_department error:', error);
    return res.status(500).send({
      error: error.message || error,
      details: error.response && error.response.body ? error.response.body : undefined
    });
  }
});

/**
 * AUTO-LOGIN BY TOKEN
 * - Frontend POSTs { token } to this route with withCredentials:true.
 * - If token valid and not expired => req.logIn(department) to create session cookie.
 * - Token is cleared (single-use).
 */
router.post('/department/auto_login', async (req, res) => {
  const { token } = req.body;
  if (!token) return res.status(400).send({ success: false, message: 'Missing token' });

  try {
    const dept = await Department.findOne({
      resetToken: token,
      resetTokenExpiry: { $gt: Date.now() }
    });

    if (!dept) {
      return res.status(404).send({ success: false, message: 'Invalid or expired token' });
    }

    // Use passport to create a session
    req.logIn(dept, async (err) => {
      if (err) {
        console.error('auto_login req.logIn error:', err);
        return res.status(500).send({ success: false, message: 'Auto-login failed' });
      }

      // Clear token fields (single-use)
      dept.resetToken = null;
      dept.resetTokenExpiry = null;
      await dept.save();

      return res.send({
        success: true,
        department: {
          email: dept.email,
          department: dept.department,
          head: dept.head
        }
      });
    });

  } catch (err) {
    console.error('department/auto_login error:', err);
    return res.status(500).send({ success: false, message: 'Server error' });
  }
});

// Failed Route (unchanged)
router.get('/failed', (req, res) => res.send({ 'error': 'Error in Logging In' }));

// Logout (unchanged)
router.get('/logout', function (req, res) {
  req.logout(function (err) {
    if (err) {
      console.log('Error occured while loging out');
      return;
    }
    res.send({ msg: 'LOGGED OUT' });
  });
});

// mount sub-routers (unchanged)
router.use('/hall', require('./routes/hall'));
router.use('/department', require('./routes/department'));
router.use('/booking', require('./routes/booking'));
router.use('/approval', require('./routes/approval'));

module.exports = router;
