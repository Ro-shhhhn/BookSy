const express = require('express');
const router = express.Router();
const checkoutController = require('../controllers/checkoutcontroller');
const { isLoggedIn, isActiveUser } = require('../middleware/authMiddleware');
const offerMiddleware = require('../middleware/offerMiddleware');
const addressValidation = require('../middleware/addressValidation');

router.get('/checkout', isLoggedIn, isActiveUser, offerMiddleware.applyBestOffers, checkoutController.renderCheckoutPage);
router.post('/place-order', isLoggedIn, isActiveUser, checkoutController.placeOrder);
router.get('/order-success/:orderId', isLoggedIn, isActiveUser, checkoutController.orderSuccessPage);
router.get('/checkout/edit-address/:id', isLoggedIn, isActiveUser, checkoutController.renderEditAddressForCheckout);
router.post('/checkout/edit-address/:id', isLoggedIn, isActiveUser, addressValidation.validateAddress, checkoutController.saveAddressFromCheckout);
router.post('/checkout/set-default-address/:id', isLoggedIn, isActiveUser, checkoutController.setDefaultAddress);
// Add these routes to your routes file
router.post('/create-razorpay-order', isLoggedIn, isActiveUser, checkoutController.createRazorpayOrder);
router.post('/verify-payment', isLoggedIn, isActiveUser, checkoutController.verifyRazorpayPayment);
router.get('/order-failure/:orderId?', isLoggedIn, isActiveUser, checkoutController.orderFailurePage);
module.exports = router;