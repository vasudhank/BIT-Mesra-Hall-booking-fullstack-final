const mongoose = require('mongoose');

const agentMemorySchema = new mongoose.Schema(
  {
    ownerKey: { type: String, required: true, trim: true, index: true },
    namespace: { type: String, default: 'user', trim: true, index: true },
    kind: {
      type: String,
      enum: ['fact', 'preference', 'constraint', 'project', 'task', 'entity', 'summary'],
      default: 'fact'
    },
    key: { type: String, required: true, trim: true },
    value: { type: String, required: true },
    summary: { type: String, default: '' },
    evidence: { type: String, default: '' },
    tags: { type: [String], default: [] },
    importance: { type: Number, default: 0.5, min: 0, max: 1 },
    confidence: { type: Number, default: 0.7, min: 0, max: 1 },
    source: { type: String, default: 'conversation', trim: true },
    lastSeenAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

agentMemorySchema.index({ ownerKey: 1, namespace: 1, key: 1 }, { unique: true });
agentMemorySchema.index({ ownerKey: 1, namespace: 1, importance: -1, lastSeenAt: -1 });
agentMemorySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, sparse: true });

module.exports = mongoose.model('AgentMemory', agentMemorySchema);
