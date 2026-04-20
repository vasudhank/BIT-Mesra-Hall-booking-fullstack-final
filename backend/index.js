const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const {
  initializeDatadog,
  initializeSentry,
  attachSentryErrorHandler,
  captureException
} = require('./services/observabilityService');
initializeDatadog();

const express = require('express');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const { hashSync } = require('bcrypt');
const app = express();
initializeSentry();

require('./config/mongoose');
const passport = require('./config/passport');
const Developer = require('./models/developer');
const { startFaqAutoPromotion } = require('./services/faqAutoPromotionService');
const { startBookingCleanupSchedule } = require('./services/bookingCleanupService');
const { startNoticeMailSync } = require('./services/noticeMailSyncService');
const { startNoticeTrashCleanupSchedule } = require('./services/noticeTrashCleanupService');
const { startVectorKnowledgeSync } = require('./services/vectorKnowledgeSyncService');
const { attachAiRealtimeSocketServer } = require('./services/aiRealtimeSocketService');
const { beginHttpTimer } = require('./services/metricsService');
const { logger } = require('./services/loggerService');

const PORT = process.env.PORT || 8000;
const NODE_ENV = process.env.NODE_ENV || 'development';

const captureRawBody = (req, res, buf) => {
  if (!buf || !buf.length) return;
  req.rawBody = buf.toString('utf8');
};

logger.info('Backend boot config', {
  env: NODE_ENV,
  emailConfigured: Boolean(process.env.EMAIL),
  mongoConfigured: Boolean(process.env.MONGO_URI)
});

app.use(express.json({ limit: '15mb', verify: captureRawBody }));
app.use(express.urlencoded({ extended: true, verify: captureRawBody }));

app.use((req, res, next) => {
  const done = beginHttpTimer(req);
  res.on('finish', () => done(res.statusCode));
  next();
});

app.use(
  cors({
    origin: true,
    credentials: true
  })
);

app.set('trust proxy', 1);
app.use(
  session({
    name: 'seminar.sid',
    secret: process.env.SESSION_SECRET || 'rkm seminar',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 1000 * 60 * 60 * 24,
      sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
      secure: NODE_ENV === 'production'
    },
    store: MongoStore.create({
      mongoUrl: process.env.MONGO_URI,
      collectionName: 'sessions'
    })
  })
);

app.use(passport.initialize());
app.use(passport.session());

app.use('/api/ai', require('./routes/ai'));
app.use('/api/ai', require('./routes/aiExecute'));
app.use('/api/ai', require('./routes/aiReviews'));
app.use('/api/voice', require('./routes/voice'));
app.use('/api/vector', require('./routes/vector'));
app.use('/api/ops', require('./routes/ops'));
app.use('/api/integrations/whatsapp', require('./routes/integrationsWhatsApp'));
app.use('/api/integrations/slack', require('./routes/integrationsSlack'));
app.use('/api/integrations/crm', require('./routes/integrationsCrm'));
app.use('/api', require('./index1'));

attachSentryErrorHandler(app);

app.use((err, req, res, next) => {
  captureException(err, {
    route: req?.originalUrl || req?.url || '',
    method: req?.method || ''
  });
  logger.error('Unhandled Express error', { error: err?.message || err });
  if (res.headersSent) return next(err);
  return res.status(500).json({ error: 'Internal server error' });
});

const ensureDefaultDeveloper = async () => {
  try {
    const email = String(process.env.DEVELOPER_EMAIL || 'jarti2731@gmail.com').toLowerCase().trim();
    const password = String(process.env.DEVELOPER_DEFAULT_PASSWORD || 'test123');
    if (!email) return;

    const existing = await Developer.findOne({ email });
    if (existing) return;

    await Developer.create({
      name: 'Developer',
      email,
      password: hashSync(password, 10),
      type: 'Developer'
    });
    logger.info('Default developer created', { email });
  } catch (err) {
    logger.error('Default developer bootstrap failed', { error: err.message || err });
  }
};

const server = app.listen(PORT, () => {
  logger.info('Server started', { port: PORT });
  ensureDefaultDeveloper().catch(() => {});
  if (String(process.env.COMPLAINT_MAIL_SYNC_ENABLED || 'true').toLowerCase() !== 'false') {
    try {
      const { startComplaintMailSync } = require('./services/complaintMailSyncService');
      startComplaintMailSync();
    } catch (err) {
      logger.error('Complaint mail sync failed to start', { error: err.message || err });
    }
  } else {
    logger.info('Complaint mail sync disabled', { reason: 'COMPLAINT_MAIL_SYNC_ENABLED=false' });
  }
  startFaqAutoPromotion();
  startBookingCleanupSchedule();
  startNoticeMailSync();
  startNoticeTrashCleanupSchedule();
  startVectorKnowledgeSync();
});

attachAiRealtimeSocketServer(server);

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    logger.error('Port already in use', { port: PORT });
    logger.error('Startup blocked by occupied port', {
      hint: 'Stop old backend process or change PORT in backend/.env'
    });
    process.exit(1);
  }
  logger.error('Server failed to start', { error: err?.message || err });
  process.exit(1);
});
