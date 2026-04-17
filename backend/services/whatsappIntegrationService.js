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

const WHATSAPP_GRAPH_API_BASE = (process.env.WHATSAPP_GRAPH_API_BASE || 'https://graph.facebook.com').replace(/\/+$/, '');
const WHATSAPP_API_VERSION = String(process.env.WHATSAPP_API_VERSION || 'v20.0').trim();

const getWhatsAppConfig = () => ({
  verifyToken: String(process.env.WHATSAPP_VERIFY_TOKEN || '').trim(),
  accessToken: String(process.env.WHATSAPP_ACCESS_TOKEN || '').trim(),
  phoneNumberId: String(process.env.WHATSAPP_PHONE_NUMBER_ID || '').trim(),
  autoReplyEnabled: toBool(process.env.WHATSAPP_AUTO_REPLY_ENABLED, true)
});

const isWhatsAppSendConfigured = () => {
  const config = getWhatsAppConfig();
  return Boolean(config.accessToken && config.phoneNumberId);
};

const sanitizeText = (text, limit = 3500) =>
  String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, limit);

const extractIncomingMessages = (payload = {}) => {
  const rows = [];
  const entries = Array.isArray(payload.entry) ? payload.entry : [];

  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value || {};
      const metadata = value?.metadata || {};
      const messages = Array.isArray(value?.messages) ? value.messages : [];

      for (const msg of messages) {
        rows.push({
          id: String(msg?.id || ''),
          from: String(msg?.from || ''),
          type: String(msg?.type || ''),
          text: sanitizeText(msg?.text?.body || '', 1600),
          timestamp: String(msg?.timestamp || ''),
          phoneNumberId: String(metadata?.phone_number_id || '')
        });
      }
    }
  }

  return rows;
};

const isWhatsAppWebhookVerificationValid = (query = {}) => {
  const mode = String(query['hub.mode'] || '').trim();
  const token = String(query['hub.verify_token'] || '').trim();
  const verifyToken = getWhatsAppConfig().verifyToken;
  if (!verifyToken) return false;
  return mode === 'subscribe' && token === verifyToken;
};

const sendWhatsAppTextMessage = async ({ to, text, contextMessageId = '' } = {}) => {
  const cleanTo = String(to || '').replace(/[^\d+]/g, '').trim();
  const cleanText = sanitizeText(text, 3500);
  if (!cleanTo || !cleanText) throw new Error('Both "to" and "text" are required for WhatsApp send.');

  const config = getWhatsAppConfig();
  if (!config.accessToken || !config.phoneNumberId) {
    throw new Error('WhatsApp send configuration missing (token/phone_number_id).');
  }

  const url = `${WHATSAPP_GRAPH_API_BASE}/${WHATSAPP_API_VERSION}/${config.phoneNumberId}/messages`;
  const body = {
    messaging_product: 'whatsapp',
    to: cleanTo,
    type: 'text',
    text: {
      preview_url: false,
      body: cleanText
    }
  };
  if (contextMessageId) {
    body.context = { message_id: String(contextMessageId).trim() };
  }

  const response = await axios.post(url, body, {
    headers: {
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json'
    },
    timeout: 15000
  });

  return response.data || {};
};

const buildAutoReply = async (messageText) => {
  const workflow = await runSupportWorkflow({
    message: messageText,
    userRole: 'GUEST',
    preferredLanguage: 'en',
    history: []
  });

  return sanitizeText(workflow?.answer || 'I received your message. Please share more details so I can help.', 3500);
};

const processIncomingWhatsAppWebhook = async (payload = {}) => {
  const config = getWhatsAppConfig();
  const incomingMessages = extractIncomingMessages(payload);
  if (!incomingMessages.length) {
    return { received: 0, processed: 0, replied: 0, errors: 0 };
  }

  let processed = 0;
  let replied = 0;
  let errors = 0;

  for (const incoming of incomingMessages) {
    if (incoming.type !== 'text' || !incoming.text) continue;
    processed += 1;

    if (!config.autoReplyEnabled) continue;

    if (!isWhatsAppSendConfigured()) {
      logger.warn('WhatsApp auto-reply skipped because send configuration is incomplete', {
        from: incoming.from
      });
      continue;
    }

    try {
      const answer = await buildAutoReply(incoming.text);
      await sendWhatsAppTextMessage({
        to: incoming.from,
        text: answer,
        contextMessageId: incoming.id
      });
      replied += 1;
    } catch (err) {
      errors += 1;
      logger.error('WhatsApp auto-reply failed', {
        from: incoming.from,
        error: err.message || err
      });
    }
  }

  return {
    received: incomingMessages.length,
    processed,
    replied,
    errors
  };
};

const queueIncomingWhatsAppWebhookProcessing = (payload = {}) => {
  setImmediate(async () => {
    try {
      const summary = await processIncomingWhatsAppWebhook(payload);
      logger.info('WhatsApp webhook processed', summary);
    } catch (err) {
      logger.error('WhatsApp webhook processing failed', { error: err.message || err });
    }
  });
};

const getWhatsAppIntegrationStatus = () => {
  const config = getWhatsAppConfig();
  return {
    provider: 'meta_whatsapp_cloud_api',
    webhookVerifyConfigured: Boolean(config.verifyToken),
    sendConfigured: Boolean(config.accessToken && config.phoneNumberId),
    autoReplyEnabled: config.autoReplyEnabled
  };
};

module.exports = {
  getWhatsAppIntegrationStatus,
  isWhatsAppWebhookVerificationValid,
  queueIncomingWhatsAppWebhookProcessing,
  processIncomingWhatsAppWebhook,
  sendWhatsAppTextMessage
};
