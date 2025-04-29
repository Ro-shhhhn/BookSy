const Product = require('../models/productModel');
const Category = require('../models/categoryModel');
const Cart = require('../models/cartModel');
const mongoose = require('mongoose'); 
const CategoryOffer = require('../models/categoryOfferModel');

const applyBestOfferToProducts = async (products) => {
  if (!products || products.length === 0) return products;
  
  const now = new Date();
  
  const categoryIds = [...new Set(products.map(p => 
    p.category._id ? p.category._id.toString() : p.category.toString()
  ))];
  
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
    const productObj = product.toObject ? product.toObject() : product;
    const categoryId = productObj.category._id ? 
      productObj.category._id.toString() : 
      productObj.category.toString();
    
    const categoryOffer = categoryOffersMap.get(categoryId);
    
    const productDiscount = productObj.discountPrice || 0;
    
    if (categoryOffer) {
      const categoryDiscountAmount = Math.floor((productObj.price * categoryOffer.discountPercentage) / 100);
      
      if (categoryDiscountAmount > productDiscount) {
        productObj.effectiveDiscount = categoryDiscountAmount;
        productObj.discountSource = 'category';
        productObj.discountPercentage = categoryOffer.discountPercentage;
        productObj.finalPrice = productObj.price - categoryDiscountAmount;
      } else {
        productObj.effectiveDiscount = productDiscount;
        productObj.discountSource = 'product';
        productObj.discountPercentage = productDiscount > 0 ? 
          Math.round((productDiscount / productObj.price) * 100) : 0;
        productObj.finalPrice = productObj.price - productDiscount;
      }
    } else {
      productObj.effectiveDiscount = productDiscount;
      productObj.discountSource = productDiscount > 0 ? 'product' : 'none';
      productObj.discountPercentage = productDiscount > 0 ? 
        Math.round((productDiscount / productObj.price) * 100) : 0;
      productObj.finalPrice = productObj.price - productDiscount;
    }
    
    return productObj;
  });
};

exports.getAllProducts = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 9;  
        const skip = (page - 1) * limit;
        
        const { search, category, minPrice, maxPrice, sort } = req.query;
        
        console.log("Search term:", search);
        
        let query = { isActive: true }; 
        
        if (search && search.trim() !== '') {
            const searchTerm = search.trim();
            
            const searchWords = searchTerm.split(/\s+/).filter(word => word.length > 0);
            
            if (searchWords.length > 0) {
                const wordConditions = searchWords.map(word => ({
                    $or: [
                        { title: { $regex: word, $options: 'i' } },
                        { author: { $regex: word, $options: 'i' } },
                        { description: { $regex: word, $options: 'i' } }
                    ]
                }));
                
                query.$or = [
                    { title: { $regex: searchTerm, $options: 'i' } },
                    { author: { $regex: searchTerm, $options: 'i' } },
                    { description: { $regex: searchTerm, $options: 'i' } },
                    ...(searchWords.length > 1 ? [{ $and: wordConditions }] : wordConditions)
                ];
            }
        }
        
        console.log("Query:", JSON.stringify(query));
        
        if (category) {
            if (Array.isArray(category)) {
                if (category.length > 0) {
                    query.category = { $in: category };
                }
            } 
            else if (category) {
                query.category = category;
            }
        }
        
        // Sort options
        let sortOptions = {};
        switch (sort) {
            case 'price_asc':
                sortOptions = { price: 1 }; 
                break;
            case 'price_desc':
                sortOptions = { price: -1 }; 
                break;
            case 'title_asc':
                sortOptions = { title: 1 };
                break;
            case 'title_desc':
                sortOptions = { title: -1 };
                break;
            default:
                sortOptions = { featured: -1, createdAt: -1 }; 
        }
        
        let productsQuery = Product.find(query)
            .populate('category', 'name')
            .sort(sortOptions);
        
        const totalProducts = await Product.countDocuments(query);
        
        let products = await productsQuery;
        
        if (search) {
            console.log("Found products:", products.map(p => p.title));
        }
        
        let productsWithOffers = await applyBestOfferToProducts(products);
        
        if (minPrice || maxPrice) {
            const parsedMinPrice = minPrice ? parseFloat(minPrice) : 0;
            const parsedMaxPrice = maxPrice ? parseFloat(maxPrice) : Number.MAX_SAFE_INTEGER;
            
            productsWithOffers = productsWithOffers.filter(product => {
                return product.finalPrice >= parsedMinPrice && product.finalPrice <= parsedMaxPrice;
            });
        }
        
        if (sort === 'price_asc') {
            productsWithOffers.sort((a, b) => a.finalPrice - b.finalPrice);
        } else if (sort === 'price_desc') {
            productsWithOffers.sort((a, b) => b.finalPrice - a.finalPrice);
        }
        
        const categories = await Category.find({ status: true });
        
        let categoryNames = [];
        if (category) {
            if (Array.isArray(category)) {
                const categoryDocs = await Category.find({ _id: { $in: category } });
                categoryNames = categoryDocs.map(cat => cat.name);
            } else {
                const categoryDoc = await Category.findById(category);
                if (categoryDoc) {
                    categoryNames = [categoryDoc.name];
                }
            }
        }
        
        let userCartItems = [];   
        if (req.session && req.session.userId) {
            const cart = await Cart.findOne({ user: req.session.userId });
            if (cart) {
                userCartItems = cart.items.map(item => item.product.toString());
            }
        }
        
        let userWishlistItems = [];
        if (req.session && req.session.userId) {
            const Wishlist = require('../models/wishlistModel');
            const wishlist = await Wishlist.findOne({ user: req.session.userId });
            if (wishlist) {
                userWishlistItems = wishlist.products.map(productId => productId.toString());
            }
        }
        
        const filteredProductCount = productsWithOffers.length;
        const totalPages = Math.ceil(filteredProductCount / limit);
        
        const validatedPage = page > totalPages && totalPages > 0 ? 1 : page;
        
        const startIndex = (validatedPage - 1) * limit;
        const paginatedProducts = productsWithOffers.slice(startIndex, startIndex + limit);
        
        res.render('products', {
            products: paginatedProducts,
            currentPage: validatedPage,
            totalPages: totalPages,
            totalProducts: filteredProductCount,
            categories,
            search,
            category: Array.isArray(category) ? category : (category ? [category] : []),
            minPrice,
            maxPrice,
            sort: sort || 'default',
            categoryNames,
            categoryName: categoryNames.join(', '), 
            userCartItems,
            userWishlistItems
        });
    } catch (err) {
        console.error('Error fetching products:', err);
        res.status(500).render('error', { 
            message: 'Error loading products. Please try again later.' 
        });
    }
};

