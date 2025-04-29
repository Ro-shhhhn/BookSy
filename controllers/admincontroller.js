const User = require('../models/user');
const Admin = require('../models/adminuser');
const Product = require('../models/productModel');
const Category = require('../models/categoryModel');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const mongoose = require('mongoose');
const Order = require('../models/orderModel');

exports.loginPage = (req, res) => {
    res.render('admin/login', { error: null });
};

exports.login = async (req, res) => {
    try {
        const { email, password, remember } = req.body;
        const admin = await Admin.findOne({ email });

        if (!admin || !(await admin.comparePassword(password))) {
            return res.render('admin/login', { 
                error: 'Invalid email or password' 
            });
        }

        admin.lastLogin = new Date();
        await admin.save();

        req.session.admin = {
            id: admin._id,
            email: admin.email,
            name: admin.name,
            role: admin.role
        };

        if (remember) {
            req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000;
        }

        res.redirect('/admin/dashboard');
    } catch (error) {
        console.error('Login error:', error);
        res.render('admin/login', { 
            error: 'An error occurred during login' 
        });
    }
};

exports.logout = (req, res) => {
    req.session.admin = null;
    res.redirect('/admin/login');
};

exports.forgotPasswordPage = (req, res) => {
    res.render('admin/forgot-password', { error: null, success: null });
};


exports.dashboard = (req, res) => {
    const orders = []; 
    res.render('admin/dashboard', { 
        orders,
        pageTitle: 'Admin Dashboard',
        path: '/admin/dashboard'
    });
};



exports.getAddProductPage = async (req, res) => {
    try {
        const categories = await Category.find({ status: true });
        res.render('admin/addproduct', { 
            categories,
            isEdit: false, 
            product: null, 
            error: null 
        });
    } catch (error) {
        res.status(500).render('error', { message: 'Server error' });
    }
};


exports.addProduct = async (req, res) => {
    try {
        const { productName, author, description, category, price, discountPrice, stockCount, language } = req.body;
        const croppedImages = req.files['croppedImages'] || [];
        
        if (croppedImages.length === 0) {
            return res.status(400).json({ error: 'At least one image is required' });
        }

        // Check if a product with the same title already exists
        const existingProduct = await Product.findOne({ title: productName.trim() });
        if (existingProduct) {
            return res.status(400).json({ 
                error: 'A product with this name already exists. Please use a different name.' 
            });
        }

        const imagePaths = [];
        await Promise.all(croppedImages.map(async (file, index) => {
            try {
                const filename = `product-${Date.now()}-${index}.jpg`;
                const outputPath = path.join(__dirname, '../public/uploads/products', filename);

                await sharp(file.buffer)
                    .resize(800, 1000, { fit: 'cover' })
                    .jpeg({ quality: 80 })
                    .toFile(outputPath);

                imagePaths.push(`/uploads/products/${filename}`);
            } catch (imageError) {
                console.error(`Image processing error: ${imageError.message}`);
                throw new Error(`Failed to process image ${index + 1}`);
            }
        }));

        const newProduct = new Product({
            title: productName.trim(),
            author: author.trim(),
            description: description.trim(),
            category: category,
            price: parseFloat(price),
            discountPrice: parseFloat(discountPrice) || 0, 
            stock: parseInt(stockCount),
            language: language.toLowerCase(),
            images: imagePaths,
            coverImage: imagePaths[0],
            isActive: true
        });

        await newProduct.save();
        res.status(201).json({ success: true });

    } catch (error) {
        console.error('Product addition error:', error.message);
        res.status(500).json({
            error: error.message || 'Failed to add product'
        });
    }
};
exports.getAllProducts = async (req, res) => {
    try {
        const sortOption = req.query.sort || 'newest';
        const successMessage = req.query.success;
        
        let sortConfig = {};
        
        switch(sortOption) {
            case 'oldest':
                sortConfig = { createdAt: 1 };
                break;
            case 'newest':
                sortConfig = { createdAt: -1 };
                break;
            case 'nameAZ':
                sortConfig = { title: 1 };
                break;
            case 'nameZA':
                sortConfig = { title: -1 };
                break;
            default:
                sortConfig = { createdAt: -1 }; 
        }
        
        const products = await Product.find()
            .populate('category', 'name')
            .sort(sortConfig);
        
        res.render('admin/productmanage', { 
            products: products.map(p => ({
                ...p._doc,
                categoryName: p.category?.name || 'Uncategorized' 
            })),
            currentSort: sortOption,
            success: successMessage // Pass success message to template
        });
    } catch (error) {
        console.error('Error fetching products:', error);
        res.status(500).render('error', { message: 'Server error' });
    }
};

