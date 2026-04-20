const { generateText, cleanResponseText } = require('./llmGatewayService');
const { getProjectSupportContext } = require('./projectSupportContextService');
const { getKnowledgeContextForPrompt } = require('./supportKnowledgeService');
const { querySimilarVectors, DEFAULT_VECTOR_NAMESPACE } = require('./vectorStoreService');
const { observeAgentGraphNode } = require('./metricsService');
const { captureException, withDatadogSpan } = require('./observabilityService');

const clip = (text, limit = 5000) => String(text || '').trim().slice(0, limit);

let langGraphBundlePromise = null;
let compiledActualGraphPromise = null;

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

const runNode = async (runtime, node, state, fn) =>
  withDatadogSpan(
    'ai.agent.node',
    {
      runtime,
      node,
      user_role: String(state?.userRole || 'GUEST')
    },
    async () => {
      try {
        const result = await fn(state);
        observeAgentGraphNode({ runtime, node });
        return result;
      } catch (err) {
        observeAgentGraphNode({ runtime, node, error: true });
        captureException(err, { area: 'agent_graph_node', runtime, node });
        throw err;
      }
    }
  );

const nodeStrategist = async (state) => {
  const prompt = `
You are StrategistNode in a real LangGraph support workflow.

Task:
- Analyze the user query.
- Decide whether this is conversational, agentic/action-oriented, or mixed.
- Build a short action plan with 2-6 steps.
- Detect if human review is recommended.
- Use persistent memory when it changes the answer.

Context:
- User role: ${state.userRole}
- Preferred language: ${state.preferredLanguage}
- Project context:
${state.projectContext}

Persistent memory:
${state.memoryContext || 'No persistent memory available.'}

Recent chat history:
${state.historyBlock}

User message:
${state.message}

Return ONLY valid JSON:
{
  "goal": "string",
  "queryMode": "CONVERSATIONAL|AGENTIC_ACTION|MIXED",
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
    maxTokens: 750
  });

  const parsed = extractFirstJSON(result.text);
  const strategy = parsed && parsed.goal
    ? parsed
    : {
        goal: 'Resolve user query with accurate and practical response.',
        queryMode: 'CONVERSATIONAL',
        complexity: 'MEDIUM',
        requiresActionWorkflow: false,
        humanReviewRecommended: false,
        toolHints: ['knowledge_retrieval', 'context_reasoning'],
        steps: ['Interpret question', 'Gather project context', 'Answer with clear steps']
      };

  return {
    strategy,
    trace: [{ node: 'StrategistNode', output: strategy }]
  };
};

const nodeRetriever = async (state) => {
  const [keywordKnowledge, vectorHits] = await Promise.all([
    getKnowledgeContextForPrompt({
      query: state.message,
      maxFaq: 5,
      maxNotices: 3
    }),
    querySimilarVectors({
      namespace: DEFAULT_VECTOR_NAMESPACE,
      queryText: state.message,
      topK: 5
    }).catch(() => [])
  ]);

  const vectorBlock = (Array.isArray(vectorHits) ? vectorHits : [])
    .filter((item) => Number(item.score || 0) > 0)
    .map((item, idx) => `${idx + 1}. score=${Number(item.score).toFixed(3)} | ${clip(item.text, 300)}`)
    .join('\n');

  const retrieval = {
    keywordKnowledge: keywordKnowledge?.block || 'No keyword retrieval context.',
    vectorKnowledge: vectorBlock || 'No vector retrieval context.'
  };

  return {
    retrieval,
    trace: [
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
You are ResponderNode in a production LangGraph architecture for BIT hall booking.

Your mission:
- Produce a clear final answer for conversational queries.
- For project agentic tasks, explain the plan and supported tool/action flow.
- Follow strategist plan, retrieved context, and persistent memory.
- If exact action execution is needed, describe the supported action path and missing fields.
- Mention role/access constraints when needed.
- Never invent private credentials or hidden data.

${langInstruction}

Strategist output:
${JSON.stringify(state.strategy || {}, null, 2)}

Project context:
${state.projectContext}

Persistent memory:
${state.memoryContext || 'No persistent memory available.'}

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
    maxTokens: 1300
  });

  const draftAnswer = cleanResponseText(result.text);
  return {
    draftAnswer,
    trace: [{ node: 'ResponderNode', output: { draftLength: draftAnswer.length } }]
  };
};

const nodeCritic = async (state) => {
  const langInstruction = String(state.preferredLanguage || '').toLowerCase() === 'hi'
    ? 'Keep improved answer in Hindi.'
    : 'Keep improved answer in English.';

  const prompt = `
You are CriticNode in a production LangGraph architecture.

Review the draft answer for:
- factual consistency with strategist plan
- correct use of persistent memory
- clarity and directness
- role safety and human-in-the-loop constraints
- whether action execution claims are honest

${langInstruction}

User message:
${state.message}

Strategist output:
${JSON.stringify(state.strategy || {}, null, 2)}

Persistent memory:
${state.memoryContext || 'No persistent memory available.'}

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
    maxTokens: 750
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
    critic,
    finalAnswer: cleanResponseText(finalAnswer),
    trace: [{ node: 'CriticNode', output: critic }]
  };
};

const loadLangGraphBundle = async () => {
  if (!langGraphBundlePromise) {
    langGraphBundlePromise = import('@langchain/langgraph');
  }
  return langGraphBundlePromise;
};

const replaceReducer = (current, update) => (update === undefined ? current : update);
const traceReducer = (current, update) => {
  const existing = Array.isArray(current) ? current : [];
  const incoming = Array.isArray(update) ? update : [];
  return existing.concat(incoming);
};

