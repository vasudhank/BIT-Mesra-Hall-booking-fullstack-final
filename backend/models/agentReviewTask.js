const mongoose = require('mongoose');

const toolRunSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ['COMPLETED', 'FAILED', 'PREPARED', 'SKIPPED'],
      default: 'COMPLETED'
    },
    summary: { type: String, default: '' },
    input: { type: mongoose.Schema.Types.Mixed, default: {} },
    output: { type: mongoose.Schema.Types.Mixed, default: {} },
    durationMs: { type: Number, default: 0 }
  },
  { _id: false }
);

const decisionSchema = new mongoose.Schema(
  {
    status: {
      type: String,
      enum: ['APPROVED', 'REJECTED', 'FAILED'],
      default: 'APPROVED'
    },
    reviewerRole: { type: String, default: '' },
    reviewerId: { type: String, default: '' },
    reviewerEmail: { type: String, default: '' },
    note: { type: String, default: '' },
    decidedAt: { type: Date, default: Date.now }
  },
  { _id: false }
);

const agentReviewTaskSchema = new mongoose.Schema(
  {
    ownerKey: { type: String, required: true, trim: true, index: true },
    threadId: { type: String, required: true, trim: true, index: true },
    status: {
      type: String,
      enum: ['PENDING', 'APPROVED', 'REJECTED', 'EXECUTED', 'FAILED', 'CANCELLED'],
      default: 'PENDING',
      index: true
    },
    riskLevel: {
      type: String,
      enum: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'],
      default: 'MEDIUM'
    },
    title: { type: String, default: '', trim: true },
    summary: { type: String, default: '' },
    rationale: { type: String, default: '' },
    requestedByRole: { type: String, default: 'GUEST', trim: true },
    actionType: { type: String, required: true, trim: true, index: true },
    messagePreview: { type: String, default: '' },
    actionIntent: { type: mongoose.Schema.Types.Mixed, required: true },
    toolRuns: { type: [toolRunSchema], default: [] },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
    decision: { type: decisionSchema, default: null },
    executedAt: { type: Date, default: null }
  },
  { timestamps: true }
);

agentReviewTaskSchema.index({ status: 1, createdAt: -1 });
agentReviewTaskSchema.index({ ownerKey: 1, threadId: 1, createdAt: -1 });

module.exports = mongoose.model('AgentReviewTask', agentReviewTaskSchema);
