const CategoryOffer = require('../models/categoryOfferModel');
const Category = require('../models/categoryModel');
const Product = require('../models/productModel');
const mongoose = require('mongoose');

exports.getAllCategoryOffers = async (req, res) => {
  try {
    const { 
      sortBy = 'createdAt', 
      sortOrder = 'desc',
      discountFilter = 'all',
      searchTerm = '',
      searchBy = 'category'
    } = req.query;

    let filterQuery = {};
    
    if (discountFilter !== 'all') {
      switch(discountFilter) {
        case 'below35':
          filterQuery.discountPercentage = { $lt: 35 };
          break;
        case 'below70':
          filterQuery.discountPercentage = { $lt: 70 };
          break;
        case 'above60':
          filterQuery.discountPercentage = { $gt: 60 };
          break;
      }
    }

    if (searchTerm) {
      if (searchBy === 'discount') {
        const discountValue = parseFloat(searchTerm);
        if (!isNaN(discountValue)) {
          filterQuery.discountPercentage = discountValue;
        }
      } else {
        const categoryRegex = new RegExp(searchTerm, 'i');
        const matchingCategories = await Category.find({ name: categoryRegex });
        const categoryIds = matchingCategories.map(cat => cat._id);
        
        if (categoryIds.length > 0) {
          filterQuery.category = { $in: categoryIds };
        } else if (searchBy === 'category') {
          return res.render('admin/categoryOffers', { 
            categoryOffers: [],
            error: 'No categories found matching your search term',
            success: req.flash('success'),
            filters: { sortBy, sortOrder, discountFilter, searchTerm, searchBy }
          });
        }
      }
    }

    const sortDirection = sortOrder === 'asc' ? 1 : -1;
    
    const sortOptions = {};
    sortOptions[sortBy] = sortDirection;

    const categoryOffers = await CategoryOffer.find(filterQuery)
      .populate('category', 'name')
      .sort(sortOptions);
    
    res.render('admin/categoryOffers', { 
      categoryOffers,
      error: null,
      success: req.flash('success'),
      filters: { sortBy, sortOrder, discountFilter, searchTerm, searchBy }
    });
  } catch (error) {
    console.error('Error fetching category offers:', error);
    res.status(500).render('error', { message: 'Server error' });
  }
};

exports.getAddCategoryOfferPage = async (req, res) => {
  try {
    const categories = await Category.find({ status: true });
    res.render('admin/addCategoryOffer', { 
      categories,
      categoryOffer: {
        _id: '',
        category: '',
        discountPercentage: '',
        startDate: '',
        endDate: '',
        description: '',
        isActive: true
      },
      error: null 
    });
  } catch (error) {
    console.error('Error loading categories:', error);
    res.status(500).render('error', { message: 'Server error' });
  }
};

exports.addCategoryOffer = async (req, res) => {
  try {
    const { category, discountPercentage, startDate, endDate, description } = req.body;
    let errors = [];
    
    if (!category) {
      errors.push('Category selection is required');
    }
    
    if (!discountPercentage) {
      errors.push('Discount percentage is required');
    } else if (isNaN(parseFloat(discountPercentage)) || parseFloat(discountPercentage) < 1 || parseFloat(discountPercentage) > 90) {
      errors.push('Discount percentage must be between 1 and 90');
    }
    
    if (!startDate) {
      errors.push('Start date is required');
    }
    
    if (!endDate) {
      errors.push('End date is required');
    } else if (new Date(endDate) < new Date(startDate)) {
      errors.push('End date must be after start date');
    }
    
    if (category && startDate && endDate) {
      const overlappingOffer = await CategoryOffer.findOne({
        category,
        $or: [
          { startDate: { $lte: new Date(endDate) }, endDate: { $gte: new Date(startDate) } }
        ],
        _id: { $ne: req.params.id } 
      });
      
      if (overlappingOffer) {
        errors.push('An offer for this category already exists');
      }
    }
    
    if (errors.length > 0) {
      const categories = await Category.find({ status: true });
      return res.render('admin/addCategoryOffer', {
        categories,
        error: errors.join('. '),
        categoryOffer: {
          _id: '',
          category,
          discountPercentage,
          startDate,
          endDate,
          description,
          isActive: true
        }
      });
    }

    const newCategoryOffer = new CategoryOffer({
      category,
      discountPercentage: parseFloat(discountPercentage),
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      description: description || '',
      isActive: true
    });

    await newCategoryOffer.save();
    req.flash('success', 'Category offer added successfully');
    res.redirect('/admin/category-offers');
  } catch (error) {
    console.error('Error adding category offer:', error);
    const categories = await Category.find({ status: true });
    res.render('admin/addCategoryOffer', {
      categories,
      error: error.message || 'Failed to add category offer',
      categoryOffer: {
        _id: '',
        category: req.body.category,
        discountPercentage: req.body.discountPercentage,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        description: req.body.description,
        isActive: true
      }
    });
  }
};

