const { generateText, cleanResponseText } = require('./llmGatewayService');
const { runModelNativeToolLoop, aggregateToolOutcomes } = require('./agentToolCallingService');
const { createReviewTask } = require('./agentReviewService');
const { observeAgentGraphNode } = require('./metricsService');
const { captureException, withDatadogSpan } = require('./observabilityService');

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

const runStage = async (node, work) =>
  withDatadogSpan('ai.agentic.stage', { runtime: 'agentic_model_tools', node }, async () => {
    try {
      const result = await work();
      observeAgentGraphNode({ runtime: 'agentic_model_tools', node, error: false });
      return result;
    } catch (err) {
      observeAgentGraphNode({ runtime: 'agentic_model_tools', node, error: true });
      captureException(err, { area: 'agentic_workflow_stage', node });
      throw err;
    }
  });

const buildStrategistPrompt = ({
  message,
  userRole,
  preferredLanguage,
  history,
  projectContext,
  memoryContext
} = {}) => `
You are PlannerAgent in an agentic AI system.
Analyze the user request and decide whether tools, retrieval, persistent memory, or human review are likely needed.

User role: ${String(userRole || 'GUEST').toUpperCase()}
Preferred language: ${String(preferredLanguage || 'en')}

Recent history:
${JSON.stringify((history || []).slice(-8), null, 2)}

Project context:
${clip(projectContext, 3800) || 'No project context provided.'}

Persistent memory:
${clip(memoryContext, 2800) || 'No persistent memory available.'}

User message:
${clip(message, 3200)}

Return strict JSON only:
{
  "goal": "string",
  "complexity": "LOW|MEDIUM|HIGH",
  "queryMode": "CONVERSATIONAL|ACTIONABLE|ANALYTICAL|RETRIEVAL",
  "toolCandidates": ["tool_name"],
  "needsTools": true,
  "needsHumanReview": false,
  "planSummary": "string"
}
`.trim();

const normalizeStrategy = (parsed = {}) => ({
  goal: clip(parsed.goal || '', 260),
  complexity: ['LOW', 'MEDIUM', 'HIGH'].includes(String(parsed.complexity || '').toUpperCase())
    ? String(parsed.complexity).toUpperCase()
    : 'MEDIUM',
  queryMode: ['CONVERSATIONAL', 'ACTIONABLE', 'ANALYTICAL', 'RETRIEVAL'].includes(String(parsed.queryMode || '').toUpperCase())
    ? String(parsed.queryMode).toUpperCase()
    : 'CONVERSATIONAL',
  toolCandidates: Array.isArray(parsed.toolCandidates)
    ? parsed.toolCandidates.filter(Boolean).slice(0, 8)
    : [],
  needsTools: Boolean(parsed.needsTools),
  needsHumanReview: Boolean(parsed.needsHumanReview),
  planSummary: clip(parsed.planSummary || '', 400)
});

const synthesizeAnswerFromTools = ({ toolCalls = [], actionIntent = null, reviewTask = null, resultData = null } = {}) => {
  if (reviewTask) {
    return `I prepared the requested action and created a human review task (${reviewTask.id}) because this workflow needs approval before execution.`;
  }

  if (actionIntent?.reply) {
    return String(actionIntent.reply).trim();
  }

  const latestSummary = [...toolCalls]
    .reverse()
    .map((call) => call?.trace?.summary || '')
    .find(Boolean);

  if (latestSummary) return latestSummary;

  if (resultData?.kind === 'HALL_STATUS') {
    return `I checked the hall availability and found ${Array.isArray(resultData.items) ? resultData.items.length : 0} matching hall record(s).`;
  }

  if (resultData?.kind === 'BOOKING_REQUESTS') {
    return `I reviewed the pending booking queue and found ${Number(resultData?.summary?.total || 0)} pending request(s).`;
  }

  return 'I completed the agent workflow and prepared the next best result.';
};

const buildReviewerPrompt = ({
  message,
  preferredLanguage,
  strategy,
  draftAnswer,
  toolTraces,
  actionIntent,
  resultData
} = {}) => `
You are ReviewAgent in an agentic AI system.
Review the draft answer for clarity, role safety, tool-result faithfulness, and human-review requirements.

Preferred language: ${String(preferredLanguage || 'en')}

Strategist output:
${JSON.stringify(strategy || {}, null, 2)}

Tool traces:
${JSON.stringify(toolTraces || [], null, 2)}

Action intent:
${JSON.stringify(actionIntent || null, null, 2)}

Structured result data:
${JSON.stringify(resultData || null, null, 2)}

User message:
${clip(message, 2600)}

Draft answer:
${clip(draftAnswer, 3200)}

Return strict JSON:
{
  "needsRevision": false,
  "finalAnswer": "string",
  "reviewTitle": "string",
  "reviewSummary": "string",
  "reviewRationale": "string",
  "humanReviewConfirmed": false
}
`.trim();

