const express = require('express');
const router = express.Router();
const cartController = require('../controllers/cartController');
const authMiddleware = require('../middleware/authMiddleware');
const offerMiddleware = require('../middleware/offerMiddleware');

router.post('/add', authMiddleware.checkUserAndRedirect, cartController.addToCart);

router.use(authMiddleware.isActiveUser);

router.get('/', cartController.getCart);


router.post('/validate', cartController.validateCartForCheckout);

router.post('/update', cartController.updateCartItem, offerMiddleware.applyBestOffers);

router.post('/remove', cartController.removeCartItem);

module.exports = router;