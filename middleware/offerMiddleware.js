
const offerUtils = require('../utils/offerUtils');

/**
 * Middleware to apply best offers to products in request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
exports.applyBestOffers = async (req, res, next) => {
  try {
    if (req.products && Array.isArray(req.products)) {
      req.products = await offerUtils.applyBestOfferToProducts(req.products);
    }
    
    res.locals.offerUtils = offerUtils;
    
    next();
  } catch (error) {
    console.error('Error in offer middleware:', error);
    next(error);
  }
};

/**
 * Middleware to apply best offers to single product in request
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Express next function
 */
exports.applyBestOfferToProduct = async (req, res, next) => {
  try {
    if (req.product) {
      const [productWithOffer] = await offerUtils.applyBestOfferToProducts([req.product]);
      req.product = productWithOffer;
    }
    
    res.locals.offerUtils = offerUtils;
    
    next();
  } catch (error) {
    console.error('Error in single product offer middleware:', error);
    next(error);
  }
};

module.exports = exports;