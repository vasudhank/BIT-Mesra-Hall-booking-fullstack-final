const passport = require('passport');
const LocalStrategy = require('passport-local');
const Admin = require('../models/admin');
const Department = require('../models/department');
const Developer = require('../models/developer');
const { compareSync } = require('bcrypt');

/* ================= ADMIN STRATEGY ================= */
passport.use(
  'admin',
  new LocalStrategy(
    { usernameField: 'email' },
    async (email, password, done) => {
      try {
        const normalizedEmail = String(email || '').toLowerCase().trim();
        const admin = await Admin.findOne({ email: normalizedEmail }).sort({ _id: -1 });
        if (!admin) return done(null, false);
        if (!compareSync(password, admin.password)) return done(null, false);

        return done(null, {
          id: admin._id,
          email: admin.email,
          type: 'Admin'
        });
      } catch (err) {
        return done(err);
      }
    }
  )
);

/* ================= DEPARTMENT STRATEGY ================= */
passport.use(
  'department',
  new LocalStrategy(
    { usernameField: 'email' },
    async (email, password, done) => {
      try {
        const normalizedEmail = String(email || '').toLowerCase().trim();
        const dept = await Department.findOne({ email: normalizedEmail }).sort({ _id: -1 });
        if (!dept) return done(null, false);
        if (!compareSync(password, dept.password)) return done(null, false);

        return done(null, {
          id: dept._id,
          email: dept.email,
          type: 'Department'
        });
      } catch (err) {
        return done(err);
      }
    }
  )
);

/* ================= DEVELOPER STRATEGY ================= */
passport.use(
  'developer',
  new LocalStrategy(
    { usernameField: 'email' },
    async (email, password, done) => {
      try {
        const normalizedEmail = String(email || '').toLowerCase().trim();
        const dev = await Developer.findOne({ email: normalizedEmail }).sort({ _id: -1 });
        if (!dev) return done(null, false);
        if (!compareSync(password, dev.password)) return done(null, false);

        return done(null, {
          id: dev._id,
          email: dev.email,
          type: 'Developer',
          name: dev.name || 'Developer'
        });
      } catch (err) {
        return done(err);
      }
    }
  )
);

/* ================= SESSION ================= */
passport.serializeUser((user, cb) => {
  cb(null, user);
});

passport.deserializeUser((user, cb) => {
  cb(null, user);
});

module.exports = passport;
