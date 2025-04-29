const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Book title is required'],
        trim: true,
        index: true,
        unique: true // Add unique constraint
    },
    author: {
        type: String,
        required: [true, 'Author name is required'],
        trim: true,
        index: true
    },
    description: {
        type: String,
        required: [true, 'Book description is required']
    },
    isbn: {
        type: String,
        trim: true,
        unique: true,
        sparse: true
    },
    category: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Category',
        required: [true, 'Book category is required'],
        validate: {
            validator: async function(value) {
                const category = await mongoose.model('Category').findOne({
                    _id: value,
                    status: true
                });
                return !!category;
            },
            message: 'Invalid category or category is not active'
        }
    },
    price: {
        type: Number,
        required: [true, 'Book price is required'],
        min: [0, 'Price cannot be negative']
    },
    discountPrice: {
        type: Number,
        min: [0, 'Discount price cannot be negative'],
        default: 0
    },
    stock: {
        type: Number,
        required: [true, 'Stock quantity is required'],
        min: [0, 'Stock cannot be negative'],
        default: 0
    },
    images: [{
        type: String,
        required: [true, 'Product images are required']
    }],
    coverImage: {
        type: String,
        required: [true, 'Cover image is required']
    },
    publishedDate: Date,
    publisher: {
        type: String,
        trim: true
    },
    pages: {
        type: Number,
        min: [0, 'Page count cannot be negative']
    },
    language: {
        type: String,
        default: 'en',
        enum: ['en', 'hi', 'ml', 'ta', 'fr', 'es', 'ru', 'ar', 'ja', 'zh'],
        required: true
    },
    featured: {
        type: Boolean,
        default: false
    },
    isActive: {
        type: Boolean,
        default: true
    },
    ratings: {
        average: {
            type: Number,
            default: 0,
            min: 0,
            max: 5
        },
        count: {
            type: Number,
            default: 0
        }
    }
}, { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

// Error handler for duplicate key error
productSchema.post('save', function(error, doc, next) {
    if (error.name === 'MongoServerError' && error.code === 11000) {
        next(new Error('A product with this name already exists. Please use a different name.'));
    } else {
        next(error);
    }
});

productSchema.post('findOneAndUpdate', function(error, doc, next) {
    if (error.name === 'MongoServerError' && error.code === 11000) {
        next(new Error('A product with this name already exists. Please use a different name.'));
    } else {
        next(error);
    }
});

// Text search index
productSchema.index({
    title: 'text',
    author: 'text',
    description: 'text'
}, {
    name: 'product_text_index',
    weights: {
        title: 5,
        author: 4,
        description: 2
    },
    language_override: 'none' 
});

// Virtual for discounted price calculation
productSchema.virtual('discountedPrice').get(function() {
    return this.discountPrice > 0 ? this.price - this.discountPrice : this.price;
});

module.exports = mongoose.model('Product', productSchema);