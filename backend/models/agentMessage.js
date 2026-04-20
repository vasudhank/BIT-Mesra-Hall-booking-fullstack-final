const mongoose = require('mongoose');

const agentMessageSchema = new mongoose.Schema(
  {
    ownerKey: { type: String, required: true, trim: true, index: true },
    threadId: { type: String, required: true, trim: true, index: true },
    role: {
      type: String,
      enum: ['user', 'assistant', 'system', 'tool'],
      required: true
    },
    text: { type: String, default: '' },
    replyType: { type: String, default: 'CHAT', trim: true },
    action: { type: String, default: null },
    status: { type: String, default: 'OK', trim: true },
    tokenEstimate: { type: Number, default: 0 },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

agentMessageSchema.index({ ownerKey: 1, threadId: 1, createdAt: -1 });
agentMessageSchema.index({ action: 1, createdAt: -1 });

module.exports = mongoose.model('AgentMessage', agentMessageSchema);
