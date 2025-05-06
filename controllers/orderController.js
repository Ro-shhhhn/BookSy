const Order = require('../models/orderModel');
const Product = require('../models/productModel');
const PDFDocument = require('pdfkit');
const User = require('../models/user')
const Wallet = require('../models/walletModel');
const ReturnRequest = require('../models/returnRequestModel');
const Coupon = require('../models/couponModel');
exports.getOrderListPage = async (req, res) => {
    try {
        const searchQuery = req.query.search || '';
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const skip = (page - 1) * limit;

        const searchConditions = searchQuery ? {
            $and: [
                { user: req.session.userId },
                {
                    $or: [
                        { 'uniqueOrderId': { $regex: searchQuery, $options: 'i' } },
                        { 'orderStatus': { $regex: searchQuery, $options: 'i' } },
                        { 
                            'items.product': await Product.findOne({ 
                                $or: [
                                    { title: { $regex: searchQuery, $options: 'i' } },
                                    { author: { $regex: searchQuery, $options: 'i' } }
                                ] 
                            }).select('_id') 
                        }
                    ]
                }
            ]
        } : { user: req.session.userId };

        const orders = await Order.find(searchConditions)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('items.product');

        const totalOrders = await Order.countDocuments(searchConditions);

        const processedOrders = orders.map(order => {
            const orderObj = order.toObject();
            orderObj.totalAmount = order.total;
            return orderObj;
        });

        res.render('user/orders', {
            orders: processedOrders,
            currentPage: page,
            totalPages: Math.ceil(totalOrders / limit),
            searchQuery,
            successMessage: req.flash('success'),
            errorMessage: req.flash('error')
        });
    } catch (error) {
        console.error('Error fetching orders:', error);
        res.status(500).render('error', { 
            message: 'Failed to fetch orders', 
            error: error.message 
        });
    }
};
exports.getOrderDetailsPage = async (req, res) => {
    try {
        const order = await Order.findOne({ 
            _id: req.params.orderId, 
            user: req.session.userId 
        }).populate('items.product shippingAddress');

        if (!order) {
            return res.status(404).render('error', { 
                message: 'Order not found' 
            });
        }

        console.log('Order Details:', {
            orderId: order._id,
            shippingAddressId: order.shippingAddress?._id,
            shippingAddressName: order.shippingAddress?.name,
            itemsCount: order.items.length
        });

        const processedOrder = order.toObject();
        processedOrder.totalAmount = order.total;

        res.render('user/order-details', { 
            order: processedOrder,
            successMessage: req.flash('success'),
            errorMessage: req.flash('error')
        });
    } catch (error) {
        console.error('Error fetching order details:', error);
        res.status(500).render('error', { 
            message: 'Failed to fetch order details', 
            error: error.message 
        });
    }
};
exports.cancelOrder = async (req, res) => {
    try {
        const { reason } = req.body;
        const order = await Order.findOne({ 
            _id: req.params.orderId, 
            user: req.session.userId 
        }).populate('items.product');

        if (!order) {
            req.flash('error', 'Order not found');
            return res.redirect('/orders');
        }

        if (!['Pending', 'Processing'].includes(order.orderStatus)) {
            req.flash('error', 'Order cannot be cancelled at this stage');
            return res.redirect('/orders');
        }

        for (let item of order.items) {
            await Product.findByIdAndUpdate(item.product._id, {
                $inc: { stock: item.quantity }
            });
        }

        order.orderStatus = 'Cancelled';
        order.cancellationReason = reason;
        await order.save();

        const isCashOnDelivery = order.paymentMethod === 'Cash on Delivery' || 
                               order.paymentMethod === 'cashOnDelivery';
        
        if (!isCashOnDelivery || (isCashOnDelivery && order.paymentStatus === 'paid')) {
            let wallet = await Wallet.findOne({ user: req.session.userId });
            if (!wallet) {
                wallet = new Wallet({
                    user: req.session.userId,
                    balance: 0
                });
            }
            
            await wallet.credit(
                order.total,
                `Refund for cancelled order #${order.uniqueOrderId}`,
                order._id
            );
            
            req.flash('success', 'Order cancelled successfully. Amount refunded to your wallet.');
        } else {
            req.flash('success', 'Order cancelled successfully');
        }
        
        res.redirect('/orders');
    } catch (error) {
        console.error('Error cancelling order:', error);
        req.flash('error', 'Failed to cancel order');
        res.redirect('/orders');
    }
};
exports.cancelOrderProduct = async (req, res) => {
    try {
        const { productId, reason } = req.body;
        const order = await Order.findOne({ 
            _id: req.params.orderId, 
            user: req.session.userId 
        }).populate('items.product');

        if (!order) {
            req.flash('error', 'Order not found');
            return res.redirect('/orders');
        }

        // Updated to include "Shipped" status for cancellation
        if (!['Pending', 'Processing', 'Shipped'].includes(order.orderStatus)) {
            req.flash('error', 'Order cannot be cancelled at this stage');
            return res.redirect(`/orders/${req.params.orderId}`);
        }

        const productItem = order.items.find(item => 
            item.product._id.toString() === productId
        );

        if (!productItem) {
            req.flash('error', 'Product not found in order');
            return res.redirect(`/orders/${req.params.orderId}`);
        }

        await Product.findByIdAndUpdate(productId, {
            $inc: { stock: productItem.quantity }
        });

        const productTotalPrice = productItem.price * productItem.quantity;

        productItem.returnStatus = 'Cancelled';
        productItem.returnReason = reason || null;
        
        order.subtotal -= productTotalPrice;
        order.total = order.subtotal - order.discount;

        const activeItems = order.items.filter(item => 
            item.returnStatus !== 'Cancelled' && 
            item.returnStatus !== 'Approved'
        );
        
        if (activeItems.length === 0) {
            order.orderStatus = 'Cancelled';
            order.cancellationReason = 'All products cancelled';
        }

        await order.save();

        const isCashOnDelivery = order.paymentMethod === 'Cash on Delivery' || 
                                order.paymentMethod === 'cashOnDelivery';
        
        if (!isCashOnDelivery || (isCashOnDelivery && order.paymentStatus === 'paid')) {
            let wallet = await Wallet.findOne({ user: req.session.userId });
            if (!wallet) {
                wallet = new Wallet({
                    user: req.session.userId,
                    balance: 0
                });
            }
            
            await wallet.credit(
                productTotalPrice,
                `Refund for cancelled product in order #${order.uniqueOrderId}`,
                order._id
            );
            
            req.flash('success', 'Product cancelled successfully. Amount refunded to your wallet.');
        } else {
            req.flash('success', 'Product cancelled successfully');
        }
        
        res.redirect(`/orders/${req.params.orderId}`);
    } catch (error) {
        console.error('Error cancelling product:', error);
        req.flash('error', `Failed to cancel product: ${error.message}`);
        res.redirect(`/orders/${req.params.orderId}`);
    }
};

