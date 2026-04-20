const fetch = require('node-fetch');
const { observeLlmProviderCall } = require('./metricsService');
const { captureException, withDatadogSpan } = require('./observabilityService');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434/api/generate';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'phi3';
const OLLAMA_VISION_MODEL = process.env.OLLAMA_VISION_MODEL || process.env.OLLAMA_MODEL || 'phi3';

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';

const ANTHROPIC_BASE_URL = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest';

const DEFAULT_TIMEOUT_MS = Math.max(Number(process.env.AI_LLM_TIMEOUT_MS || 25000), 3000);
const DEFAULT_MAX_TOKENS = Math.max(Number(process.env.AI_LLM_DEFAULT_MAX_TOKENS || 900), 64);

const providerPresentation = (provider) => {
  if (provider === 'ollama') {
    return {
      id: 'ollama',
      label: 'Ollama',
      vendor: 'Local model runtime',
      delivery: 'Runs on this machine or LAN'
    };
  }

  if (provider === 'openai') {
    return {
      id: 'openai',
      label: 'OpenAI',
      vendor: 'OpenAI',
      delivery: 'Hosted API'
    };
  }

  if (provider === 'anthropic') {
    return {
      id: 'anthropic',
      label: 'Claude',
      vendor: 'Anthropic',
      delivery: 'Hosted API'
    };
  }

  return {
    id: 'unknown',
    label: 'Unknown',
    vendor: 'Unknown',
    delivery: 'Unknown'
  };
};

const resolveProviderModel = (provider) => {
  if (provider === 'ollama') return OLLAMA_MODEL;
  if (provider === 'openai') return OPENAI_MODEL;
  if (provider === 'anthropic') return ANTHROPIC_MODEL;
  return '';
};

const isProviderConfigured = (provider) => {
  if (provider === 'ollama') return Boolean(String(OLLAMA_URL || '').trim());
  if (provider === 'openai') return Boolean(String(process.env.OPENAI_API_KEY || '').trim());
  if (provider === 'anthropic') return Boolean(String(process.env.ANTHROPIC_API_KEY || '').trim());
  return false;
};

const normalizeProvider = (providerLike) => {
  const raw = String(providerLike || '').trim().toLowerCase();
  if (raw === 'openai') return 'openai';
  if (raw === 'anthropic') return 'anthropic';
  if (raw === 'ollama') return 'ollama';
  return '';
};

const parseProviderOrder = (rawOrder) => {
  const configured = String(rawOrder || '')
    .split(',')
    .map((item) => normalizeProvider(item))
    .filter(Boolean);

  const deduped = [];
  for (const provider of configured) {
    if (!deduped.includes(provider)) deduped.push(provider);
  }

  if (deduped.length > 0) return deduped;
  return ['ollama', 'openai', 'anthropic'];
};

const resolveProviderOrder = (customProviders) => {
  if (Array.isArray(customProviders) && customProviders.length > 0) {
    const parsed = customProviders
      .map((item) => normalizeProvider(item))
      .filter(Boolean);
    if (parsed.length > 0) return Array.from(new Set(parsed));
  }

  const envOrder = process.env.AI_PROVIDER_ORDER || process.env.AI_PROVIDER || 'ollama';
  return parseProviderOrder(envOrder);
};

const withTimeout = async (url, requestOptions, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...requestOptions, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const toModelPrompt = ({ prompt, systemPrompt, userPrompt }) => {
  if (String(prompt || '').trim()) return String(prompt).trim();

  const pieces = [];
  if (String(systemPrompt || '').trim()) {
    pieces.push(`System:\n${String(systemPrompt).trim()}`);
  }
  if (String(userPrompt || '').trim()) {
    pieces.push(`User:\n${String(userPrompt).trim()}`);
  }
  return pieces.join('\n\n').trim();
};

const sanitizeStopArray = (stopLike) => {
  if (!Array.isArray(stopLike)) return [];
  return stopLike
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .slice(0, 8);
};

const callOllama = async (input) => {
  const prompt = toModelPrompt(input);
  if (!prompt) throw new Error('Prompt is required for Ollama call.');

  const images = Array.isArray(input.images) ? input.images.filter(Boolean).slice(0, 3) : [];
  const response = await withTimeout(
    OLLAMA_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: images.length > 0 ? OLLAMA_VISION_MODEL : OLLAMA_MODEL,
        prompt,
        stream: false,
        images: images.length > 0 ? images : undefined,
        options: {
          temperature: Number.isFinite(Number(input.temperature)) ? Number(input.temperature) : 0.3,
          num_predict: Math.max(Number(input.maxTokens || DEFAULT_MAX_TOKENS), 64),
          stop: sanitizeStopArray(input.stop)
        }
      })
    },
    input.timeoutMs
  );

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`Ollama request failed (${response.status}) ${details.slice(0, 220)}`.trim());
  }

  const data = await response.json();
  const text = String(data.response || '').trim();
  if (!text) throw new Error('Ollama returned empty response.');

  return {
    provider: 'ollama',
    model: images.length > 0 ? OLLAMA_VISION_MODEL : OLLAMA_MODEL,
    text
  };
};

const buildOpenAIMessages = ({ prompt, systemPrompt, userPrompt, images = [] }) => {
  const messages = [];

  if (String(systemPrompt || '').trim()) {
    messages.push({
      role: 'system',
      content: String(systemPrompt).trim()
    });
  }

  const baseText = toModelPrompt({ prompt, userPrompt });
  if (images.length > 0) {
    const content = [{ type: 'text', text: baseText || 'Analyze the provided input.' }];
    for (const imageBase64 of images.slice(0, 3)) {
      content.push({
        type: 'image_url',
        image_url: { url: `data:image/png;base64,${imageBase64}` }
      });
    }
    messages.push({ role: 'user', content });
  } else {
    messages.push({ role: 'user', content: baseText || 'Please respond to the user request.' });
  }

  return messages;
};

