const { generateText, cleanResponseText } = require('./llmGatewayService');
const { getProjectSupportContext } = require('./projectSupportContextService');
const { getKnowledgeContextForPrompt } = require('./supportKnowledgeService');
const { querySimilarVectors, DEFAULT_VECTOR_NAMESPACE } = require('./vectorStoreService');

const clip = (text, limit = 5000) => String(text || '').trim().slice(0, limit);

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

const buildHistoryBlock = (history = []) => {
  if (!Array.isArray(history) || history.length === 0) return 'No prior messages.';
  return history
    .slice(-10)
    .map((item, idx) => `${idx + 1}. ${item.role === 'user' ? 'User' : 'Assistant'}: ${item.text}`)
    .join('\n');
};

const runStrategistAgent = async ({
  message,
  userRole,
  preferredLanguage,
  historyBlock,
  projectContext
}) => {
  const prompt = `
You are StrategistAgent in a multi-agent support system.

Task:
- Analyze the user query.
- Build a short action plan with 2-6 steps.
- Detect if human review is recommended.

Context:
- User role: ${userRole}
- Preferred language: ${preferredLanguage}
- Project context:
${projectContext}

Recent chat history:
${historyBlock}

User message:
${message}

Return ONLY valid JSON:
{
  "goal": "string",
  "complexity": "LOW|MEDIUM|HIGH",
  "requiresActionWorkflow": true|false,
  "humanReviewRecommended": true|false,
  "toolHints": ["string"],
  "steps": ["string"]
}
`.trim();

  const result = await generateText({
    prompt,
    temperature: 0.2,
    maxTokens: 700
  });

  const parsed = extractFirstJSON(result.text);
  if (parsed && parsed.goal) return parsed;

  return {
    goal: 'Resolve user query with accurate and practical response.',
    complexity: 'MEDIUM',
    requiresActionWorkflow: false,
    humanReviewRecommended: false,
    toolHints: ['knowledge_retrieval', 'context_reasoning'],
    steps: ['Interpret question', 'Gather project context', 'Answer with clear steps']
  };
};

const runRetrieverAgent = async ({ message }) => {
  const [keywordKnowledge, vectorHits] = await Promise.all([
    getKnowledgeContextForPrompt({
      query: message,
      maxFaq: 4,
      maxNotices: 3
    }),
    querySimilarVectors({
      namespace: DEFAULT_VECTOR_NAMESPACE,
      queryText: message,
      topK: 4
    }).catch(() => [])
  ]);

  const vectorBlock = (Array.isArray(vectorHits) ? vectorHits : [])
    .filter((item) => Number(item.score || 0) > 0)
    .map((item, idx) => `${idx + 1}. score=${Number(item.score).toFixed(3)} | ${clip(item.text, 260)}`)
    .join('\n');

  return {
    keywordKnowledge: keywordKnowledge?.block || 'No keyword retrieval context.',
    vectorKnowledge: vectorBlock || 'No vector retrieval context.'
  };
};

const runResponderAgent = async ({
  message,
  preferredLanguage,
  userRole,
  projectContext,
  historyBlock,
  strategy,
  retrieval
}) => {
  const langInstruction = String(preferredLanguage || '').toLowerCase() === 'hi'
    ? 'Respond in Hindi.'
    : 'Respond in English.';

  const prompt = `
You are ResponderAgent in a multi-agent support architecture for BIT hall booking.

Your mission:
- Produce a clear final answer for the user.
- Follow strategist plan and retrieved context.
- Be concise but practical.
- If details are missing, request exact missing fields.
- Mention role/access constraints when needed.

${langInstruction}

Strategist output:
${JSON.stringify(strategy, null, 2)}

Project context:
${projectContext}

Retriever keyword context:
${retrieval.keywordKnowledge}

Retriever vector context:
${retrieval.vectorKnowledge}

Recent chat history:
${historyBlock}

User role: ${userRole}
User message: ${message}

Return plain text only.
`.trim();

  const result = await generateText({
    prompt,
    temperature: 0.35,
    maxTokens: 1200
  });

  return cleanResponseText(result.text);
};

const runCriticAgent = async ({ message, draftAnswer, strategy, preferredLanguage }) => {
  const langInstruction = String(preferredLanguage || '').toLowerCase() === 'hi'
    ? 'Keep improved answer in Hindi.'
    : 'Keep improved answer in English.';

  const prompt = `
You are CriticAgent in a multi-agent support architecture.

Review the draft answer for:
- factual consistency with strategist plan
- clarity and directness
- role safety (permissions, admin-only actions)

${langInstruction}

User message:
${message}

Strategist output:
${JSON.stringify(strategy, null, 2)}

Draft answer:
${draftAnswer}

Return only JSON:
{
  "needsRevision": true|false,
  "issues": ["string"],
  "improvedAnswer": "string"
}
`.trim();

  const result = await generateText({
    prompt,
    temperature: 0.1,
    maxTokens: 700
  });

  const parsed = extractFirstJSON(result.text);
  if (parsed && typeof parsed === 'object') {
    return {
      needsRevision: Boolean(parsed.needsRevision),
      issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 8) : [],
      improvedAnswer: clip(parsed.improvedAnswer, 5000)
    };
  }

  return {
    needsRevision: false,
    issues: [],
    improvedAnswer: ''
  };
};

const runAgenticSupportWorkflow = async ({
  message,
  userRole = 'GUEST',
  preferredLanguage = 'en',
  history = [],
  projectContext = ''
} = {}) => {
  const cleanMessage = clip(message, 12000);
  if (!cleanMessage) {
    return {
      answer: '',
      meta: {
        mode: 'agent_graph',
        agentCount: 0,
        trace: []
      }
    };
  }

  const trace = [];
  const effectiveProjectContext = projectContext || await getProjectSupportContext();
  const historyBlock = buildHistoryBlock(history);

  const strategy = await runStrategistAgent({
    message: cleanMessage,
    userRole,
    preferredLanguage,
    historyBlock,
    projectContext: effectiveProjectContext
  });
  trace.push({ agent: 'StrategistAgent', output: strategy });

  const retrieval = await runRetrieverAgent({ message: cleanMessage });
  trace.push({
    agent: 'RetrieverAgent',
    output: {
      keywordKnowledgeLength: String(retrieval.keywordKnowledge || '').length,
      vectorKnowledgeLength: String(retrieval.vectorKnowledge || '').length
    }
  });

  const draftAnswer = await runResponderAgent({
    message: cleanMessage,
    preferredLanguage,
    userRole,
    projectContext: effectiveProjectContext,
    historyBlock,
    strategy,
    retrieval
  });
  trace.push({ agent: 'ResponderAgent', output: { draftLength: draftAnswer.length } });

  const critic = await runCriticAgent({
    message: cleanMessage,
    draftAnswer,
    strategy,
    preferredLanguage
  });
  trace.push({ agent: 'CriticAgent', output: critic });

  const finalAnswer = critic.needsRevision && critic.improvedAnswer
    ? critic.improvedAnswer
    : draftAnswer;

  return {
    answer: cleanResponseText(finalAnswer),
    meta: {
      mode: 'agent_graph',
      agentCount: 4,
      humanReviewRecommended: Boolean(strategy?.humanReviewRecommended),
      complexity: String(strategy?.complexity || 'MEDIUM'),
      trace
    }
  };
};

module.exports = {
  runAgenticSupportWorkflow
};
