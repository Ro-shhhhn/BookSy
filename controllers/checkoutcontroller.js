const mongoose = require('mongoose');
const Address = require('../models/addressModel');
const Cart = require('../models/cartModel');
const Product = require('../models/productModel');
const Order = require('../models/orderModel');
const razorpayInstance = require('../config/razorpay'); 
const crypto = require('crypto');
const { message } = require('statuses');
const { resolveSoa } = require('dns');
const Coupon = require('../models/couponModel');
const Wallet = require('../models/walletModel');
const User = require('../models/user');
const CategoryOffer = require('../models/categoryOfferModel');
const offerUtils = require('../utils/offerUtils');

const applyBestOfferToCartItems = async (cartItems) => {
  if (!cartItems || cartItems.length === 0) return cartItems;
  
  const now = new Date();
  
  const productIds = cartItems.map(item => item.product._id || item.product);
  const products = await Product.find({ _id: { $in: productIds } }).populate('category');
  
  const productsMap = new Map();
  products.forEach(product => {
    productsMap.set(product._id.toString(), product);
  });
  
  const categoryIds = [...new Set(products.map(p => p.category._id.toString()))];
  
  const categoryOffers = await CategoryOffer.find({
    category: { $in: categoryIds },
    isActive: true,
    startDate: { $lte: now },
    endDate: { $gte: now }
  });
  
  const categoryOffersMap = new Map();
  categoryOffers.forEach(offer => {
    const categoryId = offer.category.toString();
    categoryOffersMap.set(categoryId, offer);
  });
  
  return cartItems.map(item => {
    const cartItem = { ...item };
    const productId = (item.product._id || item.product).toString();
    const product = productsMap.get(productId);
    
    if (!product) return cartItem;
    
    const categoryId = product.category._id.toString();
    const categoryOffer = categoryOffersMap.get(categoryId);
    
    const productDiscount = product.discountPrice || 0;
    
    if (categoryOffer) {
      const categoryDiscountAmount = Math.floor((product.price * categoryOffer.discountPercentage) / 100);
      
      if (categoryDiscountAmount > productDiscount) {
        cartItem.effectiveDiscount = categoryDiscountAmount;
        cartItem.discountSource = 'category';
        cartItem.discountPercentage = categoryOffer.discountPercentage;
        cartItem.unitPrice = product.price;
        cartItem.discountedUnitPrice = product.price - categoryDiscountAmount;
        cartItem.totalPrice = cartItem.quantity * cartItem.discountedUnitPrice;
      } else {
        cartItem.effectiveDiscount = productDiscount;
        cartItem.discountSource = 'product';
        cartItem.discountPercentage = productDiscount > 0 ? 
          Math.round((productDiscount / product.price) * 100) : 0;
        cartItem.unitPrice = product.price;
        cartItem.discountedUnitPrice = product.price - productDiscount;
        cartItem.totalPrice = cartItem.quantity * cartItem.discountedUnitPrice;
      }
    } else {
      cartItem.effectiveDiscount = productDiscount;
      cartItem.discountSource = productDiscount > 0 ? 'product' : 'none';
      cartItem.discountPercentage = productDiscount > 0 ? 
        Math.round((productDiscount / product.price) * 100) : 0;
      cartItem.unitPrice = product.price;
      cartItem.discountedUnitPrice = product.price - productDiscount;
      cartItem.totalPrice = cartItem.quantity * cartItem.discountedUnitPrice;
    }
    
    return cartItem;
  });
};

