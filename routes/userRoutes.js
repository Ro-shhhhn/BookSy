const express = require('express');
const bcrypt = require('bcrypt');
const router = express.Router();
const User = require('../models/user');
const OTP = require('../models/OTP');
const sendEmail = require('../utils/sendEmail');
const authMiddleware = require('../middleware/authMiddleware');
const productController = require('../controllers/productController');
const Category = require('../models/categoryModel');
const passport = require('passport');
const userController = require('../controllers/userController'); 
const upload = require('../middleware/uploadMiddleware');
const addressValidation = require('../middleware/addressValidation');
const offerMiddleware = require('../middleware/offerMiddleware');
const Wallet = require('../models/walletModel');


const validateName = (name) => {
  
  if (!name || name.trim() === '') {
    return { valid: false, message: 'Name cannot be empty.' };
  }
  
 
  const nameRegex = /^[A-Za-z\s'.-]+$/;
  if (!nameRegex.test(name)) {
    return { 
      valid: false, 
      message: 'Name can only contain letters, spaces, apostrophes, periods, and hyphens.' 
    };
  }
  
 
  if (name.length < 2) {
    return { valid: false, message: 'Name is too short.' };
  }
  
  if (name.length > 50) {
    return { valid: false, message: 'Name is too long (maximum 50 characters).' };
  }
  
 
  if (name.includes('  ')) {
    return { valid: false, message: 'Name should not contain consecutive spaces.' };
  }
  

  if (name.startsWith(' ') || name.endsWith(' ')) {
    return { valid: false, message: 'Name should not start or end with a space.' };
  }
  
  return { valid: true };
};

router.get('/', (req, res) => {
    res.render('user/home', { 
        title: 'BookSy - Home',
        categories: [], 
        popularAuthors: [] 
    });
});

router.get('/products', 
    function fetchProducts(req, res, next) {
        productController.getAllProducts(req, res, function() {
            next(); 
        });
    },
    offerMiddleware.applyBestOffers,
    function renderProducts(req, res) {
       
    }
);

router.get('/products/:id', 
    function fetchProductById(req, res, next) {
        productController.getProductById(req, res, function() {
            next(); 
        });
    },
    offerMiddleware.applyBestOfferToProduct,
    function renderProductDetails(req, res) {
       
    }
);

router.get('/product/:id', productController.getProductDetails);

router.get('/signup', (req, res) => {
    res.render("user/signup", { 
        title: "Sign Up - BookSy", 
        errorMessage: null,
        referralCode: req.query.ref || null
    });
});

router.post("/signup", async (req, res) => {
    try {
        const { name, email, password, confirmPassword, referralCode } = req.body;
        const normalizedEmail = email.trim().toLowerCase();

        const formData = { name, email: normalizedEmail };
        
        // Validate name
        const nameValidation = validateName(name);
        if (!nameValidation.valid) {
            return res.render("user/signup", { 
                title: "Sign Up - BookSy", 
                nameError: nameValidation.message,
                formData,
                referralCode
            });
        }
        
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(normalizedEmail)) {
            return res.render("user/signup", { 
                title: "Sign Up - BookSy", 
                emailError: "Please enter a valid email address.",
                formData,
                referralCode
            });
        }

        const passwordRegex = /^(?=.*\d)(?=.*[A-Za-z])(?=.*[\W_]).{8,}$/; 
        if (!passwordRegex.test(password)) {
            return res.render("user/signup", { 
                title: "Sign Up - BookSy", 
                passwordError: "Password must be at least 8 characters long, contain a number, and a special character.",
                formData,
                referralCode
            });
        }

        if (password !== confirmPassword) {
            return res.render("user/signup", { 
                title: "Sign Up - BookSy", 
                confirmPasswordError: "Passwords do not match.",
                formData,
                referralCode
            });
        }

        const existingUser = await User.findOne({ 
            email: { $regex: new RegExp('^' + normalizedEmail + '$', 'i') } 
        });
        
        if (existingUser) {
            return res.render("user/signup", { 
                title: "Sign Up - BookSy", 
                emailError: "This email is already registered. Please log in or use a different email.",
                formData,
                referralCode
            });
        }

        let validReferral = false;
        if (referralCode) {
            const referrer = await User.findOne({ referralCode });
            validReferral = !!referrer;
        }

        const newUser = new User({
            name,
            email: normalizedEmail,
            password,
            verified: false,
            referredBy: validReferral ? referralCode : null
        });
        
        await newUser.save();

        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        
        await OTP.findOneAndUpdate(
            { email: normalizedEmail },
            { 
                email: normalizedEmail,
                otp: otp, 
                expiresAt: new Date(Date.now() + 5 * 60 * 1000) 
            },
            { upsert: true, new: true }
        );

        await sendEmail(
            normalizedEmail, 
            'Verify Your BookSy Account', 
            `Your OTP for account verification is: ${otp}. This code will expire in 5 minutes.`
        );

        if (validReferral) {
            req.session.pendingReferral = {
                newUserId: newUser._id,
                referralCode: referralCode
            };
        }

        return res.redirect(`/otp?email=${encodeURIComponent(normalizedEmail)}&purpose=signup`);
    } catch (error) {
        console.error('Error in signup:', error);
        return res.render("user/signup", { 
            title: "Sign Up - BookSy", 
            error: "Error signing up. Please try again.",
            formData: { name: req.body.name, email: req.body.email },
            referralCode: req.body.referralCode
        });
    }
});

