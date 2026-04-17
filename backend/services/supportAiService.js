const { getProjectSupportContext } = require('./projectSupportContextService');
const { getKnowledgeContextForPrompt } = require('./supportKnowledgeService');
const { generateText, cleanResponseText } = require('./llmGatewayService');
const { runSupportWorkflow } = require('./supportWorkflowService');
const { isCrmAutoSyncEnabled, safeSyncSupportThreadToCrm } = require('./crmIntegrationService');

const buildPrompt = async ({ kind, title, message, email, threadId }) => {
  const [projectContext, retrieval] = await Promise.all([
    getProjectSupportContext(),
    getKnowledgeContextForPrompt({
      query: `${title}\n${message}`,
      maxFaq: 4,
      maxNotices: 2
    })
  ]);

  const knowledgeContext = retrieval?.block || 'No additional retrieval snippets.';
  const normalizedKind = String(kind || '').toUpperCase();
  const styleHint = normalizedKind === 'FAQ'
    ? 'Answer as an FAQ response: concise and directly reusable in docs.'
    : 'Answer as a practical support response for a live production issue thread.';

  return `
You are a support AI for the BIT Seminar Hall Booking System.
Your responsibility is to provide production-grade guidance that is concrete, safe, and action-oriented.

Thread type: ${kind}
Thread id: ${threadId}
Reporter email: ${email}
Title: ${title}
Message: ${message}

Project context:
${projectContext}

Retrieved FAQ/notice context:
${knowledgeContext}

Guidance style:
- ${styleHint}
- Prefer steps tied to actual app screens/menus or admin workflows.
- Mention validation checks (date/time, hall conflict, role access) where relevant.
- If details are missing, ask for only the exact missing fields.
- If the issue likely needs human escalation, explicitly state when to involve Admin/Developer.

Output rules:
- Plain text only
- 5 to 14 lines
- Mention concrete page names or menu names in this app when relevant.
`.trim();
};

const fallbackAnswer = ({ kind, title }) => {
  const normalized = String(kind || '').toUpperCase();
  const type = normalized === 'QUERY' ? 'query' : normalized === 'FAQ' ? 'faq' : 'complaint';
  return [
    `AI Generated (${type}): I could not complete full analysis right now.`,
    `Please open the ${normalized === 'QUERY' ? 'Queries' : normalized === 'FAQ' ? 'FAQ' : 'Complaints'} page thread "${title}" and add:`,
    '1) exact hall/department/date-time details',
    '2) screenshot or error text',
    '3) expected behavior vs actual behavior',
    'Admin/Developer can then provide a trusted fix quickly.'
  ].join('\n');
};

const postProcessSupportAnswer = (text, input) => {
  const clean = cleanResponseText(text);
  if (!clean) return fallbackAnswer(input);
  return clean;
};

const queueSupportThreadCrmSync = (input, aiAnswer) => {
  if (!isCrmAutoSyncEnabled()) return;

  setImmediate(() => {
    safeSyncSupportThreadToCrm({
      kind: input?.kind || 'SUPPORT',
      title: input?.title || '',
      message: input?.message || '',
      email: input?.email || '',
      threadId: input?.threadId || '',
      aiAnswer: aiAnswer || '',
      source: 'BIT-Booking3:auto-support-ai'
    }).catch(() => {});
  });
};

const generateProjectSpecificSupportAnswer = async (input = {}) => {
  try {
    const useMultiAgent = String(process.env.SUPPORT_MULTI_AGENT_ENABLED || 'true').toLowerCase() !== 'false';
    if (useMultiAgent) {
      const workflow = await runSupportWorkflow({
        message: `${input.title || ''}\n${input.message || ''}`.trim(),
        userRole: 'SUPPORT_THREAD',
        preferredLanguage: 'en',
        history: [],
        projectContext: await getProjectSupportContext()
      });

      if (workflow?.answer) {
        const answer = postProcessSupportAnswer(workflow.answer, input);
        queueSupportThreadCrmSync(input, answer);
        return answer;
      }
    }

    const prompt = await buildPrompt(input);
    const result = await generateText({
      prompt,
      temperature: 0.22,
      maxTokens: 720,
      providers: process.env.SUPPORT_AI_PROVIDER_ORDER
        ? String(process.env.SUPPORT_AI_PROVIDER_ORDER).split(',')
        : undefined
    });
    const answer = postProcessSupportAnswer(result.text, input);
    queueSupportThreadCrmSync(input, answer);
    return answer;
  } catch (err) {
    const answer = fallbackAnswer(input);
    queueSupportThreadCrmSync(input, answer);
    return answer;
  }
};

module.exports = { generateProjectSpecificSupportAnswer };
