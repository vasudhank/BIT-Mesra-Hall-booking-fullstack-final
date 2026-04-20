const crypto = require('crypto');
const mongoose = require('mongoose');
const AgentConversation = require('../models/agentConversation');
const AgentMessage = require('../models/agentMessage');
const AgentMemory = require('../models/agentMemory');
const { generateText, cleanResponseText } = require('./llmGatewayService');
const {
  upsertVectorDocuments,
  querySimilarVectors
} = require('./vectorStoreService');
const {
  observeAgentMemoryOperation
} = require('./metricsService');
const { captureException } = require('./observabilityService');
const { logger } = require('./loggerService');

const MAX_MEMORY_CONTEXT_CHARS = Math.max(Number(process.env.AI_MEMORY_CONTEXT_CHARS || 4200), 1200);
const MAX_RECENT_MEMORY_MESSAGES = Math.max(Number(process.env.AI_MEMORY_RECENT_MESSAGES || 10), 4);
const MAX_RELEVANT_MEMORIES = Math.max(Number(process.env.AI_MEMORY_RELEVANT_LIMIT || 8), 3);
const MEMORY_EXTRACTION_ENABLED = String(process.env.AI_MEMORY_EXTRACTION_ENABLED || 'true').toLowerCase() !== 'false';
const MEMORY_VECTOR_ENABLED = String(process.env.AI_MEMORY_VECTOR_ENABLED || 'true').toLowerCase() !== 'false';

const isMongoReady = () => Number(mongoose?.connection?.readyState || 0) === 1;

const clip = (text, limit = 1000) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, limit);

const hash = (value, length = 16) =>
  crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, length);

const sanitizeKeyPart = (value, fallback = 'item') =>
  String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 90) || fallback;

const estimateTokens = (text) => Math.ceil(String(text || '').length / 4);

const normalizeRole = (roleLike) => {
  const role = String(roleLike || '').trim().toUpperCase();
  if (role === 'ADMIN') return 'ADMIN';
  if (role === 'DEVELOPER') return 'DEVELOPER';
  if (role === 'DEPARTMENT' || role === 'FACULTY') return 'DEPARTMENT';
  return 'GUEST';
};

const resolveOwnerKey = ({ req, userRole, userId, email, accountKey } = {}) => {
  const role = normalizeRole(userRole || req?.user?.type || String(accountKey || '').split(':')[0]);
  const id = String(userId || req?.user?._id || req?.user?.id || '').trim();
  const mail = String(email || req?.user?.email || '').trim().toLowerCase();
  const explicitAccount = String(accountKey || '').trim();

  if (id) return `${role}:${id}`;
  if (mail) return `${role}:${mail}`;
  if (explicitAccount && explicitAccount.toUpperCase() !== 'GUEST:LOCAL') return sanitizeKeyPart(explicitAccount, 'guest');
  if (req?.sessionID) return `GUEST:${hash(req.sessionID, 20)}`;
  return 'GUEST:anonymous';
};

const resolveThreadId = ({ req, threadId, accountKey } = {}) => {
  const raw = String(threadId || req?.body?.threadId || req?.query?.threadId || '').trim();
  if (raw) return sanitizeKeyPart(raw, 'thread');
  if (req?.sessionID) return `session_${hash(req.sessionID, 20)}`;
  return `thread_${hash(accountKey || 'anonymous', 16)}`;
};

const memoryNamespaceForOwner = (ownerKey) => `agent_memory_${hash(ownerKey, 20)}`;

const extractFirstJSON = (txt) => {
  const text = String(txt || '');
  const start = text.indexOf('{');
  if (start === -1) return null;

  let balance = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === '\\') {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') balance += 1;
    if (ch === '}') balance -= 1;
    if (balance === 0) {
      try {
        return JSON.parse(text.substring(start, i + 1));
      } catch (err) {
        return null;
      }
    }
  }
  return null;
};

const tokenize = (text) =>
  String(text || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 2);

const lexicalScore = (query, candidate) => {
  const q = new Set(tokenize(query));
  if (q.size === 0) return 0;
  const c = new Set(tokenize(candidate));
  let score = 0;
  q.forEach((token) => {
    if (c.has(token)) score += token.length >= 7 ? 2 : 1;
  });
  return score / Math.max(q.size, 1);
};

