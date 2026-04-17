const LEVEL_PRIORITY = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

const rawLevel = String(process.env.LOG_LEVEL || 'info').trim().toLowerCase();
const ACTIVE_LEVEL = Object.prototype.hasOwnProperty.call(LEVEL_PRIORITY, rawLevel)
  ? rawLevel
  : 'info';

const shouldLog = (level) => {
  const wanted = LEVEL_PRIORITY[String(level || 'info').toLowerCase()] || LEVEL_PRIORITY.info;
  const active = LEVEL_PRIORITY[ACTIVE_LEVEL] || LEVEL_PRIORITY.info;
  return wanted >= active;
};

const safeSerialize = (value) => {
  if (value === null || value === undefined) return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack
    };
  }
  if (typeof value === 'object') {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (err) {
      return String(value);
    }
  }
  return value;
};

const write = (level, message, context = {}) => {
  if (!shouldLog(level)) return;

  const payload = {
    ts: new Date().toISOString(),
    level: String(level || 'info').toLowerCase(),
    msg: String(message || '').trim(),
    context: safeSerialize(context)
  };

  const line = JSON.stringify(payload);
  if (payload.level === 'error') {
    process.stderr.write(`${line}\n`);
    return;
  }
  process.stdout.write(`${line}\n`);
};

const logger = {
  debug(message, context) {
    write('debug', message, context);
  },
  info(message, context) {
    write('info', message, context);
  },
  warn(message, context) {
    write('warn', message, context);
  },
  error(message, context) {
    write('error', message, context);
  }
};

module.exports = { logger };