exports.getEditCategoryOfferPage = async (req, res) => {
  try {
    const { id } = req.params;
    const categoryOffer = await CategoryOffer.findById(id);
    
    if (!categoryOffer) {
      req.flash('error', 'Category offer not found');
      return res.redirect('/admin/category-offers');
    }
    
    const categories = await Category.find({ status: true });
    
    const formattedOffer = {
      ...categoryOffer.toObject(),
      startDate: categoryOffer.startDate.toISOString().split('T')[0],
      endDate: categoryOffer.endDate.toISOString().split('T')[0]
    };
    
    res.render('admin/addCategoryOffer', {
      categoryOffer: formattedOffer,
      categories,
      error: null
    });
  } catch (error) {
    console.error('Error loading category offer for edit:', error);
    req.flash('error', error.message || 'Failed to load category offer');
    res.redirect('/admin/category-offers');
  }
};


exports.updateCategoryOffer = async (req, res) => {
  try {
    const { id } = req.params;
    const { category, discountPercentage, startDate, endDate, description, isActive } = req.body;
    let errors = [];
    
    if (!category) {
      errors.push('Category selection is required');
    }
    
    if (!discountPercentage) {
      errors.push('Discount percentage is required');
    } else if (isNaN(parseFloat(discountPercentage)) || parseFloat(discountPercentage) < 1 || parseFloat(discountPercentage) > 90) {
      errors.push('Discount percentage must be between 1 and 90');
    }
    
    if (!startDate) {
      errors.push('Start date is required');
    }
    
    if (!endDate) {
      errors.push('End date is required');
    } else if (new Date(endDate) < new Date(startDate)) {
      errors.push('End date must be after start date');
    }
    
    if (category && startDate && endDate) {
      const overlappingOffer = await CategoryOffer.findOne({
        category,
        $or: [
          { startDate: { $lte: new Date(endDate) }, endDate: { $gte: new Date(startDate) } }
        ],
        _id: { $ne: id } 
      });
      
      if (overlappingOffer) {
        errors.push('An offer for this category already exists');
      }
    }
    
    if (errors.length > 0) {
      const categories = await Category.find({ status: true });
      
      return res.render('admin/addCategoryOffer', {
        categories,
        error: errors.join('. '),
        categoryOffer: {
          _id: id,
          category,
          discountPercentage,
          startDate,
          endDate,
          description,
          isActive: isActive === 'true' || isActive === true
        }
      });
    }
    
    const existingOffer = await CategoryOffer.findById(id);
    if (!existingOffer) {
      req.flash('error', 'Category offer not found');
      return res.redirect('/admin/category-offers');
    }

    console.log('Start Date:', startDate, typeof startDate, new Date(startDate));
    console.log('End Date:', endDate, typeof endDate, new Date(endDate));

    existingOffer.category = category;
    existingOffer.discountPercentage = parseFloat(discountPercentage);
    existingOffer.startDate = new Date(startDate);
    existingOffer.endDate = new Date(endDate);
    existingOffer.description = description || '';
    existingOffer.isActive = isActive === 'true' || isActive === true;

    await existingOffer.save();
    
    req.flash('success', 'Category offer updated successfully');
    res.redirect('/admin/category-offers');
  } catch (error) {
    console.error('Error updating category offer:', error);
    const categories = await Category.find({ status: true });
    res.render('admin/addCategoryOffer', {
      categories,
      error: error.message || 'Failed to update category offer',
      categoryOffer: {
        _id: req.params.id,
        category: req.body.category,
        discountPercentage: req.body.discountPercentage,
        startDate: req.body.startDate,
        endDate: req.body.endDate,
        description: req.body.description,
        isActive: req.body.isActive === 'true' || req.body.isActive === true
      }
    });
  }
};
exports.deleteCategoryOffer = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedOffer = await CategoryOffer.findByIdAndDelete(id);
    
    if (!deletedOffer) {
      return res.status(404).json({ success: false, message: 'Category offer not found' });
    }
    
    res.json({ success: true, message: 'Category offer deleted successfully' });
  } catch (error) {
    console.error('Error deleting category offer:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to delete category offer' });
  }
};

