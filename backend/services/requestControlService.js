const { logger } = require('./loggerService');

const toPositiveInt = (value, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const normalized = Math.floor(parsed);
  if (normalized < min) return fallback;
  return Math.min(normalized, max);
};

const RATE_LIMIT_DEFAULT_WINDOW_MS = toPositiveInt(process.env.RATE_LIMIT_DEFAULT_WINDOW_MS, 60 * 1000);
const RATE_LIMIT_DEFAULT_MAX = toPositiveInt(process.env.RATE_LIMIT_DEFAULT_MAX, 240);
const RATE_LIMIT_AUTH_WINDOW_MS = toPositiveInt(process.env.RATE_LIMIT_AUTH_WINDOW_MS, 15 * 60 * 1000);
const RATE_LIMIT_AUTH_MAX = toPositiveInt(process.env.RATE_LIMIT_AUTH_MAX, 40);
const RATE_LIMIT_BOOKING_WINDOW_MS = toPositiveInt(process.env.RATE_LIMIT_BOOKING_WINDOW_MS, 60 * 1000);
const RATE_LIMIT_BOOKING_MAX = toPositiveInt(process.env.RATE_LIMIT_BOOKING_MAX, 80);
const RATE_LIMIT_AI_WINDOW_MS = toPositiveInt(process.env.RATE_LIMIT_AI_WINDOW_MS, 60 * 1000);
const RATE_LIMIT_AI_MAX = toPositiveInt(process.env.RATE_LIMIT_AI_MAX, 80);
const RATE_LIMIT_WRITE_WINDOW_MS = toPositiveInt(process.env.RATE_LIMIT_WRITE_WINDOW_MS, 60 * 1000);
const RATE_LIMIT_WRITE_MAX = toPositiveInt(process.env.RATE_LIMIT_WRITE_MAX, 140);
const MAX_ACTIVE_REQUESTS = toPositiveInt(process.env.MAX_ACTIVE_REQUESTS, 900);

const AUTH_ROUTE_REGEX =
  /^\/api\/(admin_login|department_login|developer_login|admin\/send_otp|department\/send_otp|developer\/send_otp|admin\/verify_otp|department\/verify_otp|admin\/reset_password|department\/reset_password|developer\/reset_password|account\/[^/]+\/send_email_otp|complaints\/[^/]+\/reopen\/request-otp|complaints\/[^/]+\/reopen\/verify-otp)\b/i;
const BOOKING_ROUTE_REGEX =
  /^\/api\/(booking\/create_booking|booking\/change_booking_request|approval\/approve|approval\/reject|approval\/vacate|approval\/leave)\b/i;
const AI_ROUTE_REGEX = /^\/api\/(ai|voice)\b/i;

const SKIP_LIMIT_PATHS = new Set(['/api/ops/health', '/api/ops/ready']);

const RULES = [
  {
    id: 'auth_sensitive',
    windowMs: RATE_LIMIT_AUTH_WINDOW_MS,
    max: RATE_LIMIT_AUTH_MAX,
    matcher: ({ path }) => AUTH_ROUTE_REGEX.test(path)
  },
  {
    id: 'booking_mutations',
    windowMs: RATE_LIMIT_BOOKING_WINDOW_MS,
    max: RATE_LIMIT_BOOKING_MAX,
    matcher: ({ path }) => BOOKING_ROUTE_REGEX.test(path)
  },
  {
    id: 'ai_heavy',
    windowMs: RATE_LIMIT_AI_WINDOW_MS,
    max: RATE_LIMIT_AI_MAX,
    matcher: ({ path }) => AI_ROUTE_REGEX.test(path)
  },
  {
    id: 'generic_write',
    windowMs: RATE_LIMIT_WRITE_WINDOW_MS,
    max: RATE_LIMIT_WRITE_MAX,
    matcher: ({ method }) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)
  },
  {
    id: 'default',
    windowMs: RATE_LIMIT_DEFAULT_WINDOW_MS,
    max: RATE_LIMIT_DEFAULT_MAX,
    matcher: () => true
  }
];

const rateWindowStore = new Map();
const state = {
  activeRequests: 0,
  rejectedRateLimited: 0,
  rejectedOverloaded: 0,
  lastRejectedAt: null,
  lastRejectReason: '',
  byRule: {}
};

const sanitizePath = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '/';
  return raw.split('?')[0] || '/';
};

const normalizeRuleStats = (ruleId) => {
  if (!state.byRule[ruleId]) {
    state.byRule[ruleId] = {
      requests: 0,
      rateLimited: 0
    };
  }
  return state.byRule[ruleId];
};

