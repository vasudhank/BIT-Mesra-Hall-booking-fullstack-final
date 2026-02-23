const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { hashSync, compareSync } = require('bcrypt');
const path = require('path');

const Admin = require('./models/admin');
const Department = require('./models/department');
const Developer = require('./models/developer');
const Department_Requests = require('./models/department_requests');

const passport = require('./config/passport');

const details = require('./routes/constants');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const createTransporter = () =>
  nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
      user: process.env.EMAIL,
      pass: process.env.EMAIL_APP_PASSWORD
    }
  });

const sendOtpMail = async ({ to, subject, otp, intro = 'Use OTP below' }) => {
  if (!process.env.EMAIL || !process.env.EMAIL_APP_PASSWORD) return;
  const transporter = createTransporter();
  await transporter.sendMail({
    to,
    subject,
    html: `
      <div style="font-family:Arial,sans-serif;padding:16px">
        <h3 style="margin:0 0 12px">${subject}</h3>
        <p>${intro}</p>
        <div style="display:inline-block;padding:10px 16px;border:1px dashed #333;border-radius:8px;font-size:24px;letter-spacing:4px;font-weight:700">${otp}</div>
        <p style="margin-top:12px">OTP valid for 10 minutes.</p>
      </div>
    `
  });
};

const isAuthenticatedRole = (req, role) =>
  req.isAuthenticated &&
  req.isAuthenticated() &&
  String(req.user?.type || '').toLowerCase() === String(role || '').toLowerCase();

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

/* ---------------- DEVELOPER LOGIN ---------------- */
router.post('/developer_login', (req, res, next) => {
  passport.authenticate('developer', (err, user) => {
    if (err) {
      return res.status(500).json({ error: 'Internal server error', details: err });
    }

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.logIn(user, (loginErr) => {
      if (loginErr) {
        return res.status(500).json({ error: 'Login failed', details: loginErr });
      }
      res.status(200).json({ msg: 'Successfully Logged In', developer: user });
    });
  })(req, res, next);
});

/* ---------------- SEND OTP (DEVELOPER) ---------------- */
router.post('/developer/send_otp', async (req, res) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const dev = await Developer.findOne({ email });
    if (!dev) return res.status(404).send({ success: false });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    dev.otp = hashSync(otp, 10);
    dev.otpExpiry = Date.now() + 10 * 60 * 1000;
    await dev.save();

    await sendOtpMail({
      to: email,
      subject: 'Developer Password Reset OTP',
      otp,
      intro: 'Use this OTP to reset your developer password.'
    });

    res.send({ success: true });
  } catch (err) {
    res.status(500).send({ success: false, msg: err.message });
  }
});

