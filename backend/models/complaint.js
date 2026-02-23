const mongoose = require('mongoose');

const reactionVoteSchema = new mongoose.Schema(
  {
    voterId: { type: String, required: true },
    value: { type: Number, enum: [-1, 1], required: true }
  },
  { _id: false }
);

const replySchema = new mongoose.Schema(
  {
    parentReplyId: { type: mongoose.Schema.Types.ObjectId, default: null },
    authorName: { type: String, default: 'Guest' },
    authorEmail: { type: String, default: '', lowercase: true, trim: true },
    authorType: { type: String, default: '' },
    authorRole: {
      type: String,
      enum: ['GUEST', 'ADMIN', 'DEVELOPER', 'DEPARTMENT', 'AI'],
      default: 'GUEST'
    },
    trusted: { type: Boolean, default: false },
    isTrusted: { type: Boolean, default: false },
    body: { type: String, default: '', maxlength: 12000 },
    message: { type: String, default: '' },
    content: { type: String, default: '' },
    text: { type: String, default: '' },
    upvotes: { type: Number, default: 0 },
    downvotes: { type: Number, default: 0 },
    reactions: { type: [reactionVoteSchema], default: [] },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const solutionSchema = new mongoose.Schema(
  {
    authorName: { type: String, default: 'Guest' },
    authorEmail: { type: String, default: '', lowercase: true, trim: true },
    authorType: { type: String, default: '' },
    authorRole: {
      type: String,
      enum: ['GUEST', 'ADMIN', 'DEVELOPER', 'DEPARTMENT', 'AI'],
      default: 'GUEST'
    },
    trusted: { type: Boolean, default: false },
    isTrusted: { type: Boolean, default: false },
    isAIGenerated: { type: Boolean, default: false },
    isAIPending: { type: Boolean, default: false },
    source: {
      type: String,
      enum: ['MANUAL', 'EMAIL_SYNC', 'AI_AUTOREPLY'],
      default: 'MANUAL'
    },
    externalMessageId: { type: String, default: null },
    body: { type: String, default: '', maxlength: 12000 },
    message: { type: String, default: '' },
    content: { type: String, default: '' },
    solution: { type: String, default: '' },
    likes: { type: Number, default: 0 },
    dislikes: { type: Number, default: 0 },
    reactions: { type: [reactionVoteSchema], default: [] },
    replies: { type: [replySchema], default: [] },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const complaintSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 300 },
    message: { type: String, default: '', trim: true, maxlength: 20000 },
    description: { type: String, default: '' },
    email: { type: String, required: true, lowercase: true, trim: true },
    createdByType: { type: String, default: '' },
    status: {
      type: String,
      enum: ['IN_PROGRESS', 'RESOLVED', 'REOPENED', 'CLOSED'],
      default: 'IN_PROGRESS'
    },
    type: { type: String, enum: ['COMPLAINT'], default: 'COMPLAINT' },
    source: { type: String, enum: ['WEB', 'ADMIN', 'DEVELOPER'], default: 'WEB' },
    createdByRole: {
      type: String,
      enum: ['GUEST', 'ADMIN', 'DEVELOPER', 'DEPARTMENT'],
      default: 'GUEST'
    },
    createdById: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    lastActivityAt: { type: Date, default: Date.now },
    autoCloseAfterDays: { type: Number, default: 7 },
    emailReopenOtpHash: { type: String, default: null },
    emailReopenOtpExpiry: { type: Date, default: null },
    solutions: { type: [solutionSchema], default: [] }
  },
  { timestamps: true }
);

complaintSchema.index({ title: 'text', message: 'text', email: 'text' });

module.exports = mongoose.model('Complaint', complaintSchema);
