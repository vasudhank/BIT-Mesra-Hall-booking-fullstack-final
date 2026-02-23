const express = require('express');
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const { hashSync } = require('bcrypt');

require('dotenv').config({ path: path.join(__dirname, '.env') });

const app = express();

require('./config/mongoose');
const passport = require('./config/passport');
const Developer = require('./models/developer');
const { startFaqAutoPromotion } = require('./services/faqAutoPromotionService');

const PORT = process.env.PORT || 8000;
const NODE_ENV = process.env.NODE_ENV || 'development';

console.log('ENV:', NODE_ENV);
console.log('EMAIL:', process.env.EMAIL ? 'SET' : 'NOT SET');
console.log('MONGO_URI:', process.env.MONGO_URI ? 'SET' : 'NOT SET');

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
app.use('/api/voice', require('./routes/voice'));
app.use('/api', require('./index1'));

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
    console.log(`[Bootstrap] Default developer created: ${email}`);
  } catch (err) {
    console.error('[Bootstrap] Developer init failed:', err.message);
  }
};

const server = app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  ensureDefaultDeveloper().catch(() => {});
  if (String(process.env.COMPLAINT_MAIL_SYNC_ENABLED || 'true').toLowerCase() !== 'false') {
    try {
      const { startComplaintMailSync } = require('./services/complaintMailSyncService');
      startComplaintMailSync();
    } catch (err) {
      console.error('[Startup] Complaint mail sync failed to start:', err.message);
    }
  } else {
    console.log('[Startup] Complaint mail sync disabled (COMPLAINT_MAIL_SYNC_ENABLED=false).');
  }
  startFaqAutoPromotion();
});

server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    console.error(`[Startup] Port ${PORT} is already in use.`);
    console.error('[Startup] Stop the old backend process or change PORT in backend/.env, then restart.');
    process.exit(1);
  }
  console.error('[Startup] Server failed to start:', err?.message || err);
  process.exit(1);
});