router.post('/verify-otp', async (req, res) => {
    try {
        const { email, otp, purpose } = req.body;
        
        const otpRecord = await OTP.findOne({
            email,
            otp,
            expiresAt: { $gt: new Date() }
        });
        
        if (!otpRecord) {
            return res.render('user/otp-verification', {
                title: 'Verify OTP',
                email,
                purpose,
                error: 'Invalid or expired OTP'
            });
        }
        
        if (purpose === 'signup') {
            const user = await User.findOneAndUpdate(
                { email },
                { verified: true },
                { new: true }
            );
            
            if (req.session.pendingReferral && req.session.pendingReferral.newUserId.equals(user._id)) {
                const referralCode = req.session.pendingReferral.referralCode;
                const referrer = await User.findOne({ referralCode });
                
                if (referrer) {
                    referrer.referredUsers.push(user._id);
                    await referrer.save();
                    
                    let referrerWallet = await Wallet.findById(referrer.wallet);
                    if (!referrerWallet) {
                        referrerWallet = new Wallet({
                            user: referrer._id,
                            balance: 0
                        });
                        referrer.wallet = referrerWallet._id;
                        await referrer.save();
                    }
                    
                    await referrerWallet.credit(
                        200,
                        `Referral bonus for user ${user.email} joining`
                    );
                }
                
                delete req.session.pendingReferral;
            }
            
            await OTP.deleteOne({ _id: otpRecord._id });
            
            return res.redirect('/login?message=Account verified successfully. Please login.');
        }
        
        
    } catch (error) {
        console.error('Error in OTP verification:', error);
        return res.render('user/otp-verification', {
            title: 'Verify OTP',
            email: req.body.email,
            purpose: req.body.purpose,
            error: 'An error occurred during verification'
        });
    }
});

router.get('/login', (req, res) => {
    const message = req.query.message || null;
    const blocked = req.query.blocked === 'true';
    
    res.render('user/signin', { 
        title: "Sign In - BookSy", 
        errorMessage: message || (blocked ? "Your account has been blocked by an administrator." : null) 
    });
});

