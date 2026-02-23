const mongoose = require('mongoose');

const faqSchema = new mongoose.Schema(
  {
    question: { type: String, required: true, trim: true, maxlength: 500 },
    answer: { type: String, required: true, trim: true, maxlength: 20000 },
    isAIGenerated: { type: Boolean, default: false },
    source: {
      type: String,
      enum: ['MANUAL', 'AI_PROMOTED'],
      default: 'MANUAL'
    },
    intentKey: { type: String, default: '' },
    frequencyScore: { type: Number, default: 0 },
    createdByRole: {
      type: String,
      enum: ['ADMIN', 'DEVELOPER', 'SYSTEM'],
      default: 'SYSTEM'
    },
    createdByEmail: { type: String, default: '' },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

faqSchema.index({ question: 'text', answer: 'text', intentKey: 'text' });

module.exports = mongoose.model('FAQ', faqSchema);