exports.getProductById = async (req, res) => {
    try {
        const productId = req.params.id;
        
        const product = await Product.findOne({
            _id: productId,
            isActive: true
        }).populate('category', 'name');
        
        if (!product) {
            return res.status(404).render('error', { 
                message: 'Product not found or unavailable' 
            });
        }
        
        const [productWithOffer] = await applyBestOfferToProducts([product]);
        
        const relatedProducts = await Product.find({
            category: product.category._id,
            isActive: true,
            _id: { $ne: product._id }
        }).limit(4);
        
        const relatedProductsWithOffers = await applyBestOfferToProducts(relatedProducts);
        
        let cartHasProduct = false;
        if (req.session && req.session.userId) {
            const cart = await Cart.findOne({
                user: req.session.userId,
                'items.product': productId
            });
            cartHasProduct = !!cart;
        }
        
        let userWishlistItems = [];
        if (req.session && req.session.userId) {
            const Wishlist = require('../models/wishlistModel');
            const wishlist = await Wishlist.findOne({ user: req.session.userId });
            if (wishlist) {
                userWishlistItems = wishlist.products.map(productId => productId.toString());
            }
        }
        
        res.render('productdetails', {
            product: productWithOffer,
            relatedProducts: relatedProductsWithOffers,
            cartHasProduct,
            userWishlistItems
        });
    } catch (err) {
        console.error('Error fetching product:', err);
        res.status(500).render('error', { 
            message: 'Error loading product. Please try again later.' 
        });
    }
};

exports.getProductDetails = async (req, res) => {
    try {
        const productId = req.params.id;
        
        if (!mongoose.Types.ObjectId.isValid(productId)) {
            return res.status(400).render('error', {
                message: 'Invalid product ID',
                error: { status: 400 }
            });
        }
        
        const product = await Product.findById(productId)
            .populate('category', 'name')
            .lean();
        
        if (!product) {
            return res.status(404).render('error', {
                message: 'Product not found',
                error: { status: 404 }
            });
        }
        
        const [productWithOffer] = await applyBestOfferToProducts([product]);
        
        let cartHasProduct = false;
        if (req.session && req.session.userId) {
            const cart = await Cart.findOne({
                user: req.session.userId,
                'items.product': productId
            });
            cartHasProduct = !!cart;
        }
        
        let userWishlistItems = [];
        if (req.session && req.session.userId) {
            const Wishlist = require('../models/wishlistModel');
            const wishlist = await Wishlist.findOne({ user: req.session.userId });
            if (wishlist) {
                userWishlistItems = wishlist.products.map(productId => productId.toString());
            }
        }
        
        res.render('productdetails', {
            product: productWithOffer,
            title: product.title + ' | BookStore',
            user: req.user || null,
            userId: req.session ? req.session.userId : null,
            cartHasProduct,
            userWishlistItems
        });
    } catch (error) {
        console.error('Error fetching product details:', error);
        res.status(500).render('error', {
            message: 'Something went wrong',
            error: { status: 500 }
        });
    }
};