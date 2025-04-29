const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    items: [{
        product: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Product',
            required: true
        },
        quantity: {
            type: Number,
            required: true,
            min: 1
        },
        price: {
            type: Number,
            required: true
        },
        total: {
            type: Number,
            required: true
        },
        discountedPrice: {
            type: Number,
            default: 0
        },
        returnStatus: {
            type: String,
            enum: ['None', 'Pending', 'Approved', 'Rejected', 'Cancelled'],
            default: 'None'
        },
        returnReason: {
            type: String,
            trim: true
        }
    }],
    shippingAddress: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Address',
        required: true
    },
    subtotal: {
        type: Number,
        required: true
    },
    discount: {
        type: Number,
        default: 0
    },
    couponCode: {
        type: String,
        default: null
    },
    total: {
        type: Number,
        required: true
    },
    paymentMethod: {
        type: String,
        enum: ['Cash on Delivery', 'Razorpay', 'cashOnDelivery', 'razorpay', 'wallet'],
        required: true
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'paid', 'failed'],
        default: 'pending'
    },
    orderStatus: {
        type: String,
        enum: ['Pending', 'Processing', 'Shipped', 'Delivered', 'Cancelled', 'Returned'],
        default: 'Pending'
    },
    razorpayOrderId: {
        type: String
    },
    razorpayPaymentId: {
        type: String
    },
    couponApplied: {
        couponId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Coupon'
        },
        code: String,
        discount: Number,
        discountAmount: Number
    },
    cancellationReason: {
        type: String,
        trim: true
    },
    returnStatus: {
        type: String,
        enum: ['None', 'Pending', 'Approved', 'Rejected', 'Cancelled'],
        default: 'None'
    },
    uniqueOrderId: {
        type: String,
        unique: true
    }
}, { timestamps: true });

orderSchema.methods.requestReturn = function(reason) {
    this.returnRequested = true;
    this.returnRequestedAt = new Date();
    this.returnReason = reason;
    return this.save();
};

orderSchema.pre('save', function(next) {
    if (!this.uniqueOrderId) {
        // YYYYMMDD-RANDOMCHARS-INCREMENTINGNUMBER
        const date = new Date();
        const randomChars = Math.random().toString(36).substring(2, 7).toUpperCase();
        const timestamp = date.getFullYear().toString() + 
                          String(date.getMonth() + 1).padStart(2, '0') + 
                          String(date.getDate()).padStart(2, '0');
        
        this.uniqueOrderId = `${timestamp}-${randomChars}`;
    }
    next();
});

orderSchema.methods.calculateOrderStatus = function() {
    if (this.items.length > 0 && this.items.every(item => item.returnStatus === 'Approved')) {
        this.orderStatus = 'Returned';
    } 
    else if (this.items.some(item => item.returnStatus === 'Approved') && this.orderStatus === 'Delivered') {
        this.orderStatus = 'Delivered'; 
    }
    return this;
};

module.exports = mongoose.model('Order', orderSchema);