const getConversationTitle = (message) => {
  const clean = clip(message, 72);
  return clean || 'AI conversation';
};

const formatMemoryContext = ({ conversation, memories, recentMessages }) => {
  const sections = [];

  if (conversation?.summary) {
    sections.push(`Conversation summary:\n${clip(conversation.summary, 1100)}`);
  }

  if (Array.isArray(memories) && memories.length > 0) {
    const memoryLines = memories
      .slice(0, MAX_RELEVANT_MEMORIES)
      .map((item, idx) => {
        const tags = Array.isArray(item.tags) && item.tags.length ? ` | tags=${item.tags.slice(0, 5).join(',')}` : '';
        const score = Number(item.score || item.importance || 0).toFixed(2);
        return `${idx + 1}. [${item.kind || 'fact'} score=${score}${tags}] ${clip(item.value || item.summary, 260)}`;
      });
    sections.push(`Relevant long-term memories:\n${memoryLines.join('\n')}`);
  }

  if (Array.isArray(recentMessages) && recentMessages.length > 0) {
    const lines = recentMessages
      .slice(-MAX_RECENT_MEMORY_MESSAGES)
      .map((msg, idx) => `${idx + 1}. ${msg.role === 'user' ? 'User' : 'Assistant'}: ${clip(msg.text, 260)}`);
    sections.push(`Persistent recent turns:\n${lines.join('\n')}`);
  }

  return sections.join('\n\n').slice(0, MAX_MEMORY_CONTEXT_CHARS) || 'No persistent memory found for this user/thread yet.';
};

const retrieveRelevantMemories = async ({ ownerKey, query }) => {
  if (!isMongoReady()) return [];

  const now = new Date();
  const rows = await AgentMemory.find({
    ownerKey,
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }]
  })
    .sort({ importance: -1, lastSeenAt: -1 })
    .limit(120)
    .lean();

  const lexical = rows
    .map((row) => ({
      ...row,
      score: lexicalScore(query, `${row.kind} ${row.key} ${row.value} ${row.summary} ${(row.tags || []).join(' ')}`)
        + Number(row.importance || 0) * 0.35
        + Number(row.confidence || 0) * 0.15
    }))
    .filter((row) => row.score > 0.05)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RELEVANT_MEMORIES);

  if (!MEMORY_VECTOR_ENABLED) return lexical;

  const vectorHits = await querySimilarVectors({
    namespace: memoryNamespaceForOwner(ownerKey),
    queryText: query,
    topK: MAX_RELEVANT_MEMORIES
  }).catch(() => []);

  const byKey = new Map();
  lexical.forEach((item) => byKey.set(String(item.key), item));

  (Array.isArray(vectorHits) ? vectorHits : []).forEach((hit) => {
    const key = String(hit.metadata?.key || hit.id || '').trim();
    if (!key || byKey.has(key)) return;
    byKey.set(key, {
      key,
      kind: hit.metadata?.kind || 'fact',
      value: hit.text || hit.metadata?.text || '',
      summary: hit.metadata?.summary || '',
      tags: Array.isArray(hit.metadata?.tags) ? hit.metadata.tags : [],
      importance: Number(hit.metadata?.importance || 0.5),
      confidence: Number(hit.metadata?.confidence || 0.7),
      score: Number(hit.score || 0)
    });
  });

  return Array.from(byKey.values())
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, MAX_RELEVANT_MEMORIES);
};

