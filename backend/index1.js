const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { hashSync, compareSync } = require('bcrypt');
const path = require('path');

const Admin = require('./models/admin');
const Department = require('./models/department');
const Department_Requests = require('./models/department_requests');

const passport = require('./config/passport');

const details = require('./routes/constants');

require('dotenv').config({ path: path.join(__dirname, '.env') });

/* ---------------- BASIC TEST ROUTE ---------------- */
router.get('/', (req, res) => {
  res.send({ "HELLO WORLD": "SERVER STARTED" });
});

/* ---------------- CREATE ADMIN ---------------- */
router.post('/create_admin', (req, res) => {
  const newUser = new Admin({
  email: req.body.email,
  password: hashSync(req.body.password, 10),
  type: 'Admin'
});

  newUser.save()
    .then(user => res.status(201).json(user))
    .catch(() => res.status(500).json({ error: 'Failed to create user' }));
});

/* ---------------- ADMIN LOGIN ---------------- */
router.post('/admin_login', (req, res, next) => {
  passport.authenticate('admin', (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Internal server error', details: err });
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.logIn(user, err => {
      if (err) {
        return res.status(500).json({ error: 'Login failed', details: err });
      }

      res.status(200).json({ msg: 'Successfully Logged In', admin: user });
    });
  })(req, res, next);
});

/* ---------------- SEND OTP (ADMIN) ---------------- */
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
    <div style="max-width:520px;margin:30px auto;background:#ffffff;border-radius:12px;overflow:hidden;
      font-family:Arial,Helvetica,sans-serif;box-shadow:0 10px 25px rgba(0,0,0,0.15);">
      <div style="background:linear-gradient(135deg,#ff8a00,#e52e71);padding:20px;text-align:center;color:#fff;">
        <h1 style="margin:0;font-size:22px;">Admin Password Reset</h1>
      </div>
      <div style="padding:28px;color:#111;">
        <p>Hello Admin,</p>
        <p>Use the OTP below:</p>
        <div style="margin:25px auto;text-align:center;font-size:32px;letter-spacing:6px;
          font-weight:bold;background:#f9fafb;border:2px dashed #e52e71;color:#e52e71;
          width:fit-content;padding:12px 24px;border-radius:10px;">
          ${otp}
        </div>
        <p>⏳ OTP valid for <b>10 minutes</b>.</p>
        <p>Regards,<br/><b>Seminar Hall Booking System</b></p>
      </div>
    </div>
  </div>`;

  await transporter.sendMail({
    to: email,
    subject: '🔐 Admin Password Reset OTP',
    html
  });

  res.send({ success: true });
});

/* ---------------- RESET PASSWORD (ADMIN) ---------------- */
router.post('/admin/reset_password', async (req, res) => {
  const { email, otp, password } = req.body;
  const admin = await Admin.findOne({ email });

  if (!admin || admin.otpExpiry < Date.now()) {
    return res.status(400).send({ success: false, msg: 'OTP expired' });
  }

  if (!compareSync(otp, admin.otp)) {
    return res.status(400).send({ success: false, msg: 'Invalid OTP' });
  }

  admin.password = hashSync(password, 10);
  admin.otp = null;
  admin.otpExpiry = null;

  await admin.save();
  res.send({ success: true });
});

/* ---------------- SEND OTP (DEPARTMENT) ---------------- */
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

  await transporter.sendMail({
    to: email,
    subject: 'Department Password Reset OTP',
    html: `<p>Your OTP is <b>${otp}</b>. It expires in 10 minutes.</p>`
  });

  res.send({ success: true });
});

/* ---------------- RESET PASSWORD (DEPARTMENT) ---------------- */
router.post('/department/reset_password', async (req, res) => {
  const { email, otp, password } = req.body;
  const dept = await Department.findOne({ email });

  if (!dept || dept.otpExpiry < Date.now()) {
    return res.status(400).send({ success: false, msg: 'OTP expired' });
  }

  if (!compareSync(otp, dept.otp)) {
    return res.status(400).send({ success: false, msg: 'Invalid OTP' });
  }

  dept.password = hashSync(password, 10);
  dept.otp = null;
  dept.otpExpiry = null;

  await dept.save();
  res.send({ success: true });
});

/* ---------------- DEPARTMENT LOGIN ---------------- */
router.post('/department_login', (req, res, next) => {
  passport.authenticate('department', (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Internal server error', details: err });
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.logIn(user, err => {
      if (err) {
        return res.status(500).json({ error: 'Login failed', details: err });
      }

      res.status(200).json({ msg: 'Successfully Logged In', department: user });
    });
  })(req, res, next);
});

/* ---------------- VERIFY OTP (ADMIN) ---------------- */
router.post('/admin/verify_otp', async (req, res) => {
  const { email, otp } = req.body;
  const admin = await Admin.findOne({ email });

  if (!admin) {
    return res.status(404).send({ success: false, msg: 'User not found' });
  }

  if (!admin.otp || admin.otpExpiry < Date.now()) {
    return res.status(400).send({ success: false, msg: 'OTP expired' });
  }

  if (!compareSync(otp, admin.otp)) {
    return res.status(400).send({ success: false, msg: 'Invalid OTP' });
  }

  res.send({ success: true });
});

/* ---------------- VERIFY OTP (DEPARTMENT) ---------------- */
router.post('/department/verify_otp', async (req, res) => {
  const { email, otp } = req.body;
  const dept = await Department.findOne({ email });

  if (!dept) {
    return res.status(404).send({ success: false, msg: 'User not found' });
  }

  if (!dept.otp || dept.otpExpiry < Date.now()) {
    return res.status(400).send({ success: false, msg: 'OTP expired' });
  }

  if (!compareSync(otp, dept.otp)) {
    return res.status(400).send({ success: false, msg: 'Invalid OTP' });
  }

  res.send({ success: true });
});




/* ---------------- AUTH DETAILS ---------------- */
router.get('/details', (req, res) => {
  if (req.isAuthenticated()) {
    res.send({ status: 'Authenticated', details: req.user });
  } else {
    res.send({ status: 'Not Authenticated', msg: 'Not Authenticated' });
  }
});

/* ---------------- LOGOUT ---------------- */
router.get('/logout', (req, res) => {
  req.logout(err => {
    if (err) return;
    res.send({ msg: 'LOGGED OUT' });
  });
});

/* ---------------- SUB ROUTERS ---------------- */
router.use('/hall', require('./routes/hall'));
router.use('/department', require('./routes/department'));
router.use('/booking', require('./routes/booking'));
router.use('/approval', require('./routes/approval'));
router.use('/contact', require('./routes/contactRoutes'));
module.exports = router;
