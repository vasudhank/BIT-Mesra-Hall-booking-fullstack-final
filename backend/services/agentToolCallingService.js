const fetch = require('node-fetch');
const {
  generateText,
  cleanResponseText
} = require('./llmGatewayService');
const {
  observeLlmProviderCall
} = require('./metricsService');
const {
  captureException,
  withDatadogSpan
} = require('./observabilityService');
const {
  getRotatedOpenAIApiKeys,
  hasOpenAIApiKeyConfigured,
  shouldRetryWithAnotherOpenAIKey
} = require('./openaiKeyPoolService');
const { logger } = require('./loggerService');
const {
  getAgentToolCatalog,
  getOpenAIToolSpecs,
  getAnthropicToolSpecs,
  runAgentToolByName
} = require('./agentToolRegistryService');

const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini';
const ANTHROPIC_BASE_URL = (process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1').replace(/\/+$/, '');
const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL || 'claude-3-5-sonnet-latest';
const DEFAULT_TIMEOUT_MS = Math.max(Number(process.env.AI_LLM_TIMEOUT_MS || 25000), 3000);
const MAX_TOOL_ITERATIONS = Math.max(Number(process.env.AI_AGENT_TOOL_MAX_ITERATIONS || 6), 2);

const clip = (text, limit = 7000) => String(text || '').trim().slice(0, limit);

const normalizeRole = (roleLike) => {
  const raw = String(roleLike || '').trim().toUpperCase();
  if (raw === 'ADMIN') return 'ADMIN';
  if (raw === 'DEVELOPER') return 'DEVELOPER';
  if (raw === 'DEPARTMENT' || raw === 'FACULTY') return 'DEPARTMENT';
  return 'GUEST';
};

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

const withTimeout = async (url, requestOptions, timeoutMs = DEFAULT_TIMEOUT_MS) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, { ...requestOptions, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
};

const isProviderConfigured = (provider) => {
  if (provider === 'openai') return hasOpenAIApiKeyConfigured();
  if (provider === 'anthropic') return Boolean(String(process.env.ANTHROPIC_API_KEY || '').trim());
  return false;
};

const resolveToolProviderOrder = () => {
  const configured = String(process.env.AI_TOOL_CALL_PROVIDER_ORDER || 'openai,anthropic')
    .split(',')
    .map((item) => String(item || '').trim().toLowerCase())
    .filter((item) => item === 'openai' || item === 'anthropic');

  const unique = Array.from(new Set(configured));
  return unique.length > 0 ? unique : ['openai', 'anthropic'];
};

const safeJsonStringify = (value, limit = 7000) => {
  try {
    return clip(JSON.stringify(value), limit);
  } catch (err) {
    return clip(String(value || ''), limit);
  }
};

const toolResultToTrace = (toolName, input, result) => ({
  name: toolName,
  status: String(result?.status || 'ok'),
  kind: String(result?.kind || 'lookup'),
  summary: clip(result?.summary || '', 260),
  riskLevel: String(result?.riskLevel || 'LOW'),
  reviewRequired: Boolean(result?.reviewRequired),
  durationMs: Number(result?.durationMs || 0),
  input: input && typeof input === 'object' ? input : {},
  outputPreview: clip(result?.summary || safeJsonStringify(result?.data || result, 320), 320)
});

const aggregateToolOutcomes = (toolCalls = []) => {
  const actionCarrier = [...toolCalls]
    .reverse()
    .find((call) => call?.result?.actionIntent && typeof call.result.actionIntent === 'object');

  const lastLookup = [...toolCalls]
    .reverse()
    .find((call) => call?.result?.kind === 'lookup' && call?.result?.data);

  return {
    actionIntent: actionCarrier?.result?.actionIntent || null,
    reviewRequired: Boolean(actionCarrier?.result?.reviewRequired),
    riskLevel: String(actionCarrier?.result?.riskLevel || 'LOW'),
    resultData: lastLookup?.result?.data || null
  };
};

const buildSystemPrompt = ({
  preferredLanguage = 'en',
  userRole = 'GUEST',
  strategy = {},
  projectContext = '',
  memoryContext = ''
} = {}) => {
  const responseInstruction = String(preferredLanguage || '').toLowerCase() === 'hi'
    ? 'Respond to the user in Hindi unless the user clearly asks for English.'
    : 'Respond to the user in English unless the user clearly asks for Hindi.';

  return `
You are ToolCoordinatorAgent in an agentic AI system.

Your job is to reason, select tools, inspect observations, and produce the best next step.

Rules:
- Use tools when facts, memory, schedules, hall status, booking queues, or external action preparation are needed.
- Never claim that a booking, vacate, admin approval, Slack send, WhatsApp send, or CRM sync has already happened unless a tool explicitly says it executed. In this workflow, prepare actions and explain approval/review state.
- For sensitive or external operations, prefer prepare_* tools so the system can route through human review.
- If a tool reports missing fields, ask the user only for those missing fields.
- Keep the final answer direct and operationally accurate.
- Mention role restrictions when a tool denies access.

${responseInstruction}

Current user role: ${normalizeRole(userRole)}
Strategist guidance:
${safeJsonStringify(strategy, 2200)}

Project context:
${clip(projectContext, 5000) || 'No project context provided.'}

Persistent memory:
${clip(memoryContext, 3500) || 'No persistent memory provided.'}
`.trim();
};

const toOpenAIHistoryMessages = (history = []) =>
  (Array.isArray(history) ? history : [])
    .slice(-10)
    .map((item) => ({
      role: item.role === 'ai' ? 'assistant' : 'user',
      content: clip(item.text, 2000)
    }))
    .filter((item) => item.content);

const toAnthropicHistoryMessages = (history = []) =>
  (Array.isArray(history) ? history : [])
    .slice(-10)
    .map((item) => ({
      role: item.role === 'ai' ? 'assistant' : 'user',
      content: [{ type: 'text', text: clip(item.text, 2000) }]
    }))
    .filter((item) => item.content?.[0]?.text);

const parseOpenAIMessageText = (message) => {
  if (!message) return '';
  if (typeof message.content === 'string') return message.content.trim();
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => (part && typeof part.text === 'string' ? part.text : ''))
      .join('\n')
      .trim();
  }
  return '';
};

