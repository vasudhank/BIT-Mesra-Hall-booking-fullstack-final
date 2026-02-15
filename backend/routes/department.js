const express = require('express');
const router = express.Router();
const Department = require('../models/department');
const Department_Requests = require('../models/department_requests');
const Booking_Requests = require('../models/booking_requests');
const Hall = require('../models/hall');
const Admin = require('../models/admin'); 
const Contact = require('../models/Contact');
const { hashSync, compareSync } = require('bcrypt');
const crypto = require('crypto'); 
const emailService = require('../services/emailService');
const smsService = require('../services/smsService');
require('dotenv').config();

// Basic route sanity check
router.get('/', (req,res)=>{
    res.send({ msg:'Inside Department Router' });
});

// GET /api/department/me
router.get('/me', async (req, res) => {
  try {
    if (!req.isAuthenticated()) {
      return res.status(401).send({ success: false, message: 'Not authenticated' });
    }
    const email = req.user && req.user.email;
    if (!email) {
      return res.status(400).send({ success: false, message: 'No email in session' });
    }
    const dept = await Department.findOne({ email: email }, { password: 0, __v: 0, _id: 0 });
    if (!dept) return res.status(404).send({ success: false, message: 'Department not found' });
    return res.send({ success: true, department: dept });
  } catch (err) {
    console.error('GET /department/me error:', err);
    return res.status(500).send({ success: false, message: 'Server error' });
  }
});

// Public department lookup by email
router.get('/department/by_email', async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) return res.status(400).send({ success: false, message: 'Missing email' });
    const dept = await Department.findOne({ email }, { password: 0, __v: 0 });
    if (!dept) return res.status(404).send({ success: false, message: 'Department not found' });
    return res.send({ success: true, department: dept });
  } catch (err) {
    return res.status(500).send({ success: false, message: 'Server error' });
  }
});

router.get('/show_departments',(req,res)=>{
  Department.find({},{ password:0 })
    .then((departments) => res.send({ departments }))
    .catch((error) => res.status(500).send({ error }));
});

// Delete an existing department (admin only)
router.delete('/delete_department/:id', async (req, res) => {
  if (!(req.isAuthenticated && req.isAuthenticated() && req.user.type === 'Admin')) {
    return res.status(403).json({ msg: 'You are not authorized to delete departments' });
  }

  try {
    const { id } = req.params;
    const deletedDepartment = await Department.findByIdAndDelete(id);

    if (!deletedDepartment) {
      return res.status(404).json({ msg: 'Department not found' });
    }

    await Promise.all([
      Booking_Requests.deleteMany({ department: deletedDepartment._id }),
      Hall.updateMany(
        {},
        {
          $pull: { bookings: { department: deletedDepartment._id } },
          $set: { department: null }
        }
      )
    ]);

    return res.status(200).json({
      msg: 'Department deleted successfully',
      department: {
        _id: deletedDepartment._id,
        email: deletedDepartment.email,
        department: deletedDepartment.department
      }
    });
  } catch (error) {
    console.error('delete_department error:', error);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ==========================================
// 1. REQUEST DEPARTMENT (User Action)
// ==========================================
router.post('/request_department', async (req, res) => {
    try {
        const { email, department, head, phone } = req.body;
        const normalizedPhone = String(phone || '').trim();

        if (!email || !department || !head || !normalizedPhone) {
            return res.status(400).json({ error: 'Email, department, faculty name and phone number are required' });
        }

        if (!/^\d{10,15}$/.test(normalizedPhone)) {
            return res.status(400).json({ error: 'Phone number must contain 10 to 15 digits' });
        }
        
        // Generate Token for Email Actions
        const actionToken = crypto.randomBytes(32).toString('hex');
        const tokenExpiry = Date.now() + 24 * 60 * 60 * 1000; // 24 hours

        const newRequest = new Department_Requests({ 
            email, 
            phone: normalizedPhone,
            department, 
            head,
            actionToken,
            tokenExpiry 
        });
        await newRequest.save();

        // --- NOTIFY ADMIN ---
        const admins = await Admin.find({});
        const adminEmails = admins.map(a => a.email).join(','); 
        
        // Construct Action URLs
        const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
        const backendUrl = process.env.PUBLIC_BASE_URL || 'http://localhost:8000';
        
        // Link to Frontend Page for Approval (Needs Admin Password Input)
        const approveUrl = `${frontendUrl}/admin/department/approve/${actionToken}`;
        
        // Link to Backend Route for Direct Rejection
        const rejectUrl = `${backendUrl}/api/department/reject_request_link/${actionToken}`;

        if(adminEmails) {
            emailService.sendRegistrationRequestToAdmin({
                adminEmails,
                requestData: { email, phone: normalizedPhone, department, head },
                approveUrl,
                rejectUrl
            }).catch(err => console.error("Admin Alert Email Failed", err));
        }

        smsService.sendRegistrationAlertToAdmin({ department, head })
          .catch(err => console.error("Admin Alert SMS Failed", err));

        return res.status(201).json(newRequest);

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: 'Failed to request department', details: error });
    }
});

// ==========================================
// 2. VERIFY ACTION TOKEN (For Admin Approval Page)
// ==========================================
router.post('/verify_action_token', async (req, res) => {
    const { token } = req.body;
    try {
        const requestDoc = await Department_Requests.findOne({ 
            actionToken: token,
            tokenExpiry: { $gt: Date.now() }
        });

        if (!requestDoc) {
            return res.status(400).json({ success: false, message: 'Invalid or expired action link.' });
        }

        return res.json({ 
            success: true, 
            request: {
                email: requestDoc.email,
                phone: requestDoc.phone,
                department: requestDoc.department,
                head: requestDoc.head
            }
        });
    } catch (err) {
        return res.status(500).json({ success: false, message: "Server Error" });
    }
});

// ==========================================
// 3. REJECT REQUEST (Direct Link from Email)
// ==========================================
router.get('/reject_request_link/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const requestDoc = await Department_Requests.findOne({ 
            actionToken: token,
            tokenExpiry: { $gt: Date.now() }
        });

        if (!requestDoc) {
            return res.status(400).send('<h1>Invalid or Expired Link</h1>');
        }

        // Notify
        emailService.sendRejectionEmail({
            email: requestDoc.email,
            department: requestDoc.department
        }).catch(e => console.error("Rejection Email Failed", e));
        
        smsService.sendRejectionSMS({
            department: requestDoc.department
        }).catch(e => console.error("Rejection SMS Failed", e));

        // Delete
        await Department_Requests.findOneAndDelete({ _id: requestDoc._id });

        res.send(`
            <div style="font-family: sans-serif; text-align: center; padding: 50px;">
                <h1 style="color: #ef4444;">Request Rejected</h1>
                <p>The department registration request for <b>${requestDoc.department}</b> has been rejected and the user has been notified.</p>
                <p>You can close this window.</p>
            </div>
        `);

    } catch (error) {
        res.status(500).send('Server Error');
    }
});

