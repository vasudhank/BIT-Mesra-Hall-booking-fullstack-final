const client = require('prom-client');

const register = new client.Registry();
client.collectDefaultMetrics({
  register,
  prefix: 'bit_booking_'
});

const HTTP_LATENCY_BUCKETS_MS = [50, 100, 250, 500, 1000, 2000, 5000, 10000];
const AI_LATENCY_BUCKETS_MS = [100, 250, 500, 1000, 2500, 5000, 10000, 20000, 40000];
const HISTORY_SAMPLE_INTERVAL_MS = Math.max(Number(process.env.MONITORING_SAMPLE_INTERVAL_MS || 30000), 5000);
const HISTORY_LIMIT = Math.max(Number(process.env.MONITORING_HISTORY_LIMIT || 72), 12);

const createDurationBuckets = (thresholds = []) =>
  thresholds.map((maxMs, index) => ({
    maxMs,
    label: `${index === 0 ? 0 : thresholds[index - 1]}-${maxMs} ms`,
    count: 0
  })).concat({
    maxMs: null,
    label: `>${thresholds[thresholds.length - 1] || 0} ms`,
    count: 0
  });

const cloneDurationBuckets = (buckets = []) =>
  buckets.map((bucket) => ({
    maxMs: bucket.maxMs,
    label: bucket.label,
    count: Number(bucket.count || 0)
  }));

const metricsState = {
  processStartAt: Date.now(),
  history: {
    sampleIntervalMs: HISTORY_SAMPLE_INTERVAL_MS,
    samples: [],
    lastCapturedAt: 0
  },
  http: {
    requestsTotal: 0,
    byRoute: {},
    byStatus: {},
    totalDurationMs: 0,
    latencyDistribution: createDurationBuckets(HTTP_LATENCY_BUCKETS_MS)
  },
  ai: {
    requestsTotal: 0,
    activeRequests: 0,
    errorsTotal: 0,
    totalDurationMs: 0,
    byMode: {},
    lastErrorAt: null,
    latencyDistribution: createDurationBuckets(AI_LATENCY_BUCKETS_MS)
  },
  memory: {
    operationsTotal: 0,
    errorsTotal: 0,
    byOperation: {}
  },
  tools: {
    callsTotal: 0,
    errorsTotal: 0,
    byTool: {}
  },
  reviews: {
    createdTotal: 0,
    pendingTotal: 0,
    approvedTotal: 0,
    rejectedTotal: 0,
    executedTotal: 0,
    failedTotal: 0
  },
  graph: {
    nodeExecutionsTotal: 0,
    nodeErrorsTotal: 0,
    byNode: {}
  },
  llm: {
    callsTotal: 0,
    errorsTotal: 0,
    byProvider: {},
    byModel: {},
    byProviderStatus: {},
    lastSuccessfulProvider: '',
    lastSuccessfulModel: '',
    lastSuccessfulAt: null,
    lastFailureAt: null
  }
};

const httpRequests = new client.Counter({
  name: 'bit_booking_http_requests_total',
  help: 'Total HTTP requests handled by the backend.',
  labelNames: ['method', 'route', 'status']
});

const httpDuration = new client.Histogram({
  name: 'bit_booking_http_request_duration_seconds',
  help: 'HTTP request duration in seconds.',
  labelNames: ['method', 'route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30]
});

const aiRequests = new client.Counter({
  name: 'bit_booking_ai_requests_total',
  help: 'Total AI orchestration requests.',
  labelNames: ['mode', 'status']
});

const aiDuration = new client.Histogram({
  name: 'bit_booking_ai_request_duration_seconds',
  help: 'AI request duration in seconds.',
  labelNames: ['mode', 'status'],
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 40, 80]
});

const agentMemoryOperations = new client.Counter({
  name: 'bit_booking_agent_memory_operations_total',
  help: 'Persistent agent memory operations.',
  labelNames: ['operation', 'status']
});

const agentToolCalls = new client.Counter({
  name: 'bit_booking_agent_tool_calls_total',
  help: 'Agent tool invocations across the orchestration layer.',
  labelNames: ['tool', 'status']
});

const agentReviewTransitions = new client.Counter({
  name: 'bit_booking_agent_review_transitions_total',
  help: 'Human review queue transitions for agentic actions.',
  labelNames: ['status']
});

const agentGraphNodes = new client.Counter({
  name: 'bit_booking_agent_graph_node_executions_total',
  help: 'Agent graph node executions.',
  labelNames: ['runtime', 'node', 'status']
});

