// routes/walletRoutes.js
const express = require('express');
const router = express.Router();
const walletController = require('../controllers/walletController');
const { isActiveUser,  isLoggedIn} = require('../middleware/authMiddleware'); // Assuming you have auth middleware

router.get('/', isActiveUser,  isLoggedIn, walletController.getWalletPage);
router.post('/use-payment', isActiveUser,  isLoggedIn, walletController.useWalletForPayment);

module.exports = router;