// ==========================================
// 4. MANUAL DELETE (Dashboard Action)
// ==========================================
router.post('/delete_department_request', async (req,res)=>{
  if(req.isAuthenticated() && req.user.type === 'Admin'){
    try {
      const requestDoc = await Department_Requests.findOne({ email: req.body.email });
      if(requestDoc) {
          emailService.sendRejectionEmail({
              email: requestDoc.email,
              department: requestDoc.department
          }).catch(e => console.error("Rejection Email Failed", e));
          
          smsService.sendRejectionSMS({
              department: requestDoc.department
          }).catch(e => console.error("Rejection SMS Failed", e));

          await Department_Requests.findOneAndDelete({ email: req.body.email });
          res.send({ delete: requestDoc });
      } else {
          res.status(404).send({ error: "Request not found" });
      }
    } catch (error) {
      res.status(500).send({ error });
    }
  } else {
    res.status(403).send({ msg:'You are not authorized' });
  }
});

// Show department requests (admin only)
router.get('/show_department_requests',(req,res)=>{
  if(req.isAuthenticated() && req.user.type === 'Admin'){
    Department_Requests.find({},{ _id: 0})
      .then((requests) => res.send({ requests }))
      .catch((error) => res.status(500).send({ error }));
  } else {
    res.status(403).send({ msg:'You are not authorized to view the requests' });
  }
});

// Change password for authenticated department
router.post('/change_password', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).send({ success: false, message: 'Not authenticated' });
  }
  // ... (Existing logic same as before) ...
  const email = req.user && req.user.email;
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).send({ success: false, message: 'Missing fields' });

  try {
    const department = await Department.findOne({ email: email });
    if (!department) return res.status(404).send({ success: false, message: 'Department not found' });
    if (!compareSync(currentPassword, department.password)) return res.status(403).send({ success: false, message: 'Current password is incorrect' });

    department.password = hashSync(newPassword, 10);
    await department.save();
    return res.send({ success: true, message: 'Password updated' });
  } catch (err) {
    return res.status(500).send({ success: false, message: 'Server error' });
  }
});