exports.listProduct = async (req, res) => {
    try {
        await Product.findByIdAndUpdate(req.params.id, { isActive: true });
        
       
        const sortParam = req.query.sort ? `?sort=${req.query.sort}` : '';
        res.redirect(`/admin/products${sortParam}`);
    } catch (error) {
        console.error('List error:', error);
        res.status(500).redirect('/admin/products');
    }
};

exports.unlistProduct = async (req, res) => {
    try {
        await Product.findByIdAndUpdate(req.params.id, { isActive: false });
        
        const sortParam = req.query.sort ? `?sort=${req.query.sort}` : '';
        res.redirect(`/admin/products${sortParam}`);
    } catch (error) {
        console.error('Unlist error:', error);
        res.status(500).redirect('/admin/products');
    }
};



exports.getAllCategories = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;
        const searchQuery = req.query.search || '';
        const sortOption = req.query.sort || 'newest'; 
        
        let query = {};
        if (searchQuery) {
            query = {
                $or: [
                    { name: { $regex: searchQuery, $options: 'i' } },
                    { description: { $regex: searchQuery, $options: 'i' } }
                ]
            };
        }
        
        let sortConfig = {};
        
        switch(sortOption) {
            case 'oldest':
                sortConfig = { createdAt: 1 };
                break;
            case 'newest':
                sortConfig = { createdAt: -1 };
                break;
            case 'nameAZ':
                sortConfig = { name: 1 };
                break;
            case 'nameZA':
                sortConfig = { name: -1 };
                break;
            default:
                sortConfig = { createdAt: -1 }; 
        }

        const [categories, totalCategories] = await Promise.all([
            Category.find(query)
                .sort(sortConfig)
                .skip(skip)
                .limit(limit),
            Category.countDocuments(query)
        ]);

        const totalPages = Math.ceil(totalCategories / limit);

        res.render('admin/category', {
            categories,
            currentPage: page,
            totalPages,
            totalCategories,
            limit,
            searchQuery,
            currentSort: sortOption 
        });
    } catch (error) {
        console.error('Category search error:', error);
        res.status(500).render('error', { message: 'Search failed' });
    }
};
exports.addCategory = async (req, res) => {
    try {
        const { name, description } = req.body;
        const newCategory = new Category({
            name: name.trim().toLowerCase(),
            description,
            status: true
        });
        await newCategory.save();
        res.redirect('/admin/category');
    } catch (error) {
        res.render('admin/categoryadd', { 
            error: error.code === 11000 ? 'Category already exists' : 'Error adding category'
        });
    }
};

exports.editCategory = async (req, res) => {
    try {
        const { name, description } = req.body;
        await Category.findByIdAndUpdate(
            req.params.id,
            { name: name.trim().toLowerCase(), description },
            { new: true, runValidators: true }
        );
        res.redirect('/admin/category');
    } catch (error) {
        res.render('admin/categoryedit', { 
            error: error.code === 11000 ? 'Category already exists' : 'Error updating category',
            category: req.body
        });
    }
};

exports.toggleCategoryStatus = async (req, res) => {
    try {
        const category = await Category.findById(req.params.id);
        category.status = !category.status;
        await category.save();
        res.redirect('/admin/category');
    } catch (error) {
        console.error('Toggle status error:', error);
        res.status(500).redirect('/admin/category');
    }
};

exports.buildCategoryUrl = (queryParams) => {
    const params = [];
    if (queryParams.page) params.push(`page=${queryParams.page}`);
    if (queryParams.search) params.push(`search=${queryParams.search}`);
    if (queryParams.sort) params.push(`sort=${queryParams.sort}`);
    return '/admin/category' + (params.length ? `?${params.join('&')}` : '');
};

buildRedirectUrl = (queryParams) => {
    const params = [];
    if (queryParams.page) params.push(`page=${queryParams.page}`);
    if (queryParams.search) params.push(`search=${queryParams.search}`);
    if (queryParams.sort) params.push(`sort=${queryParams.sort}`);
    return '/admin/users' + (params.length ? `?${params.join('&')}` : '');
};

