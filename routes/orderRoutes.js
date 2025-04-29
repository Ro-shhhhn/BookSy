const express = require('express');
const router = express.Router();
const orderController = require('../controllers/orderController');
const { isActiveUser } = require('../middleware/authMiddleware');

router.get('/orders', isActiveUser, orderController.getOrderListPage);

router.get('/orders/:orderId', isActiveUser, orderController.getOrderDetailsPage);

router.get('/orders/:orderId/cancel', isActiveUser, orderController.cancelOrder);

router.post('/orders/:orderId/cancel-product', isActiveUser, orderController.cancelOrderProduct);

router.post('/orders/:orderId/return', isActiveUser, orderController.createReturnRequest);
router.post('/orders/:orderId/cancel-shipped', orderController.cancelShippedOrder);

router.get('/orders/:orderId/invoice', isActiveUser, orderController.downloadInvoice);
router.post('/orders/:orderId/return-products', isActiveUser, orderController.createReturnRequestForProducts);
module.exports = router;