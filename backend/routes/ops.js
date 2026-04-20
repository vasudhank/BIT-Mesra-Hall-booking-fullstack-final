const express = require('express');
const fetch = require('node-fetch');
const mongoose = require('mongoose');
const { toPrometheus, toJsonSnapshot, getPrometheusContentType } = require('../services/metricsService');
const { captureException, withDatadogSpan } = require('../services/observabilityService');
const { resolveSupportRuntime } = require('../services/supportWorkflowService');
const { getLlmRuntimeProfile } = require('../services/llmGatewayService');
const { getReviewQueueSnapshot } = require('../services/agentReviewService');

const router = express.Router();

const getRole = (req) => String(req?.user?.type || '').toUpperCase();
const isTrusted = (req) => req.isAuthenticated && req.isAuthenticated() && ['ADMIN', 'DEVELOPER'].includes(getRole(req));

const requireTrusted = (req, res, next) => {
  if (!isTrusted(req)) {
    return res.status(403).json({ error: 'Only admin/developer can access monitoring.' });
  }
  return next();
};

const trimSlash = (value = '') => String(value || '').trim().replace(/\/+$/, '');
const envEnabled = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());

const isDatadogConfigured = () => {
  const enabled =
    envEnabled(process.env.DATADOG_ENABLED) ||
    envEnabled(process.env.DD_TRACE_ENABLED) ||
    Boolean(process.env.DD_AGENT_HOST);
  return enabled && String(process.env.DD_TRACE_ENABLED || '').trim().toLowerCase() !== 'false';
};

const isLocalHost = (hostname = '') => {
  const lower = String(hostname || '').toLowerCase();
  if (['localhost', '127.0.0.1', '0.0.0.0', '::1'].includes(lower)) return true;
  if (/^10\./.test(lower)) return true;
  if (/^192\.168\./.test(lower)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(lower)) return true;
  return false;
};

const resolveRequestBase = (req) => {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
  const protocol = forwardedProto || req.protocol || 'http';
  const host = String(req.get('host') || 'localhost:8000').trim();

  try {
    return new URL(`${protocol}://${host}`);
  } catch (err) {
    return null;
  }
};

const resolveLocalDashboardUrl = (req, envUrl, port, path = '') => {
  const explicit = trimSlash(envUrl);
  if (explicit) return `${explicit}${path}`;

  const requestBase = resolveRequestBase(req);
  if (!requestBase || !isLocalHost(requestBase.hostname)) return '';

  return `${requestBase.protocol}//${requestBase.hostname}:${port}${path}`;
};

const fetchWithTimeout = async (url, options = {}, timeoutMs = 1600) => {
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : null;

  try {
    return await fetch(url, controller ? { ...options, signal: controller.signal } : options);
  } finally {
    if (timer) clearTimeout(timer);
  }
};

const probeUrl = async (url, path = '', okStatusCodes = [200]) => {
  const target = trimSlash(url);
  if (!target) {
    return {
      available: false,
      state: 'setup_required',
      detail: 'No public URL is configured for this tool yet.'
    };
  }

  try {
    const response = await fetchWithTimeout(`${target}${path}`, {}, 1600);
    if (okStatusCodes.includes(response.status)) {
      return {
        available: true,
        state: 'live',
        detail: 'Connected and responding.'
      };
    }

    return {
      available: false,
      state: 'offline',
      detail: `Reached the service, but it responded with status ${response.status}.`
    };
  } catch (err) {
    return {
      available: false,
      state: 'offline',
      detail: 'The URL was resolved, but the service did not respond.'
    };
  }
};

