const User = require('../models/user');
const Address = require('../models/addressModel');
const OTP = require('../models/OTP');
const sendEmail = require('../utils/sendEmail');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const Wallet = require('../models/walletModel');


const userController = {
    getProfile: async (req, res) => {
        try {
            const user = await User.findById(req.session.userId)
                .populate('referredUsers', 'name email');
                
            if (!user) {
                return res.redirect('/login');
            }
            
            res.render('user/profile', {
                title: 'My Profile',
                user,
                activeTab: 'profile',
                referralError: req.query.referralError || null,
                message: req.query.message || null
            });
        } catch (error) {
            console.error('Error fetching profile:', error);
            res.status(500).render('error', { 
                message: 'Failed to load profile', 
                error: { status: 500 } 
            });
        }
    },
    applyReferralCode: async (req, res) => {
        try {
            const { referralCode } = req.body;
            const userId = req.session.userId;
    
            const currentUser = await User.findById(userId);
            if (!currentUser) {
                return res.redirect('/login');
            }
    
            if (currentUser.referredBy) {
                return res.redirect('/profile?referralError=You have already used a referral code');
            }
    
            if (!referralCode || referralCode.trim() === '') {
                return res.redirect('/profile?referralError=Please enter a valid referral code');
            }
    
            if (currentUser.referralCode === referralCode) {
                return res.redirect('/profile?referralError=You cannot use your own referral code');
            }
    
            const referrer = await User.findOne({ referralCode });
            if (!referrer) {
                return res.redirect('/profile?referralError=Invalid referral code');
            }
    
            console.log('Starting referral process for code:', referralCode);
            console.log('Referrer found:', referrer._id, referrer.email);
    
            currentUser.referredBy = referralCode;
            await currentUser.save();
    
            referrer.referredUsers.push(currentUser._id);
            await referrer.save();
    
            let referrerWallet = await Wallet.findById(referrer.wallet);
    
            console.log('Referrer wallet before:', referrerWallet);
    
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
                `Referral bonus for user ${currentUser.email} joining`
            );
    
            console.log('Wallet after credit attempt:', await Wallet.findById(referrerWallet._id));
    
            return res.redirect('/profile?message=Referral code applied successfully! Your friend received Rs. 200');
        } catch (error) {
            console.error('Error applying referral code:', error);
            return res.redirect('/profile?referralError=Failed to apply referral code');
        }
    },
    

    getEditProfile: async (req, res) => {
        try {
            const user = await User.findById(req.session.userId);
            if (!user) {
                return res.redirect('/login');
            }
            
            res.render('user/edit-profile', {
                title: 'Edit Profile',
                user,
                message: req.query.message || null,
                error: req.query.error || null
            });
        } catch (error) {
            console.error('Error loading edit profile:', error);
            res.status(500).render('error', { 
                message: 'Failed to load edit profile page', 
                error: { status: 500 } 
            });
        }
    },
    
    updateProfile: async (req, res) => {
        try {
            const { name, email } = req.body;
            const userId = req.session.userId;
            const user = await User.findById(userId);
            
            if (!user) {
                return res.redirect('/login');
            }
            
            // Check if a file was uploaded and handle the profile image
            if (req.file) {
                // For disk storage, we can use this path format
                user.profileImage = `/uploads/profiles/${req.file.filename}`;
                console.log('Profile image updated:', user.profileImage);
            }
            
            if (email !== user.email) {
                const otp = Math.floor(1000 + Math.random() * 9000).toString();
                
                req.session.pendingEmailChange = {
                    newEmail: email,
                    currentEmail: user.email
                };
                
                await OTP.findOneAndUpdate(
                    { email },
                    { 
                        email,
                        otp, 
                        expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes expiry
                    },
                    { upsert: true, new: true }
                );
                
                await sendEmail(
                    email, 
                    'Verify Your New Email Address', 
                    `Your OTP for email verification is: ${otp}. This code will expire in 5 minutes.`
                );
                
                user.name = name;
                await user.save();
                
                return res.redirect(`/verify-email-change?email=${encodeURIComponent(email)}`);
            }
            
            user.name = name;
            await user.save();
            
            req.session.userName = name;
            
            return res.redirect('/profile?message=Profile updated successfully');
        } catch (error) {
            console.error('Error updating profile:', error);
            return res.redirect('/edit-profile?error=Failed to update profile');
        }
    },
    getVerifyEmailChange: (req, res) => {
        const { email } = req.query;
        
        if (!req.session.pendingEmailChange) {
            return res.redirect('/profile');
        }
        
        res.render('user/verify-email-change', {
            title: 'Verify Email Change',
            email,
            error: req.query.error || null
        });
    },
    
    verifyEmailChange: async (req, res) => {
        try {
            const { otp } = req.body;
            
            if (!req.session.pendingEmailChange) {
                return res.redirect('/profile');
            }
            
            const { newEmail } = req.session.pendingEmailChange;
            
            const otpRecord = await OTP.findOne({ 
                email: newEmail,
                otp,
                expiresAt: { $gt: new Date() }
            });
            
            if (!otpRecord) {
                return res.redirect(`/verify-email-change?email=${encodeURIComponent(newEmail)}&error=Invalid or expired OTP`);
            }
            
            const user = await User.findById(req.session.userId);
            user.email = newEmail;
            await user.save();
            
            delete req.session.pendingEmailChange;
            
            await OTP.deleteOne({ _id: otpRecord._id });
            
            return res.redirect('/profile?message=Email updated successfully');
        } catch (error) {
            console.error('Error verifying email change:', error);
            return res.redirect('/profile?error=Failed to verify email change');
        }
    },
    
    getChangePassword: (req, res) => {
        res.render('user/change-password', {
            title: 'Change Password',
            message: req.query.message || null,
            error: req.query.error || null
        });
    },
    
    changePassword: async (req, res) => {
        try {
            const { currentPassword, newPassword, confirmPassword } = req.body;
            const userId = req.session.userId;
            
            if (!currentPassword || !newPassword || !confirmPassword) {
                return res.redirect('/change-password?error=All fields are required');
            }
            
            if (newPassword !== confirmPassword) {
                return res.redirect('/change-password?error=New passwords do not match');
            }
            
            const passwordRegex = /^(?=.*\d)(?=.*[A-Za-z])(?=.*[\W_]).{8,}$/;
            if (!passwordRegex.test(newPassword)) {
                return res.redirect('/change-password?error=Password must be at least 8 characters long, contain a number, and a special character');
            }
            
            const user = await User.findById(userId);
            if (!user) {
                return res.redirect('/login');
            }
            
            const isMatch = await user.comparePassword(currentPassword);
            if (!isMatch) {
                return res.redirect('/change-password?error=Current password is incorrect');
            }
            
            user.password = newPassword;
            await user.save();
            
            return res.redirect('/profile?message=Password changed successfully');
        } catch (error) {
            console.error('Error changing password:', error);
            return res.redirect('/change-password?error=Failed to change password');
        }
    },
    
    getForgotPassword: (req, res) => {
        res.render('user/forgot-password', {
            title: 'Forgot Password',
            message: req.query.message || null,
            error: req.query.error || null
        });
    },
    
    forgotPassword: async (req, res) => {
        try {
            const { email } = req.body;
            const normalizedEmail = email.trim().toLowerCase();
            
            const user = await User.findOne({ email: normalizedEmail });
            if (!user) {
                return res.redirect('/user/forgot-password?message=Please enter your registered email id');
            }
            
            const token = crypto.randomBytes(20).toString('hex');
            
            user.resetPasswordToken = token;
            user.resetPasswordExpires = Date.now() + 3600000; // 1 hour
            await user.save();
            
            const resetUrl = `${req.protocol}://${req.get('host')}/user/reset-password/${token}`;            
            await sendEmail(
                user.email,
                'Password Reset',
                `You requested a password reset. Please click on the following link to reset your password: ${resetUrl}\n\nIf you didn't request this, please ignore this email.`
            );
            
            res.redirect('/user/forgot-password?message=If your email is registered, you will receive a password reset link');
        } catch (error) {
            console.error('Error in forgot password:', error);
            res.redirect('/user/forgot-password?error=An error occurred. Please try again later.');
        }
    },
    
    getResetPassword: async (req, res) => {
        try {
            const { token } = req.params;
            
            const user = await User.findByResetPasswordToken(token);
            if (!user) {
                return res.redirect('/user/forgot-password?error=Password reset link is invalid or has expired');
            }
            
            res.render('user/reset-password', {
                title: 'Reset Password',
                token,
                error: req.query.error || null
            });
        } catch (error) {
            console.error('Error in reset password page:', error);
            res.redirect('/user/forgot-password?error=An error occurred. Please try again later.');
        }
    },
    
    resetPassword: async (req, res) => {
        try {
            const { token } = req.params;
            const { password, confirmPassword } = req.body;
            
            if (!password || !confirmPassword) {
                return res.redirect(`/user/reset-password/${token}?error=All fields are required`);
            }
            
            if (password !== confirmPassword) {
                return res.redirect(`/user/reset-password/${token}?error=Passwords do not match`);
            }
            
            const passwordRegex = /^(?=.*\d)(?=.*[A-Za-z])(?=.*[\W_]).{8,}$/;
            if (!passwordRegex.test(password)) {
                return res.redirect(`/user/reset-password/${token}?error=Password must be at least 8 characters long, contain a number, and a special character`);
            }
            
            const user = await User.findByResetPasswordToken(token);
            if (!user) {
                return res.redirect('/user/forgot-password?error=Password reset link is invalid or has expired');
            }
            
            user.password = password;
            user.resetPasswordToken = undefined;
            user.resetPasswordExpires = undefined;
            await user.save();
            
            res.redirect('/profile?message=Password has been reset successfully. Please login with your new password');
        } catch (error) {
            console.error('Error resetting password:', error);
            res.redirect('/user/forgot-password?error=An error occurred. Please try again later.');
        }
    },
    
    getAddresses: async (req, res) => {
        try {
            const addresses = await Address.find({ user: req.session.userId });
            
            res.render('user/addresses', {
                title: 'My Addresses',
                addresses,
                message: req.query.message || null,
                error: req.query.error || null,
                activeTab: 'addresses'
            });
        } catch (error) {
            console.error('Error fetching addresses:', error);
            res.status(500).render('error', { 
                message: 'Failed to load addresses', 
                error: { status: 500 } 
            });
        }
    },
    
    getEditAddress: async (req, res) => {
        try {
            const { id } = req.params;
            let address = null;
            
            if (id !== 'new') {
                address = await Address.findOne({ 
                    _id: id, 
                    user: req.session.userId 
                });
                
                if (!address) {
                    return res.redirect('/addresses?error=Address not found');
                }
            }
            
            
            const formData = req.session.formData || null;
            const formErrors = req.session.formErrors || null;
            
            
            delete req.session.formData;
            delete req.session.formErrors;
            
            const isFromCheckout = req.query.checkout === 'true';
            
            res.render('user/edit-address', {
                title: id === 'new' ? 'Add New Address' : 'Edit Address',
                address: formData || address || null, 
                errors: formErrors,
                error: req.query.error || null,
                fromCheckout: isFromCheckout,
                addressId: id  
            });
        } catch (error) {
            console.error('Error loading address form:', error);
            res.redirect('/addresses?error=Failed to load address form');
        }
    },
    
    saveAddress: async (req, res) => {
        try {
            const { id } = req.params;
            const { 
                name, addressLine1, addressLine2, city, 
                state, postalCode, country, phone, isDefault 
            } = req.body;
            
            const setAsDefault = isDefault === 'on';
            const isFromCheckout = req.query.checkout === 'true';
            const redirectBase = isFromCheckout ? '/checkout' : '/addresses';
            
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
                
                return res.redirect(`${redirectBase}?message=Address added successfully`);
            } else {
                const address = await Address.findOne({ 
                    _id: id, 
                    user: req.session.userId 
                });
                
                if (!address) {
                    return res.redirect(`${redirectBase}?error=Address not found`);
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
                
                return res.redirect(`${redirectBase}?message=Address updated successfully`);
            }
        } catch (error) {
            console.error('Error saving address:', error);
            const isFromCheckout = req.query.checkout === 'true';
            const redirectPath = `/${isFromCheckout ? 'checkout/' : ''}edit-address/${req.params.id}`;
            
            req.session.formData = req.body;  
            req.session.formErrors = { general: 'Failed to save address' };
            
            return res.redirect(redirectPath);
        }
    },
    confirmDeleteAddress: async (req, res) => {
        try {
            const { id } = req.params;
            
            const address = await Address.findOne({ 
                _id: id, 
                user: req.session.userId 
            });
            
            if (!address) {
                return res.redirect('/addresses?error=Address not found');
            }
            
            if (address.isDefault) {
                return res.redirect('/addresses?error=Cannot delete default address');
            }
            
            res.render('confirm-delete-address', { 
                address, 
                activeTab: 'addresses',
                title: 'Confirm Address Deletion'
            });
        } catch (error) {
            console.error('Error loading address for deletion:', error);
            return res.redirect('/addresses?error=Failed to load address');
        }
    },
    
    deleteAddress: async (req, res) => {
        try {
            const { id } = req.params;
            
            const address = await Address.findOne({ 
                _id: id, 
                user: req.session.userId 
            });
            
            if (!address) {
                return res.redirect('/addresses?error=Address not found');
            }
            
            if (address.isDefault) {
                return res.redirect('/addresses?error=Cannot delete default address');
            }
            
            await Address.deleteOne({ _id: id });
            
            return res.redirect('/addresses?message=Address deleted successfully');
        } catch (error) {
            console.error('Error deleting address:', error);
            return res.redirect('/addresses?error=Failed to delete address');
        }
    }};

    module.exports = userController;