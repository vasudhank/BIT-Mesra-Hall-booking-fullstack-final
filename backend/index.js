const express = require('express');
const app = express();
const path = require('path');
const cors = require('cors');
const session = require('express-session');
const MongoStore = require('connect-mongo');

const db = require('./config/mongoose');
const passport = require('./config/passport');

require('dotenv').config({ path: path.join(__dirname, '.env') });

/* =====================================================
   BASIC CONFIG
===================================================== */
const PORT = process.env.PORT || 8000;
const NODE_ENV = process.env.NODE_ENV || 'development';

/* =====================================================
   DEBUG ENV (SAFE)
===================================================== */
console.log('ENV:', NODE_ENV);
console.log('EMAIL:', process.env.EMAIL ? 'SET' : 'NOT SET');
console.log('MONGO_URI:', process.env.MONGO_URI ? 'SET' : 'NOT SET');

/* =====================================================
   BODY PARSERS
===================================================== */
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

/* =====================================================
   CORS CONFIG (LOCAL + PROD SAFE)
===================================================== */
const allowedOrigins = [
  'http://localhost:3000',
  process.env.FRONTEND_URL
].filter(Boolean);

app.use(cors({
  origin: true,
  credentials: true
}));

/* =====================================================
   SESSION CONFIG (LOCAL + PROD)
===================================================== */
app.set('trust proxy', 1);

app.use(session({
  name: 'seminar.sid',
  secret: process.env.SESSION_SECRET || 'rkm seminar',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 1000 * 60 * 60 * 24, // 1 day

    // 🔑 LOCAL vs PROD difference
    sameSite: NODE_ENV === 'production' ? 'none' : 'lax',
    secure: NODE_ENV === 'production'
  },
  store: MongoStore.create({
    mongoUrl: process.env.MONGO_URI,
    collectionName: 'sessions'
  })
}));

/* =====================================================
   PASSPORT
===================================================== */
app.use(passport.initialize());
app.use(passport.session());

app.use('/api/ai', require('./routes/ai'));
app.use('/api/ai', require('./routes/aiExecute'));
app.use('/api/voice', require('./routes/voice'));
/* =====================================================
   API ROUTES
===================================================== */
app.use('/api', require('./index1'));

/* =====================================================
   SERVE FRONTEND (ONLY IN PRODUCTION)
===================================================== */


/* =====================================================
   START SERVER
===================================================== */
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
