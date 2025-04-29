// utils/offerUtils.js

const CategoryOffer = require('../models/categoryOfferModel');

/**
 * Get active category offer for a specific category
 * @param {String} categoryId - Category ID
 * @returns {Object|null} - Category offer object or null if no active offer
 */
exports.getActiveCategoryOffer = async (categoryId) => {
  if (!categoryId) return null;
  
  const now = new Date();
  
  try {
    const categoryOffer = await CategoryOffer.findOne({
      category: categoryId,
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now }
    }).sort({ discountPercentage: -1 });
    
    return categoryOffer;
  } catch (error) {
    console.error('Error getting active category offer:', error);
    return null;
  }
};

/**
 * Calculate the best discount between product discount and category offer
 * @param {Number} productPrice - Original product price
 * @param {Number} productDiscountPrice - Product's own discount amount
 * @param {Object|null} categoryOffer - Category offer object
 * @returns {Object} - Object containing discount details
 */
exports.calculateBestDiscount = (productPrice, productDiscountPrice, categoryOffer) => {
  const result = {
    effectiveDiscount: productDiscountPrice || 0,
    discountSource: productDiscountPrice > 0 ? 'product' : 'none',
    discountPercentage: productDiscountPrice > 0 ? 
      Math.round((productDiscountPrice / productPrice) * 100) : 0,
    finalPrice: productPrice - (productDiscountPrice || 0)
  };
  
  if (!categoryOffer) return result;
  
  const categoryDiscountAmount = Math.floor((productPrice * categoryOffer.discountPercentage) / 100);
  
  if (categoryDiscountAmount > productDiscountPrice) {
    return {
      effectiveDiscount: categoryDiscountAmount,
      discountSource: 'category',
      discountPercentage: categoryOffer.discountPercentage,
      finalPrice: productPrice - categoryDiscountAmount
    };
  }
  
  return result;
};

/**
 * Apply best discount to a list of products
 * @param {Array} products - Array of product objects
 * @returns {Promise<Array>} - Products with discount information applied
 */
exports.applyBestOfferToProducts = async (products) => {
  if (!products || products.length === 0) return products;
  
  const now = new Date();
  
  const categoryIds = [...new Set(products.map(p => {
    if (!p.category) return null;
    return p.category._id ? p.category._id.toString() : p.category.toString();
  }).filter(id => id))];
  
  const categoryOffers = await CategoryOffer.find({
    category: { $in: categoryIds },
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now }
  });
  
  const categoryOffersMap = new Map();
  categoryOffers.forEach(offer => {
    const categoryId = offer.category.toString();
    categoryOffersMap.set(categoryId, offer);
  });
  
  return products.map(product => {
    const productObj = product.toObject ? product.toObject() : { ...product };
    
    if (!productObj.category) return productObj;
    
    const categoryId = productObj.category._id ? 
      productObj.category._id.toString() : 
      productObj.category.toString();
    
    const categoryOffer = categoryOffersMap.get(categoryId);
    const productPrice = productObj.price || 0;
    const productDiscountPrice = productObj.discountPrice || 0;
    
    const discountInfo = exports.calculateBestDiscount(
      productPrice, 
      productDiscountPrice, 
      categoryOffer
    );
    
    return { ...productObj, ...discountInfo };
  });
};