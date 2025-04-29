const Order = require('../models/orderModel');
const Product = require('../models/productModel');
const mongoose = require('mongoose');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
exports.getSalesReport = async (req, res) => {
    try {
        const today = new Date();
        const startDate = req.query.startDate 
            ? new Date(req.query.startDate) 
            : new Date(today.getFullYear(), today.getMonth(), 1); 
        
        const endDate = req.query.endDate 
            ? new Date(req.query.endDate) 
            : new Date(today.getFullYear(), today.getMonth() + 1, 0); 
        
        endDate.setHours(23, 59, 59, 999);
        
        const orderStatusFilter = req.query.orderStatus || 'all';
        const filter = {
            createdAt: { $gte: startDate, $lte: endDate }
        };
        
        if (orderStatusFilter !== 'all') {
            filter.orderStatus = orderStatusFilter;
        }
        
        const [orders, salesStats, categoryStats] = await Promise.all([
            Order.find(filter)
                .sort({ createdAt: -1 })
                .limit(10)
                .populate('user', 'name email')
                .populate('items.product', 'title author price'),
                
            Order.aggregate([
                { $match: { 
                    ...filter,
                    orderStatus: { $nin: ['Cancelled'] } 
                }},
                { $group: {
                    _id: null,
                    totalSales: { $sum: '$total' },
                    totalOrders: { $count: {} },
                    totalProducts: { $sum: { $size: '$items' } },
                    avgOrderValue: { $avg: '$total' }
                }}
            ]),
            
            Order.aggregate([
                { $match: { 
                    ...filter,
                    orderStatus: { $nin: ['Cancelled'] } 
                }},
                { $unwind: '$items' },
                { $lookup: {
                    from: 'products',
                    localField: 'items.product',
                    foreignField: '_id',
                    as: 'productDetails'
                }},
                { $unwind: '$productDetails' },
                { $lookup: {
                    from: 'categories',
                    localField: 'productDetails.category',
                    foreignField: '_id',
                    as: 'categoryDetails'
                }},
                { $unwind: '$categoryDetails' },
                { $group: {
                    _id: '$categoryDetails._id',
                    categoryName: { $first: '$categoryDetails.name' },
                    totalSales: { $sum: '$items.total' },
                    count: { $sum: 1 }
                }},
                { $sort: { totalSales: -1 } }
            ])
        ]);
        
        const dailySalesData = await Order.aggregate([
            { $match: { 
                ...filter,
                orderStatus: { $nin: ['Cancelled'] } 
            }},
            { $group: {
                _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                sales: { $sum: "$total" },
                count: { $sum: 1 }
            }},
            { $sort: { _id: 1 } }
        ]);
        
        const paymentMethods = await Order.aggregate([
            { $match: filter },
            { $group: {
                _id: '$paymentMethod',
                count: { $sum: 1 },
                total: { $sum: '$total' }
            }},
            { $sort: { count: -1 } }
        ]);
        
        const stats = salesStats[0] || {
            totalSales: 0,
            totalOrders: 0,
            totalProducts: 0,
            avgOrderValue: 0
        };
        
        res.render('admin/sales-report', {
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            orderStatusFilter,
            orders,
            stats,
            dailySalesData,
            categoryStats,
            paymentMethods,
            formatDate: (date) => {
                return new Date(date).toLocaleDateString('en-US', {
                    year: 'numeric', 
                    month: 'short', 
                    day: 'numeric'
                });
            },
            formatCurrency: (amount) => {
                return '₹' + amount.toFixed(2);
            }
        });
    } catch (error) {
        console.error('Sales report error:', error);
        res.status(500).render('error', { message: 'Failed to generate sales report' });
    }
};

exports.downloadSalesReport = async (req, res) => {
    try {
        const today = new Date();
        const startDate = req.query.startDate 
            ? new Date(req.query.startDate) 
            : new Date(today.getFullYear(), today.getMonth(), 1);
        
        const endDate = req.query.endDate 
            ? new Date(req.query.endDate) 
            : new Date(today.getFullYear(), today.getMonth() + 1, 0);
        
        endDate.setHours(23, 59, 59, 999);
        
        const filter = {
            createdAt: { $gte: startDate, $lte: endDate },
            orderStatus: { $nin: ['Cancelled'] }
        };
        
        const orders = await Order.find(filter)
            .sort({ createdAt: -1 })
            .populate('user', 'email')
            .populate('items.product', 'title author price');
        
        const doc = new PDFDocument();
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=sales-report-${startDate.toISOString().split('T')[0]}-to-${endDate.toISOString().split('T')[0]}.pdf`);
        
        doc.pipe(res);
        
        doc.fontSize(20).text('BookSy Sales Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(12).text(`Period: ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}`, { align: 'center' });
        doc.moveDown();
        
        doc.fontSize(16).text('Order Details', { underline: true });
        doc.moveDown();
        
        let yPos = doc.y;
        doc.fontSize(10);
        doc.text('Order ID', 50, yPos);
        doc.text('Customer', 150, yPos);
        doc.text('Date', 250, yPos);
        doc.text('Amount', 350, yPos);
        doc.text('Status', 450, yPos);
        
        doc.moveDown();
        yPos = doc.y;
        
        doc.moveTo(50, yPos).lineTo(550, yPos).stroke();
        doc.moveDown();
        
        orders.forEach((order, index) => {
            yPos = doc.y;
            doc.text(order.uniqueOrderId || order._id.toString().substring(0, 10), 50, yPos);
            doc.text(order.user ? order.user.email : 'Unknown', 150, yPos);
            doc.text(new Date(order.createdAt).toLocaleDateString(), 250, yPos);
            doc.text(`₹${order.total.toFixed(2)}`, 350, yPos);
            doc.text(order.orderStatus, 450, yPos);
            doc.moveDown();
            
            if (doc.y > 700 && index < orders.length - 1) {
                doc.addPage();
                doc.fontSize(16).text('Order Details (continued)', { underline: true });
                doc.moveDown();
                
                yPos = doc.y;
                doc.fontSize(10);
                doc.text('Order ID', 50, yPos);
                doc.text('Customer', 150, yPos);
                doc.text('Date', 250, yPos);
                doc.text('Amount', 350, yPos);
                doc.text('Status', 450, yPos);
                
                doc.moveDown();
                yPos = doc.y;
                doc.moveTo(50, yPos).lineTo(550, yPos).stroke();
                doc.moveDown();
            }
        });
        
        // Finalize the PDF
        doc.end();
        
    } catch (error) {
        console.error('PDF generation error:', error);
        res.status(500).send('Failed to generate PDF report');
    }
};


exports.downloadExcelReport = async (req, res) => {
    try {
        res.status(200).json({ message: 'Excel download not implemented yet' });
    } catch (error) {
        console.error('Excel generation error:', error);
        res.status(500).json({ error: 'Failed to generate Excel report' });
    }
};