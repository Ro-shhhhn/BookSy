// middleware/cartMiddleware.js
const Cart = require('../models/cartModel');

const cartMiddleware = async (req, res, next) => {
  res.locals.cartCount = 0; 
  
  if (req.session && req.session.userId) {
    try {
      const cart = await Cart.findOne({ user: req.session.userId });
      if (cart && cart.items) {
        const validItemCount = cart.items.reduce((total, item) => {
          return total + item.quantity;
        }, 0);
        res.locals.cartCount = validItemCount;
      }
    } catch (error) {
      console.error('Error fetching cart count:', error);
    }
  }
  next();
};

module.exports = cartMiddleware;