exports.renderCheckoutPage = async (req, res) => {
    try {
        const userId = req.session.userId;
        const addresses = await Address.find({ user: userId });
        
        const cart = await Cart.findOne({ user: userId }).populate('items.product');
        
        if (!cart || cart.items.length === 0) {
            return res.redirect('/cart');
        }

        const validCartItems = cart.items.filter(item => {
            const product = item.product;
            return product && product.isActive && product.stock >= item.quantity;
        });

        if (validCartItems.length !== cart.items.length) {
            cart.items = validCartItems;
            await cart.save();
            
            if (validCartItems.length === 0) {
                return res.redirect('/cart?error=invalid_products');
            }
        }

        if (addresses.length === 0) {
            return res.redirect('/checkout/edit-address/new');
        }

        let defaultAddress = addresses.find(addr => addr.isDefault);
        if (!defaultAddress) {
            const firstAddress = addresses[0];
            firstAddress.isDefault = true;
            await firstAddress.save();
            defaultAddress = firstAddress;
        }
        const addressAdded = req.query.addressAdded === 'true';

        let wallet = await Wallet.findOne({ user: userId });
        if (!wallet) {
            wallet = new Wallet({
                user: userId,
                balance: 0,
                transactions: []
            });
            await wallet.save();
        }
        
        for (const item of cart.items) {
            if (item.product) {
                const productWithCategory = await Product.findById(item.product._id).populate('category');
                if (productWithCategory) {
                    const categoryOffer = await offerUtils.getActiveCategoryOffer(productWithCategory.category._id);
                    
                    const discountInfo = offerUtils.calculateBestDiscount(
                        productWithCategory.price,
                        productWithCategory.discountPrice,
                        categoryOffer
                    );
                    
                    item.product.finalPrice = discountInfo.finalPrice;
                    item.product.effectiveDiscount = discountInfo.effectiveDiscount;
                    item.product.discountSource = discountInfo.discountSource;
                    item.product.discountPercentage = discountInfo.discountPercentage;
                    
                    item.totalPrice = item.quantity * discountInfo.finalPrice;
                }
            }
        }
        
        cart.totalAmount = cart.items.reduce((sum, item) => 
            sum + (item.totalPrice || 0), 0);

        const cartTotal = cart.totalAmount;
        const eligibleCoupons = await Coupon.find({
            isActive: true,
            expirationDate: { $gt: new Date() },
            minAmount: { $lte: cartTotal },
            $or: [
                { maxAmount: { $gte: cartTotal } },
                { maxAmount: Infinity }
            ]
        }).sort({ discount: -1 });
        
        res.render('checkout', {
            addresses,
            cart,
            defaultAddress,
            addressAdded,
            eligibleCoupons,
            appliedCoupon: req.session.appliedCoupon || null,
            wallet, 
            pageTitle: 'Checkout'
        });
    } catch (error) {
        console.error('Checkout page error:', error);
        res.status(500).render('error', { 
            message: 'Error loading checkout page',
            error: error 
        });
    }
};

