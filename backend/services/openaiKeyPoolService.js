const splitKeys = (raw) =>
  String(raw || '')
    .split(/[\n,;]+/)
    .map((item) => String(item || '').trim())
    .filter(Boolean);

const dedupe = (values = []) => {
  const out = [];
  for (const value of values) {
    if (!out.includes(value)) out.push(value);
  }
  return out;
};

let roundRobinCursor = 0;

const getOpenAIApiKeys = () => {
  const multi = splitKeys(process.env.OPENAI_API_KEYS);
  const single = String(process.env.OPENAI_API_KEY || '').trim();
  return dedupe(single ? [...multi, single] : multi);
};

const hasOpenAIApiKeyConfigured = () => getOpenAIApiKeys().length > 0;

const getRotatedOpenAIApiKeys = () => {
  const keys = getOpenAIApiKeys();
  if (keys.length <= 1) return keys;

  const start = roundRobinCursor % keys.length;
  roundRobinCursor = (roundRobinCursor + 1) % keys.length;

  return [...keys.slice(start), ...keys.slice(0, start)];
};

const shouldRetryWithAnotherOpenAIKey = ({ status = 0, details = '', error = null } = {}) => {
  const text = `${String(details || '')} ${String(error?.message || error || '')}`.toLowerCase();

  if (status === 0) {
    return /(aborted|abort|timeout|timed out|econnreset|enotfound|eai_again|socket hang up|network)/i.test(text);
  }

  if ([401, 403, 408, 409, 425, 429].includes(status)) return true;
  if (status >= 500) return true;

  if (status === 400 && /(quota|rate limit|too many requests|resource exhausted)/i.test(text)) {
    return true;
  }

  return false;
};

module.exports = {
  getOpenAIApiKeys,
  getRotatedOpenAIApiKeys,
  hasOpenAIApiKeyConfigured,
  shouldRetryWithAnotherOpenAIKey
};

