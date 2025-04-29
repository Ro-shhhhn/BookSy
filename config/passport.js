// config/passport.js
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/user');

passport.serializeUser((user, done) => {
  done(null, user.id);
});

passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: "/auth/google/callback"
  },
  async (accessToken, refreshToken, profile, done) => {
    try {
      // Check if user exists
      let user = await User.findOne({ googleId: profile.id });
      
      if (!user) {
        // Find by email if new Google login
        user = await User.findOne({ email: profile.emails[0].value });
        
        if (user) {
          // Link Google ID to existing account
          user.googleId = profile.id;
          await user.save();
        } else {
          // Create new user
          user = await User.create({
            googleId: profile.id,
            name: profile.displayName,
            email: profile.emails[0].value,
            profileImage: profile.photos[0].value,
            verified: true // Google users are pre-verified
          });
        }
      }
      
      // Check if the user is blocked before allowing login
      if (user.isBlocked) {
        return done(null, false, { message: 'Your account has been blocked by an administrator.' });
      }
      
      return done(null, user);
    } catch (error) {
      return done(error, null);
    }
  }
));