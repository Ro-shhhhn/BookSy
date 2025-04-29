const Order = require('../models/orderModel');
const Product = require('../models/productModel');
const Category = require('../models/categoryModel');
const mongoose = require('mongoose');

exports.getDashboardData = async (req, res) => {
    try {
        const timeFilter = req.query.timeFilter || 'monthly'; 
        
        const dateRange = getDateRange(timeFilter);
        
        const totalUsers = await mongoose.model('user').countDocuments();
        const totalOrders = await Order.countDocuments();
        const totalSales = await getTotalSales(dateRange);
        const pendingOrders = await Order.countDocuments({ orderStatus: 'Pending' });
        
        const topProducts = await getTopProducts(dateRange);
        const topCategories = await getTopCategories(dateRange);
        const salesData = await getSalesData(timeFilter);
        
        res.json({
            stats: {
                totalUsers,
                totalOrders,
                totalSales,
                pendingOrders
            },
            topProducts,
            topCategories,
            salesData
        });
    } catch (error) {
        console.error('Dashboard data error:', error);
        res.status(500).json({ error: 'Failed to fetch dashboard data' });
    }
};

function getDateRange(timeFilter) {
    const now = new Date();
    let startDate = new Date();
    
    switch(timeFilter) {
        case 'daily':
            startDate.setHours(0, 0, 0, 0);
            break;
        case 'weekly':
            startDate.setDate(now.getDate() - 7);
            break;
        case 'monthly':
            startDate.setMonth(now.getMonth() - 1);
            break;
        case 'yearly':
            startDate.setFullYear(now.getFullYear() - 1);
            break;
        default:
            startDate.setMonth(now.getMonth() - 1); 
    }
    
    return { startDate, endDate: now };
}

async function getTotalSales(dateRange) {
    const result = await Order.aggregate([
        {
            $match: {
                createdAt: { $gte: dateRange.startDate, $lte: dateRange.endDate },
                paymentStatus: 'paid'
            }
        },
        {
            $group: {
                _id: null,
                totalSales: { $sum: '$total' }
            }
        }
    ]);
    
    return result.length > 0 ? result[0].totalSales : 0;
}

async function getTopProducts(dateRange) {
    return Order.aggregate([
        {
            $match: {
                orderStatus: { $nin: ['Cancelled'] } 
            }
        },
        { $unwind: '$items' },
        {
            $group: {
                _id: '$items.product',
                totalSold: { $sum: '$items.quantity' },
                totalRevenue: { $sum: '$items.total' }
            }
        },
        {
            $lookup: {
                from: 'products',
                localField: '_id',
                foreignField: '_id',
                as: 'productDetails'
            }
        },
        { $unwind: '$productDetails' },
        {
            $project: {
                _id: 1,
                title: '$productDetails.title',
                author: '$productDetails.author',
                totalSold: 1,
                totalRevenue: 1,
                coverImage: '$productDetails.coverImage'
            }
        },
        { $sort: { totalSold: -1 } },
        { $limit: 10 }
    ]);
}

async function getTopCategories(dateRange) {
    return Order.aggregate([
        {
            $match: {
                orderStatus: { $nin: ['Cancelled'] } 
            }
        },
        { $unwind: '$items' },
        {
            $lookup: {
                from: 'products',
                localField: 'items.product',
                foreignField: '_id',
                as: 'product'
            }
        },
        { $unwind: '$product' },
        {
            $group: {
                _id: '$product.category',
                totalSold: { $sum: '$items.quantity' },
                totalRevenue: { $sum: '$items.total' }
            }
        },
        {
            $lookup: {
                from: 'categories',
                localField: '_id',
                foreignField: '_id',
                as: 'categoryDetails'
            }
        },
        { $unwind: '$categoryDetails' },
        {
            $project: {
                _id: 1,
                name: '$categoryDetails.name',
                totalSold: 1,
                totalRevenue: 1
            }
        },
        { $sort: { totalSold: -1 } },
        { $limit: 10 }
    ]);
}

async function getSalesData(timeFilter) {
    const groupFormat = {
        daily: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        weekly: { $week: '$createdAt' },
        monthly: { $dateToString: { format: '%Y-%m', date: '$createdAt' } },
        yearly: { $year: '$createdAt' }
    };
    
    const labelFormat = {
        daily: '%b %d',
        weekly: 'Week %d',
        monthly: '%b %Y',
        yearly: '%Y'
    };
    
    let dateRange;
    let limit;
    const now = new Date();
    
    switch(timeFilter) {
        case 'daily':
            dateRange = new Date(now);
            dateRange.setDate(now.getDate() - 30); 
            limit = 30;
            break;
        case 'weekly':
            dateRange = new Date(now);
            dateRange.setDate(now.getDate() - (7 * 12)); 
            limit = 12;
            break;
        case 'monthly':
            dateRange = new Date(now);
            dateRange.setMonth(now.getMonth() - 12); 
            limit = 12;
            break;
        case 'yearly':
            dateRange = new Date(now);
            dateRange.setFullYear(now.getFullYear() - 5); 
            limit = 5;
            break;
        default:
            dateRange = new Date(now);
            dateRange.setMonth(now.getMonth() - 12);
            limit = 12;
    }
    
    const result = await Order.aggregate([
        {
            $match: {
                createdAt: { $gte: dateRange },
                paymentStatus: 'paid'
            }
        },
        {
            $group: {
                _id: groupFormat[timeFilter],
                totalSales: { $sum: '$total' },
                orderCount: { $sum: 1 }
            }
        },
        { $sort: { _id: 1 } },
        { $limit: limit }
    ]);
    
    return result;
}