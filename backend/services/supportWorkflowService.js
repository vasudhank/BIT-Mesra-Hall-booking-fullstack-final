const { runAgenticModelWorkflow } = require('./agenticWorkflowService');
const { runAgenticSupportWorkflow } = require('./agentGraphService');
const { runLangGraphCompatibleWorkflow } = require('./langGraphRuntimeService');
const { logger } = require('./loggerService');

const normalizeRuntime = (runtimeLike) => {
  const raw = String(runtimeLike || '').trim().toUpperCase();
  if (raw === 'AGENTIC_MODEL_TOOLS' || raw === 'MODEL_NATIVE_TOOLS' || raw === 'TOOL_CALLING') {
    return 'AGENTIC_MODEL_TOOLS';
  }
  if (raw === 'LANGGRAPH' || raw === 'LANGGRAPH_COMPAT') return 'LANGGRAPH_COMPAT';
  return 'AGENT_GRAPH';
};

const resolveSupportRuntime = () => normalizeRuntime(process.env.SUPPORT_GRAPH_RUNTIME || 'AGENTIC_MODEL_TOOLS');

const runSupportWorkflow = async (input = {}) => {
  const runtime = resolveSupportRuntime();

  if (runtime === 'AGENTIC_MODEL_TOOLS') {
    try {
      return await runAgenticModelWorkflow(input);
    } catch (err) {
      logger.warn('Agentic model-tools workflow failed, falling back to LangGraph-compatible runtime', {
        error: err.message || err
      });
    }
  }

  if (runtime === 'LANGGRAPH_COMPAT') {
    try {
      return await runLangGraphCompatibleWorkflow(input);
    } catch (err) {
      logger.warn('LangGraph-compatible workflow failed, falling back to agent graph', {
        error: err.message || err
      });
    }
  } else {
    try {
      return await runLangGraphCompatibleWorkflow(input);
    } catch (err) {
      logger.warn('LangGraph-compatible fallback failed, falling back to agent graph', {
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
