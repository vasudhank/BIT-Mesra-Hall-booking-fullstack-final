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
      serverSelectionTimeoutMS: MONGO_SERVER_SELECTION_TIMEOUT_MS
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
