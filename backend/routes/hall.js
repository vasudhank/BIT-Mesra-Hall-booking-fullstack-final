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
      // Check if there is any booking currently active
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

// Change the status of the halls (Admin manual clear / Vacate)
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

    const hallName = req.body.name;
    const hall = await Hall.findOne({ name: hallName });

    if (!hall) {
      return res.status(404).json({ msg: 'Hall not found' });
    }

    const now = new Date();

    // 🔥 FIXED LOGIC: Completely REMOVE the active booking from the array.
    // This ensures it disappears from the schedule view entirely.
    if (hall.bookings && hall.bookings.length > 0) {
      hall.bookings = hall.bookings.filter(b => {
        const start = new Date(b.startDateTime);
        const end = new Date(b.endDateTime);
        
        // If booking is currently active (start <= now < end), REMOVE IT (return false)
        const isActive = (start <= now && end > now);
        return !isActive; 
      });
    }

    // 2. Clear legacy fields and update status flags
    hall.department = null; 
    hall.event = "";
    hall.status = "Not Filled";

    const updatedHall = await hall.save();

    return res.status(200).json({
      status: 'Changed Status',
      updates: updatedHall
    });

  } catch (err) {
    console.error('clear_hall error:', err);
    return res.status(500).json({ error: err.message || err });
  }
});

// DELETE HALL
router.delete('/delete_hall/:id', async (req, res) => {
    try {
      if (
        !(
          req.isAuthenticated &&
          req.isAuthenticated() &&
          req.user.type === 'Admin'
        )
      ) {
        return res.status(403).json({ msg: 'You are not authorized to delete hall' });
      }
  
      const deletedHall = await Hall.findByIdAndDelete(req.params.id);
  
      if (!deletedHall) {
        return res.status(404).json({ msg: 'Hall not found' });
      }
  
      return res.status(200).json({ msg: 'Hall deleted successfully' });
  
    } catch (err) {
      console.error('delete_hall error:', err);
      return res.status(500).json({ error: err.message || err });
    }
});

module.exports = router;