const llmProviderCalls = new client.Counter({
  name: 'bit_booking_llm_provider_calls_total',
  help: 'LLM provider calls.',
  labelNames: ['provider', 'status']
});

const activeAiRequests = new client.Gauge({
  name: 'bit_booking_ai_active_requests',
  help: 'Currently active AI requests.'
});

const pendingAgentReviews = new client.Gauge({
  name: 'bit_booking_agent_review_pending_total',
  help: 'Current number of pending human review tasks.'
});

register.registerMetric(httpRequests);
register.registerMetric(httpDuration);
register.registerMetric(aiRequests);
register.registerMetric(aiDuration);
register.registerMetric(agentMemoryOperations);
register.registerMetric(agentToolCalls);
register.registerMetric(agentReviewTransitions);
register.registerMetric(agentGraphNodes);
register.registerMetric(llmProviderCalls);
register.registerMetric(activeAiRequests);
register.registerMetric(pendingAgentReviews);

const sanitizeLabel = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_:/.-]/g, '_')
    .slice(0, 120) || 'unknown';

const splitRouteLabel = (routeLabel = '') => {
  const raw = String(routeLabel || '').trim();
  const match = raw.match(/^([A-Z]+)\s+(.+)$/);
  if (!match) return { method: 'UNKNOWN', route: sanitizeLabel(raw || 'unknown') };
  return {
    method: sanitizeLabel(match[1]).toUpperCase(),
    route: sanitizeLabel(match[2])
  };
};

const increment = (bucket, key, by = 1) => {
  const k = sanitizeLabel(key);
  bucket[k] = Number(bucket[k] || 0) + by;
};

const observeDurationBucket = (bucketList, durationMs) => {
  const safeDurationMs = Math.max(Number(durationMs) || 0, 0);
  const matched = bucketList.find((bucket) => bucket.maxMs == null || safeDurationMs <= bucket.maxMs);
  if (matched) matched.count += 1;
};

const average = (total, count) => {
  const safeCount = Number(count || 0);
  if (!safeCount) return 0;
  return Math.max(Number(total) || 0, 0) / safeCount;
};

const buildHistorySample = () => ({
  at: new Date().toISOString(),
  httpRequestsTotal: metricsState.http.requestsTotal,
  aiRequestsTotal: metricsState.ai.requestsTotal,
  aiErrorsTotal: metricsState.ai.errorsTotal,
  aiActiveRequests: metricsState.ai.activeRequests,
  llmCallsTotal: metricsState.llm.callsTotal,
  llmErrorsTotal: metricsState.llm.errorsTotal,
  memoryOperationsTotal: metricsState.memory.operationsTotal,
  toolCallsTotal: metricsState.tools.callsTotal,
  reviewPendingTotal: metricsState.reviews.pendingTotal,
  graphNodeExecutionsTotal: metricsState.graph.nodeExecutionsTotal,
  avgHttpDurationMs: average(metricsState.http.totalDurationMs, metricsState.http.requestsTotal),
  avgAiDurationMs: average(metricsState.ai.totalDurationMs, metricsState.ai.requestsTotal),
  currentProvider: metricsState.llm.lastSuccessfulProvider || '',
  currentModel: metricsState.llm.lastSuccessfulModel || ''
});

const captureHistorySample = ({ force = false } = {}) => {
  const now = Date.now();
  if (!force && metricsState.history.lastCapturedAt && now - metricsState.history.lastCapturedAt < HISTORY_SAMPLE_INTERVAL_MS) {
    return;
  }

  metricsState.history.lastCapturedAt = now;
  metricsState.history.samples.push(buildHistorySample());
  if (metricsState.history.samples.length > HISTORY_LIMIT) {
    metricsState.history.samples.splice(0, metricsState.history.samples.length - HISTORY_LIMIT);
  }
};

captureHistorySample({ force: true });

const historyTimer = setInterval(() => {
  captureHistorySample();
}, HISTORY_SAMPLE_INTERVAL_MS);

if (typeof historyTimer.unref === 'function') {
  historyTimer.unref();
}

const observeHttpRequest = ({ route, statusCode, durationMs }) => {
  const status = sanitizeLabel(String(statusCode || 0));
  const labels = splitRouteLabel(route);
  const safeDurationMs = Math.max(Number(durationMs) || 0, 0);
  const durationSeconds = safeDurationMs / 1000;

  metricsState.http.requestsTotal += 1;
  metricsState.http.totalDurationMs += safeDurationMs;
  increment(metricsState.http.byRoute, route || 'unknown');
  increment(metricsState.http.byStatus, status);
  observeDurationBucket(metricsState.http.latencyDistribution, safeDurationMs);

  httpRequests.inc({ ...labels, status });
  httpDuration.observe({ ...labels, status }, durationSeconds);
};

