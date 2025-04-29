const Wishlist = require('../models/wishlistModel');
const Product = require('../models/productModel');


exports.addToWishlist = async (req, res) => {
    try {
      const { productId } = req.body;
      const userId = req.session.userId;
  
      if (!userId) {
        return res.status(401).json({ 
          success: false, 
          requireLogin: true,
          message: 'Please login to add items to your wishlist' 
        });
      }
  
      let wishlist = await Wishlist.findOne({ user: userId });
      
      if (!wishlist) {
        wishlist = new Wishlist({
          user: userId,
          products: [productId]
        });
      } else {
        if (!wishlist.products.includes(productId)) {
          wishlist.products.push(productId);
        }
      }
  
      await wishlist.save();
      
      res.json({ 
        success: true, 
        message: 'Product added to wishlist',
        inWishlist: true
      });
    } catch (error) {
      console.error('Add to wishlist error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to add to wishlist. Please try again.' 
      });
    }
  };
  
  exports.removeFromWishlist = async (req, res) => {
    try {
      const { productId } = req.body;
      const userId = req.session.userId;
  
      if (!userId) {
        return res.status(401).json({ 
          success: false, 
          requireLogin: true,
          message: 'Please login to manage your wishlist' 
        });
      }
  
      const wishlist = await Wishlist.findOne({ user: userId });
      
      if (wishlist) {
        wishlist.products = wishlist.products.filter(id => id.toString() !== productId);
        await wishlist.save();
      }
      
      res.json({ 
        success: true, 
        message: 'Product removed from wishlist',
        inWishlist: false
      });
    } catch (error) {
      console.error('Remove from wishlist error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to remove from wishlist. Please try again.' 
      });
    }
  };
  
  exports.getWishlist = async (req, res) => {
    try {
      const userId = req.session.userId;
      
      if (!userId) {
        return res.redirect('/login');
      }
      
      const wishlist = await Wishlist.findOne({ user: userId })
        .populate({
          path: 'products',
          match: { isActive: true }, 
          populate: {
            path: 'category',
            select: 'name'
          }
        });
      
      let userCartItems = [];
      const Cart = require('../models/cartModel');
      const cart = await Cart.findOne({ user: userId });
      if (cart) {
        userCartItems = cart.items.map(item => item.product.toString());
      }
      
      res.render('wishlist', {
        wishlistItems: wishlist ? wishlist.products : [],
        userCartItems
      });
    } catch (error) {
      console.error('Get wishlist error:', error);
      res.status(500).render('error', { 
        message: 'Failed to load wishlist. Please try again.' 
      });
    }
  };
  
  exports.toggleWishlist = async (req, res) => {
    try {
      const { productId } = req.body;
      const userId = req.session.userId;
  
      if (!userId) {
        return res.status(401).json({ 
          success: false, 
          requireLogin: true,
          message: 'Please login to manage your wishlist' 
        });
      }
  
      let wishlist = await Wishlist.findOne({ user: userId });
      let inWishlist = false;
      
      if (!wishlist) {
        wishlist = new Wishlist({
          user: userId,
          products: [productId]
        });
        inWishlist = true;
      } else {
        const productIndex = wishlist.products.findIndex(id => id.toString() === productId);
        
        if (productIndex === -1) {
          wishlist.products.push(productId);
          inWishlist = true;
        } else {
          wishlist.products.splice(productIndex, 1);
          inWishlist = false;
        }
      }
  
      await wishlist.save();
      
      res.json({ 
        success: true, 
        message: inWishlist ? 'Product added to wishlist' : 'Product removed from wishlist',
        inWishlist
      });
    } catch (error) {
      console.error('Toggle wishlist error:', error);
      res.status(500).json({ 
        success: false, 
        message: 'Failed to update wishlist. Please try again.' 
      });
    }
  };