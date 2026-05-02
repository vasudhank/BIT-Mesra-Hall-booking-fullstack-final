const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = String(process.env.MONGO_URI || '').trim();
const NODE_ENV = String(process.env.NODE_ENV || 'development').trim().toLowerCase();
const MONGO_RETRY_INTERVAL_MS = Math.max(
  Number(process.env.MONGO_RETRY_INTERVAL_MS || 10000),
  1000
);
const MONGO_SERVER_SELECTION_TIMEOUT_MS = Math.max(
  Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000),
  1000
);
const MONGO_SOCKET_TIMEOUT_MS = Math.max(Number(process.env.MONGO_SOCKET_TIMEOUT_MS || 45000), 1000);
const MONGO_CONNECT_TIMEOUT_MS = Math.max(Number(process.env.MONGO_CONNECT_TIMEOUT_MS || 10000), 1000);
const MONGO_MAX_POOL_SIZE = Math.max(Number(process.env.MONGO_MAX_POOL_SIZE || 80), 1);
const MONGO_MIN_POOL_SIZE = Math.min(
  Math.max(Number(process.env.MONGO_MIN_POOL_SIZE || 5), 0),
  MONGO_MAX_POOL_SIZE
);
const MONGO_MAX_IDLE_TIME_MS = Math.max(Number(process.env.MONGO_MAX_IDLE_TIME_MS || 30000), 1000);
const MONGO_FAMILY = Number(process.env.MONGO_FAMILY || 4) === 6 ? 6 : 4;

mongoose.set('bufferCommands', false);
mongoose.set('autoIndex', NODE_ENV !== 'production');

let reconnectTimer = null;
let hasConnectedOnce = false;
let connectInFlight = null;

const isMongoAuthError = (err) => {
  const message = String(err?.message || '').toLowerCase();
  return (
    err?.code === 8000 ||
    message.includes('authentication failed') ||
    message.includes('bad auth')
  );
};

const scheduleReconnect = () => {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectMongo().catch(() => {});
  }, MONGO_RETRY_INTERVAL_MS);
};

const connectMongo = async () => {
  if (!MONGO_URI) {
    console.error('MONGO_URI not set in environment variables.');
    return false;
  }

  if (mongoose.connection.readyState === 1) {
    return true;
  }

  if (connectInFlight) {
    return connectInFlight;
  }

  connectInFlight = mongoose
    .connect(MONGO_URI, {
      serverSelectionTimeoutMS: MONGO_SERVER_SELECTION_TIMEOUT_MS,
      socketTimeoutMS: MONGO_SOCKET_TIMEOUT_MS,
      connectTimeoutMS: MONGO_CONNECT_TIMEOUT_MS,
      maxPoolSize: MONGO_MAX_POOL_SIZE,
      minPoolSize: MONGO_MIN_POOL_SIZE,
      maxIdleTimeMS: MONGO_MAX_IDLE_TIME_MS,
      family: MONGO_FAMILY
    })
    .then(() => {
      hasConnectedOnce = true;
      return true;
    })
    .catch((err) => {
      console.error('MongoDB connection error:', err);
      if (isMongoAuthError(err)) {
        console.error(
          'MongoDB authentication failed. Update backend/.env MONGO_URI with valid Atlas credentials or use a local Mongo URI.'
        );
        return false;
      }
      scheduleReconnect();
      return false;
    })
    .finally(() => {
      connectInFlight = null;
    });

  return connectInFlight;
};

mongoose.connection.on('connected', () => {
  console.log('Successfully connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
  if (isMongoAuthError(err)) {
    console.error(
      'MongoDB authentication failed. Check backend/.env MONGO_URI username/password and Atlas DB user access.'
    );
  }
});

mongoose.connection.on('disconnected', () => {
  if (!hasConnectedOnce) return;
  console.warn('MongoDB disconnected. Retrying connection...');
  scheduleReconnect();
});

connectMongo().catch(() => {});

module.exports = {
  db: mongoose.connection,
  connectMongo
};
