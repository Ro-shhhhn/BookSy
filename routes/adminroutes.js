const express = require('express');
const router = express.Router();
const adminController = require('../controllers/admincontroller');
const adminAuth = require('../middleware/adminauth');
const multer = require('multer');
const path = require('path');
const Category = require('../models/categoryModel');
const adminusercontroller = require('../controllers/adminusercontroller');
const adminOrderController = require('../controllers/adminOrderController');
const orderController = require('../controllers/orderController');
const couponController = require('../controllers/couponController');
const walletController = require('../controllers/walletController');
const salesReportController = require('../controllers/salesReportController');
const categoryOfferController = require('../controllers/categoryOfferController');
const adminDashboardController = require('../controllers/adminDashboardController');
const adminWalletController = require('../controllers/adminWalletController');
// Multer Configuration
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 8 
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
        cb(null, true);
    } else {
        cb(new Error('Only image files are allowed!'), false);
    }
  }
});
router.get('/login', adminController.loginPage);
router.post('/login', adminController.login);
router.get('/logout', adminController.logout);
router.get('/forgot-password', adminController.forgotPasswordPage);

router.use(adminAuth.isAdminAuthenticated);

// Dashboard
router.get('/dashboard', adminController.dashboard);

// User Management
router.get('/users', adminusercontroller.getAllUsers);
router.post('/users/block/:id', adminusercontroller.blockUser);
router.post('/users/unblock/:id', adminusercontroller.unblockUser);

// Product Management
router.get('/products', adminController.getAllProducts);
router.get('/products/add', adminController.getAddProductPage);

// Unlist/List Product
router.post('/products/unlist/:id', adminController.unlistProduct);
router.post('/products/list/:id', adminController.listProduct);

router.get('/products/edit/:id', adminController.getEditProductPage);

router.post('/products/edit/:id', 
  upload.fields([
    { name: 'productImages', maxCount: 4 },
    { name: 'croppedImages', maxCount: 4 }
  ]),
  adminController.updateProduct
);

router.post('/products/add', 
  upload.fields([
    { name: 'productImages', maxCount: 4 },
    { name: 'croppedImages', maxCount: 4 }
  ]),
  adminController.addProduct
);
// Category Management
router.get('/category', adminController.getAllCategories);
router.get('/category/add', (req, res) => res.render('admin/categoryadd'));
router.post('/category/add', adminController.addCategory);
router.get('/category/edit/:id', async (req, res) => {
  try {
    const category = await Category.findById(req.params.id);
    res.render('admin/categoryedit', { category });
  } catch (error) {
    res.redirect('/admin/category');
  }
});
router.post('/category/edit/:id', adminController.editCategory);
router.post('/category/list/:id', adminController.toggleCategoryStatus);
router.post('/category/unlist/:id', adminController.toggleCategoryStatus);


// Order Management Routes
router.get('/orders', adminOrderController.getAllOrders);
router.get('/orders/search', adminOrderController.searchOrders);
router.get('/orders/details/:orderId', adminOrderController.getOrderDetails);
router.post('/orders/status/:orderId', adminOrderController.updateOrderStatus);
router.post('/orders/return-verify/:orderId', adminOrderController.verifyReturnRequest);
router.get('/return-requests', adminOrderController.getReturnRequests);
router.post('/return-requests/process', adminOrderController.processReturnRequest);
router.post('/orders/:orderId/refund', walletController.processRefund);
router.put('/orders/:orderId/status', orderController.updateOrderStatus);


// In adminroutes.js - Updated coupon routes
router.get('/coupons', couponController.getAllCoupons);
router.get('/coupons/add', couponController.getAddCoupon);
router.post('/coupons/add', couponController.createCoupon);
router.get('/coupons/edit/:couponId', couponController.getEditCoupon);
router.post('/coupons/update/:couponId', couponController.updateCoupon);
router.put('/coupons/toggle/:couponId', couponController.toggleCouponStatus);
router.delete('/coupons/delete/:couponId', couponController.deleteCoupon);

// Sales Report Routes (add these to your existing routes)
router.get('/sales-report', salesReportController.getSalesReport);
router.get('/sales-report/download-pdf', salesReportController.downloadPdf);
router.get('/sales-report/download-excel', salesReportController.downloadExcel);

// Category Offer routes
router.get('/category-offers', categoryOfferController.getAllCategoryOffers);
router.get('/category-offers/add', categoryOfferController.getAddCategoryOfferPage);
router.post('/category-offers/add', categoryOfferController.addCategoryOffer);
router.get('/category-offers/edit/:id', categoryOfferController.getEditCategoryOfferPage);
router.post('/category-offers/edit/:id', categoryOfferController.updateCategoryOffer);
router.delete('/category-offers/:id', categoryOfferController.deleteCategoryOffer);
router.patch('/category-offers/:id/toggle-status', categoryOfferController.toggleCategoryOfferStatus);

router.get('/api/dashboard-data', adminDashboardController.getDashboardData);
router.get('/wallet/transactions', adminWalletController.getAllTransactions);
router.get('/wallet/transactions/search', adminWalletController.searchTransactions);
router.get('/wallet/transactions/:transactionId', adminWalletController.getTransactionDetails);


module.exports = router;