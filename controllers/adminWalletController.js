const Wallet = require('../models/walletModel');
const User = require('../models/user');
const Order = require('../models/orderModel');
const mongoose = require('mongoose');

exports.getAllTransactions = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const sortBy = req.query.sortBy || 'date';
        const sortOrder = req.query.sortOrder || 'desc';

        const pipeline = [
            { $unwind: '$transactions' },
            
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
                $project: {
                    _id: 0,
                    transactionId: '$transactions._id',
                    user: {
                        _id: '$userDetails._id',
                        name: '$userDetails.name',
                        email: '$userDetails.email'
                    },
                    type: '$transactions.type',
                    amount: '$transactions.amount',
                    description: '$transactions.description',
                    date: '$transactions.date',
                    orderId: '$transactions.orderId'
                }
            },
            
            { $sort: { [sortBy]: sortOrder === 'asc' ? 1 : -1 } },
            
            // Pagination
            { $skip: skip },
            { $limit: limit }
        ];

        const transactions = await Wallet.aggregate(pipeline);
        
        const countPipeline = [
            { $unwind: '$transactions' },
            { $count: 'totalTransactions' }
        ];
        
        const countResult = await Wallet.aggregate(countPipeline);
        const totalTransactions = countResult[0] ? countResult[0].totalTransactions : 0;

        res.render('admin/wallet-transactions', {
            transactions,
            currentPage: page,
            totalPages: Math.ceil(totalTransactions / limit),
            sortBy,
            sortOrder
        });
    } catch (error) {
        console.error('Error fetching wallet transactions:', error);
        res.status(500).render('error', { 
            error: 'Failed to fetch wallet transactions', 
            details: error.message 
        });
    }
};

exports.getTransactionDetails = async (req, res) => {
    try {
        const { transactionId } = req.params;
        
        const wallet = await Wallet.findOne({
            'transactions._id': transactionId
        }).populate('user');
        
        if (!wallet) {
            return res.status(404).render('error', { error: 'Transaction not found' });
        }
        
        const transaction = wallet.transactions.find(
            t => t._id.toString() === transactionId
        );
        
        if (!transaction) {
            return res.status(404).render('error', { error: 'Transaction not found' });
        }
        
        let order = null;
        if (transaction.orderId) {
            order = await Order.findById(transaction.orderId)
                .populate('items.product');
        }
        
        res.render('admin/transaction-details', {
            transaction,
            user: wallet.user,
            order
        });
    } catch (error) {
        console.error('Error fetching transaction details:', error);
        res.status(500).render('error', { 
            message: 'Failed to fetch transaction details: ' + error.message
        });
    }
};

exports.searchTransactions = async (req, res) => {
    try {
        const searchTerm = req.query.search;
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const sortBy = req.query.sortBy || 'date';
        const sortOrder = req.query.sortOrder || 'desc';

        const pipeline = [
            { $unwind: '$transactions' },
            
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
                        { 'transactions.description': new RegExp(searchTerm, 'i') },
                        { 'userDetails.name': new RegExp(searchTerm, 'i') },
                        { 'userDetails.email': new RegExp(searchTerm, 'i') }
                    ]
                }
            },
            
            {
                $project: {
                    _id: 0,
                    transactionId: '$transactions._id',
                    user: {
                        _id: '$userDetails._id',
                        name: '$userDetails.name',
                        email: '$userDetails.email'
                    },
                    type: '$transactions.type',
                    amount: '$transactions.amount',
                    description: '$transactions.description',
                    date: '$transactions.date',
                    orderId: '$transactions.orderId'
                }
            },
            
            { $sort: { [sortBy]: sortOrder === 'asc' ? 1 : -1 } },
            
          
            { $skip: skip },
            { $limit: limit }
        ];

       
        const transactions = await Wallet.aggregate(pipeline);
        
        // pagination
        const countPipeline = [
            { $unwind: '$transactions' },
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
                        { 'transactions.description': new RegExp(searchTerm, 'i') },
                        { 'userDetails.name': new RegExp(searchTerm, 'i') },
                        { 'userDetails.email': new RegExp(searchTerm, 'i') }
                    ]
                }
            },
            { $count: 'totalTransactions' }
        ];
        
        const countResult = await Wallet.aggregate(countPipeline);
        const totalTransactions = countResult[0] ? countResult[0].totalTransactions : 0;

        res.render('admin/wallet-transactions', {
            transactions,
            currentPage: page,
            totalPages: Math.ceil(totalTransactions / limit),
            searchTerm,
            sortBy,
            sortOrder
        });
    } catch (error) {
        console.error('Error searching wallet transactions:', error);
        res.status(500).render('error', { 
            error: 'Failed to search wallet transactions', 
            details: error.message 
        });
    }
};