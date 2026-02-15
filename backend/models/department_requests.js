const mongoose = require('mongoose');

const departmentrequestSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true
    },
    phone: {
        type: String,
        required: true
    },
    department: {
        type: String,
        required: true
    },
    head: {
        type: String,
        required: true
    },
    // New fields for Email Actions
    actionToken: { type: String, default: null },
    tokenExpiry: { type: Date, default: null } 
});

const Department_Requests = mongoose.model('Department_Requests', departmentrequestSchema);

module.exports = Department_Requests;
