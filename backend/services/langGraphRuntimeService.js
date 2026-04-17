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

const nodeStrategist = async (state) => {
  const prompt = `
You are StrategistNode in a LangGraph-style support workflow.

Task:
- Analyze the user query.
- Build a short action plan with 2-6 steps.
- Detect if human review is recommended.

Context:
- User role: ${state.userRole}
- Preferred language: ${state.preferredLanguage}
- Project context:
${state.projectContext}

Recent chat history:
${state.historyBlock}

User message:
${state.message}

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
  const strategy = parsed && parsed.goal
    ? parsed
    : {
        goal: 'Resolve user query with accurate and practical response.',
        complexity: 'MEDIUM',
        requiresActionWorkflow: false,
        humanReviewRecommended: false,
        toolHints: ['knowledge_retrieval', 'context_reasoning'],
        steps: ['Interpret question', 'Gather project context', 'Answer with clear steps']
      };

  return {
    ...state,
    strategy,
    trace: [...state.trace, { node: 'StrategistNode', output: strategy }]
  };
};

const nodeRetriever = async (state) => {
  const [keywordKnowledge, vectorHits] = await Promise.all([
    getKnowledgeContextForPrompt({
      query: state.message,
      maxFaq: 4,
      maxNotices: 3
    }),
    querySimilarVectors({
      namespace: DEFAULT_VECTOR_NAMESPACE,
      queryText: state.message,
      topK: 4
    }).catch(() => [])
  ]);

  const vectorBlock = (Array.isArray(vectorHits) ? vectorHits : [])
    .filter((item) => Number(item.score || 0) > 0)
    .map((item, idx) => `${idx + 1}. score=${Number(item.score).toFixed(3)} | ${clip(item.text, 260)}`)
    .join('\n');

  const retrieval = {
    keywordKnowledge: keywordKnowledge?.block || 'No keyword retrieval context.',
    vectorKnowledge: vectorBlock || 'No vector retrieval context.'
  };

  return {
    ...state,
    retrieval,
    trace: [
      ...state.trace,
      {
        node: 'RetrieverNode',
        output: {
          keywordKnowledgeLength: String(retrieval.keywordKnowledge || '').length,
          vectorKnowledgeLength: String(retrieval.vectorKnowledge || '').length
        }
      }
    ]
  };
};

const nodeResponder = async (state) => {
  const langInstruction = String(state.preferredLanguage || '').toLowerCase() === 'hi'
    ? 'Respond in Hindi.'
    : 'Respond in English.';

  const prompt = `
You are ResponderNode in a LangGraph-style support architecture for BIT hall booking.

Your mission:
- Produce a clear final answer for the user.
- Follow strategist plan and retrieved context.
- Be concise but practical.
- If details are missing, request exact missing fields.
- Mention role/access constraints when needed.

${langInstruction}

Strategist output:
${JSON.stringify(state.strategy || {}, null, 2)}

Project context:
${state.projectContext}

Retriever keyword context:
${state.retrieval?.keywordKnowledge || 'No keyword retrieval context.'}

Retriever vector context:
${state.retrieval?.vectorKnowledge || 'No vector retrieval context.'}

Recent chat history:
${state.historyBlock}

User role: ${state.userRole}
User message: ${state.message}

Return plain text only.
`.trim();

  const result = await generateText({
    prompt,
    temperature: 0.35,
    maxTokens: 1200
  });

  const draftAnswer = cleanResponseText(result.text);
  return {
    ...state,
    draftAnswer,
    trace: [...state.trace, { node: 'ResponderNode', output: { draftLength: draftAnswer.length } }]
  };
};

const nodeCritic = async (state) => {
  const langInstruction = String(state.preferredLanguage || '').toLowerCase() === 'hi'
    ? 'Keep improved answer in Hindi.'
    : 'Keep improved answer in English.';

  const prompt = `
You are CriticNode in a LangGraph-style support architecture.

Review the draft answer for:
- factual consistency with strategist plan
- clarity and directness
- role safety (permissions, admin-only actions)

${langInstruction}

User message:
${state.message}

Strategist output:
${JSON.stringify(state.strategy || {}, null, 2)}

Draft answer:
${state.draftAnswer || ''}

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
  const critic = parsed && typeof parsed === 'object'
    ? {
        needsRevision: Boolean(parsed.needsRevision),
        issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 8) : [],
        improvedAnswer: clip(parsed.improvedAnswer, 5000)
      }
    : {
        needsRevision: false,
        issues: [],
        improvedAnswer: ''
      };

  const finalAnswer = critic.needsRevision && critic.improvedAnswer
    ? critic.improvedAnswer
    : state.draftAnswer;

  return {
    ...state,
    critic,
    finalAnswer: cleanResponseText(finalAnswer),
    trace: [...state.trace, { node: 'CriticNode', output: critic }]
  };
};

const executeGraph = async ({ startNode, nodes, edges, state }) => {
  let current = startNode;
  let workingState = { ...state };
  let hops = 0;

  while (current) {
    if (!nodes[current]) {
      throw new Error(`Graph node "${current}" is not registered.`);
    }
    hops += 1;
    if (hops > 16) {
      throw new Error('LangGraph-compatible workflow exceeded max hops.');
    }

    workingState = await nodes[current](workingState);
    const transition = edges[current];
    if (!transition) break;
    current = typeof transition === 'function' ? transition(workingState) : transition;
  }

  return workingState;
};

const runLangGraphCompatibleWorkflow = async ({
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
        mode: 'langgraph_compat',
        nodeCount: 0,
        trace: []
      }
    };
  }

  const effectiveProjectContext = projectContext || await getProjectSupportContext();
  const baseState = {
    message: cleanMessage,
    userRole,
    preferredLanguage,
    historyBlock: buildHistoryBlock(history),
    projectContext: effectiveProjectContext,
    trace: []
  };

  const finalState = await executeGraph({
    startNode: 'strategist',
    state: baseState,
    nodes: {
      strategist: nodeStrategist,
      retriever: nodeRetriever,
      responder: nodeResponder,
      critic: nodeCritic
    },
    edges: {
      strategist: 'retriever',
      retriever: 'responder',
      responder: 'critic'
    }
  });

  return {
    answer: cleanResponseText(finalState.finalAnswer || ''),
    meta: {
      mode: 'langgraph_compat',
      nodeCount: 4,
      humanReviewRecommended: Boolean(finalState?.strategy?.humanReviewRecommended),
      complexity: String(finalState?.strategy?.complexity || 'MEDIUM'),
      trace: finalState.trace || []
    }
  };
};

module.exports = {
  runLangGraphCompatibleWorkflow
};
