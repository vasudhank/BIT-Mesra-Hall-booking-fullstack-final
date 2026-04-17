const crypto = require('crypto');
const axios = require('axios');
const { runSupportWorkflow } = require('./supportWorkflowService');
const { logger } = require('./loggerService');

const toBool = (value, fallback = false) => {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
};

const getSlackConfig = () => ({
  signingSecret: String(process.env.SLACK_SIGNING_SECRET || '').trim(),
  botToken: String(process.env.SLACK_BOT_TOKEN || '').trim(),
  incomingWebhookUrl: String(process.env.SLACK_INCOMING_WEBHOOK_URL || '').trim(),
  autoReplyEnabled: toBool(process.env.SLACK_AUTO_REPLY_ENABLED, true)
});

const sanitizeText = (text, limit = 3500) =>
  String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);

const safeTimingCompare = (a, b) => {
  const aBuf = Buffer.from(String(a || ''), 'utf8');
  const bBuf = Buffer.from(String(b || ''), 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
};

const isSlackSignatureValid = (req) => {
  const config = getSlackConfig();
  if (!config.signingSecret) return true;

  const signature = String(req.headers['x-slack-signature'] || '').trim();
  const tsRaw = String(req.headers['x-slack-request-timestamp'] || '').trim();
  const rawBody = String(req.rawBody || '');
  if (!signature || !tsRaw || !rawBody) return false;

  const ts = Number(tsRaw);
  if (!Number.isFinite(ts)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - ts) > 60 * 5) return false;

  const base = `v0:${tsRaw}:${rawBody}`;
  const digest = `v0=${crypto.createHmac('sha256', config.signingSecret).update(base).digest('hex')}`;
  return safeTimingCompare(digest, signature);
};

const sendSlackWebhookMessage = async ({ text, blocks } = {}) => {
  const config = getSlackConfig();
  if (!config.incomingWebhookUrl) {
    throw new Error('SLACK_INCOMING_WEBHOOK_URL is not configured.');
  }

  const payload = {
    text: sanitizeText(text || 'Notification', 3500)
  };
  if (Array.isArray(blocks) && blocks.length > 0) payload.blocks = blocks;

  const response = await axios.post(config.incomingWebhookUrl, payload, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 15000
  });
  return response.data || {};
};

const sendSlackChannelMessage = async ({ channel, text, threadTs = '' } = {}) => {
  const config = getSlackConfig();
  const cleanChannel = String(channel || '').trim();
  const cleanText = sanitizeText(text || '', 3500);
  if (!cleanChannel || !cleanText) {
    throw new Error('Both "channel" and "text" are required for Slack channel send.');
  }
  if (!config.botToken) {
    throw new Error('SLACK_BOT_TOKEN is not configured.');
  }

  const response = await axios.post(
    'https://slack.com/api/chat.postMessage',
    {
      channel: cleanChannel,
      text: cleanText,
      thread_ts: threadTs || undefined
    },
    {
      headers: {
        Authorization: `Bearer ${config.botToken}`,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    }
  );

  if (!response.data?.ok) {
    throw new Error(`Slack chat.postMessage failed: ${response.data?.error || 'unknown_error'}`);
  }
  return response.data;
};

const buildSlackAutoReply = async (messageText) => {
  const workflow = await runSupportWorkflow({
    message: messageText,
    userRole: 'GUEST',
    preferredLanguage: 'en',
    history: []
  });
  return sanitizeText(workflow?.answer || 'I received your message. Please share more details.', 3500);
};

const processSlackEventPayload = async (payload = {}) => {
  const config = getSlackConfig();

  if (payload?.type === 'url_verification') {
    return {
      type: 'url_verification',
      challenge: String(payload?.challenge || '')
    };
  }

  if (payload?.type !== 'event_callback') {
    return { type: 'ignored', reason: 'unsupported_event_type' };
  }

  const event = payload?.event || {};
  if (event?.type !== 'message' || event?.subtype || event?.bot_id) {
    return { type: 'ignored', reason: 'unsupported_message_shape' };
  }

  const text = sanitizeText(event?.text || '', 1600);
  if (!text) {
    return { type: 'ignored', reason: 'empty_message' };
  }

  if (!config.autoReplyEnabled) {
    return { type: 'processed', replied: false, reason: 'auto_reply_disabled' };
  }

  const answer = await buildSlackAutoReply(text);
  if (config.botToken && event?.channel) {
    await sendSlackChannelMessage({
      channel: event.channel,
      text: answer,
      threadTs: event.thread_ts || event.ts || ''
    });
    return { type: 'processed', replied: true, via: 'bot_token' };
  }

  if (config.incomingWebhookUrl) {
    await sendSlackWebhookMessage({
      text: `Reply:\n${answer}`
    });
    return { type: 'processed', replied: true, via: 'incoming_webhook' };
  }

  return { type: 'processed', replied: false, reason: 'slack_send_not_configured' };
};

const queueSlackEventProcessing = (payload = {}) => {
  setImmediate(async () => {
    try {
      const summary = await processSlackEventPayload(payload);
      logger.info('Slack event processed', summary);
    } catch (err) {
      logger.error('Slack event processing failed', { error: err.message || err });
    }
  });
};

const processSlackCommandPayload = async (payload = {}) => {
  const text = sanitizeText(payload?.text || '', 1600);
  if (!text) {
    return {
      ok: false,
      error: 'Command text is empty.'
    };
  }

  const answer = await buildSlackAutoReply(text);
  const responseUrl = String(payload?.response_url || '').trim();

  if (responseUrl) {
    await axios.post(
      responseUrl,
      {
        response_type: 'ephemeral',
        text: answer
      },
      {
        headers: { 'Content-Type': 'application/json' },
        timeout: 15000
      }
    );
  } else {
    await sendSlackWebhookMessage({
      text: answer
    });
  }

  return {
    ok: true,
    answerPreview: answer.slice(0, 160)
  };
};

const queueSlackCommandProcessing = (payload = {}) => {
  setImmediate(async () => {
    try {
      const summary = await processSlackCommandPayload(payload);
      logger.info('Slack command processed', summary);
    } catch (err) {
      logger.error('Slack command processing failed', { error: err.message || err });
    }
  });
};

const dispatchSlackNotification = async ({ text, channel = '', threadTs = '' } = {}) => {
  const cleanText = sanitizeText(text || '', 3500);
  if (!cleanText) throw new Error('Notification text is required.');

  const config = getSlackConfig();
  if (channel && config.botToken) {
    return sendSlackChannelMessage({
      channel,
      text: cleanText,
      threadTs
    });
  }

  return sendSlackWebhookMessage({
    text: cleanText
  });
};

const getSlackIntegrationStatus = () => {
  const config = getSlackConfig();
  return {
    provider: 'slack',
    signingSecretConfigured: Boolean(config.signingSecret),
    botTokenConfigured: Boolean(config.botToken),
    incomingWebhookConfigured: Boolean(config.incomingWebhookUrl),
    autoReplyEnabled: config.autoReplyEnabled
  };
};

module.exports = {
  getSlackIntegrationStatus,
  isSlackSignatureValid,
  queueSlackEventProcessing,
  queueSlackCommandProcessing,
  dispatchSlackNotification
};
