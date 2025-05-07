const express = require('express');
const router = express.Router();
const wishlistController = require('../controllers/wishlistController');
const { isLoggedIn } = require('../middleware/authMiddleware'); 

router.get('/', isLoggedIn, wishlistController.getWishlist);

router.post('/add', wishlistController.addToWishlist);

router.post('/remove', wishlistController.removeFromWishlist);

router.post('/toggle', wishlistController.toggleWishlist);

module.exports = router;