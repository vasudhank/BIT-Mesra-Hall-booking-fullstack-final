const metricsState = {
  processStartAt: Date.now(),
  http: {
    requestsTotal: 0,
    byRoute: {},
    byStatus: {},
    totalDurationMs: 0
  },
  ai: {
    requestsTotal: 0,
    errorsTotal: 0,
    totalDurationMs: 0,
    byMode: {},
    lastErrorAt: null
  }
};

const sanitizeLabel = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_:/.-]/g, '_')
    .slice(0, 120);

const increment = (bucket, key, by = 1) => {
  const k = sanitizeLabel(key);
  bucket[k] = Number(bucket[k] || 0) + by;
};

const observeHttpRequest = ({ route, statusCode, durationMs }) => {
  metricsState.http.requestsTotal += 1;
  metricsState.http.totalDurationMs += Math.max(Number(durationMs) || 0, 0);
  increment(metricsState.http.byRoute, route || 'unknown');
  increment(metricsState.http.byStatus, String(statusCode || 0));
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
  metricsState.ai.requestsTotal += 1;
  metricsState.ai.totalDurationMs += Math.max(Number(durationMs) || 0, 0);
  increment(metricsState.ai.byMode, mode || 'unknown');
  if (error) {
    metricsState.ai.errorsTotal += 1;
    metricsState.ai.lastErrorAt = new Date().toISOString();
  }
};

const beginAiTimer = (mode = 'unknown') => {
  const started = Date.now();
  return ({ error = false } = {}) => {
    observeAiRequest({
      mode,
      durationMs: Date.now() - started,
      error
    });
  };
};

const toPrometheus = () => {
  const lines = [];
  lines.push('# HELP app_uptime_seconds Process uptime in seconds.');
  lines.push('# TYPE app_uptime_seconds gauge');
  lines.push(`app_uptime_seconds ${(Date.now() - metricsState.processStartAt) / 1000}`);

  lines.push('# HELP app_http_requests_total Total number of HTTP requests.');
  lines.push('# TYPE app_http_requests_total counter');
  lines.push(`app_http_requests_total ${metricsState.http.requestsTotal}`);

  lines.push('# HELP app_http_request_duration_ms_total Total HTTP duration in milliseconds.');
  lines.push('# TYPE app_http_request_duration_ms_total counter');
  lines.push(`app_http_request_duration_ms_total ${metricsState.http.totalDurationMs}`);

  lines.push('# HELP app_http_requests_by_status HTTP requests by status code.');
  lines.push('# TYPE app_http_requests_by_status counter');
  Object.keys(metricsState.http.byStatus).forEach((status) => {
    lines.push(`app_http_requests_by_status{status="${status}"} ${metricsState.http.byStatus[status]}`);
  });

  lines.push('# HELP app_http_requests_by_route HTTP requests by route label.');
  lines.push('# TYPE app_http_requests_by_route counter');
  Object.keys(metricsState.http.byRoute).forEach((route) => {
    lines.push(`app_http_requests_by_route{route="${route}"} ${metricsState.http.byRoute[route]}`);
  });

  lines.push('# HELP app_ai_requests_total Total number of AI orchestration requests.');
  lines.push('# TYPE app_ai_requests_total counter');
  lines.push(`app_ai_requests_total ${metricsState.ai.requestsTotal}`);

  lines.push('# HELP app_ai_errors_total Total number of AI orchestration errors.');
  lines.push('# TYPE app_ai_errors_total counter');
  lines.push(`app_ai_errors_total ${metricsState.ai.errorsTotal}`);

  lines.push('# HELP app_ai_duration_ms_total Total AI request duration in milliseconds.');
  lines.push('# TYPE app_ai_duration_ms_total counter');
  lines.push(`app_ai_duration_ms_total ${metricsState.ai.totalDurationMs}`);

  lines.push('# HELP app_ai_requests_by_mode AI requests by orchestration mode.');
  lines.push('# TYPE app_ai_requests_by_mode counter');
  Object.keys(metricsState.ai.byMode).forEach((mode) => {
    lines.push(`app_ai_requests_by_mode{mode="${mode}"} ${metricsState.ai.byMode[mode]}`);
  });

  return lines.join('\n');
};

const toJsonSnapshot = () => ({
  uptimeSeconds: Math.floor((Date.now() - metricsState.processStartAt) / 1000),
  http: {
    requestsTotal: metricsState.http.requestsTotal,
    totalDurationMs: metricsState.http.totalDurationMs,
    byRoute: { ...metricsState.http.byRoute },
    byStatus: { ...metricsState.http.byStatus }
  },
  ai: {
    requestsTotal: metricsState.ai.requestsTotal,
    errorsTotal: metricsState.ai.errorsTotal,
    totalDurationMs: metricsState.ai.totalDurationMs,
    byMode: { ...metricsState.ai.byMode },
    lastErrorAt: metricsState.ai.lastErrorAt
  }
});

module.exports = {
  beginHttpTimer,
  beginAiTimer,
  toPrometheus,
  toJsonSnapshot
};
