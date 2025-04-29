const mongoose = require('mongoose');

const walletSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    balance: {
        type: Number,
        default: 0,
        min: 0
    },
    transactions: [{
        type: {
            type: String,
            enum: ['credit', 'debit'],
            required: true
        },
        amount: {
            type: Number,
            required: true
        },
        description: {
            type: String,
            required: true
        },
        date: {
            type: Date,
            default: Date.now
        },
        orderId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Order'
        }
    }],
    createdAt: {
        type: Date,
        default: Date.now
    }
}, { 
    timestamps: true 
});

// Method to add money to wallet
walletSchema.methods.credit = function(amount, description, orderId = null) {
    this.balance += amount;
    this.transactions.push({
        type: 'credit',
        amount,
        description,
        orderId
    });
    return this.save();
};

// Method to deduct money from wallet
walletSchema.methods.debit = function(amount, description, orderId = null) {
    if (this.balance < amount) {
        throw new Error('Insufficient wallet balance');
    }
    this.balance -= amount;
    this.transactions.push({
        type: 'debit',
        amount,
        description,
        orderId
    });
    return this.save();
};

const Wallet = mongoose.model('Wallet', walletSchema);

module.exports = Wallet;