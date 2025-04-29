const mongoose = require('mongoose');

const validCountries = [
    'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia', 
    'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 
    'Bhutan', 'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 
    'Cabo Verde', 'Cambodia', 'Cameroon', 'Canada', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 
    'Comoros', 'Congo', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic', 'Denmark', 'Djibouti', 'Dominica', 
    'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia', 'Eswatini', 
    'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 
    'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hungary', 'Iceland', 'India', 'Indonesia', 
    'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati', 
    'Korea, North', 'Korea, South', 'Kosovo', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 
    'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 
    'Marshall Islands', 'Mauritania', 'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 
    'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 
    'Nigeria', 'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea', 
    'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saint Kitts and Nevis', 
    'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'Sao Tome and Principe', 'Saudi Arabia', 
    'Senegal', 'Serbia', 'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 
    'South Africa', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria', 'Taiwan', 
    'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 
    'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay', 
    'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe'
];

const patterns = {
    name: /^[A-Za-z\s\.',-]{2,50}$/,
    city: /^[A-Za-z\s\.',-]{2,50}$/,
    state: /^[A-Za-z\s\.',-]{2,50}$/,
    postalCode: /^[A-Za-z0-9\s-]{3,10}$/,
    phone: /^\d{7,15}$/
};

const validateAddress = (req, res, next) => {
    const { id } = req.params;
    const { 
        name, addressLine1, addressLine2, city, 
        state, postalCode, country, phone 
    } = req.body;
    
    const errors = {};
    
    if (!name) {
        errors.name = 'Name is required';
    } else if (name.length < 2 || name.length > 50) {
        errors.name = 'Name must be between 2 and 50 characters';
    } else if (!patterns.name.test(name)) {
        errors.name = 'Name contains invalid characters';
    }
    
    if (!addressLine1) {
        errors.addressLine1 = 'Address Line 1 is required';
    } else if (addressLine1.length < 5 || addressLine1.length > 100) {
        errors.addressLine1 = 'Address Line 1 must be between 5 and 100 characters';
    }
    
    if (addressLine2 && addressLine2.length > 100) {
        errors.addressLine2 = 'Address Line 2 cannot exceed 100 characters';
    }
    
    if (!city) {
        errors.city = 'City is required';
    } else if (city.length < 2 || city.length > 50) {
        errors.city = 'City must be between 2 and 50 characters';
    } else if (!patterns.city.test(city)) {
        errors.city = 'City contains invalid characters';
    }
    
    if (!state) {
        errors.state = 'State is required';
    } else if (state.length < 2 || state.length > 50) {
        errors.state = 'State must be between 2 and 50 characters';
    } else if (!patterns.state.test(state)) {
        errors.state = 'State contains invalid characters';
    }
    
    if (!postalCode) {
        errors.postalCode = 'Postal code is required';
    } else if (postalCode.length < 3 || postalCode.length > 10) {
        errors.postalCode = 'Postal code must be between 3 and 10 characters';
    } else if (!patterns.postalCode.test(postalCode)) {
        errors.postalCode = 'Postal code contains invalid characters';
    }
    
    if (!country) {
        errors.country = 'Country is required';
    } else if (!validCountries.includes(country)) {
        errors.country = 'Please select a valid country';
    }
    
    if (!phone) {
        errors.phone = 'Phone number is required';
    } else if (!patterns.phone.test(phone)) {
        errors.phone = 'Phone number must be 7-15 digits and contain only numbers';
    }
    
    if (Object.keys(errors).length > 0) {
        req.session.formData = req.body;
        req.session.formErrors = errors;
        
        const isCheckout = req.originalUrl.includes('/checkout/');
        
        return res.redirect(`${isCheckout ? '/checkout' : ''}/edit-address/${id}`);
    }
    
    delete req.session.formData;
    delete req.session.formErrors;
    
    next();
};

module.exports = {
    validateAddress,
    validCountries
};