exports.toggleCategoryOfferStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const categoryOffer = await CategoryOffer.findById(id);
    
    if (!categoryOffer) {
      return res.status(404).json({ success: false, message: 'Category offer not found' });
    }
    
    categoryOffer.isActive = !categoryOffer.isActive;
    await categoryOffer.save();
    
    res.json({ 
      success: true, 
      message: `Category offer ${categoryOffer.isActive ? 'activated' : 'deactivated'} successfully`,
      isActive: categoryOffer.isActive
    });
  } catch (error) {
    console.error('Error toggling category offer status:', error);
    res.status(500).json({ success: false, message: error.message || 'Failed to update status' });
  }
};

exports.getApplicableCategoryOffer = async (categoryId) => {
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
    console.error('Error getting applicable category offer:', error);
    return null;
  }
};

exports.calculateBestDiscount = (productPrice, productDiscountPrice, categoryOfferDiscount) => {
  if (!categoryOfferDiscount || categoryOfferDiscount <= 0) {
    return productDiscountPrice;
  }
  
  const categoryDiscountAmount = (productPrice * categoryOfferDiscount) / 100;
  
  return Math.max(productDiscountPrice, categoryDiscountAmount);
};

exports.applyBestOfferToProducts = async (req, res, next) => {
  try {
    if (!req.products || !Array.isArray(req.products)) {
      return next();
    }
    
    const now = new Date();
    
    const categoryIds = [...new Set(req.products.map(p => p.category))];
    
    const categoryOffers = await CategoryOffer.find({
      category: { $in: categoryIds },
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now }
    });
    
    const categoryOffersMap = new Map();
    categoryOffers.forEach(offer => {
      const categoryId = offer.category.toString();
      if (!categoryOffersMap.has(categoryId) || 
          categoryOffersMap.get(categoryId).discountPercentage < offer.discountPercentage) {
        categoryOffersMap.set(categoryId, offer);
      }
    });
    
    req.products = req.products.map(product => {
      const productObj = product.toObject ? product.toObject() : product;
      const categoryId = productObj.category.toString();
      const categoryOffer = categoryOffersMap.get(categoryId);
      
      if (categoryOffer) {
        const productDiscount = productObj.discountPrice || 0;
        const categoryDiscountAmount = (productObj.price * categoryOffer.discountPercentage) / 100;
        
        if (categoryDiscountAmount > productDiscount) {
          productObj.effectiveDiscount = categoryDiscountAmount;
          productObj.discountSource = 'category';
          productObj.discountPercentage = categoryOffer.discountPercentage;
          productObj.discountedPrice = productObj.price - categoryDiscountAmount;
        } else {
          productObj.effectiveDiscount = productDiscount;
          productObj.discountSource = 'product';
          productObj.discountPercentage = productDiscount > 0 ? 
            Math.round((productDiscount / productObj.price) * 100) : 0;
          productObj.discountedPrice = productObj.price - productDiscount;
        }
      } else {
        // No category offer, use product discount
        productObj.effectiveDiscount = productObj.discountPrice || 0;
        productObj.discountSource = productObj.discountPrice > 0 ? 'product' : 'none';
        productObj.discountPercentage = productObj.discountPrice > 0 ? 
          Math.round((productObj.discountPrice / productObj.price) * 100) : 0;
        productObj.discountedPrice = productObj.price - (productObj.discountPrice || 0);
      }
      
      return productObj;
    });
    
    next();
  } catch (error) {
    console.error('Error applying best offer to products:', error);
    next(error);
  }
};