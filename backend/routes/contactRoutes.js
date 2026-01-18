const express = require('express');
const router = express.Router();
const Contact = require('../models/Contact'); // Ensure this path matches your project structure

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
  try {
    const { name, number, email, order } = req.body; // Added email here
    const newContact = new Contact({ name, number, email, order }); // Added email here
    await newContact.save();
    res.status(201).json({ message: "Contact added", contact: newContact });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;