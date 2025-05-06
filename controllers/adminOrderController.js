const Order = require('../models/orderModel');
const User = require('../models/user');
const Wallet = require('../models/walletModel');
const ReturnRequest = require('../models/returnRequestModel');
const mongoose = require('mongoose');
const Product = require('../models/productModel');

exports.getAllOrders = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const sortBy = req.query.sortBy || 'createdAt';
        const sortOrder = req.query.sortOrder || 'desc';

        const filter = req.query.status ? { orderStatus: req.query.status } : {};

        const pipeline = [
            {
                $lookup: {
                    from: 'users',
                    localField: 'user',
                    foreignField: '_id',
                    as: 'userDetails'
                }
            },
            { $unwind: '$userDetails' },
            
            ...(filter.orderStatus ? [{ $match: { orderStatus: filter.orderStatus } }] : []),
            
            {
                $project: {
                    uniqueOrderId: 1,
                    totalAmount: '$total', 
                    orderStatus: 1,
                    createdAt: 1,
                    user: {
                        _id: '$userDetails._id',
                        name: '$userDetails.name',
                        email: '$userDetails.email'
                    }
                }
            },
            
            { $sort: { [sortBy]: sortOrder === 'asc' ? 1 : -1 } },
            
            { $skip: skip },
            { $limit: limit }
        ];

       
        const countPipeline = [
            ...pipeline.slice(0, -2),
            { $count: 'totalOrders' }
        ];

        const orders = await Order.aggregate(pipeline)
            .collation({ locale: 'en', strength: 2 });

        const countResult = await Order.aggregate(countPipeline);
        const totalOrders = countResult[0] ? countResult[0].totalOrders : 0;

        res.render('admin/orders', {
            orders,
            currentPage: page,
            totalPages: Math.ceil(totalOrders / limit),
            sortBy,
            sortOrder,
            selectedStatus: req.query.status || ''
        });
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).send('Error fetching orders: ' + error.message);
    }
};
exports.searchOrders = async (req, res) => {
    try {
        const searchTerm = req.query.search;
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const sortBy = req.query.sortBy || 'createdAt';
        const sortOrder = req.query.sortOrder || 'desc';

        const searchRegex = new RegExp(searchTerm, 'i');

        const pipeline = [
            {
                $lookup: {
                    from: 'users', 
                    localField: 'user',
                    foreignField: '_id',
                    as: 'userDetails'
                }
            },
            { $unwind: '$userDetails' },
            
            {
                $match: {
                    $or: [
                        { uniqueOrderId: searchRegex }, 
                        { 'userDetails.name': searchRegex }, 
                        { 'userDetails.email': searchRegex }, 
                        { orderStatus: searchRegex } 
                    ]
                }
            },
            
            {
                $project: {
                    uniqueOrderId: 1,
                    totalAmount: 1,
                    orderStatus: 1,
                    createdAt: 1,
                    user: {
                        _id: '$userDetails._id',
                        name: '$userDetails.name',
                        email: '$userDetails.email'
                    }
                }
            },
            { $sort: { [sortBy]: sortOrder === 'asc' ? 1 : -1 } },
            
            { $skip: skip },
            { $limit: limit }
        ];

        const countPipeline = [
            ...pipeline.slice(0, -2), 
            { $count: 'totalOrders' }
        ];

        const orders = await Order.aggregate(pipeline)
            .collation({ locale: 'en', strength: 2 }); 

        const countResult = await Order.aggregate(countPipeline);
        const totalOrders = countResult[0] ? countResult[0].totalOrders : 0;

        res.render('admin/orders', {
            orders,
            currentPage: page,
            totalPages: Math.ceil(totalOrders / limit),
            searchTerm,
            sortBy,
            sortOrder,
            selectedStatus: req.query.status || ''
        });
    } catch (error) {
        console.error('Error searching orders:', error);
        res.status(500).render('admin/error', { error: 'Failed to search orders' });
    }
};