exports.placeOrder = async (req, res) => {
    try {
        const { addressId, coupon, paymentMethod } = req.body;
        const userId = req.session.userId;

        if (!addressId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Shipping address is required',
                errorType: 'ADDRESS_REQUIRED'
            });
        }

        const address = await Address.findOne({ _id: addressId, user: userId });
        if (!address) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid or unauthorized shipping address',
                errorType: 'INVALID_ADDRESS'
            });
        }

        const cart = await Cart.findOne({ user: userId }).populate('items.product');
        if (!cart || !cart.items || cart.items.length === 0) {
            return res.status(400).json({ success: false, message: 'Your cart is empty', errorType: 'EMPTY_CART' });
        }

        console.log("Cart items structure:", JSON.stringify(cart.items.map(item => ({
            product: item.product,
            quantity: item.quantity
        })), null, 2));

        const stockValidationErrors = [];
        let subtotal = 0;
        const orderItems = [];

        const productIds = [];
        
        for (const item of cart.items) {
            console.log("Item:", item);
            if (item.product) {
                let productId;
                
                if (typeof item.product === 'object' && item.product._id) {
                    productId = item.product._id.toString();
                    console.log("Product ID from object:", productId);
                } else if (typeof item.product === 'string') {
                    productId = item.product;
                    console.log("Product ID from string:", productId);
                } else {
                    console.log("Unrecognized product format:", typeof item.product);
                }
                
                if (productId) {
                    productIds.push(productId);
                }
            }
        }

        console.log("Extracted product IDs:", productIds);

        const products = await Product.find({ _id: { $in: productIds } }).populate('category');
        console.log("Found products count:", products.length);
        
        const productsMap = {};
        
        products.forEach(product => {
            productsMap[product._id.toString()] = product;
        });
        
        console.log("Product map keys:", Object.keys(productsMap));

        for (const item of cart.items) {
            let productId;
            
            if (item.product) {
                if (typeof item.product === 'object' && item.product._id) {
                    productId = item.product._id.toString();
                } else if (typeof item.product === 'string') {
                    productId = item.product;
                }
            }
            
            if (!productId) {
                stockValidationErrors.push(`Product ID missing in cart item`);
                continue;
            }

            const product = productsMap[productId];
            
            if (!product) {
                stockValidationErrors.push(`Product not found for ID: ${productId}`);
                continue;
            }

            if (!product.isActive) {
                stockValidationErrors.push(`Product "${product.title}" is no longer available for purchase`);
                continue;
            }

            if (product.stock < item.quantity) {
                stockValidationErrors.push(`Insufficient stock for ${product.title}. Available: ${product.stock}, Requested: ${item.quantity}`);
                continue;
            }
            
            if (item.quantity <= 0) {
                stockValidationErrors.push(`Invalid quantity for ${product.title}`);
                continue;
            }
            
            const categoryOffer = await offerUtils.getActiveCategoryOffer(product.category);
            
            const discountInfo = offerUtils.calculateBestDiscount(
                product.price,
                product.discountPrice,
                categoryOffer
            );
            
            const finalPrice = discountInfo.finalPrice;
            const totalPrice = item.quantity * finalPrice;
            
            subtotal += totalPrice;
            
            orderItems.push({
                product: productId,
                quantity: item.quantity,
                price: product.price,
                discountedPrice: finalPrice,
                total: totalPrice,
                discountSource: discountInfo.discountSource,
                discountPercentage: discountInfo.discountPercentage
            });
        }
        
        if (stockValidationErrors.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Stock validation failed',
                errorType: 'STOCK_VALIDATION_FAILED',
                errors: stockValidationErrors
            });
        }

        let discount = 0;
        let couponCode = null;
        let totalOrderAmount = subtotal;

        if (coupon) {
            let couponCodeValue;
            
            if (typeof coupon === 'object' && coupon.couponCode) {
                couponCodeValue = coupon.couponCode;
            } 
            else if (typeof coupon === 'string' && coupon.trim() !== '') {
                couponCodeValue = coupon.trim();
            }
            
            if (couponCodeValue) {
                const validCoupon = await Coupon.findOne({ 
                    code: couponCodeValue, 
                    isActive: true,
                    expirationDate: { $gt: new Date() }
                });

                if (validCoupon) {
                    const userUsedCoupon = await Order.findOne({
                        user: userId,
                        couponCode: couponCodeValue
                    });

                    if (validCoupon.minAmount && subtotal < validCoupon.minAmount) {
                        return res.status(400).json({
                            success: false,
                            message: `Minimum purchase of ₹${validCoupon.minAmount} required for this coupon`,
                            errorType: 'MINIMUM_PURCHASE_NOT_MET'
                        });
                    }

                    discount = Math.round((subtotal * validCoupon.discount) / 100);
                    
                    if (validCoupon.maxDiscount && discount > validCoupon.maxDiscount) {
                        discount = validCoupon.maxDiscount;
                    }

                    couponCode = validCoupon.code;
                    totalOrderAmount = subtotal - discount;
                } else {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid or expired coupon',
                        errorType: 'INVALID_COUPON'
                    });
                }
            }
        }
        
        if (paymentMethod === 'cashOnDelivery' && totalOrderAmount > 1000) {
            return res.status(400).json({
                success: false, 
                message: 'Cash on Delivery is not available for orders above ₹1000',
                errorType: 'COD_LIMIT_EXCEEDED'
            });
        }
        
        if (paymentMethod === 'wallet') {
            const wallet = await Wallet.findOne({ user: userId });
            
            if (!wallet) {
                return res.status(404).json({
                    success: false,
                    message: 'Wallet not found',
                    errorType: 'WALLET_NOT_FOUND'
                });
            }
            
            if (wallet.balance < totalOrderAmount) {
                return res.status(400).json({
                    success: false,
                    message: 'Insufficient wallet balance',
                    errorType: 'INSUFFICIENT_BALANCE'
                });
            }
        }

        const newOrder = new Order({
            user: userId,
            items: orderItems,
            shippingAddress: addressId,
            subtotal: subtotal,
            discount: discount || 0,
            couponCode: couponCode || null,
            total: totalOrderAmount || subtotal,
            paymentMethod: paymentMethod || 'Cash on Delivery',
            paymentStatus: paymentMethod === 'wallet' ? 'paid' : 'pending',
            orderStatus: 'Pending'
        });
        
        const savedOrder = await newOrder.save();

        if (paymentMethod === 'wallet') {
            const wallet = await Wallet.findOne({ user: userId });
            
            await wallet.debit(
                totalOrderAmount,
                `Payment for Order #${savedOrder._id}`,
                savedOrder._id
            );
        }

        for (const orderItem of orderItems) {
            await Product.findByIdAndUpdate(
                orderItem.product,
                { $inc: { stock: -orderItem.quantity } }
            );
        }

        cart.items = [];
        await cart.save();

        if (req.session.appliedCoupon) {
            delete req.session.appliedCoupon;
        }

        return res.status(200).json({ 
            success: true, 
            message: 'Order placed successfully',
            orderId: savedOrder._id
        });
    } catch (err) {
        console.error('Order placement error:', err);
        return res.status(500).json({ 
            success: false, 
            message: 'Error placing order',
            errorType: 'SERVER_ERROR'
        });
    }
};
exports.orderSuccessPage = async (req, res) => {
    try {
        const { orderId } = req.params;
        const order = await Order.findById(orderId)
            .populate('items.product')
            .populate('shippingAddress');

        if (!order) {
            return res.redirect('/');
        }

        res.render('order-success', {
            order,
            pageTitle: 'Order Confirmation'
        });
    } catch (error) {
        console.error('Order success page error:', error);
        res.redirect('/');
    }
};
exports.renderEditAddressForCheckout = async (req, res) => {
    try {
        const { id } = req.params;
        let address = null;
        
        if (id !== 'new') {
            address = await Address.findOne({ 
                _id: id, 
                user: req.session.userId 
            });
            
            if (!address) {
                return res.redirect('/checkout?error=Address not found');
            }
        }
        
        const formData = req.session.formData || null;
        const formErrors = req.session.formErrors || null;
        
        delete req.session.formData;
        delete req.session.formErrors;
        
        res.render('user/edit-address', {
            title: id === 'new' ? 'Add New Address' : 'Edit Address',
            address: formData || address || null,
            errors: formErrors,
            error: req.query.error || null,
            fromCheckout: true,
            addressId: id  // Pass the ID to the template
        });
    } catch (error) {
        console.error('Error loading address form for checkout:', error);
        res.redirect('/checkout?error=Failed to load address form');
    }
};
exports.saveAddressFromCheckout = async (req, res) => {
    try {
        const { id } = req.params;
        const { 
            name, addressLine1, addressLine2, city, 
            state, postalCode, country, phone, isDefault 
        } = req.body;
        
        if (!name || !addressLine1 || !city || !state || !postalCode || !phone) {
            req.session.formData = req.body;
            req.session.formErrors = { general: 'Please fill all required fields' };
            return res.redirect(`/checkout/edit-address/${id}`);
        }
        
        const setAsDefault = isDefault === 'on';
        
        if (id === 'new') {
            const newAddress = new Address({
                user: req.session.userId,
                name,
                addressLine1,
                addressLine2,
                city,
                state,
                postalCode,
                country: country || 'India',
                phone,
                isDefault: setAsDefault
            });
            
            await newAddress.save();
            
            if (setAsDefault) {
                await Address.updateMany(
                    { user: req.session.userId, _id: { $ne: newAddress._id } },
                    { isDefault: false }
                );
            }
            
            return res.redirect('/checkout?addressAdded=true');
        } else {
            const address = await Address.findOne({
                _id: id,
                user: req.session.userId
            });
            
            if (!address) {
                return res.redirect('/checkout?error=Address not found');
            }
            
            address.name = name;
            address.addressLine1 = addressLine1;
            address.addressLine2 = addressLine2;
            address.city = city;
            address.state = state;
            address.postalCode = postalCode;
            address.country = country || 'India';
            address.phone = phone;
            address.isDefault = setAsDefault;
            
            await address.save();
            
            if (setAsDefault) {
                await Address.updateMany(
                    { user: req.session.userId, _id: { $ne: id } },
                    { isDefault: false }
                );
            }
            
            return res.redirect('/checkout?addressAdded=true');
        }
    } catch (error) {
        console.error('Error saving address from checkout:', error);
        req.session.formData = req.body;
        req.session.formErrors = { general: 'Failed to save address' };
        return res.redirect(`/checkout/edit-address/${req.params.id}`);
    }
};
exports.setDefaultAddress = async (req, res) => {
    try {
        const { id } = req.params;
        
        const address = await Address.findOne({ 
            _id: id, 
            user: req.session.userId 
        });
        
        if (!address) {
            return res.redirect('/checkout?error=Address not found');
        }
        
        await Address.updateMany(
            { user: req.session.userId },
            { isDefault: false }
        );
        
        address.isDefault = true;
        await address.save();
        
        return res.redirect('/checkout?addressSelected=true');
    } catch (error) {
        console.error('Error setting default address:', error);
        return res.redirect('/checkout?error=Failed to set default address');
    }
};
exports.createRazorpayOrder = async (req, res) => {
    try {
        const userId = req.session.userId;
        const { addressId } = req.body;

        if (!addressId) {
            return res.status(400).json({ 
                success: false, 
                message: 'Shipping address is required',
                errorType: 'ADDRESS_REQUIRED'
            });
        }

        const address = await Address.findOne({ 
            _id: addressId, 
            user: userId 
        });

        if (!address) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid or unauthorized shipping address',
                errorType: 'INVALID_ADDRESS'
            });
        }

        const cart = await Cart.findOne({ user: userId }).populate('items.product');
        
        if (!cart || !cart.items || cart.items.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Your cart is empty',
                errorType: 'EMPTY_CART'
            });
        }

        console.log("Cart structure in createRazorpayOrder:", JSON.stringify(cart.items.map(item => ({
            productId: item.product ? (item.product._id ? item.product._id.toString() : item.product.toString()) : 'null',
            quantity: item.quantity
        })), null, 2));

        const cartItemsWithOffers = await applyBestOfferToCartItems(cart.items);
        
        console.log("Cart items with offers:", JSON.stringify(cartItemsWithOffers.map(item => ({
            productId: item.product ? (item.product._id ? item.product._id.toString() : item.product.toString()) : 'null',
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            discountedUnitPrice: item.discountedUnitPrice,
            totalPrice: item.totalPrice
        })), null, 2));

        const stockValidationErrors = [];
        
        const productIds = cart.items.map(item => {
            if (!item.product) return null;
            return typeof item.product === 'object' ? item.product._id : item.product;
        }).filter(id => id !== null);

        const products = await Product.find({ _id: { $in: productIds } });
        const productsMap = {};
        products.forEach(product => {
            productsMap[product._id.toString()] = product;
        });

        for (const item of cart.items) {
            if (!item.product) {
                stockValidationErrors.push('Missing product reference in cart item');
                continue;
            }

            const productId = typeof item.product === 'object' ? 
                (item.product._id ? item.product._id.toString() : null) : 
                item.product.toString();
            
            if (!productId) {
                stockValidationErrors.push('Invalid product reference');
                continue;
            }

            const product = productsMap[productId];
            
            if (!product) {
                stockValidationErrors.push(`Product not found for ID: ${productId}`);
                continue;
            }
            
            if (!product.isActive) {
                stockValidationErrors.push(`Product "${product.title}" is no longer available for purchase`);
                continue;
            }

            if (product.stock < item.quantity) {
                stockValidationErrors.push(`Insufficient stock for ${product.title}. Available: ${product.stock}, Requested: ${item.quantity}`);
            }
            
            if (item.quantity <= 0) {
                stockValidationErrors.push(`Invalid quantity for ${product.title}`);
            }
        }

        if (stockValidationErrors.length > 0) {
            console.log("Stock validation errors:", stockValidationErrors);
            return res.status(400).json({
                success: false,
                message: 'Stock validation failed',
                errorType: 'STOCK_VALIDATION_FAILED',
                errors: stockValidationErrors
            });
        }

        let totalOrderAmount = 0;
        
        if (Array.isArray(cartItemsWithOffers) && cartItemsWithOffers.length > 0) {
            for (const item of cartItemsWithOffers) {
                if (item.totalPrice && typeof item.totalPrice === 'number') {
                    totalOrderAmount += item.totalPrice;
                } else if (item.discountedUnitPrice && item.quantity) {
                    totalOrderAmount += (item.discountedUnitPrice * item.quantity);
                } else if (item.unitPrice && item.quantity) {
                    totalOrderAmount += (item.unitPrice * item.quantity);
                }
            }
        }
        
        if (totalOrderAmount <= 0) {
            for (const item of cart.items) {
                const productId = typeof item.product === 'object' ? 
                    item.product._id.toString() : item.product.toString();
                const product = productsMap[productId];
                
                if (product) {
                    const price = product.discountPrice ? 
                        (product.price - product.discountPrice) : product.price;
                    totalOrderAmount += (price * item.quantity);
                }
            }
        }
        
        console.log("Calculated total order amount:", totalOrderAmount);
        
        if (totalOrderAmount <= 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Invalid order total',
                errorType: 'INVALID_ORDER_TOTAL'
            });
        }

        const options = {
            amount: Math.round(totalOrderAmount * 100), 
            currency: 'INR',
            receipt: `rcpt_${Date.now().toString().slice(-10)}_${userId.toString().slice(-5)}`,
            payment_capture: 1 
        };

        const razorpayOrder = await razorpayInstance.orders.create(options);

        req.session.pendingOrder = {
            addressId,
            razorpayOrderId: razorpayOrder.id,
            amount: totalOrderAmount
        };

        res.status(200).json({
            success: true,
            order: razorpayOrder,
            key: process.env.RAZORPAY_KEY_ID,
            amount: totalOrderAmount,
            name: address.name
        });

    } catch (error) {
        console.error('Razorpay order creation error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error creating payment order: ' + error.message,
            errorType: 'SERVER_ERROR'
        });
    }
};