const getActualLangGraph = async () => {
  if (String(process.env.LANGGRAPH_REAL_ENABLED || 'true').toLowerCase() === 'false') {
    throw new Error('Real LangGraph runtime disabled by LANGGRAPH_REAL_ENABLED=false');
  }

  if (!compiledActualGraphPromise) {
    compiledActualGraphPromise = (async () => {
      const {
        Annotation,
        StateGraph,
        START,
        END,
        MemorySaver
      } = await loadLangGraphBundle();

      const GraphState = Annotation.Root({
        message: Annotation({ reducer: replaceReducer, default: () => '' }),
        userRole: Annotation({ reducer: replaceReducer, default: () => 'GUEST' }),
        preferredLanguage: Annotation({ reducer: replaceReducer, default: () => 'en' }),
        historyBlock: Annotation({ reducer: replaceReducer, default: () => 'No prior messages.' }),
        projectContext: Annotation({ reducer: replaceReducer, default: () => '' }),
        memoryContext: Annotation({ reducer: replaceReducer, default: () => '' }),
        strategy: Annotation({ reducer: replaceReducer, default: () => ({}) }),
        retrieval: Annotation({ reducer: replaceReducer, default: () => ({}) }),
        draftAnswer: Annotation({ reducer: replaceReducer, default: () => '' }),
        critic: Annotation({ reducer: replaceReducer, default: () => ({}) }),
        finalAnswer: Annotation({ reducer: replaceReducer, default: () => '' }),
        trace: Annotation({ reducer: traceReducer, default: () => [] })
      });

      const checkpointer = new MemorySaver();
      const graph = new StateGraph(GraphState)
        .addNode('strategist', (state) => runNode('langgraph_actual', 'strategist', state, nodeStrategist))
        .addNode('retriever', (state) => runNode('langgraph_actual', 'retriever', state, nodeRetriever))
        .addNode('responder', (state) => runNode('langgraph_actual', 'responder', state, nodeResponder))
        .addNode('critic', (state) => runNode('langgraph_actual', 'critic', state, nodeCritic))
        .addEdge(START, 'strategist')
        .addEdge('strategist', 'retriever')
        .addEdge('retriever', 'responder')
        .addEdge('responder', 'critic')
        .addEdge('critic', END)
        .compile({ checkpointer });

      return graph;
    })();
  }

  return compiledActualGraphPromise;
};

const executeFallbackGraph = async ({ startNode, nodes, edges, state }) => {
  let current = startNode;
  let workingState = { ...state };
  let hops = 0;

  while (current) {
    if (!nodes[current]) {
      throw new Error(`Fallback graph node "${current}" is not registered.`);
    }
    hops += 1;
    if (hops > 16) {
      throw new Error('Fallback LangGraph workflow exceeded max hops.');
    }

    const update = await runNode('langgraph_fallback', current, workingState, nodes[current]);
    workingState = {
      ...workingState,
      ...update,
      trace: traceReducer(workingState.trace, update.trace)
    };
    const transition = edges[current];
    if (!transition) break;
    current = typeof transition === 'function' ? transition(workingState) : transition;
  }

  return workingState;
};

const buildBaseState = async ({
  message,
  userRole = 'GUEST',
  preferredLanguage = 'en',
  history = [],
  projectContext = '',
  memoryContext = ''
} = {}) => {
  const cleanMessage = clip(message, 12000);
  const effectiveProjectContext = projectContext || await getProjectSupportContext();
  return {
    message: cleanMessage,
    userRole,
    preferredLanguage,
    historyBlock: buildHistoryBlock(history),
    projectContext: effectiveProjectContext,
    memoryContext,
    trace: []
  };
};

const runActualLangGraphWorkflow = async (baseState, { ownerKey, threadId } = {}) => {
  const graph = await getActualLangGraph();
  const graphThreadId = `${ownerKey || 'anonymous'}:${threadId || 'default'}`.slice(0, 180);
  return graph.invoke(baseState, {
    configurable: { thread_id: graphThreadId },
    recursionLimit: 16
  });
};

const runFallbackLangGraphWorkflow = async (baseState) =>
  executeFallbackGraph({
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

const runLangGraphCompatibleWorkflow = async ({
  message,
  userRole = 'GUEST',
  preferredLanguage = 'en',
  history = [],
  projectContext = '',
  memoryContext = '',
  ownerKey = '',
  threadId = ''
} = {}) => {
  const cleanMessage = clip(message, 12000);
  if (!cleanMessage) {
    return {
      answer: '',
      meta: {
        mode: 'langgraph_actual',
        nodeCount: 0,
        trace: []
      }
    };
  }

  const baseState = await buildBaseState({
    message: cleanMessage,
    userRole,
    preferredLanguage,
    history,
    projectContext,
    memoryContext
  });

  let finalState;
  let mode = 'langgraph_actual';

  try {
    finalState = await runActualLangGraphWorkflow(baseState, { ownerKey, threadId });
  } catch (err) {
    mode = 'langgraph_fallback';
    captureException(err, { area: 'langgraph_actual_runtime' });
    finalState = await runFallbackLangGraphWorkflow(baseState);
  }

  return {
    answer: cleanResponseText(finalState.finalAnswer || ''),
    meta: {
      mode,
      nodeCount: 4,
      humanReviewRecommended: Boolean(finalState?.strategy?.humanReviewRecommended),
      complexity: String(finalState?.strategy?.complexity || 'MEDIUM'),
      queryMode: String(finalState?.strategy?.queryMode || 'CONVERSATIONAL'),
      trace: finalState.trace || []
    }
  };
};

module.exports = {
  runLangGraphCompatibleWorkflow
};
