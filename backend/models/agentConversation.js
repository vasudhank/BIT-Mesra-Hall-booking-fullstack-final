const mongoose = require('mongoose');

const agentConversationSchema = new mongoose.Schema(
  {
    ownerKey: { type: String, required: true, trim: true, index: true },
    threadId: { type: String, required: true, trim: true, index: true },
    userRole: { type: String, default: 'GUEST', trim: true },
    title: { type: String, default: 'New AI conversation', trim: true },
    summary: { type: String, default: '' },
    summaryVersion: { type: Number, default: 0 },
    messageCount: { type: Number, default: 0 },
    actionCount: { type: Number, default: 0 },
    lastMessageAt: { type: Date, default: Date.now },
    memoryUpdatedAt: { type: Date, default: null },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true }
);

agentConversationSchema.index({ ownerKey: 1, threadId: 1 }, { unique: true });
agentConversationSchema.index({ lastMessageAt: -1 });

module.exports = mongoose.model('AgentConversation', agentConversationSchema);
