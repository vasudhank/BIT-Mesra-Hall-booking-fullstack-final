const mongoose = require('mongoose');

const NoticeSchema = new mongoose.Schema({
  subject: String,
  body: String,
  extracted: String, // AI summary
  startDate: String,
  endDate: String,
  halls: [String],
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('Notice', NoticeSchema);
