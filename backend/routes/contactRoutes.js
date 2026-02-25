const express = require('express');
const router = express.Router();
const Contact = require('../models/Contact'); // Ensure this path matches your project structure

const isAdminAuthenticated = (req) => (
  req.isAuthenticated &&
  req.isAuthenticated() &&
  req.user &&
  req.user.type === 'Admin'
);

// GET /api/contact/get_contacts
router.get('/get_contacts', async (req, res) => {
  try {
    // Fetch all contacts, sorted by 'order' or creation date
    const contacts = await Contact.find().sort({ order: 1, createdAt: 1 });
    res.status(200).json({ contacts });
  } catch (error) {
    console.error("Error fetching contacts:", error);
    res.status(500).json({ error: "Failed to fetch contacts" });
  }
});

// Optional: Route to add contacts (Use Postman or a script to add them initially)
router.post('/add', async (req, res) => {
  if (!isAdminAuthenticated(req)) {
    return res.status(403).json({ success: false, message: 'You are not authorized' });
  }

  try {
    const name = String(req.body.name || '').trim();
    const number = String(req.body.number || '').replace(/\D/g, '').slice(0, 15);
    const email = String(req.body.email || '').trim();
    const order = Number(req.body.order) || 0;

    if (!name) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }

    if (!/^\d{10,15}$/.test(number)) {
      return res.status(400).json({ success: false, message: 'Phone number must contain 10 to 15 digits' });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address' });
    }

    const newContact = new Contact({ name, number, email, order });
    await newContact.save();
    res.status(201).json({ success: true, message: "Contact added", contact: newContact });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// PATCH /api/contact/admin_update/:id
// Admin-only inline update for Wish Your Day contact fields.
router.patch('/admin_update/:id', async (req, res) => {
  if (!isAdminAuthenticated(req)) {
    return res.status(403).json({ success: false, message: 'You are not authorized' });
  }

  const { id } = req.params;
  const { field, value } = req.body;
  const allowedFields = ['email', 'number'];

  if (!allowedFields.includes(field)) {
    return res.status(400).json({ success: false, message: 'Invalid field for update' });
  }

  const normalizedValue = String(value || '').trim();

  if (field === 'email') {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(normalizedValue)) {
      return res.status(400).json({ success: false, message: 'Please provide a valid email address' });
    }
  }

  if (field === 'number') {
    if (!/^\d{10,15}$/.test(normalizedValue)) {
      return res.status(400).json({ success: false, message: 'Phone number must contain 10 to 15 digits' });
    }
  }

  try {
    const updatedContact = await Contact.findByIdAndUpdate(
      id,
      { $set: { [field]: normalizedValue } },
      { new: true }
    );

    if (!updatedContact) {
      return res.status(404).json({ success: false, message: 'Contact not found' });
    }

    return res.status(200).json({
      success: true,
      message: 'Contact updated successfully',
      contact: updatedContact
    });
  } catch (error) {
    console.error('Error updating contact:', error);
    return res.status(500).json({ success: false, message: 'Failed to update contact' });
  }
});

module.exports = router;
