const mongoose = require('mongoose');

const departmentSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true
    },
    password: {
        type: String,
        required: true
    },
    department: {
        type: String,
        required: String
    },
    head: {
        type: String,
        required: String
    },
    phone: {
        type: String,
        default: ''
    },

    // Password Reset fields
    resetToken: { type: String, default: null },
    resetTokenExpiry: { type: Date, default: null },
    
    // OTP fields
    otp: { type: String, default: null },
    otpExpiry: { type: Date, default: null },

    // New Account Setup fields
    setupToken: { type: String, default: null },
    setupTokenExpiry: { type: Date, default: null }
});

const Department = mongoose.model('Department', departmentSchema);

module.exports = Department;
