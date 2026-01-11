// models/hall.js
const mongoose = require('mongoose');

const bookingSubSchema = new mongoose.Schema({
  bookingRequest: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking_Requests', default: null }, // link to request (optional)
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  event: { type: String, default: '' },
  startDateTime: { type: Date, required: true },
  endDateTime: { type: Date, required: true },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });

const hallSchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true },
  capacity: { type: Number, default: 0 },
  // kept for backward compatibility, but will be computed on read
  status: { type: String, enum: ['Filled', 'Not Filled'], default: 'Not Filled' },
  department: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null },
  event: { type: String, default: '' },

  // new bookings array: stores all accepted bookings (active + past)
  bookings: { type: [bookingSubSchema], default: [] }

}, { timestamps: true });

// instance method: is the hall filled at 'date'?
hallSchema.methods.isFilledAt = function(date = new Date()) {
  return this.bookings.some(b => new Date(b.startDateTime) <= date && new Date(b.endDateTime) > date);
};

// static helper: remove bookings that ended before 'cutoff' (optional cleanup)
hallSchema.statics.removeExpiredBookings = async function(cutoff = new Date()) {
  const halls = await this.find({ "bookings.endDateTime": { $lt: cutoff } });
  for (const hall of halls) {
    const beforeLen = hall.bookings.length;
    hall.bookings = hall.bookings.filter(b => new Date(b.endDateTime) > cutoff);
    if (hall.bookings.length !== beforeLen) {
      hall.status = hall.isFilledAt() ? 'Filled' : 'Not Filled';
      await hall.save();
    }
  }
};

module.exports = mongoose.model('Hall', hallSchema);
