
const User = require('../models/user');

const authMiddleware = {
  isLoggedIn: (req, res, next) => {
    if (req.session.userId) {
      return next();
    }
    return res.redirect('/login');
  },
checkUserAndRedirect: (req, res, next) => {
  if (!req.session || !req.session.userId) {
      return res.status(401).json({
          success: false,
          message: 'Please login to add items to your cart',
          requireLogin: true
      });
  }
  next();
},
  isActiveUser: async (req, res, next) => {
    if (!req.session.userId) {
      return res.redirect('/login');
    }
    
    try {
      const user = await User.findById(req.session.userId);
      if (!user || user.isBlocked) {
        req.session.destroy();
        return res.redirect('/login?blocked=true');
      }
      return next();
    } catch (error) {
      console.error('Auth middleware error:', error);
      req.session.destroy();
      return res.redirect('/login');
    }
  }
};



module.exports = authMiddleware;