/* ---------------- RESET PASSWORD (DEVELOPER) ---------------- */
router.post('/developer/reset_password', async (req, res) => {
  try {
    const email = String(req.body.email || '').toLowerCase().trim();
    const otp = String(req.body.otp || '');
    const password = String(req.body.password || '');
    const dev = await Developer.findOne({ email });

    if (!dev || dev.otpExpiry < Date.now()) {
      return res.status(400).send({ success: false, msg: 'OTP expired' });
    }
    if (!compareSync(otp, dev.otp)) {
      return res.status(400).send({ success: false, msg: 'Invalid OTP' });
    }

    dev.password = hashSync(password, 10);
    dev.otp = null;
    dev.otpExpiry = null;
    await dev.save();

    res.send({ success: true });
  } catch (err) {
    res.status(500).send({ success: false, msg: err.message });
  }
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

const ACCOUNT_ROLE_MAP = {
  admin: { roleName: 'admin', model: Admin, defaultName: 'Admin' },
  developer: { roleName: 'developer', model: Developer, defaultName: 'Developer' }
};

const getAccountRoleConfig = (roleParam) => ACCOUNT_ROLE_MAP[String(roleParam || '').toLowerCase()] || null;

router.get('/account/:role', async (req, res) => {
  try {
    const cfg = getAccountRoleConfig(req.params.role);
    if (!cfg) return res.status(404).json({ error: 'Invalid account role' });
    if (!isAuthenticatedRole(req, cfg.roleName)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const account = await cfg.model.findById(req.user.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    res.json({
      account: {
        name: account.name || cfg.defaultName,
        email: account.email,
        phone: account.phone || '',
        type: account.type || cfg.defaultName
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/account/:role/profile', async (req, res) => {
  try {
    const cfg = getAccountRoleConfig(req.params.role);
    if (!cfg) return res.status(404).json({ error: 'Invalid account role' });
    if (!isAuthenticatedRole(req, cfg.roleName)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const name = String(req.body.name || '').trim().slice(0, 120);
    const phone = String(req.body.phone || '').trim().slice(0, 30);
    const updates = {};
    if (name) updates.name = name;
    updates.phone = phone;

    const account = await cfg.model.findByIdAndUpdate(req.user.id, { $set: updates }, { new: true });
    if (!account) return res.status(404).json({ error: 'Account not found' });
    res.json({
      account: {
        name: account.name || cfg.defaultName,
        email: account.email,
        phone: account.phone || '',
        type: account.type || cfg.defaultName
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/account/:role/send_email_otp', async (req, res) => {
  try {
    const cfg = getAccountRoleConfig(req.params.role);
    if (!cfg) return res.status(404).json({ error: 'Invalid account role' });
    if (!isAuthenticatedRole(req, cfg.roleName)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const newEmail = String(req.body.newEmail || '').toLowerCase().trim();
    if (!newEmail) return res.status(400).json({ error: 'newEmail is required' });

    const existingAdmin = await Admin.findOne({ email: newEmail });
    const existingDev = await Developer.findOne({ email: newEmail });
    if ((existingAdmin && String(existingAdmin._id) !== String(req.user.id)) || (existingDev && String(existingDev._id) !== String(req.user.id))) {
      return res.status(409).json({ error: 'Email already in use.' });
    }

    const account = await cfg.model.findById(req.user.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    account.otp = hashSync(otp, 10);
    account.otpExpiry = Date.now() + 10 * 60 * 1000;
    account.pendingEmail = newEmail;
    await account.save();

    await sendOtpMail({
      to: newEmail,
      subject: `${cfg.defaultName} Email Change OTP`,
      otp,
      intro: 'Enter this OTP in account page to confirm your new email.'
    });

    res.json({ success: true, message: 'OTP sent to new email.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/account/:role/verify_email_otp', async (req, res) => {
  try {
    const cfg = getAccountRoleConfig(req.params.role);
    if (!cfg) return res.status(404).json({ error: 'Invalid account role' });
    if (!isAuthenticatedRole(req, cfg.roleName)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const newEmail = String(req.body.newEmail || '').toLowerCase().trim();
    const otp = String(req.body.otp || '');
    const account = await cfg.model.findById(req.user.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });

    if (!account.pendingEmail || account.pendingEmail !== newEmail) {
      return res.status(400).json({ error: 'No pending email change for this email.' });
    }
    if (!account.otp || !account.otpExpiry || account.otpExpiry < Date.now()) {
      return res.status(400).json({ error: 'OTP expired.' });
    }
    if (!compareSync(otp, account.otp)) {
      return res.status(400).json({ error: 'Invalid OTP.' });
    }

    account.email = newEmail;
    account.pendingEmail = null;
    account.otp = null;
    account.otpExpiry = null;
    await account.save();

    if (req.user) req.user.email = newEmail;
    res.json({
      success: true,
      account: {
        name: account.name || cfg.defaultName,
        email: account.email,
        phone: account.phone || '',
        type: account.type || cfg.defaultName
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/account/:role/change_password', async (req, res) => {
  try {
    const cfg = getAccountRoleConfig(req.params.role);
    if (!cfg) return res.status(404).json({ error: 'Invalid account role' });
    if (!isAuthenticatedRole(req, cfg.roleName)) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'currentPassword and newPassword are required' });
    }

    const account = await cfg.model.findById(req.user.id);
    if (!account) return res.status(404).json({ error: 'Account not found' });
    if (!compareSync(currentPassword, account.password)) {
      return res.status(400).json({ error: 'Current password is incorrect.' });
    }

    account.password = hashSync(newPassword, 10);
    await account.save();
    res.json({ success: true, message: 'Password updated.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
router.use('/complaints', require('./routes/complaints'));
router.use('/queries', require('./routes/queries'));
router.use('/feedback', require('./routes/feedback'));
router.use('/faq', require('./routes/faq'));
module.exports = router;