const buildAlertPolicies = (snapshot, dbReady) => {
  const aiRequests = Number(snapshot?.ai?.requestsTotal || 0);
  const aiErrors = Number(snapshot?.ai?.errorsTotal || 0);
  const llmCalls = Number(snapshot?.llm?.callsTotal || 0);
  const llmErrors = Number(snapshot?.llm?.errorsTotal || 0);
  const graphErrors = Number(snapshot?.graph?.nodeErrorsTotal || 0);
  const memoryErrors = Number(snapshot?.memory?.errorsTotal || 0);
  const toolCalls = Number(snapshot?.tools?.callsTotal || 0);
  const toolErrors = Number(snapshot?.tools?.errorsTotal || 0);
  const pendingReviews = Number(snapshot?.reviews?.pendingTotal || 0);

  return [
    {
      id: 'db-readiness',
      name: 'Database readiness',
      severity: dbReady ? 'healthy' : 'critical',
      condition: 'The booking database should be available before the assistant handles live traffic.',
      status: dbReady ? 'OK' : 'FIRING',
      recommendation: dbReady ? 'No action needed.' : 'Check MongoDB connectivity and confirm the configured database is reachable.'
    },
    {
      id: 'ai-error-budget',
      name: 'Assistant reliability',
      severity: aiRequests > 0 && aiErrors / aiRequests > 0.05 ? 'warning' : 'healthy',
      condition: 'Assistant error rate should stay below 5% during normal use.',
      status: aiRequests > 0 && aiErrors / aiRequests > 0.05 ? 'WATCH' : 'OK',
      recommendation: 'Inspect provider availability, prompt parsing, and action execution failures.'
    },
    {
      id: 'llm-provider-errors',
      name: 'AI provider stability',
      severity: llmErrors > 0 ? 'warning' : 'healthy',
      condition: 'The active AI provider should answer consistently without repeated failures.',
      status: llmErrors > 0 ? 'WATCH' : 'OK',
      recommendation: llmCalls === 0 ? 'No provider calls recorded yet.' : 'Check provider keys, Ollama reachability, model health, and fallback order.'
    },
    {
      id: 'agent-graph-node-errors',
      name: 'Workflow reliability',
      severity: graphErrors > 0 ? 'warning' : 'healthy',
      condition: 'Planner, retrieval, response, and review stages should complete cleanly.',
      status: graphErrors > 0 ? 'WATCH' : 'OK',
      recommendation: 'Review workflow traces and fallback transitions for the failing stage.'
    },
    {
      id: 'persistent-memory-errors',
      name: 'Memory reliability',
      severity: memoryErrors > 0 ? 'warning' : 'healthy',
      condition: 'Conversation memory should save and load without errors.',
      status: memoryErrors > 0 ? 'WATCH' : 'OK',
      recommendation: 'Check Mongo indexes, vector settings, and memory extraction logs.'
    },
    {
      id: 'agent-tooling-health',
      name: 'Agent tool reliability',
      severity: toolCalls > 0 && toolErrors / toolCalls > 0.1 ? 'warning' : 'healthy',
      condition: 'Tool invocations should succeed consistently once the planner begins using the tool registry.',
      status: toolCalls > 0 && toolErrors / toolCalls > 0.1 ? 'WATCH' : 'OK',
      recommendation: toolCalls === 0 ? 'No tool traffic recorded yet.' : 'Inspect the failing tool names, provider context, and prepared action payloads.'
    },
    {
      id: 'human-review-backlog',
      name: 'Human review queue',
      severity: pendingReviews > 10 ? 'warning' : 'healthy',
      condition: 'Pending review tasks should be cleared before they become an execution bottleneck.',
      status: pendingReviews > 10 ? 'WATCH' : 'OK',
      recommendation: pendingReviews > 0 ? 'Review, approve, or reject queued agent actions to keep the system flowing.' : 'No pending review tasks.'
    }
  ];
};

