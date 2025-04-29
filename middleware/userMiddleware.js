
const User = require('../models/user');

const userMiddleware = {
  attachUserToResponse: async (req, res, next) => {
    // Initialize user to null
    res.locals.user = null;
    res.locals.isAuthenticated = false;
    
    if (req.session.userId) {
      try {
        const user = await User.findById(req.session.userId);
        
        if (user) {
          if (user.isBlocked) {
            console.log(`Blocked user ${user.email} attempted to access the site`);
          } else {
            res.locals.user = {
              id: user._id,
              name: user.name,
              email: user.email
            };
            res.locals.isAuthenticated = true;
            res.locals.userName = user.name;
          }
        }
      } catch (error) {
        console.error('Error in userMiddleware:', error);
      }
    }
    next();
  }
};

module.exports = userMiddleware;