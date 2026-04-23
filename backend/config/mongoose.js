const mongoose = require('mongoose');
require('dotenv').config();

const MONGO_URI = String(process.env.MONGO_URI || '').trim();
const MONGO_RETRY_INTERVAL_MS = Math.max(
  Number(process.env.MONGO_RETRY_INTERVAL_MS || 10000),
  1000
);
const MONGO_SERVER_SELECTION_TIMEOUT_MS = Math.max(
  Number(process.env.MONGO_SERVER_SELECTION_TIMEOUT_MS || 10000),
  1000
);

let reconnectTimer = null;
let hasConnectedOnce = false;

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

  if (mongoose.connection.readyState === 1 || mongoose.connection.readyState === 2) {
    return true;
  }

  try {
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: MONGO_SERVER_SELECTION_TIMEOUT_MS
    });
    hasConnectedOnce = true;
    return true;
  } catch (err) {
    console.error('MongoDB connection error:', err);
    scheduleReconnect();
    return false;
  }
};

mongoose.connection.on('connected', () => {
  console.log('Successfully connected to MongoDB');
});

mongoose.connection.on('error', (err) => {
  console.error('MongoDB connection error:', err);
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
