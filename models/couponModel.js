// models/couponModel.js
const mongoose = require('mongoose');

const couponSchema = new mongoose.Schema({
    code: {
        type: String,
        required: true,
        unique: true,
        uppercase: true,
        trim: true
    },
    discount: {
        type: Number,
        required: true,
        min: 0,
        max: 100
    },
    minAmount: {
        type: Number,
        required: true,
        default: 0
    },
    maxAmount: {
        type: Number,
        required: true,
        default: Infinity
    },
   
    expirationDate: {
        type: Date,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Coupon', couponSchema);