const buildProviderOverview = (snapshot) => {
  const runtimeProfile = getLlmRuntimeProfile();
  const providerStatusMap = snapshot?.llm?.byProviderStatus || {};
  const providerTotals = snapshot?.llm?.byProvider || {};
  const currentProviderId = String(snapshot?.llm?.lastSuccessfulProvider || runtimeProfile?.primaryProvider?.id || '').trim();
  const currentProvider = runtimeProfile.providers.find((provider) => provider.id === currentProviderId) || runtimeProfile.primaryProvider || null;

  const providers = runtimeProfile.providers.map((provider, index) => {
    const totals = Number(providerTotals[provider.id] || 0);
    const statusCounts = providerStatusMap[provider.id] || { ok: 0, error: 0 };
    const errors = Number(statusCounts.error || 0);
    const success = Number(statusCounts.ok || 0);

    return {
      ...provider,
      preferredRank: index + 1,
      totalCalls: totals,
      successfulCalls: success,
      failedCalls: errors,
      errorRate: totals > 0 ? errors / totals : 0,
      isCurrent: provider.id === currentProviderId
    };
  });

  return {
    orchestration: resolveSupportRuntime(),
    currentProvider: currentProvider
      ? {
          ...currentProvider,
          lastUsedAt: snapshot?.llm?.lastSuccessfulAt || null,
          lastFailureAt: snapshot?.llm?.lastFailureAt || null,
          totalCalls: Number(providerTotals[currentProvider.id] || 0)
        }
      : null,
    providers
  };
};

const buildObservabilityTools = async (req, sentryConfigured, datadogConfigured) => {
  const prometheusUrl = resolveLocalDashboardUrl(req, process.env.PROMETHEUS_URL, 9090);
  const grafanaUrl = resolveLocalDashboardUrl(req, process.env.GRAFANA_URL, 3001);
  const sentryUrl = trimSlash(process.env.SENTRY_PROJECT_URL || '');
  const datadogUrl = trimSlash(process.env.DATADOG_DASHBOARD_URL || '');

  const [prometheusProbe, grafanaProbe] = await Promise.all([
    probeUrl(prometheusUrl, '/-/ready'),
    probeUrl(grafanaUrl, '/api/health')
  ]);

  return {
    dashboards: {
      prometheus: prometheusUrl,
      grafana: grafanaUrl,
      sentry: sentryUrl,
      datadog: datadogUrl
    },
    tools: [
      {
        id: 'prometheus',
        name: 'Prometheus',
        summary: 'Stores the live metrics used for trends, alerting, and chart history.',
        url: prometheusUrl,
        actionLabel: 'Open Prometheus',
        status: prometheusProbe.state,
        detail: prometheusProbe.available
          ? 'Ready for live metric exploration.'
          : prometheusUrl
            ? `${prometheusProbe.detail} Start the stack with: docker compose --profile monitoring up`
            : 'Set PROMETHEUS_URL for a public deployment or run the local monitoring stack.'
      },
      {
        id: 'grafana',
        name: 'Grafana',
        summary: 'Turns raw metrics into polished dashboards and long-range visual monitoring.',
        url: grafanaUrl,
        actionLabel: 'Open Grafana',
        status: grafanaProbe.state,
        detail: grafanaProbe.available
          ? 'Dashboard server is responding.'
          : grafanaUrl
            ? `${grafanaProbe.detail} Start the stack with: docker compose --profile monitoring up`
            : 'Set GRAFANA_URL for a public deployment or run the local monitoring stack.'
      },
      {
        id: 'sentry',
        name: 'Sentry',
        summary: 'Captures crashes and exception traces so issues can be debugged quickly.',
        url: sentryUrl,
        actionLabel: sentryUrl ? 'Open Sentry' : '',
        status: sentryConfigured ? 'connected' : 'setup_required',
        detail: sentryConfigured
          ? 'Connected. Synthetic issue tests will send a real error event.'
          : 'Add SENTRY_DSN and SENTRY_PROJECT_URL in backend/.env to enable live error tracking.'
      },
      {
        id: 'datadog',
        name: 'Datadog',
        summary: 'Shows trace-level timing for provider calls and request flows.',
        url: datadogUrl,
        actionLabel: datadogUrl ? 'Open Datadog' : '',
        status: datadogConfigured ? 'connected' : 'setup_required',
        detail: datadogConfigured
          ? 'Tracing is enabled. Synthetic trace tests will emit a span.'
          : 'Add DATADOG_ENABLED=true plus a Datadog agent/dashboard configuration to enable trace export.'
      }
    ]
  };
};