exports.verifyRazorpayPayment = async (req, res) => {
    try {
        const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
        const userId = req.session.userId;
        
        const generatedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(`${razorpay_order_id}|${razorpay_payment_id}`)
            .digest('hex');
        
        const isSignatureValid = generatedSignature === razorpay_signature;
        
        if (!isSignatureValid) {
            return res.status(400).json({
                success: false,
                message: 'Invalid payment signature',
                errorType: 'INVALID_SIGNATURE'
            });
        }
        
        const pendingOrder = req.session.pendingOrder;
        if (!pendingOrder || pendingOrder.razorpayOrderId !== razorpay_order_id) {
            return res.status(400).json({
                success: false,
                message: 'Order details not found or mismatch',
                errorType: 'ORDER_NOT_FOUND'
            });
        }
        
        const cart = await Cart.findOne({ user: userId }).populate('items.product');
        
        if (!cart || cart.items.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Your cart is empty',
                errorType: 'EMPTY_CART'
            });
        }
        
        const productIds = cart.items.map(item => {
            return typeof item.product === 'object' ? item.product._id : item.product;
        }).filter(id => id !== null);

        const products = await Product.find({ _id: { $in: productIds } });
        const productsMap = {};
        products.forEach(product => {
            productsMap[product._id.toString()] = product;
        });

        const validationErrors = [];
        for (const item of cart.items) {
            const productId = typeof item.product === 'object' ? 
                item.product._id.toString() : item.product.toString();
            
            const product = productsMap[productId];
            
            if (!product) {
                validationErrors.push(`Product not found`);
                continue;
            }
            
            if (!product.isActive) {
                validationErrors.push(`Product "${product.title || 'Unknown'}" is no longer available for purchase`);
                continue;
            }
            
            if (product.stock < item.quantity) {
                validationErrors.push(`Insufficient stock for ${product.title || 'Unknown'}`);
            }
        }

        if (validationErrors.length > 0) {
            return res.status(400).json({
                success: false,
                message: 'Product validation failed',
                errorType: 'PRODUCT_VALIDATION_FAILED',
                errors: validationErrors
            });
        }
        
        console.log("Cart items before offers:", JSON.stringify(cart.items.map(item => ({
            productId: item.product ? (item.product._id ? item.product._id.toString() : 'unknown') : 'null',
            quantity: item.quantity
        })), null, 2));
        
        const cartItemsWithOffers = await applyBestOfferToCartItems(cart.items);
        
        console.log("Cart items with offers:", JSON.stringify(cartItemsWithOffers.map(item => ({
            productId: item.product ? 
                (typeof item.product === 'object' ? 
                    (item.product._id ? item.product._id.toString() : 'no _id') : 
                    item.product.toString()) 
                : 'null',
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            totalPrice: item.totalPrice
        })), null, 2));
        
        const orderItems = [];
        let subtotal = 0;
        
        for (const item of cartItemsWithOffers) {
            let productId;
            
            if (item.product) {
                if (typeof item.product === 'object' && item.product._id) {
                    productId = item.product._id;
                } else if (typeof item.product === 'string' || item.product instanceof mongoose.Types.ObjectId) {
                    productId = item.product;
                }
            }
            
            if (!productId) {
                const originalCartItem = cart.items.find(ci => 
                    ci.quantity === item.quantity
                );
                
                if (originalCartItem && originalCartItem.product && originalCartItem.product._id) {
                    productId = originalCartItem.product._id;
                } else {
                    console.error("Cannot determine product ID for item:", item);
                    continue; 
                }
            }
            
            const orderItem = {
                product: productId,
                quantity: item.quantity,
                price: item.unitPrice || 0,
                total: item.totalPrice || 0,
                discountedPrice: item.discountedUnitPrice || 0
            };
            
            if (item.discountSource) {
                orderItem.discountSource = item.discountSource;
            }
            
            if (item.discountPercentage) {
                orderItem.discountPercentage = item.discountPercentage;
            }
            
            subtotal += orderItem.total;
            orderItems.push(orderItem);
        }
        
        if (orderItems.length === 0) {
            console.log("Using original cart items for order creation");
            
            for (const item of cart.items) {
                if (!item.product || !item.product._id) {
                    console.error("Invalid product in cart item:", item);
                    continue;
                }
                
                const product = item.product;
                const price = product.price || 0;
                const discountedPrice = product.discountPrice ? 
                    (price - product.discountPrice) : price;
                const total = item.quantity * discountedPrice;
                
                subtotal += total;
                orderItems.push({
                    product: product._id,
                    quantity: item.quantity,
                    price: price,
                    discountedPrice: discountedPrice,
                    total: total
                });
            }
        }
        
        if (orderItems.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Failed to create order items',
                errorType: 'ORDER_ITEMS_CREATION_FAILED'
            });
        }

        const order = new Order({
            user: userId,
            items: orderItems,
            shippingAddress: pendingOrder.addressId,
            subtotal: subtotal,
            total: pendingOrder.amount,
            paymentMethod: 'razorpay',
            razorpayOrderId: razorpay_order_id,
            razorpayPaymentId: razorpay_payment_id,
            paymentStatus: 'paid',
            orderStatus: 'Pending'
        });

        const savedOrder = await order.save();

        for (const item of orderItems) {
            await Product.findByIdAndUpdate(
                item.product,
                { $inc: { stock: -item.quantity } }
            );
        }

        await Cart.findOneAndUpdate(
            { user: userId },
            { items: [], totalAmount: 0 }
        );
        
        delete req.session.pendingOrder;

        res.status(200).json({
            success: true,
            orderId: savedOrder._id,
            message: 'Payment successful and order placed'
        });

    } catch (error) {
        console.error('Razorpay payment verification error:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Error processing payment',
            errorType: 'SERVER_ERROR'
        });
    }
};

exports.orderFailurePage = async (req, res) => {
    try {
        const { orderId } = req.params;
        let order = null;
        
        if (orderId) {
            try {
                order = await Order.findById(orderId);
            } catch (e) {
                console.error("Error finding order:", e);
            }
        }
        
        res.render('order-failure', {
            order,
            pageTitle: 'Payment Failed'
        });
    } catch (error) {
        console.error('Order failure page error:', error);
        res.status(500).render('error', { 
            message: 'Error loading payment failure page',
            error: error,
            pageTitle: 'Error'
        });
    }
};