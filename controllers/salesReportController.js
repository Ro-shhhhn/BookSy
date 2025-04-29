const Order = require('../models/orderModel');
const Product = require('../models/productModel');
const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const formatCurrency = (amount) => {
    if (isNaN(amount) || amount === null || amount === undefined) {
        return '₹0.00';
    }
    return '₹' + parseFloat(amount).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
};

const formatDate = (date) => {
    return new Date(date).toLocaleDateString('en-IN', {
        year: 'numeric',
        month: 'short',
        day: 'numeric'
    });
};

exports.getSalesReport = async (req, res) => {
    try {
        let endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
        endDate.setHours(23, 59, 59, 999);

        let startDate = req.query.startDate ? new Date(req.query.startDate) : new Date();
        startDate.setHours(0, 0, 0, 0);

        if (!req.query.startDate) {
            startDate.setDate(startDate.getDate() - 30);
        }

        const filterType = req.query.filterType || 'custom';

        if (filterType === 'daily') {
            startDate = new Date();
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date();
            endDate.setHours(23, 59, 59, 999);
        } else if (filterType === 'weekly') {
            const today = new Date();
            startDate = new Date(today);
            startDate.setDate(today.getDate() - 7);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date();
            endDate.setHours(23, 59, 59, 999);
        } else if (filterType === 'monthly') {
            const today = new Date();
            startDate = new Date(today);
            startDate.setMonth(today.getMonth() - 1);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date();
            endDate.setHours(23, 59, 59, 999);
        } else if (filterType === 'yearly') {
            const today = new Date();
            startDate = new Date(today);
            startDate.setFullYear(today.getFullYear() - 1);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date();
            endDate.setHours(23, 59, 59, 999);
        }

        const orderStatusFilter = req.query.orderStatus || 'all';
        const statusFilter = orderStatusFilter !== 'all' ? { orderStatus: orderStatusFilter } : {};

        const filter = {
            createdAt: { $gte: startDate, $lte: endDate },
            ...statusFilter
        };


        const stats = await getStats(filter);

        const dailySalesData = await getDailySalesData(startDate, endDate, orderStatusFilter);

        const categoryStats = await getCategoryStats(startDate, endDate, orderStatusFilter);

        const orders = await Order.find(filter)
            .populate('user', 'email')
            .sort({ createdAt: -1 })
            .limit(10);
        const discountData = await getDailyDiscountData(startDate, endDate, orderStatusFilter);

        res.render('admin/sales-report', {
            stats,
            dailySalesData: JSON.stringify(dailySalesData),
            categoryStats: JSON.stringify(categoryStats),
            discountData: JSON.stringify(discountData), // Add this line    
            orders,
            startDate: startDate.toISOString().split('T')[0],
            endDate: endDate.toISOString().split('T')[0],
            orderStatusFilter,
            filterType,
            formatCurrency,
            formatDate
        });
    } catch (error) {
        console.error('Error generating sales report:', error);
        res.status(500).render('admin/error', { error: 'Failed to generate sales report' });
    }
};

const getStats = async (filter) => {
    const ordersData = await Order.find(filter);

    let totalSales = 0;
    let totalProducts = 0;
    let totalDiscount = 0;
    const totalOrders = ordersData.length;

    ordersData.forEach(order => {
        if (order.total && !isNaN(Number(order.total))) {
            totalSales += Number(order.total);
        }

        if (order.discount && !isNaN(Number(order.discount))) {
            totalDiscount += Number(order.discount);
        }

        if (order.items && Array.isArray(order.items)) {
            order.items.forEach(item => {
                if (item.quantity && !isNaN(Number(item.quantity))) {
                    totalProducts += Number(item.quantity);
                }
            });
        }
    });

    const avgOrderValue = totalOrders > 0 ? totalSales / totalOrders : 0;

    return {
        totalSales,
        totalOrders,
        totalProducts,
        avgOrderValue,
        totalDiscount
    };
};