router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = email.trim().toLowerCase();

        if (!normalizedEmail || !password) {
            return res.render('user/signin', { 
                title: 'Sign In - BookSy', 
                errorMessage: 'Please fill all fields.' 
            });
        }

        const existingUser = await User.findOne({ 
            email: { $regex: new RegExp('^' + normalizedEmail + '$', 'i') } 
        });
        
        if (!existingUser) {
            return res.render('user/signin', { 
                title: 'Sign In - BookSy', 
                errorMessage: 'No account found with this email.' 
            });
        }

        if (existingUser.isBlocked) {
            return res.render('user/signin', { 
                title: 'Sign In - BookSy', 
                errorMessage: 'Your account has been blocked by an administrator.' 
            });
        }

        const isMatch = await existingUser.comparePassword(password);
        if (!isMatch) {
            return res.render('user/signin', { 
                title: 'Sign In - BookSy', 
                errorMessage: 'Invalid password.' 
            });
        }

        if (!existingUser.verified) {
            return res.render('user/signin', { 
                title: 'Sign In - BookSy', 
                errorMessage: 'Your account is not verified. Please check your email for verification instructions or sign up again.' 
            });
        }

        req.session.userId = existingUser._id;
        req.session.isAuthenticated = true;
        req.session.userName = existingUser.name;
        
        const redirectUrl = req.body.redirectUrl || '/';
        return res.redirect(redirectUrl);
    } catch (error) {
        console.error('Error in login:', error);
        return res.render('user/signin', { 
            title: 'Sign In - BookSy', 
            errorMessage: 'Error logging in. Try again.' 
        });
    }
});

// Logout route
router.get('/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('Error destroying session:', err);
            return res.status(500).redirect('/login?error=logout_failed');
        }
        
        res.clearCookie('connect.sid'); 
        
        res.redirect('/login');
    });
});

// User profile routes
router.get('/profile', authMiddleware.isActiveUser, userController.getProfile);
router.get('/edit-profile', authMiddleware.isActiveUser, userController.getEditProfile);
router.post('/edit-profile', authMiddleware.isActiveUser, upload.single('profileImage'), userController.updateProfile);
router.get('/verify-email-change', authMiddleware.isActiveUser, userController.getVerifyEmailChange);
router.post('/verify-email-change', authMiddleware.isActiveUser, userController.verifyEmailChange);

// Password management
router.get('/change-password', authMiddleware.isActiveUser, userController.getChangePassword);
router.post('/change-password', authMiddleware.isActiveUser, userController.changePassword);
router.get('/user/forgot-password', userController.getForgotPassword);
router.post('/user/forgot-password', userController.forgotPassword);
router.get('/user/reset-password/:token', userController.getResetPassword);
router.post('/user/reset-password/:token', userController.resetPassword);

// Address management
router.get('/addresses', authMiddleware.isActiveUser, userController.getAddresses);
router.get('/edit-address/:id', authMiddleware.isActiveUser, userController.getEditAddress);
router.post('/edit-address/:id', authMiddleware.isActiveUser, addressValidation.validateAddress, userController.saveAddress);
router.get('/confirm-delete-address/:id', authMiddleware.isActiveUser, userController.confirmDeleteAddress);
router.post('/delete-address/:id', authMiddleware.isActiveUser, userController.deleteAddress);

// Referral routes
router.post('/apply-referral', authMiddleware.isActiveUser, userController.applyReferralCode);

// Google Auth Routes
router.get('/auth/google',
    passport.authenticate('google', { 
        scope: ['profile', 'email'] 
    })
);

router.get('/auth/google/callback', 
    passport.authenticate('google', { 
        failureRedirect: '/login',
        failureMessage: true
    }),
    async (req, res) => {
        if (req.user.isBlocked) {
            req.logout(function(err) {
                if (err) { return next(err); }
                return res.redirect('/login?message=Your account has been blocked by an administrator');
            });
        } else {
            req.session.userId = req.user._id;
            req.session.isAuthenticated = true;
            req.session.userName = req.user.name;
            res.redirect('/');
        }
    }
);

router.get('/account', authMiddleware.isActiveUser, (req, res) => {
    res.render('user/account', { title: 'My Account' });
});

module.exports = router;