const resolveIdentity = (req) => {
  const role = String(req?.user?.type || '').trim().toUpperCase();
  const userId = String(req?.user?.id || req?.user?._id || '').trim();
  if (userId) return `${role || 'USER'}:${userId}`;

  const forwardedFor = String(req.headers['x-forwarded-for'] || '')
    .split(',')[0]
    .trim();
  const fallbackIp = String(req.ip || req.socket?.remoteAddress || req.connection?.remoteAddress || '').trim();
  const ip = forwardedFor || fallbackIp || 'unknown';
  return `IP:${ip}`;
};

const resolveRule = ({ path, method }) =>
  RULES.find((rule) => rule.matcher({ path, method })) || RULES[RULES.length - 1];

const cleanupExpiredWindows = () => {
  const now = Date.now();
  for (const [key, bucket] of rateWindowStore.entries()) {
    if (!bucket || now >= Number(bucket.resetAt || 0)) {
      rateWindowStore.delete(key);
    }
  }
};

const cleanupTimer = setInterval(cleanupExpiredWindows, 60 * 1000);
if (typeof cleanupTimer.unref === 'function') cleanupTimer.unref();

const getRequestControlSnapshot = () => ({
  activeRequests: state.activeRequests,
  maxActiveRequests: MAX_ACTIVE_REQUESTS,
  rejectedRateLimited: state.rejectedRateLimited,
  rejectedOverloaded: state.rejectedOverloaded,
  lastRejectedAt: state.lastRejectedAt,
  lastRejectReason: state.lastRejectReason,
  byRule: Object.fromEntries(
    Object.entries(state.byRule).map(([ruleId, stats]) => [
      ruleId,
      {
        requests: Number(stats.requests || 0),
        rateLimited: Number(stats.rateLimited || 0)
      }
    ])
  )
});

const requestControlMiddleware = (req, res, next) => {
  const method = String(req.method || 'GET').toUpperCase();
  const path = sanitizePath(req.originalUrl || req.url || req.path);

  if (method === 'OPTIONS' || SKIP_LIMIT_PATHS.has(path)) {
    return next();
  }

  if (MAX_ACTIVE_REQUESTS > 0 && state.activeRequests >= MAX_ACTIVE_REQUESTS) {
    state.rejectedOverloaded += 1;
    state.lastRejectedAt = new Date().toISOString();
    state.lastRejectReason = 'overloaded';
    res.setHeader('Retry-After', '2');
    return res.status(503).json({
      error: 'Server is temporarily busy. Please retry shortly.',
      code: 'SERVER_BUSY'
    });
  }

  state.activeRequests += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    state.activeRequests = Math.max(0, state.activeRequests - 1);
  };
  res.once('finish', release);
  res.once('close', release);

  const rule = resolveRule({ path, method });
  const ruleStats = normalizeRuleStats(rule.id);
  ruleStats.requests += 1;

  const now = Date.now();
  const identity = resolveIdentity(req);
  const bucketKey = `${rule.id}::${identity}`;
  const existing = rateWindowStore.get(bucketKey);
  const bucket =
    existing && now < existing.resetAt
      ? existing
      : {
          count: 0,
          resetAt: now + rule.windowMs
        };

  if (bucket.count >= rule.max) {
    ruleStats.rateLimited += 1;
    state.rejectedRateLimited += 1;
    state.lastRejectedAt = new Date().toISOString();
    state.lastRejectReason = `rate_limited:${rule.id}`;

    const retryAfterMs = Math.max(0, bucket.resetAt - now);
    const retryAfterSeconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
    res.setHeader('Retry-After', String(retryAfterSeconds));
    res.setHeader('X-RateLimit-Limit', String(rule.max));
    res.setHeader('X-RateLimit-Remaining', '0');
    res.setHeader('X-RateLimit-Reset', String(Math.floor(bucket.resetAt / 1000)));
    release();
    return res.status(429).json({
      error: 'Too many requests. Please retry after a short delay.',
      code: 'RATE_LIMITED',
      rule: rule.id,
      retryAfterMs
    });
  }

  bucket.count += 1;
  rateWindowStore.set(bucketKey, bucket);
  const remaining = Math.max(0, rule.max - bucket.count);
  res.setHeader('X-RateLimit-Limit', String(rule.max));
  res.setHeader('X-RateLimit-Remaining', String(remaining));
  res.setHeader('X-RateLimit-Reset', String(Math.floor(bucket.resetAt / 1000)));

  return next();
};

logger.info('Request control initialized', {
  maxActiveRequests: MAX_ACTIVE_REQUESTS,
  defaultLimit: RATE_LIMIT_DEFAULT_MAX,
  defaultWindowMs: RATE_LIMIT_DEFAULT_WINDOW_MS
});

module.exports = {
  requestControlMiddleware,
  getRequestControlSnapshot
};
