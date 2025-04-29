const express = require('express');
const router = express.Router();
const User = require('../models/user');
const OTP = require('../models/OTP');
const Wallet = require('../models/walletModel');
const nodemailer = require('nodemailer');
require('dotenv').config();

router.get("/otp", (req, res) => {
    const email = req.query.email || '';
    const purpose = req.query.purpose || 'signup'; 
    
    res.render("otp-verification", { 
        error: null,
        message: null,
        email: email,
        purpose: purpose 
    });
});

router.post("/verify-otp", async (req, res) => {
    const email = req.body.email?.trim().toLowerCase();
    const otp = req.body.otp?.trim();
    const purpose = req.body.purpose || 'signup';
    
    console.log('Attempting to verify OTP for email:', email, 'Purpose:', purpose, 'OTP entered:', otp);
    
    try {
      
        const storedOtp = await OTP.findOne({ email: email });
        
        if (!storedOtp) {
            console.log('No OTP found for email:', email);
            return res.render("otp-verification", { 
                error: "No valid OTP found. Please request a new OTP.", 
                message: null,
                email,
                purpose
            });
        }
        
        if (storedOtp.expiresAt < new Date()) {
            console.log('OTP expired for email:', email);
            return res.render("otp-verification", { 
                error: "OTP has expired. Please request a new OTP.", 
                message: null,
                email,
                purpose
            });
        }
        
        if (storedOtp.otp !== otp) {
            console.log('Invalid OTP for email:', email, 'Entered:', otp, 'Stored:', storedOtp.otp);
            return res.render("otp-verification", { 
                error: "Invalid OTP. Please try again.", 
                message: null,
                email,
                purpose
            });
        }
        
        const user = await User.findOne({ email: email });
        if (!user) {
            return res.render("otp-verification", { 
                error: "User not found.", 
                message: null,
                email,
                purpose
            });
        }
        
        if (purpose === 'signup') {
            user.verified = true;
            
            if (!user.referralCode) {
                const baseCode = user.name.replace(/\s+/g, '').substring(0, 5).toUpperCase();
                const uniqueCode = `${baseCode}${Math.floor(1000 + Math.random() * 9000)}`;
                user.referralCode = uniqueCode;
            }
            
            await user.save();
            console.log('User verified successfully:', email);
            
            if (user.referredBy) {
                const referrer = await User.findOne({ referralCode: user.referredBy });
                if (referrer) {
                    // Find or create referrer's wallet
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
                    
                    console.log(`Credited Rs. 200 to ${referrer.email}'s wallet for referring ${user.email}`);
                }
            }
            
            await OTP.deleteOne({ email: email });
            
            req.session.userId = user._id;
            req.session.isAuthenticated = true;
            req.session.userName = user.name;
            
            return res.redirect(`/?ref=${user.referralCode}`);
        } else if (purpose === 'reset') {
            console.log('OTP verified for password reset:', email);
            
            await OTP.deleteOne({ email: email });
            
            return res.redirect(`/reset-password?email=${encodeURIComponent(email)}`);
        }
        
        return res.redirect('/');
        
    } catch (err) {
        console.error('Error during OTP verification:', err);
        res.render("otp-verification", {
            error: "An error occurred. Please try again.",
            message: null,
            email: email || '',
            purpose: purpose
        });
    }
});

router.post("/resend-otp", async (req, res) => {
    const email = req.body.email?.trim().toLowerCase();
    const purpose = req.body.purpose || 'signup';
    
    if (!email) {
        return res.render("otp-verification", {
            error: "Email is required.",
            message: null,
            email: '',
            purpose: purpose
        });
    }

    try {
        const user = await User.findOne({ email });
        if (!user) {
            return res.render("otp-verification", {
                error: "User not found.",
                message: null,
                email: email,
                purpose: purpose
            });
        }
        
        const newOtp = Math.floor(1000 + Math.random() * 9000).toString();

        await OTP.findOneAndUpdate(
            { email },
            { 
                otp: newOtp, 
                expiresAt: new Date(Date.now() + 5 * 60 * 1000) 
            },
            { upsert: true, new: true }
        );

        console.log('New OTP for', email, ':', newOtp);

        try {
            const transporter = nodemailer.createTransport({
                service: 'gmail',
                auth: {
                    user: process.env.EMAIL_USER,
                    pass: process.env.EMAIL_PASS
                }
            });

            const mailOptions = {
                from: process.env.EMAIL_USER,
                to: email,
                subject: 'Your New OTP for BookSy',
                text: `Your new OTP is: ${newOtp}`
            };

            await transporter.sendMail(mailOptions);
            
            return res.render("otp-verification", {
                error: null,
                message: "New OTP sent successfully!",
                email: email,
                purpose: purpose
            });
        } catch (emailError) {
            console.error('Error sending email:', emailError);
            return res.render("otp-verification", {
                error: "Failed to send new OTP. Please try again.",
                message: null,
                email: email,
                purpose: purpose
            });
        }
    } catch (error) {
        console.error(error);
        res.render("otp-verification", {
            error: "Error resending OTP. Please try again.",
            message: null,
            email: email || '',
            purpose: purpose
        });
    }
});

module.exports = router;