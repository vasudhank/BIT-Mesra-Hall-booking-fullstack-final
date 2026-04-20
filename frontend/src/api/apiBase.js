const trimTrailingSlash = (value = '') => String(value || '').trim().replace(/\/+$/, '');

const isLocalHostname = (hostname = '') =>
  ['localhost', '127.0.0.1', '0.0.0.0'].includes(String(hostname || '').toLowerCase());

const maybeUpgradeToHttps = (value = '') => {
  const raw = trimTrailingSlash(value);
  if (!raw || typeof window === 'undefined' || window.location?.protocol !== 'https:') {
    return raw;
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol === 'http:' && !isLocalHostname(parsed.hostname)) {
      parsed.protocol = 'https:';
      return trimTrailingSlash(parsed.toString());
    }
  } catch (err) {
    return raw;
  }

  return raw;
};

export const normalizeApiBaseUrl = (value = '') => {
  const raw = trimTrailingSlash(maybeUpgradeToHttps(value));
  if (!raw) return '';
  return /\/api$/i.test(raw) ? raw : `${raw}/api`;
};

export const resolveApiBaseUrl = () => {
  const explicit = normalizeApiBaseUrl(process.env.REACT_APP_API_URL);
  if (explicit) return explicit;

  if (typeof window !== 'undefined' && window.location?.origin) {
    return normalizeApiBaseUrl(window.location.origin);
  }

  return '/api';
};

export const resolveApiOrigin = () => trimTrailingSlash(resolveApiBaseUrl().replace(/\/api$/i, ''));

export const buildApiUrl = (path = '') => {
  const base = trimTrailingSlash(resolveApiBaseUrl());
  if (!path) return base;
  if (/^https?:\/\//i.test(String(path || '').trim())) return path;
  return `${base}${String(path).startsWith('/') ? path : `/${path}`}`;
};