router.get('/health', (req, res) => {
  return res.json({
    status: 'ok',
    service: 'bit-booking-backend',
    now: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime())
  });
});

router.get('/ready', (req, res) => {
  const dbReady = Number(mongoose?.connection?.readyState || 0) === 1;
  if (!dbReady) {
    return res.status(503).json({
      status: 'degraded',
      dbReady: false,
      now: new Date().toISOString()
    });
  }
  return res.json({
    status: 'ready',
    dbReady: true,
    now: new Date().toISOString()
  });
});

router.get('/metrics', async (req, res) => {
  const asText = String(req.query?.format || '').toLowerCase() === 'prom' || req.headers.accept === 'text/plain';
  if (asText) {
    res.setHeader('Content-Type', getPrometheusContentType());
    return res.send(await toPrometheus());
  }
  return res.json({
    status: 'ok',
    snapshot: toJsonSnapshot()
  });
});

router.get('/monitoring', requireTrusted, async (req, res) => {
  const dbReady = Number(mongoose?.connection?.readyState || 0) === 1;
  const snapshot = toJsonSnapshot();
  const sentryConfigured = Boolean(String(process.env.SENTRY_DSN || '').trim());
  const datadogConfigured = isDatadogConfigured();
  const providerOverview = buildProviderOverview(snapshot);
  const observability = await buildObservabilityTools(req, sentryConfigured, datadogConfigured);
  const reviewQueue = await getReviewQueueSnapshot({ limit: 8 });

  return res.json({
    status: 'ok',
    generatedAt: new Date().toISOString(),
    service: {
      name: 'bit-booking-backend',
      env: process.env.NODE_ENV || 'development',
      uptimeSeconds: Math.floor(process.uptime()),
      dbReady
    },
    metrics: snapshot,
    aiRuntime: providerOverview,
    reviewQueue,
    alertPolicies: buildAlertPolicies(snapshot, dbReady),
    observability,
    endpoints: {
      health: '/api/ops/health',
      ready: '/api/ops/ready',
      metricsJson: '/api/ops/metrics',
      metricsPrometheus: '/api/ops/metrics?format=prom',
      monitoring: '/api/ops/monitoring'
    },
    dashboards: observability.dashboards,
    providers: {
      sentryConfigured,
      datadogConfigured,
      prometheusMetricsPath: '/api/ops/metrics?format=prom',
      grafanaProvisionedDashboard: 'monitoring/grafana/dashboards/bit-booking-observability.json'
    }
  });
});

router.post('/sentry-test', requireTrusted, (req, res) => {
  if (!String(process.env.SENTRY_DSN || '').trim()) {
    return res.json({
      ok: false,
      skipped: true,
      message: 'Sentry is not connected in this environment yet. Add SENTRY_DSN in backend/.env, restart the backend, and then run this test again.'
    });
  }

  captureException(new Error('Synthetic monitoring issue from BIT Booking developer dashboard'), {
    area: 'ops_synthetic_sentry_test',
    triggeredBy: getRole(req)
  });

  return res.json({
    ok: true,
    message: 'Synthetic Sentry issue queued successfully.'
  });
});

router.post('/datadog-test', requireTrusted, async (req, res) => {
  const configured = isDatadogConfigured();

  await withDatadogSpan(
    'ops.synthetic_trace',
    {
      area: 'developer_monitoring_dashboard',
      triggered_by: getRole(req)
    },
    async () => true
  );

  return res.json({
    ok: configured,
    configured,
    message: configured
      ? 'Synthetic Datadog trace emitted successfully.'
      : 'Datadog tracing is currently turned off for this environment. Add DATADOG_ENABLED=true and connect a Datadog agent/dashboard before testing again.'
  });
});

module.exports = router;
