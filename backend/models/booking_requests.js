// models/booking_requests.js
const mongoose = require('mongoose');

const bookingrequestSchema = new mongoose.Schema({
  hall: { type: String, required: true },

  department: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Department',
    required: true,
  },

  event: { type: String, required: true },
  
  // NEW FIELD
  description: { type: String, maxLength: 10000 }, 

  startDateTime: { type: Date, required: true },
  endDateTime: { type: Date, required: true },

  startTime12: String,
  endTime12: String,
  startTime24: String,
  endTime24: String,
  startDate: String,
  endDate: String,

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },

  status: {
    type: String,
    enum: ['PENDING', 'APPROVED', 'REJECTED', 'AUTO_BOOKED', 'LEFT', 'VACATED'],
    default: 'PENDING'
  },

  approvalToken: { type: String },
  tokenExpiry: { type: Date },

}, { timestamps: true });

module.exports = mongoose.model('Booking_Requests', bookingrequestSchema);
