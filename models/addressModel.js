// models/addressModel.js
const mongoose = require('mongoose');
const { validCountries } = require('../middleware/addressValidation');

const addressSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'user',
        required: true
    },
    name: {
        type: String,
        required: [true, 'Name is required'],
        trim: true,
        minlength: [2, 'Name must be at least 2 characters'],
        maxlength: [50, 'Name cannot exceed 50 characters'],
        match: [/^[A-Za-z\s\.',-]{2,50}$/, 'Name contains invalid characters']
    },
    addressLine1: {
        type: String,
        required: [true, 'Address line 1 is required'],
        trim: true,
        minlength: [5, 'Address must be at least 5 characters'],
        maxlength: [100, 'Address cannot exceed 100 characters']
    },
    addressLine2: {
        type: String,
        trim: true,
        maxlength: [100, 'Address line 2 cannot exceed 100 characters']
    },
    city: {
        type: String,
        required: [true, 'City is required'],
        trim: true,
        minlength: [2, 'City must be at least 2 characters'],
        maxlength: [50, 'City cannot exceed 50 characters'],
        match: [/^[A-Za-z\s\.',-]{2,50}$/, 'City contains invalid characters']
    },
    state: {
        type: String,
        required: [true, 'State is required'],
        trim: true,
        minlength: [2, 'State must be at least 2 characters'],
        maxlength: [50, 'State cannot exceed 50 characters'],
        match: [/^[A-Za-z\s\.',-]{2,50}$/, 'State contains invalid characters']
    },
    postalCode: {
        type: String,
        required: [true, 'Postal code is required'],
        trim: true,
        minlength: [3, 'Postal code must be at least 3 characters'],
        maxlength: [10, 'Postal code cannot exceed 10 characters'],
        match: [/^[A-Za-z0-9\s-]{3,10}$/, 'Postal code contains invalid characters']
    },
    country: {
        type: String,
        required: [true, 'Country is required'],
        enum: {
            values: validCountries,
            message: 'Please select a valid country'
        },
        default: 'India'
    },
    phone: {
        type: String,
        required: [true, 'Phone number is required'],
        trim: true,
        match: [/^\d{7,15}$/, 'Phone number must be 7-15 digits and contain only numbers']
    },
    isDefault: {
        type: Boolean,
        default: false
    }
}, { timestamps: true });

const Address = mongoose.model('Address', addressSchema);
module.exports = Address;