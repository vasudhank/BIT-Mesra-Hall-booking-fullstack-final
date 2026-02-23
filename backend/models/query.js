const mongoose = require('mongoose');

const reactionVoteSchema = new mongoose.Schema(
  {
    voterId: { type: String, required: true },
    value: { type: Number, enum: [-1, 1], required: true }
  },
  { _id: false }
);

const queryReplySchema = new mongoose.Schema(
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

const querySolutionSchema = new mongoose.Schema(
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
      enum: ['MANUAL', 'AI_AUTOREPLY', 'EMAIL_SYNC'],
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
    replies: { type: [queryReplySchema], default: [] },
    createdAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const querySchema = new mongoose.Schema(
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
    type: { type: String, enum: ['QUERY'], default: 'QUERY' },
    createdByRole: {
      type: String,
      enum: ['GUEST', 'ADMIN', 'DEVELOPER', 'DEPARTMENT'],
      default: 'GUEST'
    },
    createdById: { type: String, default: null },
    acceptedSolutionId: { type: String, default: null },
    resolvedAt: { type: Date, default: null },
    lastActivityAt: { type: Date, default: Date.now },
    solutions: { type: [querySolutionSchema], default: [] }
  },
  { timestamps: true }
);

querySchema.index({ title: 'text', message: 'text', email: 'text' });

module.exports = mongoose.model('Query', querySchema);
