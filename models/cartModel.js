// models/cartModel.js
const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
    product: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Product',
        required: true
    },
    quantity: {
        type: Number,
        required: true,
        min: 1,
        max: 4 
    },
    price: {
        type: Number,
        required: true
    }, discountSource: {
        type: String,
        enum: ['none', 'product', 'category'],
        default: 'none'
    },
    discountPercentage: {
        type: Number,
        default: 0
    }
});

// Add a schema for unavailable items
const unavailableItemSchema = new mongoose.Schema({
    item: cartItemSchema,
    reason: {
        type: String,
        enum: ['outOfStock', 'productUnavailable', 'categoryUnavailable'],
        required: true
    }
});

const cartSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    items: [cartItemSchema],
    // Add this field for unavailable items
    unavailableItems: [unavailableItemSchema],
    totalAmount: {
        type: Number,
        default: 0
    }
}, { timestamps: true });

// Method to calculate total cart amount
cartSchema.methods.calculateTotalAmount = function() {
    this.totalAmount = this.items.reduce((total, item) => {
        return total + (item.price * item.quantity);
    }, 0);
    return this.totalAmount;
};

module.exports = mongoose.model('Cart', cartSchema);