const beginHttpTimer = (req) => {
  const started = Date.now();
  const routeLabel = `${String(req.method || 'GET').toUpperCase()} ${req.baseUrl || ''}${req.path || req.url || ''}`.trim();
  return (statusCode) => {
    observeHttpRequest({
      route: routeLabel,
      statusCode,
      durationMs: Date.now() - started
    });
  };
};

const observeAiRequest = ({ mode = 'unknown', durationMs = 0, error = false } = {}) => {
  const status = error ? 'error' : 'ok';
  const safeMode = sanitizeLabel(mode || 'unknown');
  const safeDurationMs = Math.max(Number(durationMs) || 0, 0);

  metricsState.ai.requestsTotal += 1;
  metricsState.ai.totalDurationMs += safeDurationMs;
  increment(metricsState.ai.byMode, safeMode);
  observeDurationBucket(metricsState.ai.latencyDistribution, safeDurationMs);
  if (error) {
    metricsState.ai.errorsTotal += 1;
    metricsState.ai.lastErrorAt = new Date().toISOString();
  }

  aiRequests.inc({ mode: safeMode, status });
  aiDuration.observe({ mode: safeMode, status }, safeDurationMs / 1000);
};

const beginAiTimer = (mode = 'unknown') => {
  const started = Date.now();
  let completed = false;
  metricsState.ai.activeRequests += 1;
  activeAiRequests.inc();
  return ({ error = false } = {}) => {
    if (completed) return;
    completed = true;
    metricsState.ai.activeRequests = Math.max(0, metricsState.ai.activeRequests - 1);
    activeAiRequests.dec();
    observeAiRequest({
      mode,
      durationMs: Date.now() - started,
      error
    });
  };
};

const observeAgentMemoryOperation = ({ operation = 'unknown', error = false } = {}) => {
  const op = sanitizeLabel(operation);
  const status = error ? 'error' : 'ok';
  metricsState.memory.operationsTotal += 1;
  increment(metricsState.memory.byOperation, op);
  if (error) metricsState.memory.errorsTotal += 1;
  agentMemoryOperations.inc({ operation: op, status });
};

const observeAgentToolCall = ({ tool = 'unknown', error = false } = {}) => {
  const safeTool = sanitizeLabel(tool);
  const status = error ? 'error' : 'ok';
  metricsState.tools.callsTotal += 1;
  increment(metricsState.tools.byTool, safeTool);
  if (error) metricsState.tools.errorsTotal += 1;
  agentToolCalls.inc({ tool: safeTool, status });
};

const observeAgentReviewTransition = ({ status = 'pending', pendingDelta = 0 } = {}) => {
  const safeStatus = sanitizeLabel(status);
  agentReviewTransitions.inc({ status: safeStatus });

  if (safeStatus === 'pending') metricsState.reviews.createdTotal += 1;
  if (safeStatus === 'approved') metricsState.reviews.approvedTotal += 1;
  if (safeStatus === 'rejected') metricsState.reviews.rejectedTotal += 1;
  if (safeStatus === 'executed') metricsState.reviews.executedTotal += 1;
  if (safeStatus === 'failed') metricsState.reviews.failedTotal += 1;

  metricsState.reviews.pendingTotal = Math.max(
    0,
    Number(metricsState.reviews.pendingTotal || 0) + Number(pendingDelta || 0)
  );
  pendingAgentReviews.set(metricsState.reviews.pendingTotal);
};

const observeAgentGraphNode = ({ runtime = 'unknown', node = 'unknown', error = false } = {}) => {
  const safeRuntime = sanitizeLabel(runtime);
  const safeNode = sanitizeLabel(node);
  const status = error ? 'error' : 'ok';
  metricsState.graph.nodeExecutionsTotal += 1;
  increment(metricsState.graph.byNode, `${safeRuntime}:${safeNode}`);
  if (error) metricsState.graph.nodeErrorsTotal += 1;
  agentGraphNodes.inc({ runtime: safeRuntime, node: safeNode, status });
};