const normalizeReviewerResult = (parsed = {}, draftAnswer = '') => ({
  needsRevision: Boolean(parsed.needsRevision),
  finalAnswer: cleanResponseText(parsed.finalAnswer || draftAnswer || ''),
  reviewTitle: clip(parsed.reviewTitle || '', 180),
  reviewSummary: clip(parsed.reviewSummary || '', 800),
  reviewRationale: clip(parsed.reviewRationale || '', 1000),
  humanReviewConfirmed: Boolean(parsed.humanReviewConfirmed)
});

const runAgenticModelWorkflow = async ({
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
        mode: 'agentic_model_tools',
        agentCount: 0,
        trace: [],
        toolCalls: []
      }
    };
  }

  const trace = [];

  const strategy = await runStage('planner', async () => {
    const result = await generateText({
      prompt: buildStrategistPrompt({
        message: cleanMessage,
        userRole,
        preferredLanguage,
        history,
        projectContext,
        memoryContext
      }),
      temperature: 0.15,
      maxTokens: 700
    });

    const parsed = extractFirstJSON(result.text);
    const normalized = normalizeStrategy(parsed || {});
    trace.push({ node: 'PlannerAgent', output: normalized });
    return normalized;
  });

  const toolLoop = await runStage('tool_coordinator', async () => {
    const result = await runModelNativeToolLoop({
      message: cleanMessage,
      history,
      preferredLanguage,
      userRole,
      strategy,
      projectContext,
      memoryContext,
      ownerKey,
      threadId
    });

    trace.push({
      node: 'ToolCoordinatorAgent',
      output: {
        provider: result.provider,
        toolCallCount: Array.isArray(result.toolCalls) ? result.toolCalls.length : 0
      }
    });

    return result;
  });

  const toolCalls = Array.isArray(toolLoop.toolCalls) ? toolLoop.toolCalls : [];
  const aggregated = aggregateToolOutcomes(toolCalls);
  const draftAnswer = cleanResponseText(
    toolLoop.text
    || synthesizeAnswerFromTools({
      toolCalls,
      actionIntent: aggregated.actionIntent,
      resultData: aggregated.resultData
    })
  );

  const reviewer = await runStage('reviewer', async () => {
    const result = await generateText({
      prompt: buildReviewerPrompt({
        message: cleanMessage,
        preferredLanguage,
        strategy,
        draftAnswer,
        toolTraces: toolCalls.map((call) => call.trace),
        actionIntent: aggregated.actionIntent,
        resultData: aggregated.resultData
      }),
      temperature: 0.1,
      maxTokens: 700
    });

    const parsed = extractFirstJSON(result.text);
    const normalized = normalizeReviewerResult(parsed || {}, draftAnswer);
    trace.push({
      node: 'ReviewAgent',
      output: {
        needsRevision: normalized.needsRevision,
        humanReviewConfirmed: normalized.humanReviewConfirmed
      }
    });
    return normalized;
  });

  const needsHumanReview = Boolean(
    aggregated.reviewRequired
    || strategy.needsHumanReview
    || reviewer.humanReviewConfirmed
  );

  let reviewTask = null;
  if (aggregated.actionIntent && needsHumanReview) {
    reviewTask = await runStage('human_review_gate', async () => {
      const created = await createReviewTask({
        ownerKey: ownerKey || 'GUEST:anonymous',
        threadId: threadId || 'thread_default',
        requestedByRole: userRole,
        actionIntent: aggregated.actionIntent,
        toolRuns: toolCalls.map((call) => call.trace),
        riskLevel: aggregated.riskLevel || 'HIGH',
        title: reviewer.reviewTitle || `${aggregated.actionIntent.action} requires human review`,
        summary: reviewer.reviewSummary || 'Prepared agent action awaiting approval.',
        rationale: reviewer.reviewRationale || strategy.planSummary || 'Sensitive workflow requires approval before execution.',
        messagePreview: cleanMessage,
        metadata: {
          provider: toolLoop.provider || '',
          queryMode: strategy.queryMode,
          complexity: strategy.complexity
        }
      });

      trace.push({
        node: 'HumanReviewAgent',
        output: {
          reviewTaskId: created.id,
          riskLevel: created.riskLevel
        }
      });

      return created;
    });
  }

  const finalAnswer = cleanResponseText(
    reviewer.finalAnswer
    || draftAnswer
    || synthesizeAnswerFromTools({
      toolCalls,
      actionIntent: aggregated.actionIntent,
      reviewTask,
      resultData: aggregated.resultData
    })
  );

  return {
    answer: finalAnswer,
    meta: {
      mode: 'agentic_model_tools',
      agentCount: reviewTask ? 4 : 3,
      provider: toolLoop.provider || '',
      complexity: strategy.complexity,
      queryMode: strategy.queryMode,
      planSummary: strategy.planSummary,
      humanReviewRecommended: needsHumanReview,
      toolCalls: toolCalls.map((call) => call.trace),
      actionIntent: reviewTask ? null : aggregated.actionIntent,
      reviewTask,
      resultData: aggregated.resultData,
      trace
    }
  };
};

module.exports = {
  runAgenticModelWorkflow
};
