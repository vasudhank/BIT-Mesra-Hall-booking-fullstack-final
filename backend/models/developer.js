const mongoose = require('mongoose');

const developerSchema = new mongoose.Schema(
  {
    name: { type: String, default: 'Developer' },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    phone: { type: String, default: '' },
    type: { type: String, default: 'Developer', immutable: true },
    otp: { type: String, default: null },
    otpExpiry: { type: Date, default: null },
    pendingEmail: { type: String, default: null }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Developer', developerSchema);

