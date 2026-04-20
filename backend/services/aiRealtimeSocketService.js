const { WebSocketServer } = require('ws');
const { runSupportWorkflow } = require('./supportWorkflowService');
const { logger } = require('./loggerService');
const { beginAiTimer } = require('./metricsService');
const {
  getAgentMemoryContext,
  persistAgentTurn
} = require('./agentMemoryService');
const { captureException } = require('./observabilityService');

const chunkText = (text, size = 40) => {
  const clean = String(text || '');
  if (!clean) return [];
  const chunks = [];
  for (let i = 0; i < clean.length; i += size) {
    chunks.push(clean.slice(i, i + size));
  }
  return chunks;
};

const isLikelyActionRequest = (message) => {
  const lower = String(message || '').toLowerCase();
  return /\b(book|booking|reserve|request hall|approve|reject|vacate|clear hall|unbook|pending requests|show halls|hall status|export schedule|download schedule|slack|whatsapp|crm|hubspot|notify)\b/.test(lower);
};

const safeSend = (ws, payload) => {
  if (!ws || ws.readyState !== 1) return;
  ws.send(JSON.stringify(payload));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const handleStreamConversation = async (ws, packet = {}) => {
  const requestId = String(packet.requestId || Date.now());
  const payload = packet.payload && typeof packet.payload === 'object' ? packet.payload : {};
  const message = String(payload.message || '').trim();
  const history = Array.isArray(payload.history) ? payload.history : [];
  const preferredLanguage = String(payload.language || 'auto');
  const userRole = String(payload.userRole || 'GUEST').toUpperCase();
  const threadId = String(payload.threadId || '').trim();
  const accountKey = String(payload.accountKey || '').trim();

  if (!message) {
    safeSend(ws, {
      type: 'chat.stream.error',
      requestId,
      error: 'Message is required.'
    });
    return;
  }

  if (isLikelyActionRequest(message)) {
    safeSend(ws, {
      type: 'chat.stream.redirect_http',
      requestId,
      reason: 'action_workflow_detected'
    });
    return;
  }

  const finalizeMetric = beginAiTimer('websocket_stream');
  try {
    const agentMemoryContext = await getAgentMemoryContext({
      message,
      history,
      userRole,
      threadId,
      accountKey,
      channel: 'websocket_stream'
    });

    safeSend(ws, {
      type: 'chat.stream.start',
      requestId,
      meta: { mode: 'agent_graph_stream' }
    });

    const result = await runSupportWorkflow({
      message,
      userRole,
      preferredLanguage,
      history,
      memoryContext: agentMemoryContext?.block || '',
      ownerKey: agentMemoryContext?.ownerKey || '',
      threadId: agentMemoryContext?.threadId || ''
    });
    const answer = String(result?.answer || '').trim();
    const chunks = chunkText(answer, 34);

    for (const token of chunks) {
      safeSend(ws, {
        type: 'chat.stream.delta',
        requestId,
        token
      });
      // Small delay to make streaming visually meaningful for the UI.
      // This keeps real-time UX without relying on provider-native streaming.
      // eslint-disable-next-line no-await-in-loop
      await sleep(10);
    }

    safeSend(ws, {
      type: 'chat.stream.end',
      requestId,
      text: answer,
      meta: result?.meta || {}
    });
    persistAgentTurn({
      context: agentMemoryContext,
      userMessage: message,
      assistantReply: answer,
      replyType: 'CHAT',
      status: 'OK',
      metadata: {
        userRole,
        channel: 'websocket_stream',
        streamMeta: result?.meta || null
      }
    }).catch((memoryErr) => {
      captureException(memoryErr, { area: 'websocket_memory_persist' });
    });
    finalizeMetric({ error: false });
  } catch (err) {
    finalizeMetric({ error: true });
    logger.error('AI websocket stream failed', { error: err.message || err });
    safeSend(ws, {
      type: 'chat.stream.error',
      requestId,
      error: 'Streaming response failed.'
    });
  }
};

const attachAiRealtimeSocketServer = (httpServer) => {
  if (!httpServer) return null;
  const wss = new WebSocketServer({ server: httpServer, path: '/api/ai/ws' });

  wss.on('connection', (ws, req) => {
    safeSend(ws, {
      type: 'socket.connected',
      at: new Date().toISOString()
    });

    ws.on('message', (raw) => {
      let packet = null;
      try {
        packet = JSON.parse(String(raw || '{}'));
      } catch (err) {
        safeSend(ws, { type: 'socket.error', error: 'Invalid JSON payload.' });
        return;
      }

      if (packet?.type === 'ping') {
        safeSend(ws, { type: 'pong', at: new Date().toISOString() });
        return;
      }

      if (packet?.type === 'chat.stream') {
        handleStreamConversation(ws, packet).catch(() => {});
        return;
      }

      safeSend(ws, {
        type: 'socket.error',
        error: 'Unsupported message type.'
      });
    });

    ws.on('error', (err) => {
      logger.warn('AI websocket client error', { error: err.message || err, ip: req?.socket?.remoteAddress || '' });
    });
  });

  logger.info('AI websocket server attached', { path: '/api/ai/ws' });
  return wss;
};

module.exports = {
  attachAiRealtimeSocketServer
};
