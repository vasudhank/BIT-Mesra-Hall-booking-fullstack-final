const mongoose = require('mongoose');
const AgentConversation = require('../models/agentConversation');

const inMemoryPendingStore = new Map();

const isMongoReady = () => Number(mongoose?.connection?.readyState || 0) === 1;

const clip = (value, limit = 4000) =>
  String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);

const makeStoreKey = (ownerKey, threadId) => `${String(ownerKey || '').trim()}::${String(threadId || '').trim()}`;

const sanitizePendingAction = (pendingActionLike) => {
  if (!pendingActionLike || typeof pendingActionLike !== 'object') return null;

  const action = String(pendingActionLike.action || '').trim().toUpperCase();
  if (!action) return null;

  return {
    action,
    payload: pendingActionLike.payload && typeof pendingActionLike.payload === 'object'
      ? pendingActionLike.payload
      : {},
    reply: clip(pendingActionLike.reply || '', 600),
    confirmation: pendingActionLike.confirmation && typeof pendingActionLike.confirmation === 'object'
      ? pendingActionLike.confirmation
      : null,
    metadata: pendingActionLike.metadata && typeof pendingActionLike.metadata === 'object'
      ? pendingActionLike.metadata
      : {},
    createdAt: pendingActionLike.createdAt || new Date(),
    updatedAt: new Date()
  };
};

const getPendingAction = async ({ ownerKey, threadId } = {}) => {
  const cleanOwnerKey = String(ownerKey || '').trim();
  const cleanThreadId = String(threadId || '').trim();
  if (!cleanOwnerKey || !cleanThreadId) return null;

  if (!isMongoReady()) {
    return sanitizePendingAction(inMemoryPendingStore.get(makeStoreKey(cleanOwnerKey, cleanThreadId)) || null);
  }

  const doc = await AgentConversation.findOne(
    { ownerKey: cleanOwnerKey, threadId: cleanThreadId },
    { metadata: 1 }
  ).lean();

  return sanitizePendingAction(doc?.metadata?.pendingAction || null);
};

const setPendingAction = async ({
  ownerKey,
  threadId,
  userRole = 'GUEST',
  pendingAction = null
} = {}) => {
  const cleanOwnerKey = String(ownerKey || '').trim();
  const cleanThreadId = String(threadId || '').trim();
  const sanitized = sanitizePendingAction(pendingAction);

  if (!cleanOwnerKey || !cleanThreadId || !sanitized) return null;

  if (!isMongoReady()) {
    inMemoryPendingStore.set(makeStoreKey(cleanOwnerKey, cleanThreadId), sanitized);
    return sanitized;
  }

  await AgentConversation.findOneAndUpdate(
    { ownerKey: cleanOwnerKey, threadId: cleanThreadId },
    {
      $set: {
        userRole: String(userRole || 'GUEST').trim().toUpperCase(),
        lastMessageAt: new Date(),
        'metadata.pendingAction': sanitized
      },
      $setOnInsert: {
        ownerKey: cleanOwnerKey,
        threadId: cleanThreadId,
        summary: '',
        title: 'New AI conversation'
      }
    },
    { upsert: true }
  );

  return sanitized;
};

const clearPendingAction = async ({ ownerKey, threadId } = {}) => {
  const cleanOwnerKey = String(ownerKey || '').trim();
  const cleanThreadId = String(threadId || '').trim();
  if (!cleanOwnerKey || !cleanThreadId) return;

  if (!isMongoReady()) {
    inMemoryPendingStore.delete(makeStoreKey(cleanOwnerKey, cleanThreadId));
    return;
  }

  await AgentConversation.updateOne(
    { ownerKey: cleanOwnerKey, threadId: cleanThreadId },
    {
      $unset: {
        'metadata.pendingAction': 1
      }
    }
  );
};

module.exports = {
  getPendingAction,
  setPendingAction,
  clearPendingAction
};
