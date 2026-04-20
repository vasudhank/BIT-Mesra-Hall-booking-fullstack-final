let sentry = null;
let datadogTracer = null;
let sentryInitialized = false;
let datadogInitialized = false;

const boolFromEnv = (value, defaultValue = false) => {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(raw);
};

const initializeDatadog = () => {
  if (datadogInitialized) return datadogTracer;

  const enabled = boolFromEnv(process.env.DATADOG_ENABLED)
    || boolFromEnv(process.env.DD_TRACE_ENABLED)
    || Boolean(process.env.DD_AGENT_HOST);

  if (!enabled || String(process.env.DD_TRACE_ENABLED || '').toLowerCase() === 'false') {
    datadogInitialized = true;
    return null;
  }

  try {
    // Datadog is most useful when initialized before Express/Mongoose are loaded.
    datadogTracer = require('dd-trace').init({
      service: process.env.DD_SERVICE || 'bit-booking-backend',
      env: process.env.DD_ENV || process.env.NODE_ENV || 'development',
      version: process.env.APP_VERSION || process.env.npm_package_version || 'local',
      logInjection: boolFromEnv(process.env.DD_LOGS_INJECTION, true),
      runtimeMetrics: boolFromEnv(process.env.DD_RUNTIME_METRICS_ENABLED, true),
      profiling: boolFromEnv(process.env.DD_PROFILING_ENABLED)
    });
  } catch (err) {
    datadogTracer = null;
  }

  datadogInitialized = true;
  return datadogTracer;
};

const initializeSentry = () => {
  if (sentryInitialized) return sentry;

  const dsn = String(process.env.SENTRY_DSN || '').trim();
  if (!dsn) {
    sentryInitialized = true;
    return null;
  }

  try {
    sentry = require('@sentry/node');
    sentry.init({
      dsn,
      environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
      release: process.env.SENTRY_RELEASE || process.env.APP_VERSION || undefined,
      tracesSampleRate: Math.max(Math.min(Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0.1), 1), 0),
      profilesSampleRate: Math.max(Math.min(Number(process.env.SENTRY_PROFILES_SAMPLE_RATE || 0), 1), 0),
      sendDefaultPii: boolFromEnv(process.env.SENTRY_SEND_DEFAULT_PII)
    });
  } catch (err) {
    sentry = null;
  }

  sentryInitialized = true;
  return sentry;
};

const attachSentryErrorHandler = (app) => {
  if (!app) return false;
  const sdk = initializeSentry();
  if (!sdk) return false;

  try {
    if (typeof sdk.setupExpressErrorHandler === 'function') {
      sdk.setupExpressErrorHandler(app);
      return true;
    }
    if (typeof sdk.expressErrorHandler === 'function') {
      app.use(sdk.expressErrorHandler());
      return true;
    }
  } catch (err) {
    return false;
  }

  return false;
};

const captureException = (err, context = {}) => {
  const sdk = initializeSentry();
  if (!sdk || !err) return;

  try {
    sdk.captureException(err, {
      extra: context && typeof context === 'object' ? context : {}
    });
  } catch (captureErr) {
    // Avoid observability failures impacting request handling.
  }
};

const addBreadcrumb = (breadcrumb = {}) => {
  const sdk = initializeSentry();
  if (!sdk || typeof sdk.addBreadcrumb !== 'function') return;

  try {
    sdk.addBreadcrumb({
      level: 'info',
      category: 'app',
      ...breadcrumb
    });
  } catch (err) {
    // Ignore telemetry write failures.
  }
};

const withDatadogSpan = async (name, tags, fn) => {
  const tracer = initializeDatadog();
  const safeTags = tags && typeof tags === 'object' ? tags : {};

  if (!tracer || typeof tracer.trace !== 'function') {
    return fn();
  }

  return tracer.trace(name, { tags: safeTags }, async (span) => {
    try {
      const result = await fn(span);
      if (span && typeof span.setTag === 'function') span.setTag('status', 'ok');
      return result;
    } catch (err) {
      if (span && typeof span.setTag === 'function') {
        span.setTag('error', err);
        span.setTag('status', 'error');
      }
      throw err;
    }
  });
};

module.exports = {
  initializeDatadog,
  initializeSentry,
  attachSentryErrorHandler,
  captureException,
  addBreadcrumb,
  withDatadogSpan
};