const getAgentMemoryContext = async ({
  req,
  message,
  history,
  userRole,
  threadId,
  accountKey,
  channel = 'http'
} = {}) => {
  const ownerKey = resolveOwnerKey({ req, userRole, accountKey });
  const resolvedThreadId = resolveThreadId({ req, threadId, accountKey });
  const cleanMessage = clip(message, 4000);
  const historyText = (Array.isArray(history) ? history : [])
    .slice(-8)
    .map((item) => `${item.role}: ${item.text}`)
    .join('\n');
  const query = `${cleanMessage}\n${historyText}`.trim();

  if (!isMongoReady()) {
    return {
      ownerKey,
      threadId: resolvedThreadId,
      block: 'Persistent memory unavailable because MongoDB is not connected.',
      memories: [],
      recentMessages: [],
      conversation: null,
      channel
    };
  }

  try {
    const [conversation, memories, recentMessagesDesc] = await Promise.all([
      AgentConversation.findOne({ ownerKey, threadId: resolvedThreadId }).lean(),
      retrieveRelevantMemories({ ownerKey, query }),
      AgentMessage.find({ ownerKey, threadId: resolvedThreadId })
        .sort({ createdAt: -1 })
        .limit(MAX_RECENT_MEMORY_MESSAGES)
        .lean()
    ]);

    const recentMessages = [...recentMessagesDesc].reverse();

    observeAgentMemoryOperation({ operation: 'context_load' });
    return {
      ownerKey,
      threadId: resolvedThreadId,
      block: formatMemoryContext({ conversation, memories, recentMessages }),
      memories,
      recentMessages,
      conversation,
      channel
    };
  } catch (err) {
    observeAgentMemoryOperation({ operation: 'context_load', error: true });
    captureException(err, { area: 'agent_memory_context', ownerKey, threadId: resolvedThreadId });
    return {
      ownerKey,
      threadId: resolvedThreadId,
      block: 'Persistent memory lookup failed safely for this request.',
      memories: [],
      recentMessages: [],
      conversation: null,
      channel
    };
  }
};

const normalizeMemoryCandidate = (candidate, evidence) => {
  if (!candidate || typeof candidate !== 'object') return null;
  const rawValue = clip(candidate.value || candidate.summary || candidate.fact, 900);
  if (!rawValue || rawValue.length < 4) return null;

  const kindRaw = sanitizeKeyPart(candidate.kind || 'fact', 'fact');
  const allowedKinds = new Set(['fact', 'preference', 'constraint', 'project', 'task', 'entity', 'summary']);
  const kind = allowedKinds.has(kindRaw) ? kindRaw : 'fact';
  const keySeed = candidate.key || `${kind}:${rawValue}`;
  const key = `${kind}:${sanitizeKeyPart(keySeed, 'memory')}:${hash(rawValue, 10)}`.slice(0, 140);
  const tags = Array.isArray(candidate.tags)
    ? candidate.tags.map((tag) => sanitizeKeyPart(tag, '')).filter(Boolean).slice(0, 8)
    : [];

  return {
    kind,
    key,
    value: rawValue,
    summary: clip(candidate.summary || rawValue, 500),
    evidence: clip(candidate.evidence || evidence, 700),
    tags,
    importance: Math.max(Math.min(Number(candidate.importance ?? 0.55), 1), 0),
    confidence: Math.max(Math.min(Number(candidate.confidence ?? 0.72), 1), 0)
  };
};

const heuristicMemoryCandidates = (userText) => {
  const text = String(userText || '').trim();
  const candidates = [];

  const nameMatch = text.match(/\b(?:my name is|i am|i'm|call me)\s+([a-z][a-z .'-]{1,60})/i);
  if (nameMatch) {
    candidates.push({
      kind: 'entity',
      key: 'user_name',
      value: `The user identifies as ${clip(nameMatch[1], 80)}.`,
      tags: ['identity'],
      importance: 0.85,
      confidence: 0.82
    });
  }

  const rememberMatch = text.match(/\bremember(?: that)?\s+(.{6,260})/i);
  if (rememberMatch) {
    candidates.push({
      kind: 'fact',
      key: `remember_${hash(rememberMatch[1], 8)}`,
      value: clip(rememberMatch[1], 300),
      tags: ['explicit'],
      importance: 0.9,
      confidence: 0.86
    });
  }

  const preferenceMatch = text.match(/\b(?:i prefer|i like|i want|please always|always)\s+(.{6,220})/i);
  if (preferenceMatch) {
    candidates.push({
      kind: 'preference',
      key: `preference_${hash(preferenceMatch[1], 8)}`,
      value: clip(preferenceMatch[1], 280),
      tags: ['preference'],
      importance: 0.7,
      confidence: 0.74
    });
  }

  return candidates;
};

