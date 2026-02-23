const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['BUG', 'SUGGESTION', 'PRAISE'], required: true },
    message: { type: String, required: true, maxlength: 12000 },
    email: { type: String, default: '', lowercase: true, trim: true },
    rating: { type: Number, min: 1, max: 5, default: null },
    status: {
      type: String,
      enum: ['NEW', 'IN_REVIEW', 'DONE'],
      default: 'NEW'
    },
    visibility: { type: String, enum: ['PUBLIC', 'INTERNAL'], default: 'PUBLIC' },
    createdByRole: {
      type: String,
      enum: ['GUEST', 'ADMIN', 'DEVELOPER', 'DEPARTMENT'],
      default: 'GUEST'
    },
    createdById: { type: String, default: null }
  },
  { timestamps: true }
);

feedbackSchema.index({ message: 'text', email: 'text', type: 'text' });

module.exports = mongoose.model('Feedback', feedbackSchema);