const getDailySalesData = async (startDate, endDate, orderStatus) => {
    try {
        const statusFilter = orderStatus !== 'all' ? { orderStatus } : {};

        const dailySales = await Order.aggregate([
            {
                $match: {
                    createdAt: { $gte: startDate, $lte: endDate },
                    ...statusFilter
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
                    },
                    sales: { $sum: "$total" }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        const dateArray = getDatesInRange(startDate, endDate);
        const filledData = dateArray.map(date => {
            const found = dailySales.find(d => d._id === date);
            return {
                date,
                sales: found ? Number(found.sales) : 0
            };
        });

        return filledData;
    } catch (error) {
        console.error('Error getting daily sales data:', error);
        return [];
    }
};

const getDatesInRange = (startDate, endDate) => {
    const dates = [];
    let currentDate = new Date(startDate);

    while (currentDate <= endDate) {
        dates.push(currentDate.toISOString().split('T')[0]);
        currentDate.setDate(currentDate.getDate() + 1);
    }

    return dates;
};

const getCategoryStats = async (startDate, endDate, orderStatus) => {
    try {
        const statusFilter = orderStatus !== 'all' ? { orderStatus } : {};

        const categoryData = await Order.aggregate([
            {
                $match: {
                    createdAt: { $gte: startDate, $lte: endDate },
                    ...statusFilter
                }
            },
            { $unwind: "$items" },
            {
                $lookup: {
                    from: "products",
                    localField: "items.product",
                    foreignField: "_id",
                    as: "productDetails"
                }
            },
            { $unwind: "$productDetails" },
            {
                $lookup: {
                    from: "categories",
                    localField: "productDetails.category",
                    foreignField: "_id",
                    as: "categoryDetails"
                }
            },
            { $unwind: "$categoryDetails" },
            {
                $group: {
                    _id: "$categoryDetails._id",
                    categoryName: { $first: "$categoryDetails.name" },
                    totalSales: { $sum: { $multiply: ["$items.price", "$items.quantity"] } }
                }
            },
            { $sort: { totalSales: -1 } }
        ]);

        return categoryData.map(cat => ({
            _id: cat._id.toString(),
            categoryName: cat.categoryName,
            totalSales: Number(cat.totalSales)
        }));
    } catch (error) {
        console.error('Error getting category stats:', error);
        return [];
    }
};


const getDailyDiscountData = async (startDate, endDate, orderStatus) => {
    try {
        const statusFilter = orderStatus !== 'all' ? { orderStatus } : {};

        const dailyDiscounts = await Order.aggregate([
            {
                $match: {
                    createdAt: { $gte: startDate, $lte: endDate },
                    ...statusFilter
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: "%Y-%m-%d", date: "$createdAt" }
                    },
                    discount: { $sum: "$discount" }
                }
            },
            { $sort: { _id: 1 } }
        ]);

        const dateArray = getDatesInRange(startDate, endDate);
        const filledData = dateArray.map(date => {
            const found = dailyDiscounts.find(d => d._id === date);
            return {
                date,
                discount: found ? Number(found.discount) : 0
            };
        });

        return filledData;
    } catch (error) {
        console.error('Error getting daily discount data:', error);
        return [];
    }
};


exports.downloadPdf = async (req, res) => {
    try {
        // Get the same data as in the sales report
        let endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
        endDate.setHours(23, 59, 59, 999);

        let startDate = req.query.startDate ? new Date(req.query.startDate) : new Date();
        startDate.setHours(0, 0, 0, 0);

        if (!req.query.startDate) {
            startDate.setDate(startDate.getDate() - 30);
        }

        // Apply the same filter logic as getSalesReport
        const filterType = req.query.filterType || 'custom';

        if (filterType === 'daily') {
            startDate = new Date();
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date();
            endDate.setHours(23, 59, 59, 999);
        } else if (filterType === 'weekly') {
            const today = new Date();
            startDate = new Date(today);
            startDate.setDate(today.getDate() - 7);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date();
            endDate.setHours(23, 59, 59, 999);
        } else if (filterType === 'monthly') {
            const today = new Date();
            startDate = new Date(today);
            startDate.setMonth(today.getMonth() - 1);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date();
            endDate.setHours(23, 59, 59, 999);
        } else if (filterType === 'yearly') {
            const today = new Date();
            startDate = new Date(today);
            startDate.setFullYear(today.getFullYear() - 1);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date();
            endDate.setHours(23, 59, 59, 999);
        }

        const orderStatusFilter = req.query.orderStatus || 'all';
        const statusFilter = orderStatusFilter !== 'all' ? { orderStatus: orderStatusFilter } : {};

        const filter = {
            createdAt: { $gte: startDate, $lte: endDate },
            ...statusFilter
        };

        // Get all required data
        const stats = await getStats(filter);
        const categoryStats = await getCategoryStats(startDate, endDate, orderStatusFilter);
        const dailySalesData = await getDailySalesData(startDate, endDate, orderStatusFilter);
        const discountData = await getDailyDiscountData(startDate, endDate, orderStatusFilter);

        // Get detailed order data - IMPORTANT: properly populate product information
        const orders = await Order.find(filter)
            .populate('user', 'email')
            .populate({
                path: 'items.product',
                select: 'title author price'  // Changed from 'name' to 'title author'
            })
            .sort({ createdAt: -1 });

        // Create PDF document
        const doc = new PDFDocument({
            size: 'A4',
            margin: 50,
            info: {
                Title: 'Sales Report',
                Author: 'Your E-commerce Store'
            },
            bufferPages: true // Enable buffering all pages
        });

        // Set response headers
        const reportFileName = `sales-report-${startDate.toISOString().split('T')[0]}-to-${endDate.toISOString().split('T')[0]}.pdf`;
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=${reportFileName}`);

        // Pipe the PDF document to the response
        doc.pipe(res);

        // Fix: Use a simple Rs. prefix instead of the symbol to avoid encoding issues
        const formatCurrencyForPdf = (amount) => {
            if (isNaN(amount) || amount === null || amount === undefined) {
                return 'Rs. 0.00';
            }
            return 'Rs. ' + parseFloat(amount).toFixed(2).replace(/\d(?=(\d{3})+\.)/g, '$&,');
        };

        // Add company logo placeholder
        doc.fontSize(24).fillColor('#1e3a8a').text('BookSy', { align: 'center' });
        doc.fontSize(16).fillColor('#1e3a8a').text('Sales Report', { align: 'center' });

        // Add report date range
        doc.moveDown();
        doc.fontSize(10).fillColor('#666666')
            .text(`Report Period: ${formatDate(startDate)} to ${formatDate(endDate)}`, { align: 'center' });
        doc.moveDown();

        // Add filter information
        doc.fontSize(10).fillColor('#666666')
            .text(`Filter: ${filterType.charAt(0).toUpperCase() + filterType.slice(1)}${orderStatusFilter !== 'all' ? ` | Status: ${orderStatusFilter}` : ''}`, { align: 'center' });
        doc.moveDown(2);

        // Add summary section
        doc.fontSize(14).fillColor('#1e3a8a').text('Sales Summary', { underline: true });
        doc.moveDown();

        // Create a table-like structure for summary
        const summaryTableTop = doc.y;
        const summaryColWidth = (doc.page.width - 100) / 2;

        // Add summary data
        doc.fontSize(10).fillColor('#000');

        // Row 1
        doc.text('Total Sales:', 50, summaryTableTop);
        doc.text(formatCurrencyForPdf(stats.totalSales), 50 + summaryColWidth, summaryTableTop);

        // Row 2
        doc.text('Total Orders:', 50, summaryTableTop + 20);
        doc.text(stats.totalOrders.toString(), 50 + summaryColWidth, summaryTableTop + 20);

        // Row 3
        doc.text('Total Products Sold:', 50, summaryTableTop + 40);
        doc.text(stats.totalProducts.toString(), 50 + summaryColWidth, summaryTableTop + 40);

        // Row 4
        doc.text('Average Order Value:', 50, summaryTableTop + 60);
        doc.text(formatCurrencyForPdf(stats.avgOrderValue), 50 + summaryColWidth, summaryTableTop + 60);

        // Row 5
        doc.text('Total Discounts:', 50, summaryTableTop + 80);
        doc.text(formatCurrencyForPdf(stats.totalDiscount), 50 + summaryColWidth, summaryTableTop + 80);

        doc.moveDown(6);

        // Add category performance section
        doc.fontSize(14).fillColor('#1e3a8a').text('Category Performance', { underline: true });
        doc.moveDown();

        // Create category table headers
        const categoryTableTop = doc.y;
        doc.fontSize(10).fillColor('#666666');
        doc.text('Category', 50, categoryTableTop, { width: 200 });
        doc.text('Sales Amount', 250, categoryTableTop, { width: 200, align: 'right' });
        doc.text('Percentage', 450, categoryTableTop, { width: 100, align: 'right' });

        // Add horizontal line
        doc.moveTo(50, categoryTableTop + 15)
            .lineTo(550, categoryTableTop + 15)
            .stroke('#cccccc');

        // Add category data
        let categoryY = categoryTableTop + 20;
        let totalCategorySales = categoryStats.reduce((sum, cat) => sum + (cat.totalSales || 0), 0);

        categoryStats.forEach((category, index) => {
            if (categoryY > 700) { // Check if we need a new page
                doc.addPage();
                categoryY = 50;

                // Re-add headers on new page
                doc.fontSize(10).fillColor('#666666');
                doc.text('Category', 50, categoryY, { width: 200 });
                doc.text('Sales Amount', 250, categoryY, { width: 200, align: 'right' });
                doc.text('Percentage', 450, categoryY, { width: 100, align: 'right' });

                // Add horizontal line
                doc.moveTo(50, categoryY + 15)
                    .lineTo(550, categoryY + 15)
                    .stroke('#cccccc');

                categoryY += 20;
            }

            const percentage = totalCategorySales > 0
                ? ((category.totalSales / totalCategorySales) * 100).toFixed(2) + '%'
                : '0%';

            doc.fontSize(10).fillColor('#000');
            doc.text(category.categoryName || 'Unknown', 50, categoryY, { width: 200 });
            doc.text(formatCurrencyForPdf(category.totalSales), 250, categoryY, { width: 200, align: 'right' });
            doc.text(percentage, 450, categoryY, { width: 100, align: 'right' });

            categoryY += 20;

            // Add a light gray divider except for the last item
            if (index < categoryStats.length - 1) {
                doc.moveTo(50, categoryY - 5)
                    .lineTo(550, categoryY - 5)
                    .stroke('#eeeeee');
            }
        });

        doc.moveDown(2);

        // Add recent orders section
        if (orders.length > 0) {
            doc.addPage();
            doc.fontSize(14).fillColor('#1e3a8a').text('Recent Orders', { underline: true });
            doc.moveDown();

            // Create orders table headers
            const ordersTableTop = doc.y;
            doc.fontSize(10).fillColor('#666666');
            doc.text('Order ID', 50, ordersTableTop, { width: 150 });  // Increased width for Order ID
            doc.text('Date', 200, ordersTableTop, { width: 80 });
            doc.text('Customer', 280, ordersTableTop, { width: 150 });  // Increased width for Customer email
            doc.text('Status', 430, ordersTableTop, { width: 60 });
            doc.text('Amount', 490, ordersTableTop, { width: 60, align: 'right' });

            // Add horizontal line
            doc.moveTo(50, ordersTableTop + 15)
                .lineTo(550, ordersTableTop + 15)
                .stroke('#cccccc');

            // Add order data
            let orderY = ordersTableTop + 20;

            orders.slice(0, 10).forEach((order, index) => {
                if (orderY > 700) { // Check if we need a new page
                    doc.addPage();
                    orderY = 50;

                    // Re-add headers on new page
                    doc.fontSize(10).fillColor('#666666');
                    doc.text('Order ID', 50, orderY, { width: 150 });
                    doc.text('Date', 200, orderY, { width: 80 });
                    doc.text('Customer', 280, orderY, { width: 150 });
                    doc.text('Status', 430, orderY, { width: 60 });
                    doc.text('Amount', 490, orderY, { width: 60, align: 'right' });

                    // Add horizontal line
                    doc.moveTo(50, orderY + 15)
                        .lineTo(550, orderY + 15)
                        .stroke('#cccccc');

                    orderY += 20;
                }

                // FIX: Use uniqueOrderId instead of _id
                const orderId = order.uniqueOrderId || (order._id ? order._id.toString() : 'N/A');

                doc.fontSize(10).fillColor('#000');
                doc.text(orderId, 50, orderY, { width: 150 });
                doc.text(formatDate(order.createdAt), 200, orderY, { width: 80 });

                // Show full customer email instead of truncated version
                doc.text(order.user && order.user.email ? order.user.email : 'Guest', 280, orderY, { width: 150 });

                // Color-code the status
                let statusColor = '#000';
                switch (order.orderStatus) {
                    case 'Processing': statusColor = '#f59e0b'; break;
                    case 'Shipped': statusColor = '#3b82f6'; break;
                    case 'Delivered': statusColor = '#10b981'; break;
                    case 'Cancelled': statusColor = '#ef4444'; break;
                    default: statusColor = '#000';
                }

                doc.fillColor(statusColor).text(order.orderStatus || 'Unknown', 430, orderY, { width: 60 });
                doc.fillColor('#000').text(formatCurrencyForPdf(order.total), 490, orderY, { width: 60, align: 'right' });

                orderY += 20;

                // Add a light gray divider except for the last item
                if (index < orders.slice(0, 10).length - 1) {
                    doc.moveTo(50, orderY - 5)
                        .lineTo(550, orderY - 5)
                        .stroke('#eeeeee');
                }
            });
        }

        // FIX: Proper handling of product data for Top Products section
        if (orders.length > 0) {
            doc.addPage();
            doc.fontSize(14).fillColor('#1e3a8a').text('Top Products', { underline: true });
            doc.moveDown();

            // Get product sales data from orders with proper type checking
            const productSales = {};

            orders.forEach(order => {
                if (order.items && Array.isArray(order.items)) {
                    order.items.forEach(item => {
                        if (item.product) {
                            // Properly handle both populated objects and IDs
                            const productId = typeof item.product === 'object' && item.product._id ?
                                item.product._id.toString() :
                                item.product.toString();

                            // Get product name properly - using title (and author) from your schema
                            let productName = 'Unknown Product';
                            if (typeof item.product === 'object') {
                                if (item.product.title) {
                                    productName = item.product.title;
                                    // Add author if available
                                    if (item.product.author) {
                                        productName += ` by ${item.product.author}`;
                                    }
                                }
                            }

                            if (!productSales[productId]) {
                                productSales[productId] = {
                                    name: productName,
                                    quantity: 0,
                                    revenue: 0
                                };
                            }

                            // Make sure quantity and price are actually numbers
                            const quantity = Number(item.quantity) || 0;
                            const price = Number(item.price) || 0;

                            productSales[productId].quantity += quantity;
                            productSales[productId].revenue += (price * quantity);
                        }
                    });
                }
            });

            // Convert to array and sort by revenue
            const topProducts = Object.values(productSales)
                .sort((a, b) => b.revenue - a.revenue)
                .slice(0, 15); // Show top 15 products

            // Create table headers
            const topProductsTableTop = doc.y;
            doc.fontSize(10).fillColor('#666666');
            doc.text('Product', 50, topProductsTableTop, { width: 250 });
            doc.text('Quantity Sold', 300, topProductsTableTop, { width: 100, align: 'right' });
            doc.text('Revenue', 400, topProductsTableTop, { width: 100, align: 'right' });

            // Add horizontal line
            doc.moveTo(50, topProductsTableTop + 15)
                .lineTo(550, topProductsTableTop + 15)
                .stroke('#cccccc');

            // Add product data
            let productY = topProductsTableTop + 20;

            topProducts.forEach((product, index) => {
                if (productY > 700) { // Check if we need a new page
                    doc.addPage();
                    productY = 50;

                    // Re-add headers on new page
                    doc.fontSize(10).fillColor('#666666');
                    doc.text('Product', 50, productY, { width: 250 });
                    doc.text('Quantity Sold', 300, productY, { width: 100, align: 'right' });
                    doc.text('Revenue', 400, productY, { width: 100, align: 'right' });

                    // Add horizontal line
                    doc.moveTo(50, productY + 15)
                        .lineTo(550, productY + 15)
                        .stroke('#cccccc');

                    productY += 20;
                }

                doc.fontSize(10).fillColor('#000');
                doc.text(product.name, 50, productY, { width: 250 });
                doc.text(product.quantity.toString(), 300, productY, { width: 100, align: 'right' });
                doc.text(formatCurrencyForPdf(product.revenue), 400, productY, { width: 100, align: 'right' });

                productY += 20;

                // Add a light gray divider except for the last item
                if (index < topProducts.length - 1) {
                    doc.moveTo(50, productY - 5)
                        .lineTo(550, productY - 5)
                        .stroke('#eeeeee');
                }
            });

            // Add note if no products found
            if (topProducts.length === 0) {
                doc.fontSize(10).fillColor('#666666')
                    .text('No product sales data available for the selected period.', 50, productY, { align: 'center', width: 500 });
            }
        }

        // FIX: Ensure proper calculation of daily sales data
        const hasSalesData = dailySalesData.some(day => day.sales > 0 || (discountData.find(d => d.date === day.date)?.discount > 0));

        if (hasSalesData) {
            doc.addPage();
            doc.fontSize(14).fillColor('#1e3a8a').text('Daily Sales Summary', { underline: true });
            doc.moveDown();

            // Create table headers
            const dailyTableTop = doc.y;
            doc.fontSize(10).fillColor('#666666');
            doc.text('Date', 50, dailyTableTop, { width: 100 });
            doc.text('Sales Amount', 150, dailyTableTop, { width: 100, align: 'right' });
            doc.text('Discount', 250, dailyTableTop, { width: 100, align: 'right' });
            doc.text('Net Sales', 350, dailyTableTop, { width: 100, align: 'right' });

            // Add horizontal line
            doc.moveTo(50, dailyTableTop + 15)
                .lineTo(550, dailyTableTop + 15)
                .stroke('#cccccc');

            // Add daily data
            let dailyY = dailyTableTop + 20;

            // FIX: Ensure proper calculation for combined data
            const combinedData = dailySalesData.map(salesDay => {
                const discountDay = discountData.find(d => d.date === salesDay.date);
                const discount = discountDay && !isNaN(discountDay.discount) ? Number(discountDay.discount) : 0;
                const sales = !isNaN(salesDay.sales) ? Number(salesDay.sales) : 0;

                return {
                    date: salesDay.date,
                    sales: sales,
                    discount: discount,
                    netSales: Math.max(0, sales - discount) // Ensure net sales isn't negative
                };
            }).filter(day => day.sales > 0 || day.discount > 0); // Only show days with data

            combinedData.forEach((day, index) => {
                if (dailyY > 700) { // Check if we need a new page
                    doc.addPage();
                    dailyY = 50;

                    // Re-add headers on new page
                    doc.fontSize(10).fillColor('#666666');
                    doc.text('Date', 50, dailyY, { width: 100 });
                    doc.text('Sales Amount', 150, dailyY, { width: 100, align: 'right' });
                    doc.text('Discount', 250, dailyY, { width: 100, align: 'right' });
                    doc.text('Net Sales', 350, dailyY, { width: 100, align: 'right' });

                    // Add horizontal line
                    doc.moveTo(50, dailyY + 15)
                        .lineTo(550, dailyY + 15)
                        .stroke('#cccccc');

                    dailyY += 20;
                }

                // Format the date for display
                const displayDate = new Date(day.date).toLocaleDateString('en-IN', {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric'
                });

                doc.fontSize(10).fillColor('#000');
                doc.text(displayDate, 50, dailyY, { width: 100 });
                doc.text(formatCurrencyForPdf(day.sales), 150, dailyY, { width: 100, align: 'right' });
                doc.text(formatCurrencyForPdf(day.discount), 250, dailyY, { width: 100, align: 'right' });
                doc.text(formatCurrencyForPdf(day.netSales), 350, dailyY, { width: 100, align: 'right' });

                dailyY += 20;

                // Add a light gray divider except for the last item
                if (index < combinedData.length - 1) {
                    doc.moveTo(50, dailyY - 5)
                        .lineTo(550, dailyY - 5)
                        .stroke('#eeeeee');
                }
            });
        }

        // Get total page count
        const totalPageCount = doc.bufferedPageRange().count;

        // Add footer with page numbers to each page
        for (let i = 0; i < totalPageCount; i++) {
            doc.switchToPage(i);

            // Add page number
            doc.fontSize(8).fillColor('#666666');
            doc.text(
                `Page ${i + 1} of ${totalPageCount}`,
                50,
                doc.page.height - 50,
                { align: 'center', width: doc.page.width - 100 }
            );

            // Add generation date and footer text
            doc.fontSize(8).fillColor('#666666');
            doc.text(
                `Generated on ${new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'short', day: 'numeric' })} at ${new Date().toLocaleTimeString('en-IN')}`,
                50,
                doc.page.height - 35,
                { align: 'center', width: doc.page.width - 100 }
            );
        }

        // Finalize the PDF
        doc.end();
    } catch (error) {
        console.error('Error generating PDF report:', error);
        res.status(500).send('Failed to generate PDF report');
    }
};


exports.downloadExcel = async (req, res) => {
    try {
        // Get the same data as in the sales report
        let endDate = req.query.endDate ? new Date(req.query.endDate) : new Date();
        endDate.setHours(23, 59, 59, 999);
        
        let startDate = req.query.startDate ? new Date(req.query.startDate) : new Date();
        startDate.setHours(0, 0, 0, 0);
        
        if (!req.query.startDate) {
            startDate.setDate(startDate.getDate() - 30);
        }
        
        // Apply the same filter logic as getSalesReport
        const filterType = req.query.filterType || 'custom';
        
        if (filterType === 'daily') {
            startDate = new Date();
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date();
            endDate.setHours(23, 59, 59, 999);
        } else if (filterType === 'weekly') {
            const today = new Date();
            startDate = new Date(today);
            startDate.setDate(today.getDate() - 7);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date();
            endDate.setHours(23, 59, 59, 999);
        } else if (filterType === 'monthly') {
            const today = new Date();
            startDate = new Date(today);
            startDate.setMonth(today.getMonth() - 1);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date();
            endDate.setHours(23, 59, 59, 999);
        } else if (filterType === 'yearly') {
            const today = new Date();
            startDate = new Date(today);
            startDate.setFullYear(today.getFullYear() - 1);
            startDate.setHours(0, 0, 0, 0);
            endDate = new Date();
            endDate.setHours(23, 59, 59, 999);
        }
        
        const orderStatusFilter = req.query.orderStatus || 'all';
        const statusFilter = orderStatusFilter !== 'all' ? { orderStatus: orderStatusFilter } : {};
        
        const filter = {
            createdAt: { $gte: startDate, $lte: endDate },
            ...statusFilter
        };
        
        // Get all required data
        const stats = await getStats(filter);
        const categoryStats = await getCategoryStats(startDate, endDate, orderStatusFilter);
        const dailySalesData = await getDailySalesData(startDate, endDate, orderStatusFilter);
        const discountData = await getDailyDiscountData(startDate, endDate, orderStatusFilter);
        
        // Get detailed order data - IMPORTANT: properly populate product information as in PDF
        const orders = await Order.find(filter)
            .populate('user', 'email')
            .populate({
                path: 'items.product',
                select: 'title author price'  // Use title and author like in PDF export
            })
            .sort({ createdAt: -1 });
        
        // Create a new Excel workbook
        const workbook = new ExcelJS.Workbook();
        workbook.creator = 'BookSy';
        workbook.lastModifiedBy = 'Sales Report Generator';
        workbook.created = new Date();
        workbook.modified = new Date();
        
        // Add Summary worksheet
        const summarySheet = workbook.addWorksheet('Summary', {
            properties: { tabColor: { argb: '1E3A8A' } }
        });
        
        // Add title and date range with better styling
        summarySheet.mergeCells('A1:F1');
        summarySheet.getCell('A1').value = 'BOOKSY SALES REPORT';
        summarySheet.getCell('A1').font = { size: 16, bold: true, color: { argb: '1E3A8A' } };
        summarySheet.getCell('A1').alignment = { horizontal: 'center' };
        summarySheet.getRow(1).height = 25;
        
        summarySheet.mergeCells('A2:F2');
        summarySheet.getCell('A2').value = `Report Period: ${formatDate(startDate)} to ${formatDate(endDate)}`;
        summarySheet.getCell('A2').font = { size: 10 };
        summarySheet.getCell('A2').alignment = { horizontal: 'center' };
        
        summarySheet.mergeCells('A3:F3');
        summarySheet.getCell('A3').value = `Filter: ${filterType.charAt(0).toUpperCase() + filterType.slice(1)}${orderStatusFilter !== 'all' ? ` | Status: ${orderStatusFilter}` : ''}`;
        summarySheet.getCell('A3').font = { size: 10 };
        summarySheet.getCell('A3').alignment = { horizontal: 'center' };
        
        // Add Sales Summary section header with better styling
        summarySheet.mergeCells('A5:B5');
        summarySheet.getCell('A5').value = 'SALES SUMMARY';
        summarySheet.getCell('A5').font = { size: 12, bold: true, color: { argb: '1E3A8A' } };
        summarySheet.getCell('A5').fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'ECF2FF' }
        };
        
        // Add summary table headers
        summarySheet.getCell('A7').value = 'Metric';
        summarySheet.getCell('B7').value = 'Value';
        
        // Style the header row
        ['A7', 'B7'].forEach(cell => {
            summarySheet.getCell(cell).font = { bold: true, color: { argb: 'FFFFFF' } };
            summarySheet.getCell(cell).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: '1E3A8A' }
            };
            summarySheet.getCell(cell).border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
            summarySheet.getCell(cell).alignment = { horizontal: 'center' };
        });
        
        // Add summary data
        const summaryData = [
            ['Total Sales', formatCurrency(stats.totalSales)],
            ['Total Orders', stats.totalOrders],
            ['Total Products Sold', stats.totalProducts],
            ['Average Order Value', formatCurrency(stats.avgOrderValue)],
            ['Total Discounts', formatCurrency(stats.totalDiscount)]
        ];
        
        summaryData.forEach((row, index) => {
            const rowIndex = 8 + index;
            summarySheet.getCell(`A${rowIndex}`).value = row[0];
            summarySheet.getCell(`B${rowIndex}`).value = row[1];
            
            // Add alternating row styling
            if (index % 2 === 0) {
                ['A', 'B'].forEach(col => {
                    summarySheet.getCell(`${col}${rowIndex}`).fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'F8FAFC' }
                    };
                });
            }
            
            // Add borders to all cells
            ['A', 'B'].forEach(col => {
                summarySheet.getCell(`${col}${rowIndex}`).border = {
                    top: { style: 'thin', color: { argb: 'E5E7EB' } },
                    left: { style: 'thin', color: { argb: 'E5E7EB' } },
                    bottom: { style: 'thin', color: { argb: 'E5E7EB' } },
                    right: { style: 'thin', color: { argb: 'E5E7EB' } }
                };
            });
            
            // Align currency values to right
            summarySheet.getCell(`B${rowIndex}`).alignment = { horizontal: 'right' };
        });
        
        // Set column widths
        summarySheet.getColumn('A').width = 25;
        summarySheet.getColumn('B').width = 20;
        
        // Category Performance section
        summarySheet.mergeCells('A14:C14');
        summarySheet.getCell('A14').value = 'CATEGORY PERFORMANCE';
        summarySheet.getCell('A14').font = { size: 12, bold: true, color: { argb: '1E3A8A' } };
        summarySheet.getCell('A14').fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'ECF2FF' }
        };
        
        // Add category table headers
        summarySheet.getCell('A16').value = 'Category';
        summarySheet.getCell('B16').value = 'Sales Amount';
        summarySheet.getCell('C16').value = 'Percentage';
        
        // Style the header row
        ['A16', 'B16', 'C16'].forEach(cell => {
            summarySheet.getCell(cell).font = { bold: true, color: { argb: 'FFFFFF' } };
            summarySheet.getCell(cell).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: '1E3A8A' }
            };
            summarySheet.getCell(cell).border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
            summarySheet.getCell(cell).alignment = { horizontal: 'center' };
        });
        
        // Add category data
        let totalCategorySales = categoryStats.reduce((sum, cat) => sum + (cat.totalSales || 0), 0);
        
        categoryStats.forEach((category, index) => {
            const rowIndex = 17 + index;
            const percentage = totalCategorySales > 0 
                ? ((category.totalSales / totalCategorySales) * 100).toFixed(2) + '%' 
                : '0%';
            
            summarySheet.getCell(`A${rowIndex}`).value = category.categoryName || 'Unknown';
            summarySheet.getCell(`B${rowIndex}`).value = formatCurrency(category.totalSales);
            summarySheet.getCell(`C${rowIndex}`).value = percentage;
            
            // Add alternating row styling
            if (index % 2 === 0) {
                ['A', 'B', 'C'].forEach(col => {
                    summarySheet.getCell(`${col}${rowIndex}`).fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'F8FAFC' }
                    };
                });
            }
            
            // Add borders to all cells
            ['A', 'B', 'C'].forEach(col => {
                summarySheet.getCell(`${col}${rowIndex}`).border = {
                    top: { style: 'thin', color: { argb: 'E5E7EB' } },
                    left: { style: 'thin', color: { argb: 'E5E7EB' } },
                    bottom: { style: 'thin', color: { argb: 'E5E7EB' } },
                    right: { style: 'thin', color: { argb: 'E5E7EB' } }
                };
            });
            
            // Align values
            summarySheet.getCell(`B${rowIndex}`).alignment = { horizontal: 'right' };
            summarySheet.getCell(`C${rowIndex}`).alignment = { horizontal: 'right' };
        });
        
        // Set column widths
        summarySheet.getColumn('A').width = 25;
        summarySheet.getColumn('B').width = 20;
        summarySheet.getColumn('C').width = 15;
        
        // Add Orders worksheet
        const ordersSheet = workbook.addWorksheet('Recent Orders', {
            properties: { tabColor: { argb: '047857' } }
        });
        
        // Add title to orders sheet
        ordersSheet.mergeCells('A1:G1');
        ordersSheet.getCell('A1').value = 'RECENT ORDERS';
        ordersSheet.getCell('A1').font = { size: 14, bold: true, color: { argb: '047857' } };
        ordersSheet.getCell('A1').alignment = { horizontal: 'center' };
        ordersSheet.getCell('A1').fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'ECFDF5' }
        };
        
        // Add orders table headers
        const orderHeaders = ['Order ID', 'Date', 'Customer', 'Status', 'Amount', 'Items', 'Payment Method'];
        orderHeaders.forEach((header, i) => {
            const col = String.fromCharCode(65 + i); // A, B, C, etc.
            ordersSheet.getCell(`${col}3`).value = header;
            ordersSheet.getCell(`${col}3`).font = { bold: true, color: { argb: 'FFFFFF' } };
            ordersSheet.getCell(`${col}3`).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: '047857' }
            };
            ordersSheet.getCell(`${col}3`).alignment = { horizontal: 'center' };
            ordersSheet.getCell(`${col}3`).border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        });
        
        // Add order data (up to 50 recent orders)
        orders.slice(0, 50).forEach((order, index) => {
            const rowIndex = 4 + index;
            const orderId = order.uniqueOrderId || (order._id ? order._id.toString() : 'N/A');
            
            // Create formatted items list for Excel
            const itemsList = order.items
                .map(item => {
                    const productName = typeof item.product === 'object' && item.product.title ? 
                        item.product.title :
                        'Unknown Product';
                    return `${item.quantity}x ${productName}`;
                })
                .join(', ');
            
            // Fill order data
            ordersSheet.getCell(`A${rowIndex}`).value = orderId;
            ordersSheet.getCell(`B${rowIndex}`).value = new Date(order.createdAt);
            ordersSheet.getCell(`C${rowIndex}`).value = order.user && order.user.email ? order.user.email : 'Guest';
            ordersSheet.getCell(`D${rowIndex}`).value = order.orderStatus || 'Unknown';
            ordersSheet.getCell(`E${rowIndex}`).value = Number(order.total) || 0;
            ordersSheet.getCell(`F${rowIndex}`).value = itemsList;
            ordersSheet.getCell(`G${rowIndex}`).value = order.paymentMethod || 'N/A';
            
            // Format date cell
            ordersSheet.getCell(`B${rowIndex}`).numFmt = 'dd-mmm-yyyy';
            
            // Format currency cell
            ordersSheet.getCell(`E${rowIndex}`).numFmt = '₹#,##0.00';
            
            // Add status-based styling
            let statusColor = '';
            switch(order.orderStatus) {
                case 'Processing': statusColor = 'F59E0B'; break;
                case 'Shipped': statusColor = '3B82F6'; break;
                case 'Delivered': statusColor = '10B981'; break;
                case 'Cancelled': statusColor = 'EF4444'; break;
                default: statusColor = '6B7280';
            }
            
            ordersSheet.getCell(`D${rowIndex}`).font = { color: { argb: statusColor } };
            
            // Add alternating row styling
            if (index % 2 === 0) {
                for (let i = 0; i < orderHeaders.length; i++) {
                    const col = String.fromCharCode(65 + i);
                    ordersSheet.getCell(`${col}${rowIndex}`).fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'F9FAFB' }
                    };
                }
            }
            
            // Add thin borders to all cells
            for (let i = 0; i < orderHeaders.length; i++) {
                const col = String.fromCharCode(65 + i);
                ordersSheet.getCell(`${col}${rowIndex}`).border = {
                    top: { style: 'thin', color: { argb: 'E5E7EB' } },
                    left: { style: 'thin', color: { argb: 'E5E7EB' } },
                    bottom: { style: 'thin', color: { argb: 'E5E7EB' } },
                    right: { style: 'thin', color: { argb: 'E5E7EB' } }
                };
            }
        });
        
        // Set column widths for orders sheet
        ordersSheet.getColumn('A').width = 20;
        ordersSheet.getColumn('B').width = 15;
        ordersSheet.getColumn('C').width = 30;
        ordersSheet.getColumn('D').width = 15;
        ordersSheet.getColumn('E').width = 15;
        ordersSheet.getColumn('F').width = 40;
        ordersSheet.getColumn('G').width = 15;
        
        // Add Products worksheet
        const productsSheet = workbook.addWorksheet('Top Products', {
            properties: { tabColor: { argb: '8B5CF6' } }
        });
        
        // Add title to products sheet
        productsSheet.mergeCells('A1:D1');
        productsSheet.getCell('A1').value = 'TOP SELLING PRODUCTS';
        productsSheet.getCell('A1').font = { size: 14, bold: true, color: { argb: '8B5CF6' } };
        productsSheet.getCell('A1').alignment = { horizontal: 'center' };
        productsSheet.getCell('A1').fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'F5F3FF' }
        };
        
        // Calculate product sales data
        const productSales = {};
        
        orders.forEach(order => {
            if (order.items && Array.isArray(order.items)) {
                order.items.forEach(item => {
                    if (item.product) {
                        // Properly handle both populated objects and IDs
                        const productId = typeof item.product === 'object' && item.product._id ? 
                            item.product._id.toString() : 
                            item.product.toString();
                        
                        // Get product name properly
                        let productName = 'Unknown Product';
                        let productAuthor = '';
                        let productPrice = 0;
                        
                        if (typeof item.product === 'object') {
                            if (item.product.title) {
                                productName = item.product.title;
                                if (item.product.author) {
                                    productAuthor = item.product.author;
                                }
                                if (item.product.price) {
                                    productPrice = Number(item.product.price);
                                }
                            }
                        }
                        
                        if (!productSales[productId]) {
                            productSales[productId] = {
                                name: productName,
                                author: productAuthor,
                                price: productPrice,
                                quantity: 0,
                                revenue: 0
                            };
                        }
                        
                        // Make sure quantity and price are numbers
                        const quantity = Number(item.quantity) || 0;
                        const price = Number(item.price) || 0;
                        
                        productSales[productId].quantity += quantity;
                        productSales[productId].revenue += (price * quantity);
                    }
                });
            }
        });
        
        // Convert to array and sort by revenue
        const topProducts = Object.values(productSales)
            .sort((a, b) => b.revenue - a.revenue)
            .slice(0, 25); // Show top 25 products
        
        // Add products table headers
        const productHeaders = ['Product', 'Author', 'Price', 'Quantity Sold', 'Revenue'];
        productHeaders.forEach((header, i) => {
            const col = String.fromCharCode(65 + i); // A, B, C, etc.
            productsSheet.getCell(`${col}3`).value = header;
            productsSheet.getCell(`${col}3`).font = { bold: true, color: { argb: 'FFFFFF' } };
            productsSheet.getCell(`${col}3`).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: '8B5CF6' }
            };
            productsSheet.getCell(`${col}3`).alignment = { horizontal: 'center' };
            productsSheet.getCell(`${col}3`).border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        });
        
        // Add product data
        topProducts.forEach((product, index) => {
            const rowIndex = 4 + index;
            
            productsSheet.getCell(`A${rowIndex}`).value = product.name;
            productsSheet.getCell(`B${rowIndex}`).value = product.author;
            productsSheet.getCell(`C${rowIndex}`).value = product.price;
            productsSheet.getCell(`D${rowIndex}`).value = product.quantity;
            productsSheet.getCell(`E${rowIndex}`).value = product.revenue;
            
            // Format numeric columns
            productsSheet.getCell(`C${rowIndex}`).numFmt = '₹#,##0.00';
            productsSheet.getCell(`E${rowIndex}`).numFmt = '₹#,##0.00';
            
            // Add alternating row styling
            if (index % 2 === 0) {
                for (let i = 0; i < productHeaders.length; i++) {
                    const col = String.fromCharCode(65 + i);
                    productsSheet.getCell(`${col}${rowIndex}`).fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'F9FAFB' }
                    };
                }
            }
            
            // Add borders to all cells
            for (let i = 0; i < productHeaders.length; i++) {
                const col = String.fromCharCode(65 + i);
                productsSheet.getCell(`${col}${rowIndex}`).border = {
                    top: { style: 'thin', color: { argb: 'E5E7EB' } },
                    left: { style: 'thin', color: { argb: 'E5E7EB' } },
                    bottom: { style: 'thin', color: { argb: 'E5E7EB' } },
                    right: { style: 'thin', color: { argb: 'E5E7EB' } }
                };
            }
        });
        
        // Set column widths for products sheet
        productsSheet.getColumn('A').width = 40;
        productsSheet.getColumn('B').width = 25;
        productsSheet.getColumn('C').width = 15;
        productsSheet.getColumn('D').width = 15;
        productsSheet.getColumn('E').width = 15;
        
        // Add Daily Sales worksheet
        const dailySheet = workbook.addWorksheet('Daily Sales', {
            properties: { tabColor: { argb: 'F59E0B' } }
        });
        
        // Add title to daily sales sheet
        dailySheet.mergeCells('A1:D1');
        dailySheet.getCell('A1').value = 'DAILY SALES DATA';
        dailySheet.getCell('A1').font = { size: 14, bold: true, color: { argb: 'F59E0B' } };
        dailySheet.getCell('A1').alignment = { horizontal: 'center' };
        dailySheet.getCell('A1').fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FEF3C7' }
        };
        
        // Add daily sales table headers
        const dailyHeaders = ['Date', 'Sales Amount', 'Discount', 'Net Sales'];
        dailyHeaders.forEach((header, i) => {
            const col = String.fromCharCode(65 + i); // A, B, C, etc.
            dailySheet.getCell(`${col}3`).value = header;
            dailySheet.getCell(`${col}3`).font = { bold: true, color: { argb: 'FFFFFF' } };
            dailySheet.getCell(`${col}3`).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'F59E0B' }
            };
            dailySheet.getCell(`${col}3`).alignment = { horizontal: 'center' };
            dailySheet.getCell(`${col}3`).border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' }
            };
        });
        
        // Combine and clean up daily sales data
        const combinedData = dailySalesData.map(salesDay => {
            const discountDay = discountData.find(d => d.date === salesDay.date);
            const discount = discountDay && !isNaN(discountDay.discount) ? Number(discountDay.discount) : 0;
            const sales = !isNaN(salesDay.sales) ? Number(salesDay.sales) : 0;
            
            return {
                date: salesDay.date,
                sales: sales,
                discount: discount,
                netSales: Math.max(0, sales - discount) // Ensure net sales isn't negative
            };
        }).filter(day => day.sales > 0 || day.discount > 0); // Only show days with data
        
        // Add daily sales data
        combinedData.forEach((day, index) => {
            const rowIndex = 4 + index;
            
            dailySheet.getCell(`A${rowIndex}`).value = new Date(day.date);
            dailySheet.getCell(`B${rowIndex}`).value = day.sales;
            dailySheet.getCell(`C${rowIndex}`).value = day.discount;
            dailySheet.getCell(`D${rowIndex}`).value = day.netSales;
            
            // Format date cell
            dailySheet.getCell(`A${rowIndex}`).numFmt = 'dd-mmm-yyyy';
            
            // Format currency cells
            dailySheet.getCell(`B${rowIndex}`).numFmt = '₹#,##0.00';
            dailySheet.getCell(`C${rowIndex}`).numFmt = '₹#,##0.00';
            dailySheet.getCell(`D${rowIndex}`).numFmt = '₹#,##0.00';
            
            // Add alternating row styling
            if (index % 2 === 0) {
                for (let i = 0; i < dailyHeaders.length; i++) {
                    const col = String.fromCharCode(65 + i);
                    dailySheet.getCell(`${col}${rowIndex}`).fill = {
                        type: 'pattern',
                        pattern: 'solid',
                        fgColor: { argb: 'FFFBEB' }
                    };
                }
            }
            
            // Add borders to all cells
            for (let i = 0; i < dailyHeaders.length; i++) {
                const col = String.fromCharCode(65 + i);
                dailySheet.getCell(`${col}${rowIndex}`).border = {
                    top: { style: 'thin', color: { argb: 'E5E7EB' } },
                    left: { style: 'thin', color: { argb: 'E5E7EB' } },
                    bottom: { style: 'thin', color: { argb: 'E5E7EB' } },
                    right: { style: 'thin', color: { argb: 'E5E7EB' } }
                };
            }
        });
        
        // Set column widths for daily sales sheet
        dailySheet.getColumn('A').width = 20;
        dailySheet.getColumn('B').width = 20;
        dailySheet.getColumn('C').width = 20;
        dailySheet.getColumn('D').width = 20;
        
        // Add metadata to the workbook
        const meta = workbook.addWorksheet('Info', {
            properties: { tabColor: { argb: '6B7280' } }
        });
        
        meta.getCell('A1').value = "BookSy Sales Report";
        meta.getCell('A1').font = { size: 14, bold: true };
        
        meta.getCell('A3').value = "Generated On:";
        meta.getCell('B3').value = new Date();
        meta.getCell('B3').numFmt = 'dd-mmm-yyyy hh:mm:ss';
        
        meta.getCell('A4').value = "Report Period:";
        meta.getCell('B4').value = `${formatDate(startDate)} to ${formatDate(endDate)}`;
        
        meta.getCell('A5').value = "Filter Type:";
        meta.getCell('B5').value = filterType.charAt(0).toUpperCase() + filterType.slice(1);
        
        meta.getCell('A6').value = "Status Filter:";
        meta.getCell('B6').value = orderStatusFilter;
        
        meta.getCell('A8').value = "Total Orders:";
        meta.getCell('B8').value = stats.totalOrders;
        
        meta.getCell('A9').value = "Total Sales:";
        meta.getCell('B9').value = stats.totalSales;
        meta.getCell('B9').numFmt = '₹#,##0.00';
        
      // Set column widths for metadata sheet
      meta.getColumn('A').width = 25;
      meta.getColumn('B').width = 30;
      
      // Finally write to a buffer and send as response
      const buffer = await workbook.xlsx.writeBuffer();
      
      // Set response headers
      const reportFileName = `booksy-sales-report-${startDate.toISOString().split('T')[0]}-to-${endDate.toISOString().split('T')[0]}.xlsx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=${reportFileName}`);
      res.setHeader('Content-Length', buffer.length);
      
      // Send the Excel file to client
      res.send(buffer);
      
  } catch (error) {
      console.error('Error generating Excel report:', error);
      res.status(500).send('Failed to generate Excel report');
  }
};
