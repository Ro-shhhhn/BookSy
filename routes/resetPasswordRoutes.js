const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const User = require('../models/user');
const OTP = require('../models/OTP');
const sendEmail = require('../utils/sendEmail');

// Forgot Password Page
router.get('/forgot-password', (req, res) => {
    res.render('forgot-password', { title: "Forgot Password - Booksy", errorMessage: null });
});

router.post('/forgot-password', async (req, res) => {
    const { email } = req.body; 
    const normalizedEmail = email.trim().toLowerCase();
  
    try {
        const user = await User.findOne({ 
            email: { $regex: new RegExp('^' + normalizedEmail + '$', 'i') } 
        });
        
        if (!user) {
            return res.status(400).render('forgot-password', {
                title: "Forgot Password - Booksy",
                errorMessage: 'This email is not registered. Please enter a valid registered email.'
            });
        }
    
        const otp = Math.floor(1000 + Math.random() * 9000).toString();
        
        await OTP.findOneAndUpdate(
            { email: normalizedEmail },
            { 
                email: normalizedEmail,
                otp: otp,
                expiresAt: new Date(Date.now() + 5 * 60 * 1000) // 5 minutes expiry
            },
            { upsert: true, new: true }
        );
        
        await sendEmail(
            normalizedEmail, 
            'OTP for Reset Password', 
            `Your OTP for password reset is ${otp}. This OTP will expire in 5 minutes.`
        );
    
        res.redirect(`/otp?email=${encodeURIComponent(normalizedEmail)}&purpose=reset`);
    } catch (error) {
        console.error('Error in forgot password:', error);
        res.status(500).render('forgot-password', {
            title: "Forgot Password - Booksy",
            errorMessage: 'An error occurred. Please try again later.'
        });
    }
});

router.get('/reset-password', (req, res) => {
    const email = req.query.email;
    if (!email) {
        return res.redirect('/forgot-password');
    }
    
    res.render('reset-password', { 
        title: "Reset Password - Booksy",
        email, 
        error: null, 
        success: null 
    });
});

router.post('/reset-password', async (req, res) => {
    const { newPassword, confirmPassword, email } = req.body;
    const normalizedEmail = email.trim().toLowerCase();
    
    console.log('Processing password reset for email:', normalizedEmail);

    const passwordRegex = /^(?=.*\d)(?=.*[A-Za-z])(?=.*[\W_]).{8,}$/; 
    if (!passwordRegex.test(newPassword)) {
        return res.render('reset-password', { 
            title: "Reset Password - Booksy",
            email: normalizedEmail, 
            error: 'Password must be at least 8 characters long, contain a number, and a special character.',
            success: null
        });
    }

    if (newPassword !== confirmPassword) {
        console.log('Passwords do not match');
        return res.render('reset-password', { 
            title: "Reset Password - Booksy",
            email: normalizedEmail, 
            error: 'Passwords do not match. Please try again.',
            success: null
        });
    }

    try {
        const user = await User.findOne({ 
            email: { $regex: new RegExp('^' + normalizedEmail + '$', 'i') } 
        });

        if (!user) {
            console.log('User not found for email:', normalizedEmail);
            return res.render('reset-password', { 
                title: "Reset Password - Booksy",
                email: normalizedEmail, 
                error: 'User not found. Please try again.',
                success: null
            });
        }

        user.password = newPassword;
        if (user.resetPasswordToken) user.resetPasswordToken = undefined;
        if (user.resetPasswordExpires) user.resetPasswordExpires = undefined;
        
        await user.save();
        console.log('Password updated successfully for user:', normalizedEmail);

        await OTP.deleteOne({ email: normalizedEmail });

        return res.render('reset-password', { 
            title: "Reset Password - Booksy",
            email: normalizedEmail, 
            error: null,
            success: 'Password updated successfully! Redirecting to login page...',
            redirect: true
        });
    } catch (error) {
        console.error('Error during password reset:', error);
        res.render('reset-password', { 
            title: "Reset Password - Booksy",
            email: normalizedEmail, 
            error: 'Server error. Please try again later.',
            success: null
        });
    }
});

module.exports = router;