// Update phone for authenticated department and keep contact list in sync
router.post('/update_phone', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).send({ success: false, message: 'Not authenticated' });
  }

  const email = req.user && req.user.email;
  const normalizedPhone = String(req.body?.phone || '').trim();

  if (!email) {
    return res.status(400).send({ success: false, message: 'No email in session' });
  }

  if (!/^\d{10,15}$/.test(normalizedPhone)) {
    return res.status(400).send({ success: false, message: 'Phone number must contain 10 to 15 digits' });
  }

  try {
    const department = await Department.findOneAndUpdate(
      { email },
      { $set: { phone: normalizedPhone } },
      { new: true }
    );

    if (!department) {
      return res.status(404).send({ success: false, message: 'Department not found' });
    }

    await Contact.findOneAndUpdate(
      { email: department.email },
      {
        $set: {
          name: department.head,
          number: normalizedPhone,
          email: department.email
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    return res.send({
      success: true,
      message: 'Phone number updated successfully',
      phone: normalizedPhone
    });
  } catch (err) {
    console.error('update phone error:', err);
    return res.status(500).send({ success: false, message: 'Server error' });
  }
});

// ==========================================
// 5. CREATE / APPROVE DEPARTMENT (Admin Action or Token Action)
// ==========================================
router.post('/create', async (req, res) => {
  try {
    // MODIFICATION: Allow if Authenticated Admin OR if a valid Action Token is provided in body
    let isAuthorized = false;
    let requestDoc = null;

    // Case 1: Logged in Admin
    if (req.isAuthenticated() && req.user.type === 'Admin') {
        isAuthorized = true;
    } 
    // Case 2: Email Link Token (No login required)
    else if (req.body.actionToken) {
        requestDoc = await Department_Requests.findOne({ 
            actionToken: req.body.actionToken,
            tokenExpiry: { $gt: Date.now() }
        });
        if (requestDoc && requestDoc.email === req.body.email) {
            isAuthorized = true;
        }
    }

    if (!isAuthorized) {
      return res.status(403).json({ msg: 'You are not authorized' });
    }

    const { email, password, department, head, phone } = req.body;
    const resolvedPhone = String(phone || requestDoc?.phone || '').trim();

    if (!email || !password || !department || !head) {
      return res.status(400).json({ msg: 'All fields are required' });
    }
    if (resolvedPhone && !/^\d{10,15}$/.test(resolvedPhone)) {
      return res.status(400).json({ msg: 'Phone number must contain 10 to 15 digits' });
    }

    const exists = await Department.findOne({ email });
    if (exists) {
      return res.status(409).json({ msg: 'Department already exists' });
    }

    // Generate Setup Token for the Department User
    const setupToken = crypto.randomBytes(32).toString('hex');
    const setupTokenExpiry = Date.now() + 3600000;

    const newDepartment = new Department({
      email,
      password: hashSync(password, 10),
      department,
      head,
      phone: resolvedPhone,
      setupToken,
      setupTokenExpiry
    });

    await newDepartment.save();

    if (resolvedPhone) {
      await Contact.findOneAndUpdate(
        { email },
        {
          $set: {
            name: head,
            number: resolvedPhone,
            email
          }
        },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }

    // Remove the request from Department_Requests since it's now approved
    await Department_Requests.findOneAndDelete({ email });

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const setupUrl = `${frontendUrl}/department/account?token=${setupToken}`;

    // --- NOTIFY DEPARTMENT (WELCOME) ---
    emailService.sendDepartmentWelcomeEmail({
        email,
        password,
        departmentName: department,
        headName: head,
        setupUrl
    }).catch(e => console.error("Welcome Email Failed", e));

    smsService.sendDepartmentWelcomeSMS({
        email,
        password,
        department
    }).catch(e => console.error("Welcome SMS Failed", e));

    return res.status(201).json({
      msg: 'Department created successfully & Email sent',
      department: { email, phone: resolvedPhone, department, head }
    });

  } catch (err) {
    console.error('create department error:', err);
    return res.status(500).json({ error: 'Server error' });
  }
});

// ... (Keep Setup routes: verify_setup_token, complete_setup) ...
router.post('/verify_setup_token', async (req, res) => {
    const { token } = req.body;
    if(!token) return res.status(400).json({success: false, message: "No token provided"});
    try {
        const dept = await Department.findOne({
            setupToken: token,
            setupTokenExpiry: { $gt: Date.now() }
        });
        if (!dept) return res.status(400).json({ success: false, message: 'Invalid or expired setup link.' });
        return res.json({ success: true, department: { email: dept.email, phone: dept.phone, department: dept.department, head: dept.head } });
    } catch(err) { return res.status(500).json({success: false, message: "Server error"}); }
});

router.post('/complete_setup', async (req, res) => {
    const { token, newPassword } = req.body;
    if(!token || !newPassword) return res.status(400).json({success: false, message: "Missing fields"});
    try {
        const dept = await Department.findOne({ setupToken: token, setupTokenExpiry: { $gt: Date.now() } });
        if (!dept) return res.status(400).json({ success: false, message: 'Invalid or expired setup link.' });
        dept.password = hashSync(newPassword, 10);
        dept.setupToken = null;
        dept.setupTokenExpiry = null;
        await dept.save();
        return res.json({ success: true, message: "Password set successfully." });
    } catch(err) { return res.status(500).json({success: false, message: "Server error"}); }
});

module.exports = router;
