const mongoose = require('mongoose');

const contactSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true
  },
  number: {
    type: String,
    required: true
  },
  email: {
    type: String,
    required: false // Made optional, change to true if mandatory
  },
  // Optional: Add an order field if you want to control the sort order
  order: {
    type: Number,
    default: 0
  }
}, { timestamps: true });

const Contact = mongoose.model('Contact', contactSchema);

module.exports = Contact;