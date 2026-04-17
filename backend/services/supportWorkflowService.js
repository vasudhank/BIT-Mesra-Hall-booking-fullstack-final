const { runAgenticSupportWorkflow } = require('./agentGraphService');
const { runLangGraphCompatibleWorkflow } = require('./langGraphRuntimeService');
const { logger } = require('./loggerService');

const normalizeRuntime = (runtimeLike) => {
  const raw = String(runtimeLike || '').trim().toUpperCase();
  if (raw === 'LANGGRAPH' || raw === 'LANGGRAPH_COMPAT') return 'LANGGRAPH_COMPAT';
  return 'AGENT_GRAPH';
};

const resolveSupportRuntime = () => normalizeRuntime(process.env.SUPPORT_GRAPH_RUNTIME || 'AGENT_GRAPH');

const runSupportWorkflow = async (input = {}) => {
  const runtime = resolveSupportRuntime();

  if (runtime === 'LANGGRAPH_COMPAT') {
    try {
      return await runLangGraphCompatibleWorkflow(input);
    } catch (err) {
      logger.warn('LangGraph-compatible workflow failed, falling back to agent graph', {
        error: err.message || err
      });
    }
  }

  return runAgenticSupportWorkflow(input);
};

module.exports = {
  runSupportWorkflow,
  resolveSupportRuntime
};
