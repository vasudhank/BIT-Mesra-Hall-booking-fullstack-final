// backend/routes/department.js
const express = require('express');
const router = express.Router();
const Department = require('../models/department');
const Department_Requests = require('../models/department_requests');
const { hashSync, compareSync } = require('bcrypt');

// Basic route sanity check
router.get('/', (req,res)=>{
    res.send({ msg:'Inside Department Router' });
});

// GET /api/department/me
// Returns the authenticated department record (exclude password)
router.get('/me', async (req, res) => {
  try {
    // require authentication only (don't fail if type not set exactly)
    if (!req.isAuthenticated()) {
      return res.status(401).send({ success: false, message: 'Not authenticated' });
    }

    const email = req.user && req.user.email;
    if (!email) {
      return res.status(400).send({ success: false, message: 'No email in session' });
    }

    // find the department doc and exclude password
    const dept = await Department.findOne({ email: email }, { password: 0, __v: 0, _id: 0 });
    if (!dept) return res.status(404).send({ success: false, message: 'Department not found' });

    return res.send({ success: true, department: dept });
  } catch (err) {
    console.error('GET /department/me error:', err);
    return res.status(500).send({ success: false, message: 'Server error' });
  }
});

// Public department lookup by email (no password)
router.get('/department/by_email', async (req, res) => {
  try {
    const email = req.query.email;
    if (!email) return res.status(400).send({ success: false, message: 'Missing email' });

    const dept = await Department.findOne({ email }, { password: 0, __v: 0 });
    if (!dept) return res.status(404).send({ success: false, message: 'Department not found' });

    return res.send({ success: true, department: dept });
  } catch (err) {
    console.error('GET /department/by_email error:', err);
    return res.status(500).send({ success: false, message: 'Server error' });
  }
});


// Show the Departments (public)
router.get('/show_departments',(req,res)=>{
  Department.find({},{ _id: 0 , password:0 })
    .then((departments) => res.send({ departments }))
    .catch((error) => res.status(500).send({ error }));
});

// Department request creation
router.post('/request_department' , (req,res)=>{
  const newUser = new Department_Requests({ 
    email:req.body.email,
    department:req.body.department,
    head:req.body.head
  });
  newUser.save()
    .then((user) => res.status(201).json(user))
    .catch((error) => res.status(500).json({ error: 'Failed to create user', details: error }));
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

// Cancel the Department Request (admin only)
router.post('/delete_department_request', async (req,res)=>{
  if(req.isAuthenticated() && req.user.type === 'Admin'){
    try {
      const deletedDocument = await Department_Requests.findOneAndDelete({ email: req.body.email });
      res.send({ delete:deletedDocument });
    } catch (error) {
      res.status(500).send({ error });
    }
  } else {
    res.status(403).send({ msg:'You are not authorized to view the requests' });
  }
});


// Change password for authenticated department
router.post('/change_password', async (req, res) => {
  if (!req.isAuthenticated()) {
    return res.status(401).send({ success: false, message: 'Not authenticated' });
  }

  const email = req.user && req.user.email;
  if (!email) return res.status(400).send({ success: false, message: 'No user in session' });

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).send({ success: false, message: 'Missing fields' });
  }

  try {
    const department = await Department.findOne({ email: email });
    if (!department) {
      return res.status(404).send({ success: false, message: 'Department not found' });
    }

    // verify current password
    if (!compareSync(currentPassword, department.password)) {
      return res.status(403).send({ success: false, message: 'Current password is incorrect' });
    }

    // hash new password and save
    department.password = hashSync(newPassword, 10);
    await department.save();

    return res.send({ success: true, message: 'Password updated' });
  } catch (err) {
    console.error('change_password error:', err);
    return res.status(500).send({ success: false, message: 'Server error' });
  }
});

module.exports = router;