exports.returnOrder = async (req, res) => {
    try {
        const { reason } = req.body;
        const order = await Order.findOne({ 
            _id: req.params.orderId, 
            user: req.session.userId         });

        if (!order) {
            return res.status(404).json({ 
                success: false, 
                message: 'Order not found' 
            });
        }

        if (order.orderStatus !== 'Delivered') {
            return res.status(400).json({ 
                success: false, 
                message: 'Only delivered orders can be returned' 
            });
        }

        
        if (!reason) {
            return res.status(400).json({ 
                success: false, 
                message: 'Return reason is mandatory' 
            });
        }

        order.orderStatus = 'Returned';
        order.returnReason = reason;

        for (let item of order.items) {
            await Product.findByIdAndUpdate(item.product, {
                $inc: { stock: item.quantity }
            });
        }

        await order.save();

        res.status(200).json({ 
            success: true, 
            message: 'Order return request processed' 
        });
    } catch (error) {
        console.error('Error returning order:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to process return', 
            error: error.message 
        });
    }
};
exports.createReturnRequest = async (req, res) => {
    try {
        const { reason } = req.body;
        const orderId = req.params.orderId;

        const order = await Order.findOne({ 
            _id: orderId, 
            user: req.session.userId,
            orderStatus: 'Delivered'
        });

        if (!order) {
            return res.status(404).json({ 
                success: false, 
                message: 'Order not found or not eligible for return' 
            });
        }

        const existingReturnRequest = await ReturnRequest.findOne({ 
            order: orderId, 
            status: { $ne: 'Rejected' } 
        });

        if (existingReturnRequest) {
            return res.status(400).json({ 
                success: false, 
                message: 'A return request for this order is already in process' 
            });
        }

        if (!reason || reason.trim().length < 10) {
            return res.status(400).json({ 
                success: false, 
                message: 'Please provide a detailed return reason (min 10 characters)' 
            });
        }

        const returnRequest = new ReturnRequest({
            order: orderId,
            user: req.session.userId,
            reason: reason,
            status: 'Pending'
        });

        await returnRequest.save();

        order.returnStatus = 'Pending';
        await order.save();

        res.status(201).json({ 
            success: true, 
            message: 'Return request submitted successfully. Awaiting admin approval.',
            returnRequest 
        });
    } catch (error) {
        console.error('Error creating return request:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to create return request',
            error: error.message 
        });
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
            .limit(limit);

        res.render('admin/return-requests', { 
            returnRequests,
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

exports.processReturnRequest = async (req, res) => {
    try {
        const { returnRequestId, action, adminNotes } = req.body;

        const returnRequest = await ReturnRequest.findByIdAndUpdate(
            returnRequestId,
            {
                status: action === 'approve' ? 'Approved' : 'Rejected',
                adminNotes: adminNotes
            },
            { new: true }
        ).populate('products.product order');

        if (!returnRequest) {
            return res.status(404).json({ 
                success: false, 
                message: 'Return request not found' 
            });
        }

        if (action === 'approve') {
            const order = await Order.findById(returnRequest.order._id);
            
            if (returnRequest.products && returnRequest.products.length > 0) {
                const returnedProductIds = returnRequest.products.map(item => 
                    item.product._id.toString()
                );
                
                order.items.forEach(item => {
                    if (returnedProductIds.includes(item.product.toString())) {
                        item.returnStatus = 'Approved';
                        item.returnReason = returnRequest.reason;
                    }
                });
                
                const allProductsReturned = order.items.every(item => 
                    item.returnStatus === 'Approved'
                );
                
                if (allProductsReturned) {
                    order.orderStatus = 'Returned';
                } else {
                    order.orderStatus = 'Delivered';
                }
                
                for (const returnItem of returnRequest.products) {
                    await Product.findByIdAndUpdate(returnItem.product, {
                        $inc: { stock: returnItem.quantity }
                    });
                }
                
                await order.save();
            }
        }

        res.status(200).json({ 
            success: true, 
            message: 'Return request processed successfully',
            returnRequest 
        });
    } catch (error) {
        console.error('Error processing return request:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to process return request',
            error: error.message 
        });
    }
};
exports.downloadInvoice = async (req, res) => {
    try {
      const user = await User.findById(req.session.userId);
      const order = await Order.findOne({ 
        _id: req.params.orderId, 
        user: req.session.userId 
      }).populate('items.product shippingAddress');
  
      if (!order) {
        return res.status(404).render('error', { 
          message: 'Order not found' 
        });
      }
  
      // Get coupon information if applied
      let appliedCoupon = null;
      if (order.couponCode) {
        appliedCoupon = await Coupon.findOne({ code: order.couponCode });
      }
  
      // Create PDF document
      const doc = new PDFDocument({
        size: 'A4',
        margin: 50,
        info: {
          Title: `Invoice #${order.uniqueOrderId}`,
          Author: 'Your E-commerce Store',
          Subject: 'Purchase Invoice',
        }
      });
      
      // Set response headers for PDF download
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename=invoice-${order.uniqueOrderId}.pdf`);
      doc.pipe(res);
  
      // Helper functions
      const formatDate = (date) => {
        return new Date(date).toLocaleDateString('en-IN', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
      };
  
      // Fixed currency formatter with standard rupee symbol
      const formatCurrency = (amount) => {
        // Using standard Rs. notation instead of the rupee symbol to avoid encoding issues
        return 'Rs. ' + Number(amount).toFixed(2);
      };
  
      // Document styling variables
      const primaryColor = '#0047AB'; // Strong blue color
      const secondaryColor = '#505050'; // Dark gray
      const accentColor = '#0070C0'; // Bright blue for highlights
      const successColor = '#2E8B57'; // Sea green for positive values
      const lightBg = '#F8FAFC'; // Light background color
      const borderColor = '#CBD5E1'; // Border color
      
      const fontRegular = 'Helvetica';
      const fontBold = 'Helvetica-Bold';
  
      // === HEADER SECTION ===
      doc.rect(50, 50, 500, 90).fill(lightBg).stroke(borderColor);
      
      // Company logo and info
      doc.fontSize(22).font(fontBold).fillColor(primaryColor).text('BookSy', 70, 65);
      doc.fontSize(10).font(fontRegular).fillColor(secondaryColor)
        .text('Premium E-commerce Experience', 70, 90)
        .text('www.BookSy.com', 70, 105)
        .text('BookSy.com | +916282242535', 70, 120);
      
      // Invoice title and details
      doc.fontSize(16).font(fontBold).fillColor(accentColor).text('INVOICE', 420, 65);
      doc.fontSize(10).font(fontBold).fillColor(secondaryColor).text(`#${order.uniqueOrderId}`, 420, 90);
      doc.fontSize(10).font(fontRegular).fillColor(secondaryColor).text(`Date: ${formatDate(order.createdAt)}`, 420, 105);
      
      // Set status color based on order status
      let statusColor = accentColor;
      if (order.orderStatus === 'Cancelled') statusColor = '#DC2626';
      else if (order.orderStatus === 'Delivered') statusColor = '#059669';
      else if (order.orderStatus === 'Processing') statusColor = '#D97706';
      
      doc.fontSize(10).font(fontBold).fillColor(statusColor).text(`Status: ${order.orderStatus}`, 420, 120);
      
      // === CUSTOMER & SHIPPING SECTION ===
      const infoStartY = 170;
      
      // Customer information
      doc.rect(50, infoStartY, 240, 100).fill(lightBg).stroke(borderColor);
      doc.fontSize(12).font(fontBold).fillColor(primaryColor)
        .text('CUSTOMER DETAILS', 60, infoStartY + 10);
      
      doc.fontSize(10).font(fontBold).fillColor(secondaryColor)
        .text(`${user.name}`, 60, infoStartY + 30);
      
      doc.fontSize(9).font(fontRegular).fillColor(secondaryColor)
        .text(`Email: ${user.email}`, 60, infoStartY + 45);
      
      // Fix: Use the customer's phone number from user model if available
      doc.fontSize(9).font(fontRegular).fillColor(secondaryColor)
        .text(`Phone: ${user.phone || (order.shippingAddress && order.shippingAddress.phone) || 'Not provided'}`, 60, infoStartY + 60);
        
      doc.fontSize(9).font(fontRegular).fillColor(secondaryColor)
        .text(`Customer ID: ${user._id.toString().slice(-8).toUpperCase()}`, 60, infoStartY + 75);
      
      // Shipping information
      doc.rect(310, infoStartY, 240, 100).fill(lightBg).stroke(borderColor);
      doc.fontSize(12).font(fontBold).fillColor(primaryColor)
        .text('SHIPPING ADDRESS', 320, infoStartY + 10);
      
      if (order.shippingAddress) {
        doc.fontSize(9).font(fontBold).fillColor(secondaryColor)
          .text(`${order.shippingAddress.name}`, 320, infoStartY + 30);
        
        doc.fontSize(9).font(fontRegular).fillColor(secondaryColor)
          .text(`${order.shippingAddress.streetAddress}`, 320, infoStartY + 45)
          .text(`${order.shippingAddress.city}, ${order.shippingAddress.state} ${order.shippingAddress.zipCode}`, 320, infoStartY + 60)
          .text(`${order.shippingAddress.country}`, 320, infoStartY + 75)
          .text(`Phone: ${order.shippingAddress.phone}`, 320, infoStartY + 90);
      } else {
        doc.fontSize(9).font(fontRegular).fillColor(secondaryColor)
          .text('No shipping address provided', 320, infoStartY + 30);
      }
      
      // === PAYMENT & ORDER INFO ===
      const paymentStartY = infoStartY + 120;
      
      // Payment box
      doc.rect(50, paymentStartY, 240, 60).fill(lightBg).stroke(borderColor);
      doc.fontSize(12).font(fontBold).fillColor(primaryColor)
        .text('PAYMENT INFORMATION', 60, paymentStartY + 10);
      
      doc.fontSize(9).font(fontRegular).fillColor(secondaryColor)
        .text(`Method: ${order.paymentMethod || 'Not specified'}`, 60, paymentStartY + 30)
        .text(`Status: ${order.paymentStatus || 'Not specified'}`, 60, paymentStartY + 45);
      
      // Order info box
      doc.rect(310, paymentStartY, 240, 60).fill(lightBg).stroke(borderColor);
      doc.fontSize(12).font(fontBold).fillColor(primaryColor)
        .text('ORDER INFORMATION', 320, paymentStartY + 10);
      
      doc.fontSize(9).font(fontRegular).fillColor(secondaryColor)
        .text(`Order Date: ${formatDate(order.createdAt)}`, 320, paymentStartY + 30)
        .text(`Shipping Method: ${order.shippingMethod || 'Standard Shipping'}`, 320, paymentStartY + 45);
      
      // === ORDER ITEMS TABLE ===
      const tableStartY = paymentStartY + 90;
      
      // Table header
      doc.rect(50, tableStartY, 500, 25).fill(primaryColor);
      
      // Table headers with fixed width columns
      const tableHeaders = ['#', 'Product', 'Qty', 'Price', 'Total'];
      const columnWidths = [40, 220, 60, 90, 90];
      
      // Draw each header in its position
      doc.fontSize(10).font(fontBold).fillColor('#FFFFFF')
        .text(tableHeaders[0], 70, tableStartY + 8, { width: columnWidths[0], align: 'center' })
        .text(tableHeaders[1], 110, tableStartY + 8, { width: columnWidths[1], align: 'left' })
        .text(tableHeaders[2], 330, tableStartY + 8, { width: columnWidths[2], align: 'center' })
        .text(tableHeaders[3], 390, tableStartY + 8, { width: columnWidths[3], align: 'right' })
        .text(tableHeaders[4], 480, tableStartY + 8, { width: columnWidths[4], align: 'right' });
      
      // Table rows
      let y = tableStartY + 25;
      const lineHeight = 30;
      
      // Compute the discounted total (subtotal minus discount)
      const discountedTotal = order.subtotal - order.discount;
      
      // Draw alternating row backgrounds
      order.items.forEach((item, i) => {
        const rowY = y + (i * lineHeight);
        doc.rect(50, rowY, 500, lineHeight).fill(i % 2 === 0 ? '#FFFFFF' : lightBg);
      });
      
      // Add table items with correct prices
      let calculatedTotal = 0;
      order.items.forEach((item, i) => {
        const rowY = y + (i * lineHeight) + 10;
        
        // Item number
        doc.fontSize(9).font(fontRegular).fillColor(secondaryColor)
          .text((i + 1).toString(), 70, rowY, { width: columnWidths[0], align: 'center' });
        
        // Product name
        const productName = item.product ? item.product.title : 'Product name unavailable';
        doc.fontSize(9).font(fontBold).fillColor(secondaryColor)
          .text(productName.length > 35 ? productName.substring(0, 32) + '...' : productName, 
                110, rowY - 5, { width: columnWidths[1], align: 'left' });
        
        // Add variant information if available
        if (item.product && (item.product.color || item.product.size)) {
          const details = [];
          if (item.product.color) details.push(`Color: ${item.product.color}`);
          if (item.product.size) details.push(`Size: ${item.product.size}`);
          
          doc.fontSize(8).font(fontRegular).fillColor(secondaryColor)
            .text(details.join(' | '), 110, rowY + 10, { width: columnWidths[1], align: 'left' });
        }
        
        // Quantity
        doc.fontSize(9).font(fontRegular).fillColor(secondaryColor)
          .text(item.quantity.toString(), 330, rowY, { width: columnWidths[2], align: 'center' });
        
        // Calculate what percentage this item is of the subtotal
        const itemSubtotal = item.price * item.quantity;
        const itemSubtotalPercentage = itemSubtotal / order.subtotal;
        
        // Apply that percentage to the discounted total to get item's share
        const itemDiscountedTotal = parseFloat((discountedTotal * itemSubtotalPercentage).toFixed(2));
        
        // Calculate the effective unit price (after discount)
        const effectiveUnitPrice = parseFloat((itemDiscountedTotal / item.quantity).toFixed(2));
        
        // Add to our running total to verify accuracy
        calculatedTotal += itemDiscountedTotal;
        
        // Unit price - Show the discounted price
        const unitPrice = formatCurrency(effectiveUnitPrice);
        doc.fontSize(9).font(fontRegular).fillColor(secondaryColor)
          .text(unitPrice, 390, rowY, { width: columnWidths[3], align: 'right' });
        
        // Total price - Using the calculated discounted total for this item
        const totalPrice = formatCurrency(itemDiscountedTotal);
        doc.fontSize(9).font(fontRegular).fillColor(secondaryColor)
          .text(totalPrice, 480, rowY, { width: columnWidths[4], align: 'right' });
      });
      
      // Make sure our calculated total is accurate (within a small margin of error for floating point)
      // The absolute difference between calculated total and actual discounted total should be very small
      if (Math.abs(calculatedTotal - discountedTotal) > 0.1) {
        console.log('Warning: Calculated total does not match discounted total. Diff:', 
          Math.abs(calculatedTotal - discountedTotal));
        console.log('Calculated:', calculatedTotal, 'Discounted:', discountedTotal);
      }
      
      // Calculate the end position of the items table
      const tableEndY = y + (order.items.length * lineHeight);
      
      // === SUMMARY SECTION ===
      const summaryStartY = tableEndY + 20;
      
      // Draw summary box
      doc.rect(300, summaryStartY, 250, appliedCoupon ? 140 : 110).fill(lightBg).stroke(borderColor);
      
      // Summary title
      doc.fontSize(12).font(fontBold).fillColor(primaryColor)
        .text('ORDER SUMMARY', 320, summaryStartY + 15);
      
      let summaryLineY = summaryStartY + 40;
      
      // Subtotal
      doc.fontSize(9).font(fontRegular).fillColor(secondaryColor)
        .text('Subtotal:', 320, summaryLineY);
      
      doc.fontSize(9).font(fontRegular).fillColor(secondaryColor)
        .text(formatCurrency(order.subtotal), 530, summaryLineY, { align: 'right', width: 0 });
      
      summaryLineY += 20;
      
      // Shipping
      doc.fontSize(9).font(fontRegular).fillColor(secondaryColor)
        .text('Shipping:', 320, summaryLineY);
      
      doc.fontSize(9).font(fontRegular).fillColor(secondaryColor)
        .text(formatCurrency(order.shippingCost || 0), 530, summaryLineY, { align: 'right', width: 0 });
      
      // Coupon discount
      if (order.discount > 0) {
        summaryLineY += 20;
        
        doc.fontSize(9).font(fontBold).fillColor(successColor)
          .text(`Discount (${order.couponCode || 'Applied'}):`, 320, summaryLineY);
        
        doc.fontSize(9).font(fontBold).fillColor(successColor)
          .text(`- ${formatCurrency(order.discount || 0)}`, 530, summaryLineY, { align: 'right', width: 0 });
      }
      
      // Tax (if applicable)
      if (order.tax) {
        summaryLineY += 20;
        
        doc.fontSize(9).font(fontRegular).fillColor(secondaryColor)
          .text('Tax:', 320, summaryLineY);
        
        doc.fontSize(9).font(fontRegular).fillColor(secondaryColor)
          .text(formatCurrency(order.tax), 530, summaryLineY, { align: 'right', width: 0 });
      }
      
      // Divider line before total
      summaryLineY += 20;
      doc.moveTo(320, summaryLineY).lineTo(530, summaryLineY).strokeColor(borderColor).stroke();
      summaryLineY += 15;
      
      // Total
      doc.fontSize(12).font(fontBold).fillColor(primaryColor)
        .text('TOTAL:', 320, summaryLineY);
      
      doc.fontSize(12).font(fontBold).fillColor(primaryColor)
        .text(formatCurrency(order.total), 530, summaryLineY, { align: 'right', width: 0 });
      
      // === TERMS AND POLICY SECTION ===
      const termsY = summaryStartY + (order.discount > 0 ? 180 : 150);
      
      doc.rect(50, termsY, 500, 100).fill(lightBg).stroke(borderColor);
      
      doc.fontSize(11).font(fontBold).fillColor(primaryColor)
        .text('TERMS & CONDITIONS', 70, termsY + 15);
      
      doc.fontSize(8).font(fontRegular).fillColor(secondaryColor)
        .text('• Items are subject to our return policy. Returns accepted within 30 days of purchase.', 70, termsY + 35)
        .text('• Please retain this invoice for warranty and return purposes.', 70, termsY + 50)
        .text('• For any issues or queries regarding this order, please contact our customer support.', 70, termsY + 65)
        .text('• Delivery timeframes are estimates and may vary based on location and product availability.', 70, termsY + 80);
      
      // === FOOTER ===
      const footerTop = 770;
      
      // Footer line
      doc.rect(50, footerTop, 500, 25).fill(primaryColor);
      
      // Footer text
      doc.fontSize(9).font(fontBold).fillColor('#FFFFFF')
        .text('Thank you for shopping with us!', 300, footerTop + 8, { align: 'center' });
      
      // Page number
      doc.fontSize(8).font(fontRegular).fillColor(secondaryColor)
        .text('Page 1 of 1', 500, footerTop - 15, { align: 'right' });
      
      // End the document
      doc.end();
    } catch (error) {
      console.error('Error generating invoice:', error);
      res.status(500).render('error', { 
        message: 'Failed to generate invoice', 
        error: error.message 
      });
    }
  };
exports.createReturnRequestForProducts = async (req, res) => {
    try {
        const { reason, productIds } = req.body;
        const orderId = req.params.orderId;

        if (!productIds || !Array.isArray(productIds) || productIds.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'You must select at least one product to return' 
            });
        }

        const order = await Order.findOne({ 
            _id: orderId, 
            user: req.session.userId,
            orderStatus: 'Delivered'
        }).populate('items.product');

        if (!order) {
            return res.status(404).json({ 
                success: false, 
                message: 'Order not found or not eligible for return' 
            });
        }

        if (!reason || reason.trim().length < 10) {
            return res.status(400).json({ 
                success: false, 
                message: 'Please provide a detailed return reason (min 10 characters)' 
            });
        }

        const validProductIds = order.items.map(item => item.product._id.toString());
        const invalidProducts = productIds.filter(id => !validProductIds.includes(id));
        
        if (invalidProducts.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Some selected products do not belong to this order' 
            });
        }

        const existingReturns = await ReturnRequest.find({
            order: orderId,
            status: { $ne: 'Rejected' },
            'products.product': { $in: productIds }
        });

        if (existingReturns.length > 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'One or more products already have pending return request Or returned' 
            });
        }

        const productsToReturn = order.items
            .filter(item => productIds.includes(item.product._id.toString()))
            .map(item => ({
                product: item.product._id,
                quantity: item.quantity,
                reason: reason
            }));

        const returnRequest = new ReturnRequest({
            order: orderId,
            user: req.session.userId,
            products: productsToReturn,
            reason: reason,
            status: 'Pending'
        });

        await returnRequest.save();

        for (let item of order.items) {
            if (productIds.includes(item.product._id.toString())) {
                item.returnStatus = 'Pending';
                item.returnReason = reason;
            }
        }
        await order.save();

        res.status(201).json({ 
            success: true, 
            message: 'Return request submitted successfully. Awaiting admin approval.',
            returnRequest 
        });
    } catch (error) {
        console.error('Error creating return request:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to create return request',
            error: error.message 
        });
    }
};







