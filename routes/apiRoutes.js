const express = require('express');
const router = express.Router();
const couponApiController = require('../controllers/api/couponApiController');
const authMiddleware = require('../middleware/authMiddleware');

router.post('/validate', authMiddleware.checkUserAndRedirect, couponApiController.validateCoupon);
router.delete('/remove', authMiddleware.checkUserAndRedirect, couponApiController.removeCoupon);

module.exports = router;

