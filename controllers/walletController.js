const Wallet = require('../models/walletModel');
const User = require('../models/user');
const Order = require('../models/orderModel');

exports.getWalletPage = async (req, res) => {
    try {
        let wallet = await Wallet.findOne({ user: req.session.userId });
        
        if (!wallet) {
            wallet = new Wallet({
                user: req.session.userId,
                balance: 0,
                transactions: []
            });
            await wallet.save();
        }
        
        const user = await User.findById(req.session.userId);
        
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;
        
        const totalTransactions = wallet.transactions.length;
        
        
        const transactions = wallet.transactions
            .sort((a, b) => new Date(b.date) - new Date(a.date))
            .slice(skip, skip + limit);
        
        res.render('user/wallet', {
            wallet,
            user,
            transactions,
            currentPage: page,
            totalPages: Math.ceil(totalTransactions / limit),
            successMessage: req.flash('success'),
            errorMessage: req.flash('error')
        });
    } catch (error) {
        console.error('Error fetching wallet:', error);
        res.status(500).render('error', {
            message: 'Failed to fetch wallet details',
            error: error.message
        });
    }
};

exports.useWalletForPayment = async (req, res) => {
    try {
        const { amount, orderId } = req.body;
        
        const wallet = await Wallet.findOne({ user: req.session.userId });
        if (!wallet) {
            return res.status(404).json({
                success: false,
                message: 'Wallet not found'
            });
        }
        
        const amountToUse = parseFloat(amount);
        
        if (wallet.balance < amountToUse) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient wallet balance'
            });
        }
        
        await wallet.debit(
            amountToUse,
            `Payment for Order #${orderId}`,
            orderId
        );
        
        res.status(200).json({
            success: true,
            message: 'Payment processed successfully using wallet',
            remainingBalance: wallet.balance
        });
    } catch (error) {
        console.error('Error processing wallet payment:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to process payment',
            error: error.message
        });
    }
};

exports.processRefund = async (req, res) => {
    try {
        const { orderId, refundAmount, reason } = req.body;
        
        const order = await Order.findById(orderId).populate('user');
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        let wallet = await Wallet.findOne({ user: order.user._id });
        if (!wallet) {
            wallet = new Wallet({
                user: order.user._id,
                balance: 0
            });
        }
        
        await wallet.credit(
            parseFloat(refundAmount),
            reason || `Refund for Order #${order.uniqueOrderId}`,
            order._id
        );
        
        req.flash('success', `Refund of ${refundAmount} successfully processed to user's wallet`);
        res.redirect('/admin/orders/details/' + orderId);
    } catch (error) {
        console.error('Error processing refund:', error);
        req.flash('error', 'Failed to process refund');
        res.redirect('/admin/orders');
    }
};