exports.updateOrderStatus = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { status } = req.body;
        
        const order = await Order.findById(orderId);
        
        if (!order) {
            return res.status(404).json({
                success: false,
                message: 'Order not found'
            });
        }
        
        order.orderStatus = status;
        
        // Automatically update payment status to paid when order is delivered
        if (status === 'Delivered') {
            order.paymentStatus = 'paid';
        }
        
        await order.save();
        
        return res.status(200).json({
            success: true,
            message: 'Order status updated successfully',
            order
        });
    } catch (error) {
        console.error('Error updating order status:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to update order status',
            error: error.message
        });
    }
};

// Add route to handle ship-to-cancel functionality
exports.cancelShippedOrder = async (req, res) => {
    try {
        const { orderId } = req.params;
        const { reason } = req.body;
        
        const order = await Order.findOne({
            _id: orderId,
            user: req.session.userId,
            orderStatus: 'Shipped'
        }).populate('items.product');
        
        if (!order) {
            req.flash('error', 'Order not found or cannot be cancelled at this stage');
            return res.redirect('/orders');
        }
        
        // Return items to inventory
        for (let item of order.items) {
            await Product.findByIdAndUpdate(item.product._id, {
                $inc: { stock: item.quantity }
            });
        }
        
        order.orderStatus = 'Cancelled';
        order.cancellationReason = reason || 'Cancelled by user during shipping';
        await order.save();
        
        // Handle refund if payment was already made
        if (order.paymentStatus === 'paid') {
            let wallet = await Wallet.findOne({ user: req.session.userId });
            if (!wallet) {
                wallet = new Wallet({
                    user: req.session.userId,
                    balance: 0
                });
            }
            
            await wallet.credit(
                order.total,
                `Refund for cancelled shipped order #${order.uniqueOrderId}`,
                order._id
            );
            
            req.flash('success', 'Order cancelled successfully. Amount refunded to your wallet.');
        } else {
            req.flash('success', 'Order cancelled successfully');
        }
        
        res.redirect('/orders');
    } catch (error) {
        console.error('Error cancelling shipped order:', error);
        req.flash('error', `Failed to cancel order: ${error.message}`);
        res.redirect('/orders');
    }
};