const callOpenAIToolTurn = async ({ messages, tools, temperature = 0.2, maxTokens = 1000 }) => {
  const apiKeys = getRotatedOpenAIApiKeys();
  if (apiKeys.length === 0) throw new Error('OPENAI_API_KEY/OPENAI_API_KEYS is not configured.');

  const requestBody = {
    model: OPENAI_MODEL,
    messages,
    tools,
    tool_choice: 'auto',
    temperature,
    max_tokens: maxTokens
  };

  const failures = [];
  for (let idx = 0; idx < apiKeys.length; idx += 1) {
    const apiKey = apiKeys[idx];
    try {
      const response = await withDatadogSpan(
        'ai.llm.tools.openai',
        { provider: 'openai', model: OPENAI_MODEL },
        async () =>
          withTimeout(
            `${OPENAI_BASE_URL}/chat/completions`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`
              },
              body: JSON.stringify(requestBody)
            }
          )
      );

      if (!response.ok) {
        const details = await response.text().catch(() => '');
        const status = Number(response.status || 0);
        failures.push(`key${idx + 1}:${status} ${details.slice(0, 120)}`.trim());

        const canRetry = idx < (apiKeys.length - 1)
          && shouldRetryWithAnotherOpenAIKey({ status, details });

        if (!canRetry) {
          throw new Error(`OpenAI tool call failed (${status}) ${details.slice(0, 260)}`.trim());
        }
        continue;
      }

      const data = await response.json();
      observeLlmProviderCall({ provider: 'openai', model: OPENAI_MODEL, error: false });
      return data;
    } catch (err) {
      const canRetry = idx < (apiKeys.length - 1)
        && shouldRetryWithAnotherOpenAIKey({ status: 0, error: err });
      failures.push(`key${idx + 1}:0 ${String(err?.message || err).slice(0, 120)}`.trim());
      if (!canRetry) throw err;
    }
  }

  throw new Error(`OpenAI tool call failed for all configured API keys. ${failures.join(' | ')}`.trim());
};

const extractAnthropicText = (content = []) =>
  (Array.isArray(content) ? content : [])
    .filter((block) => block?.type === 'text')
    .map((block) => String(block.text || ''))
    .join('\n')
    .trim();

const callAnthropicToolTurn = async ({ systemPrompt, messages, tools, temperature = 0.2, maxTokens = 1000 }) => {
  const apiKey = String(process.env.ANTHROPIC_API_KEY || '').trim();
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured.');

  const response = await withDatadogSpan(
    'ai.llm.tools.anthropic',
    { provider: 'anthropic', model: ANTHROPIC_MODEL },
    async () =>
      withTimeout(
        `${ANTHROPIC_BASE_URL}/messages`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify({
            model: ANTHROPIC_MODEL,
            system: systemPrompt,
            messages,
            tools,
            temperature,
            max_tokens: maxTokens
          })
        }
      )
  );

  if (!response.ok) {
    const details = await response.text().catch(() => '');
    throw new Error(`Anthropic tool call failed (${response.status}) ${details.slice(0, 260)}`.trim());
  }

  const data = await response.json();
  observeLlmProviderCall({ provider: 'anthropic', model: ANTHROPIC_MODEL, error: false });
  return data;
};

const runOpenAIToolLoop = async ({
  message,
  history = [],
  systemPrompt,
  toolContext
} = {}) => {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...toOpenAIHistoryMessages(history),
    { role: 'user', content: clip(message, 4000) }
  ];

  const toolSpecs = getOpenAIToolSpecs();
  const toolCalls = [];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const data = await callOpenAIToolTurn({ messages, tools: toolSpecs });
    const choice = data?.choices?.[0];
    const assistantMessage = choice?.message || {};
    const nativeToolCalls = Array.isArray(assistantMessage.tool_calls) ? assistantMessage.tool_calls : [];

    if (nativeToolCalls.length === 0) {
      return {
        provider: 'openai',
        text: cleanResponseText(parseOpenAIMessageText(assistantMessage)),
        toolCalls
      };
    }

    messages.push({
      role: 'assistant',
      content: assistantMessage.content || '',
      tool_calls: nativeToolCalls
    });

    for (const call of nativeToolCalls) {
      const toolName = String(call?.function?.name || '').trim();
      let parsedInput = {};
      try {
        parsedInput = call?.function?.arguments ? JSON.parse(call.function.arguments) : {};
      } catch (err) {
        parsedInput = {};
      }

      const result = await runAgentToolByName(toolName, parsedInput, toolContext);
      toolCalls.push({
        trace: toolResultToTrace(toolName, parsedInput, result),
        result
      });

      messages.push({
        role: 'tool',
        tool_call_id: call.id,
        content: safeJsonStringify(result, 6000)
      });
    }
  }

  return {
    provider: 'openai',
    text: 'The agent prepared the required tool observations but hit the iteration limit before finishing the reply.',
    toolCalls
  };
};

const runAnthropicToolLoop = async ({
  message,
  history = [],
  systemPrompt,
  toolContext
} = {}) => {
  const messages = [
    ...toAnthropicHistoryMessages(history),
    { role: 'user', content: [{ type: 'text', text: clip(message, 4000) }] }
  ];

  const toolSpecs = getAnthropicToolSpecs();
  const toolCalls = [];

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const data = await callAnthropicToolTurn({
      systemPrompt,
      messages,
      tools: toolSpecs
    });

    const content = Array.isArray(data?.content) ? data.content : [];
    const toolUses = content.filter((block) => block?.type === 'tool_use');
    const text = cleanResponseText(extractAnthropicText(content));

    if (toolUses.length === 0) {
      return {
        provider: 'anthropic',
        text,
        toolCalls
      };
    }

    messages.push({
      role: 'assistant',
      content
    });

    const toolResults = [];
    for (const block of toolUses) {
      const toolName = String(block?.name || '').trim();
      const parsedInput = block?.input && typeof block.input === 'object' ? block.input : {};
      const result = await runAgentToolByName(toolName, parsedInput, toolContext);
      toolCalls.push({
        trace: toolResultToTrace(toolName, parsedInput, result),
        result
      });
      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: safeJsonStringify(result, 6000)
      });
    }

    messages.push({
      role: 'user',
      content: toolResults
    });
  }

  return {
    provider: 'anthropic',
    text: 'The agent prepared the required tool observations but hit the iteration limit before finishing the reply.',
    toolCalls
  };
};

const buildFallbackPlannerPrompt = ({ message, history, observations, strategy, preferredLanguage }) => {
  const languageInstruction = String(preferredLanguage || '').toLowerCase() === 'hi'
    ? 'Return assistantMessage in Hindi.'
    : 'Return assistantMessage in English.';

  const toolCatalog = getAgentToolCatalog()
    .map((entry) => `- ${entry.name}: ${entry.description}`)
    .join('\n');

  return `
You are ToolPlannerAgent in an agentic workflow.
Decide the next best tool calls and return strict JSON only.

Available tools:
${toolCatalog}

Strategist guidance:
${safeJsonStringify(strategy, 1800)}

Recent history:
${safeJsonStringify(history.slice(-8), 2000)}

Completed observations:
${safeJsonStringify(observations, 2600)}

User message:
${clip(message, 3200)}

${languageInstruction}

Return JSON:
{
  "done": true,
  "assistantMessage": "string",
  "toolCalls": [
    {
      "name": "tool_name",
      "input": {}
    }
  ]
}
`.trim();
};

const runFallbackPlannerLoop = async ({
  message,
  history = [],
  preferredLanguage = 'en',
  strategy = {},
  toolContext
} = {}) => {
  const toolCalls = [];
  const observations = [];
  let assistantMessage = '';

  for (let iteration = 0; iteration < 4; iteration += 1) {
    const prompt = buildFallbackPlannerPrompt({
      message,
      history,
      observations,
      strategy,
      preferredLanguage
    });

    const response = await generateText({
      prompt,
      temperature: 0.1,
      maxTokens: 900
    });

    const parsed = extractFirstJSON(response.text) || {};
    assistantMessage = clip(parsed.assistantMessage || assistantMessage, 4000);
    const nextToolCalls = Array.isArray(parsed.toolCalls) ? parsed.toolCalls.slice(0, 3) : [];

    if (parsed.done || nextToolCalls.length === 0) {
      return {
        provider: response.provider || 'fallback',
        text: cleanResponseText(assistantMessage || response.text),
        toolCalls
      };
    }

    for (const planned of nextToolCalls) {
      const toolName = String(planned?.name || '').trim();
      const parsedInput = planned?.input && typeof planned.input === 'object' ? planned.input : {};
      const result = await runAgentToolByName(toolName, parsedInput, toolContext);
      toolCalls.push({
        trace: toolResultToTrace(toolName, parsedInput, result),
        result
      });
      observations.push({
        tool: toolName,
        summary: result.summary,
        status: result.status,
        reviewRequired: result.reviewRequired
      });
    }
  }

  return {
    provider: 'fallback',
    text: assistantMessage || 'The agent gathered tool observations but needs one more turn to finish the answer.',
    toolCalls
  };
};

const runModelNativeToolLoop = async ({
  message,
  history = [],
  preferredLanguage = 'en',
  userRole = 'GUEST',
  strategy = {},
  projectContext = '',
  memoryContext = '',
  ownerKey = '',
  threadId = ''
} = {}) => {
  const systemPrompt = buildSystemPrompt({
    preferredLanguage,
    userRole,
    strategy,
    projectContext,
    memoryContext
  });

  const toolContext = {
    userRole,
    preferredLanguage,
    history,
    projectContext,
    memoryContext,
    ownerKey,
    threadId
  };

  const providerOrder = resolveToolProviderOrder();
  const failures = [];

  for (const provider of providerOrder) {
    if (!isProviderConfigured(provider)) continue;
    try {
      if (provider === 'openai') {
        return await runOpenAIToolLoop({
          message,
          history,
          systemPrompt,
          toolContext
        });
      }
      if (provider === 'anthropic') {
        return await runAnthropicToolLoop({
          message,
          history,
          systemPrompt,
          toolContext
        });
      }
    } catch (err) {
      observeLlmProviderCall({
        provider,
        model: provider === 'openai' ? OPENAI_MODEL : ANTHROPIC_MODEL,
        error: true
      });
      captureException(err, { area: 'agent_tool_loop', provider });
      failures.push(`${provider}: ${err.message || err}`);
    }
  }

  if (failures.length > 0) {
    logger.warn('Model-native tool providers failed, using fallback tool planner', {
      failures
    });
  }

  const fallback = await runFallbackPlannerLoop({
    message,
    history,
    preferredLanguage,
    strategy,
    toolContext
  });

  return fallback;
};

module.exports = {
  runModelNativeToolLoop,
  aggregateToolOutcomes
};