const llmMemoryCandidates = async ({ userText, assistantText }) => {
  if (!MEMORY_EXTRACTION_ENABLED) return [];
  const combined = `${userText}\n${assistantText || ''}`.trim();
  if (combined.length < 20) return [];

  const prompt = `
Extract durable, future-useful memory from this AI interaction.

Rules:
- Keep only stable facts, user preferences, project constraints, names, recurring tasks, or decisions.
- Do not store one-off booking dates/times unless the user explicitly says to remember them.
- Do not store secrets, passwords, OTPs, tokens, or private credentials.
- Return ONLY JSON with this shape:
{
  "memories": [
    {
      "kind": "fact|preference|constraint|project|task|entity|summary",
      "key": "short_stable_key",
      "value": "durable memory sentence",
      "summary": "short summary",
      "importance": 0.0,
      "confidence": 0.0,
      "tags": ["short_tag"]
    }
  ]
}

Interaction:
User: ${clip(userText, 1800)}
Assistant: ${clip(assistantText, 1600)}
`.trim();

  try {
    const result = await generateText({
      prompt,
      temperature: 0.05,
      maxTokens: 650
    });
    const parsed = extractFirstJSON(result.text);
    return Array.isArray(parsed?.memories) ? parsed.memories.slice(0, 6) : [];
  } catch (err) {
    observeAgentMemoryOperation({ operation: 'extract', error: true });
    return [];
  }
};

const upsertMemoryVectors = async ({ ownerKey, memories }) => {
  if (!MEMORY_VECTOR_ENABLED || !Array.isArray(memories) || memories.length === 0) return;

  try {
    await upsertVectorDocuments({
      namespace: memoryNamespaceForOwner(ownerKey),
      documents: memories.map((memory) => ({
        id: memory.key,
        text: `${memory.kind}: ${memory.value}`,
        metadata: {
          key: memory.key,
          kind: memory.kind,
          summary: memory.summary,
          tags: memory.tags,
          importance: memory.importance,
          confidence: memory.confidence
        }
      }))
    });
    observeAgentMemoryOperation({ operation: 'vector_upsert' });
  } catch (err) {
    observeAgentMemoryOperation({ operation: 'vector_upsert', error: true });
  }
};

const storeMemoryCandidates = async ({ ownerKey, candidates, evidence }) => {
  if (!isMongoReady() || !Array.isArray(candidates) || candidates.length === 0) return [];

  const normalized = candidates
    .map((candidate) => normalizeMemoryCandidate(candidate, evidence))
    .filter(Boolean);

  const unique = [];
  const seen = new Set();
  normalized.forEach((item) => {
    if (seen.has(item.key)) return;
    seen.add(item.key);
    unique.push(item);
  });

  if (unique.length === 0) return [];

  await Promise.all(unique.map((memory) =>
    AgentMemory.findOneAndUpdate(
      { ownerKey, namespace: 'user', key: memory.key },
      {
        $set: {
          kind: memory.kind,
          value: memory.value,
          summary: memory.summary,
          evidence: memory.evidence,
          tags: memory.tags,
          importance: memory.importance,
          confidence: memory.confidence,
          source: 'conversation',
          lastSeenAt: new Date()
        },
        $setOnInsert: { ownerKey, namespace: 'user', key: memory.key }
      },
      { upsert: true, new: true }
    )
  ));

  await upsertMemoryVectors({ ownerKey, memories: unique });
  observeAgentMemoryOperation({ operation: 'memory_upsert' });
  return unique;
};