const parseOpenAIText = (data) => {
  const choice = data?.choices?.[0];
  if (!choice || !choice.message) return '';

  if (typeof choice.message.content === 'string') {
    return choice.message.content.trim();
  }

  if (Array.isArray(choice.message.content)) {
    return choice.message.content
      .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
      .join('\n')
      .trim();
  }

  return '';
};

const callOpenAI = async (input) => {
  const apiKey = String(process.env.OPENAI_API_KEY || '').trim();
  if (!apiKey) throw new Error('OPENAI_API_KEY is not configured.');

  const images = Array.isArray(input.images) ? input.images.filter(Boolean).slice(0, 3) : [];
  const response = await withTimeout(
    `${OPENAI_BASE_URL}/chat/completions`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: String(process.env.OPENAI_MODEL || input.model || OPENAI_MODEL),
        messages: buildOpenAIMessages({ ...input, images }),
        temperature: Number.isFinite(Number(input.temperature)) ? Number(input.temperature) : 0.3,
        max_tokens: Math.max(Number(input.maxTokens || DEFAULT_MAX_TOKENS), 64),
        stop: sanitizeStopArray(input.stop)
      })
    },
    input.timeoutMs
  );

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`OpenAI request failed (${response.status}) ${details.slice(0, 260)}`.trim());
  }

  const data = await response.json();
  const text = parseOpenAIText(data);
  if (!text) throw new Error('OpenAI returned empty response.');

  return {
    provider: 'openai',
    model: String(process.env.OPENAI_MODEL || input.model || OPENAI_MODEL),
    text
  };
};

const buildAnthropicContent = ({ prompt, userPrompt, images = [] }) => {
  const baseText = toModelPrompt({ prompt, userPrompt }) || 'Please respond to the user request.';
  if (images.length === 0) {
    return [{ type: 'text', text: baseText }];
  }

  const parts = [{ type: 'text', text: baseText }];
  for (const imageBase64 of images.slice(0, 3)) {
    parts.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: imageBase64
      }
    });
  }
  return parts;
};

const parseAnthropicText = (data) => {
  const content = Array.isArray(data?.content) ? data.content : [];
  const text = content
    .map((item) => (item && item.type === 'text' ? String(item.text || '') : ''))
    .join('\n')
    .trim();
  return text;
};

const callAnthropic = async (input) => {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured.');

  const images = Array.isArray(input.images) ? input.images.filter(Boolean).slice(0, 3) : [];
  const response = await withTimeout(
    `${ANTHROPIC_BASE_URL}/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: String(process.env.ANTHROPIC_MODEL || input.model || ANTHROPIC_MODEL),
        max_tokens: Math.max(Number(input.maxTokens || DEFAULT_MAX_TOKENS), 64),
        temperature: Number.isFinite(Number(input.temperature)) ? Number(input.temperature) : 0.3,
        stop_sequences: sanitizeStopArray(input.stop),
        system: String(input.systemPrompt || '').trim() || undefined,
        messages: [
          {
            role: 'user',
            content: buildAnthropicContent({ ...input, images })
          }
        ]
      })
    },
    input.timeoutMs
  );

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`Anthropic request failed (${response.status}) ${details.slice(0, 260)}`.trim());
  }

  const data = await response.json();
  const text = parseAnthropicText(data);
  if (!text) throw new Error('Anthropic returned empty response.');

  return {
    provider: 'anthropic',
    model: String(process.env.ANTHROPIC_MODEL || input.model || ANTHROPIC_MODEL),
    text
  };
};

const cleanResponseText = (text) =>
  String(text || '')
    .replace(/^\s*```json/i, '')
    .replace(/^\s*```/i, '')
    .replace(/```\s*$/i, '')
    .trim();

const getLlmRuntimeProfile = () => {
  const preferredOrder = resolveProviderOrder();
  const providers = preferredOrder.map((provider) => {
    const presentation = providerPresentation(provider);
    return {
      ...presentation,
      model: resolveProviderModel(provider),
      configured: isProviderConfigured(provider)
    };
  });

  return {
    preferredOrder,
    providers,
    primaryProvider: providers[0] || null
  };
};

const generateText = async (input = {}) => {
  const providerOrder = resolveProviderOrder(input.providers);
  const failures = [];

  for (const provider of providerOrder) {
    try {
      const result = await withDatadogSpan(
        'ai.llm.generate',
        {
          provider,
          model: String(input.model || ''),
          'ai.max_tokens': Math.max(Number(input.maxTokens || DEFAULT_MAX_TOKENS), 64)
        },
        async () => {
          if (provider === 'ollama') return callOllama(input);
          if (provider === 'openai') return callOpenAI(input);
          if (provider === 'anthropic') return callAnthropic(input);
          return null;
        }
      );

      if (result && String(result.text || '').trim()) {
        observeLlmProviderCall({
          provider,
          model: result.model || input.model || resolveProviderModel(provider),
          error: false
        });
        return {
          ...result,
          text: cleanResponseText(result.text)
        };
      }
    } catch (err) {
      observeLlmProviderCall({
        provider,
        model: input.model || resolveProviderModel(provider),
        error: true
      });
      captureException(err, { area: 'llm_gateway', provider });
      failures.push(`${provider}: ${err.message || err}`);
    }
  }

  throw new Error(`All LLM providers failed. ${failures.join(' | ')}`.trim());
};

module.exports = {
  generateText,
  cleanResponseText,
  getLlmRuntimeProfile
};
