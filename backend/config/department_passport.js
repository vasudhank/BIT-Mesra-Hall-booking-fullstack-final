var passport = require('passport');
var LocalStrategy = require('passport-local');
const Department = require('../models/department');
const { compareSync } = require('bcrypt');

passport.use(
  'department',
  new LocalStrategy(
    { usernameField: 'email' },
    async function (email, password, done) {
      try {
        const department = await Department.findOne({ email: email });

        if (!department) {
          return done(null, false);
        }

        if (!compareSync(password, department.password)) {
          return done(null, false);
        }

        return done(null, department);
      } catch (err) {
        return done(err);
      }
    }
  )
);

// Ensure session contains a 'type' so routes can identify Department users
passport.serializeUser(function (user, cb) {
  process.nextTick(function () {
    cb(null, { id: user.id, email: user.email, type: 'Department' });
  });
});

passport.deserializeUser(function (user, cb) {
  process.nextTick(function () {
    return cb(null, user);
  });
});

module.exports = passport;