const observeLlmProviderCall = ({ provider = 'unknown', model = '', error = false } = {}) => {
  const safeProvider = sanitizeLabel(provider);
  const safeModel = sanitizeLabel(model || 'default');
  const status = error ? 'error' : 'ok';

  metricsState.llm.callsTotal += 1;
  increment(metricsState.llm.byProvider, safeProvider);
  increment(metricsState.llm.byModel, `${safeProvider}:${safeModel}`);

  const currentStatus = metricsState.llm.byProviderStatus[safeProvider] || { ok: 0, error: 0 };
  currentStatus[status] = Number(currentStatus[status] || 0) + 1;
  metricsState.llm.byProviderStatus[safeProvider] = currentStatus;

  if (error) {
    metricsState.llm.errorsTotal += 1;
    metricsState.llm.lastFailureAt = new Date().toISOString();
  } else {
    metricsState.llm.lastSuccessfulProvider = safeProvider;
    metricsState.llm.lastSuccessfulModel = safeModel;
    metricsState.llm.lastSuccessfulAt = new Date().toISOString();
  }

  llmProviderCalls.inc({ provider: safeProvider, status });
};

const toPrometheus = async () => register.metrics();

const getPrometheusContentType = () => register.contentType;

const toJsonSnapshot = () => {
  captureHistorySample();

  return {
    uptimeSeconds: Math.floor((Date.now() - metricsState.processStartAt) / 1000),
    history: {
      sampleIntervalMs: metricsState.history.sampleIntervalMs,
      samples: metricsState.history.samples.map((sample) => ({ ...sample }))
    },
    http: {
      requestsTotal: metricsState.http.requestsTotal,
      totalDurationMs: metricsState.http.totalDurationMs,
      avgDurationMs: average(metricsState.http.totalDurationMs, metricsState.http.requestsTotal),
      byRoute: { ...metricsState.http.byRoute },
      byStatus: { ...metricsState.http.byStatus },
      latencyDistribution: cloneDurationBuckets(metricsState.http.latencyDistribution)
    },
    ai: {
      requestsTotal: metricsState.ai.requestsTotal,
      activeRequests: metricsState.ai.activeRequests,
      errorsTotal: metricsState.ai.errorsTotal,
      totalDurationMs: metricsState.ai.totalDurationMs,
      avgDurationMs: average(metricsState.ai.totalDurationMs, metricsState.ai.requestsTotal),
      byMode: { ...metricsState.ai.byMode },
      lastErrorAt: metricsState.ai.lastErrorAt,
      latencyDistribution: cloneDurationBuckets(metricsState.ai.latencyDistribution)
    },
    memory: {
      operationsTotal: metricsState.memory.operationsTotal,
      errorsTotal: metricsState.memory.errorsTotal,
      byOperation: { ...metricsState.memory.byOperation }
    },
    tools: {
      callsTotal: metricsState.tools.callsTotal,
      errorsTotal: metricsState.tools.errorsTotal,
      byTool: { ...metricsState.tools.byTool }
    },
    reviews: {
      createdTotal: metricsState.reviews.createdTotal,
      pendingTotal: metricsState.reviews.pendingTotal,
      approvedTotal: metricsState.reviews.approvedTotal,
      rejectedTotal: metricsState.reviews.rejectedTotal,
      executedTotal: metricsState.reviews.executedTotal,
      failedTotal: metricsState.reviews.failedTotal
    },
    graph: {
      nodeExecutionsTotal: metricsState.graph.nodeExecutionsTotal,
      nodeErrorsTotal: metricsState.graph.nodeErrorsTotal,
      byNode: { ...metricsState.graph.byNode }
    },
    llm: {
      callsTotal: metricsState.llm.callsTotal,
      errorsTotal: metricsState.llm.errorsTotal,
      byProvider: { ...metricsState.llm.byProvider },
      byModel: { ...metricsState.llm.byModel },
      byProviderStatus: Object.fromEntries(
        Object.entries(metricsState.llm.byProviderStatus).map(([provider, statusCounts]) => [
          provider,
          {
            ok: Number(statusCounts?.ok || 0),
            error: Number(statusCounts?.error || 0)
          }
        ])
      ),
      lastSuccessfulProvider: metricsState.llm.lastSuccessfulProvider,
      lastSuccessfulModel: metricsState.llm.lastSuccessfulModel,
      lastSuccessfulAt: metricsState.llm.lastSuccessfulAt,
      lastFailureAt: metricsState.llm.lastFailureAt
    }
  };
};

module.exports = {
  beginHttpTimer,
  beginAiTimer,
  observeAgentMemoryOperation,
  observeAgentToolCall,
  observeAgentReviewTransition,
  observeAgentGraphNode,
  observeLlmProviderCall,
  toPrometheus,
  getPrometheusContentType,
  toJsonSnapshot
};