handleUserError = (res, error) => {
    console.error('User operation error:', error);
    res.status(500).render('error', { message: 'Server error' });
};

handleProductError = (res, error) => {
    console.error('Product operation error:', error);
    res.status(500).redirect('/admin/products');
};


exports.getEditProductPage = async (req, res) => {
    try {
        const productId = req.params.id;
        const product = await Product.findById(productId);
        const categories = await Category.find({ status: true }); 
        
        if (!product) return res.redirect('/admin/products');
        
        res.render('admin/addproduct', { 
            isEdit: true, 
            product, 
            categories
        });
    } catch (error) {
        console.error('Error loading edit product page:', error);
        res.status(500).render('error', { message: 'Server error' });
    }
};
exports.updateProduct = async (req, res) => {
    try {
        const productId = req.params.id;
        const { productName, category, price, discountPrice, description, language, author, stockCount, imageIdsToKeep } = req.body;
        
        if (!productName || productName.trim() === '') {
            return res.status(400).json({ error: 'Book title is required' });
        }
        
        // Get current product
        const currentProduct = await Product.findById(productId);
        if (!currentProduct) {
            return res.status(404).json({ error: 'Product not found' });
        }
        
        // Check for duplicate product name, excluding the current product
        const existingProduct = await Product.findOne({ 
            title: productName.trim(),
            _id: { $ne: productId } // Exclude the current product
        });
        
        if (existingProduct) {
            return res.status(400).json({ 
                error: 'A product with this name already exists. Please use a different name.' 
            });
        }
        
        // Handle keeping existing images
        let imagesToKeep = [];
        if (imageIdsToKeep) {
            const keepIndices = imageIdsToKeep.split(',').map(id => parseInt(id));
            imagesToKeep = keepIndices.map(index => currentProduct.images[index]).filter(img => img);
        }
        
        // Process new and cropped images
        let newImagePaths = [];
        if (req.files && req.files.croppedImages && req.files.croppedImages.length > 0) {
            await Promise.all(req.files.croppedImages.map(async (file) => {
                const filename = `product-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.jpg`;
                const outputPath = path.join(__dirname, '../public/uploads/products', filename);
                
                await sharp(file.buffer)
                    .resize(800, 1000, { fit: 'cover' })
                    .jpeg({ quality: 80 })
                    .toFile(outputPath);
                
                newImagePaths.push(`/uploads/products/${filename}`);
            }));
        }
        
        // Combine kept images and new images
        const allImages = [...imagesToKeep, ...newImagePaths];
        
        if (allImages.length === 0) {
            return res.status(400).json({ error: 'At least one product image is required' });
        }
        
        // Update product
        await Product.findByIdAndUpdate(productId, {
            title: productName.trim(),  
            category,
            price: parseFloat(price),
            discountPrice: parseFloat(discountPrice) || 0, 
            description,
            language,
            author,
            stock: parseInt(stockCount),
            images: allImages,
            coverImage: allImages[0] // Use first image as cover
        }, { runValidators: true });  
        
        res.json({ success: true });
        
    } catch (error) {
        console.error('Update error:', error);
        res.status(500).json({ error: error.message || 'Server error' });
    }
};

exports.dashboard = async (req, res) => {
    try {
        const totalUsers = await mongoose.model('user').countDocuments();
        const totalOrders = await Order.countDocuments();
        const totalProducts = await Product.countDocuments();
        const pendingOrders = await Order.countDocuments({ orderStatus: 'Pending' });
        
        const revenueData = await Order.aggregate([
            {
                $match: {
                    paymentStatus: 'paid'
                }
            },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: '$total' }
                }
            }
        ]);
        
        const totalRevenue = revenueData.length > 0 ? revenueData[0].totalRevenue : 0;
        
        res.render('admin/dashboard', {
            title: 'Admin Dashboard',
            stats: {
                totalUsers,
                totalOrders,
                totalProducts,
                pendingOrders,
                totalRevenue
            }
        });
    } catch (error) {
        console.error('Dashboard error:', error);
        res.status(500).render('error', { 
            message: 'Error loading dashboard', 
            error 
        });
    }
};