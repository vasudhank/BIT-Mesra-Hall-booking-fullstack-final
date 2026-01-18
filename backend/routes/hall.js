const express = require('express');
const router = express.Router();
const Hall = require('../models/hall');

// Test route
router.get('/', (req, res) => {
  res.send({ msg: 'Inside Hall Router' });
});

// Create Hall (Admin only)
router.post('/create_hall', async (req, res) => {
  try {
    console.log('🔍 isAuthenticated:', req.isAuthenticated?.());
    console.log('🔍 session user:', req.user);
    if (
      !(
        req.isAuthenticated &&
        req.isAuthenticated() &&
        req.user.type === 'Admin'
      )
    ) {
      return res.status(403).json({ msg: 'You are not authorized to create hall' });
    }

    const newHall = new Hall({
      name: req.body.name,
      status: 'Not Filled',
      capacity: req.body.capacity,
      department: null,
      event: ''
    });

    const saved = await newHall.save();
    return res.status(201).json(saved);

  } catch (err) {
    console.error('create_hall error:', err);
    return res.status(500).json({ error: err.message || err });
  }
});

// Getting all the Halls (computes status at read-time)
router.get('/view_halls', async (req, res) => {
  try {
    const halls = await Hall.find().lean();
    const now = new Date();

    const hallsWithStatus = halls.map(h => {
      const bookings = h.bookings || [];
      const filled = bookings.some(
        b =>
          new Date(b.startDateTime) <= now &&
          new Date(b.endDateTime) > now
      );

      return {
        ...h,
        status: filled ? 'Filled' : 'Not Filled'
      };
    });

    return res.status(200).json({ halls: hallsWithStatus });

  } catch (err) {
    console.error('view_halls error:', err);
    return res.status(500).json({ error: err.message || err });
  }
});

// Change the status of the halls (Admin manual clear)
router.post('/clear_hall', async (req, res) => {
  try {
    if (
      !(
        req.isAuthenticated &&
        req.isAuthenticated() &&
        req.user.type === 'Admin'
      )
    ) {
      return res.status(403).json({ msg: 'You are not authorized' });
    }

    const updatedDocument = await Hall.findOneAndUpdate(
      { name: req.body.name },
      {
        department: "",
        event: "",
        status: "Not Filled"
      },
      { new: true }
    );

    return res.status(200).json({
      status: 'Changed Status',
      updates: updatedDocument
    });

  } catch (err) {
    console.error('clear_hall error:', err);
    return res.status(500).json({ error: err.message || err });
  }
});

module.exports = router;