const updateConversationSummary = async ({ ownerKey, threadId, userText, assistantText }) => {
  if (!isMongoReady()) return;

  const conversation = await AgentConversation.findOne({ ownerKey, threadId });
  if (!conversation) return;

  const shouldRefresh = !conversation.summary || Number(conversation.messageCount || 0) % 8 === 0;
  if (!shouldRefresh) return;

  const recentMessages = await AgentMessage.find({ ownerKey, threadId })
    .sort({ createdAt: -1 })
    .limit(16)
    .lean();
  const ordered = [...recentMessages].reverse();
  const transcript = ordered.map((msg) => `${msg.role}: ${clip(msg.text, 360)}`).join('\n');

  let summary = '';
  try {
    const result = await generateText({
      prompt: `
Update the persistent conversation summary for future AI turns.

Existing summary:
${conversation.summary || 'None'}

Recent transcript:
${transcript}

Return a concise summary of stable context, open tasks, user preferences, and important project decisions. Avoid secrets.
`.trim(),
      temperature: 0.1,
      maxTokens: 500
    });
    summary = cleanResponseText(result.text);
  } catch (err) {
    summary = clip(`${conversation.summary || ''}\nUser: ${userText}\nAssistant: ${assistantText}`, 1600);
  }

  if (!summary) return;
  conversation.summary = clip(summary, 2200);
  conversation.summaryVersion = Number(conversation.summaryVersion || 0) + 1;
  conversation.memoryUpdatedAt = new Date();
  await conversation.save();
  observeAgentMemoryOperation({ operation: 'summary_update' });
};

const extractReplyTextForMemory = (body) => {
  const reply = body?.reply && typeof body.reply === 'object' ? body.reply : null;
  if (!reply) return clip(body?.reply || body?.message || body?.msg || '', 1600);

  if (reply.type === 'ACTION') {
    return clip(reply.reply || reply.message || `Action planned: ${reply.action || 'unknown'}`, 1600);
  }
  return clip(reply.message || reply.reply || '', 1600);
};

const persistAgentTurn = async ({
  context,
  userMessage,
  assistantReply,
  replyType = 'CHAT',
  action = null,
  status = 'OK',
  metadata = {}
} = {}) => {
  const ownerKey = context?.ownerKey;
  const threadId = context?.threadId;
  if (!ownerKey || !threadId || !isMongoReady()) return;

  const userText = clip(userMessage, 8000);
  const assistantText = clip(assistantReply, 8000);
  if (!userText && !assistantText) return;

  try {
    await AgentConversation.findOneAndUpdate(
      { ownerKey, threadId },
      {
        $set: {
          userRole: normalizeRole(metadata.userRole || String(ownerKey).split(':')[0]),
          lastMessageAt: new Date(),
          title: getConversationTitle(userText),
          metadata: {
            lastChannel: context.channel || metadata.channel || 'unknown'
          }
        },
        $inc: {
          messageCount: (userText ? 1 : 0) + (assistantText ? 1 : 0),
          actionCount: action ? 1 : 0
        },
        $setOnInsert: {
          ownerKey,
          threadId,
          summary: ''
        }
      },
      { upsert: true }
    );

    const docs = [];
    if (userText) {
      docs.push({
        ownerKey,
        threadId,
        role: 'user',
        text: userText,
        replyType: 'INPUT',
        status,
        tokenEstimate: estimateTokens(userText),
        metadata
      });
    }
    if (assistantText) {
      docs.push({
        ownerKey,
        threadId,
        role: action ? 'tool' : 'assistant',
        text: assistantText,
        replyType,
        action,
        status,
        tokenEstimate: estimateTokens(assistantText),
        metadata
      });
    }

    if (docs.length > 0) {
      await AgentMessage.insertMany(docs, { ordered: false });
      observeAgentMemoryOperation({ operation: 'message_write' });
    }

    const candidates = [
      ...heuristicMemoryCandidates(userText),
      ...(await llmMemoryCandidates({ userText, assistantText }))
    ];
    await storeMemoryCandidates({
      ownerKey,
      candidates,
      evidence: `User: ${clip(userText, 400)} Assistant: ${clip(assistantText, 300)}`
    });

    await updateConversationSummary({ ownerKey, threadId, userText, assistantText });
  } catch (err) {
    observeAgentMemoryOperation({ operation: 'persist_turn', error: true });
    captureException(err, { area: 'persist_agent_turn', ownerKey, threadId });
    logger.warn('Agent memory persistence failed', { error: err.message || err, ownerKey, threadId });
  }
};

module.exports = {
  getAgentMemoryContext,
  persistAgentTurn,
  extractReplyTextForMemory,
  resolveOwnerKey,
  resolveThreadId,
  memoryNamespaceForOwner
};