exports.getOrderDetails = async (req, res) => {
    try {
        const order = await Order.findById(req.params.orderId)
            .populate('user')
            .populate({
                path: 'items.product',
                select: 'title images coverImage price discountPrice category' 
            });
        
        // Only try to populate shippingAddress if it exists
        if (order.shippingAddress) {
            await order.populate({
                path: 'shippingAddress',
                model: 'Address' 
            });
        }

        if (!order) {
            return res.status(404).render('admin/error', { error: 'Order not found' });
        }

        // Fetch active category offers for all products in the order
        const offerUtils = require('../utils/offerUtils');
        const categoryIds = [...new Set(order.items
            .filter(item => item.product && item.product.category)
            .map(item => item.product.category.toString()))];
        
        const categoryOffers = {};
        
        // Get all relevant active category offers
        for (const categoryId of categoryIds) {
            const offer = await offerUtils.getActiveCategoryOffer(categoryId);
            if (offer) {
                categoryOffers[categoryId] = offer;
            }
        }
        
        // Add discount source info to each order item
        for (const item of order.items) {
            if (!item.product) continue;
            
            // Get original price and discount info
            const productPrice = item.price;
            const productDiscountPrice = item.product.discountPrice || 0;
            
            // Check if there was a category offer applied
            let categoryOffer = null;
            if (item.product.category) {
                const categoryId = item.product.category.toString();
                categoryOffer = categoryOffers[categoryId];
            }
            
            // Calculate which offer was better and mark it
            const productDiscount = productDiscountPrice;
            const categoryDiscount = categoryOffer ? 
                Math.floor(productPrice * categoryOffer.discountPercentage / 100) : 0;
            
            // Add discount source info
            if (productDiscount > 0 || categoryDiscount > 0) {
                if (categoryDiscount > productDiscount) {
                    item.discountSource = 'category';
                    item.discountedPrice = categoryDiscount;
                    item.discountPercentage = categoryOffer.discountPercentage;
                } else if (productDiscount > 0) {
                    item.discountSource = 'product';
                    item.discountedPrice = productDiscount;
                    item.discountPercentage = Math.round((productDiscount / productPrice) * 100);
                }
            }
        }
        
        res.render('admin/order-details', { order });
    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).render('admin/error', { error: 'Failed to fetch order details' });
    }
};
exports.updateOrderStatus = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { orderStatus } = req.body;
        
        // First fetch the current order
        const order = await Order.findById(orderId);
        
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        // Define valid status transitions
        const statusFlow = {
            'Pending': ['Processing', 'Cancelled'],
            'Processing': ['Shipped', 'Cancelled'],
            'Shipped': ['Delivered', 'Cancelled'],
            'Delivered': ['Returned'], // Once delivered, can only be returned
            'Returned': [], // Terminal state
            'Cancelled': [] // Terminal state
        };
        
        // Check if the transition is valid
        if (!statusFlow[order.orderStatus].includes(orderStatus) && order.orderStatus !== orderStatus) {
            req.flash('error', `Cannot change order status from ${order.orderStatus} to ${orderStatus}`);
            return res.redirect('/admin/orders/details/' + orderId);
        }
        
        // If valid, update the status
        order.orderStatus = orderStatus;
        await order.save();
        
        req.flash('success', `Order status updated to ${orderStatus}`);
        res.redirect('/admin/orders/details/' + orderId);
    } catch (error) {
        console.error('Error updating order status:', error);
        res.status(500).render('admin/error', { error: 'Failed to update order status' });
    }
};
exports.processReturnRequest = async (req, res) => {
    try {
        const { returnRequestId, action, adminNotes } = req.body;

        const returnRequest = await ReturnRequest.findById(returnRequestId)
            .populate('order')
            .populate('user')
            .populate('products.product');

        if (!returnRequest) {
            return res.status(404).json({ 
                success: false, 
                message: 'Return request not found' 
            });
        }

        const order = returnRequest.order;

        if (action === 'approve') {
            returnRequest.status = 'Approved';
            returnRequest.adminNotes = adminNotes;
            await returnRequest.save();
        
            let refundAmount = 0;
            
            if (returnRequest.products && returnRequest.products.length > 0) {
                for (const returnItem of returnRequest.products) {
                    const orderItem = order.items.find(item => 
                        item.product.toString() === returnItem.product._id.toString()
                    );
                    
                    if (orderItem) {
                        refundAmount += orderItem.price * returnItem.quantity;
                        
                        orderItem.returnStatus = 'Approved';
                        
                        await Product.findByIdAndUpdate(returnItem.product._id, {
                            $inc: { stock: returnItem.quantity }
                        });
                    }
                }
                
                order.calculateOrderStatus();
                await order.save();
            } else {
                refundAmount = order.total;
                
                order.orderStatus = 'Returned';
                order.returnStatus = 'Approved';
                
                for (const item of order.items) {
                    await Product.findByIdAndUpdate(item.product, {
                        $inc: { stock: item.quantity }
                    });
                    
                    item.returnStatus = 'Approved';
                }
                
                await order.save();
            }
            
            if (refundAmount > 0) {
                let wallet = await Wallet.findOne({ user: order.user });
                if (!wallet) {
                    wallet = new Wallet({
                        user: order.user,
                        balance: 0
                    });
                }
                
                await wallet.credit(
                    refundAmount,
                    `Refund for returned order #${order.uniqueOrderId}`,
                    order._id
                );
            }

            req.flash('success', 'Return request approved successfully');
        } else {
            returnRequest.status = 'Rejected';
            returnRequest.adminNotes = adminNotes;
            await returnRequest.save();
            
            if (returnRequest.products && returnRequest.products.length > 0) {
                const returnedProductIds = returnRequest.products.map(item => 
                    item.product._id.toString()
                );
                
                for (let item of order.items) {
                    if (returnedProductIds.includes(item.product.toString())) {
                        item.returnStatus = 'Rejected';
                    }
                }
                
                await order.save();
            } else {
                order.returnStatus = 'Rejected';
                await order.save();
            }

            req.flash('error', 'Return request rejected');
        }

        res.redirect('/admin/return-requests');
    } catch (error) {
        console.error('Error processing return request:', error);
        
        res.status(500).send(`
            <html>
                <body>
                    <h1>Error Processing Return Request</h1>
                    <p>${error.message}</p>
                    <a href="/admin/return-requests">Back to Return Requests</a>
                </body>
            </html>
        `);
    }
};
exports.getReturnRequests = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const totalReturnRequests = await ReturnRequest.countDocuments();
        const returnRequests = await ReturnRequest.find()
            .populate({
                path: 'order',
                populate: { path: 'items.product' }
            })
            .populate('user')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .exec();

            const validReturnRequests = returnRequests.filter(request => request.order !== null);


            res.render('admin/return-requests', { 
                returnRequests: validReturnRequests,
                currentPage: page,
                totalPages: Math.ceil(totalReturnRequests / limit)
        });
    } catch (error) {
        console.error('Error fetching return requests:', error);
        res.status(500).render('error', { 
            message: 'Failed to fetch return requests', 
            error: error.message 
        });
    }
};
exports.verifyReturnRequest = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { orderId } = req.params;
        const { returnStatus } = req.body; 

        const order = await Order.findById(orderId).populate('user');
        if (!order) {
            await session.abortTransaction();
            session.endSession();
            return res.status(404).render('admin/error', { error: 'Order not found' });
        }

        if (!order.returnRequested) {
            await session.abortTransaction();
            session.endSession();
            return res.status(400).render('admin/error', { error: 'No return request exists for this order' });
        }

        if (returnStatus === 'approved') {
            let wallet = await Wallet.findOne({ user: order.user._id });
            if (!wallet) {
                wallet = new Wallet({ 
                    user: order.user._id,
                    balance: 0 
                });
            }

            await wallet.credit(
                order.totalAmount, 
                `Refund for Order ${order.orderNumber}`, 
                order._id
            );

            order.status = 'returned';
            order.returnApproved = true;
            order.returnProcessedAt = new Date();
            await order.save();

            req.flash('success', 'Return request approved. Amount refunded to user wallet.');
        } else {
            order.returnApproved = false;
            order.returnRejectedReason = req.body.rejectionReason || 'Return request does not meet criteria';
            await order.save();

            req.flash('error', 'Return request rejected');
        }

        await session.commitTransaction();
        session.endSession();

        res.redirect('/admin/orders/details/' + orderId);
    } catch (error) {
        await session.abortTransaction();
        session.endSession();

        console.error('Error processing return request:', error);
        res.status(500).render('admin/error', { 
            error: 'Failed to process return request', 
            details: error.message 
        });
    }
};