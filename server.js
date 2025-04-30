const express = require('express');
const app = express();
const mongoose = require('mongoose');
const path = require("path");
const session = require('express-session');
const MongoStore = require('connect-mongo'); 
const cookieParser = require('cookie-parser');
const fs = require('fs');
const methodOverride = require('method-override');
const bodyParser = require('body-parser');
const passport = require('passport');
const flash = require('connect-flash');

require('dotenv').config();
require('./config/passport');
const cartRoutes = require('./routes/cartRoutes');

mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/BookSy', {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log("MongoDB Connected..."))
.catch(err => {
    console.log("MongoDB Connection Error:", err);
    // Log more details about the connection
    console.log("Connection URI:", process.env.MONGODB_URI ? "URI defined" : "URI undefined");
});

const uploadDir = path.join(__dirname, 'public/uploads/products');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}
app.use(express.static(path.join(__dirname, 'public')));

app.use('/uploads/products', express.static(path.join(__dirname, 'public/uploads/products')));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(cookieParser());
app.use(methodOverride('_method'));
app.use(flash());

// Updated session configuration with MongoStore for production
app.use(session({
    secret: process.env.SESSION_SECRET || 'your-strong-secret-key',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({
        mongoUrl: process.env.MONGODB_URI,
        ttl: 14 * 24 * 60 * 60, // 14 days
        autoRemove: 'native'
    }),
    cookie: { 
        maxAge: 24 * 60 * 60 * 1000,
        secure: process.env.NODE_ENV === 'production',
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax'
    }
}));

app.use((req, res, next) => {
    res.locals.session = req.session;
    next();
});
app.use('/cart', cartRoutes);
app.use(passport.initialize());
app.use(passport.session());

app.set('view engine', 'ejs');
app.set("views", path.join(__dirname, "views"));

app.use(bodyParser.json({limit: '10mb'}));
app.use(bodyParser.urlencoded({extended: true, limit: '10mb'}));

// Load middleware
const otpRoutes = require('./routes/otpRoutes');
const userRoutes = require('./routes/userRoutes');
const authRoutes = require('./routes/auth');
const resetPasswordRoutes = require('./routes/resetPasswordRoutes');
const adminroutes = require('./routes/adminroutes');
const authMiddleware = require('./middleware/authMiddleware');
const userMiddleware = require('./middleware/userMiddleware');
const checkoutRoutes = require('./routes/checkoutRoutes');
const orderRoutes = require('./routes/orderRoutes');
const cartMiddleware = require('./middleware/cartMiddleware');
const couponApiRoutes = require('./routes/apiRoutes');
const walletRoutes = require('./routes/walletRoutes');
const wishlistRoutes = require('./routes/wishlistRoutes');

app.use(userMiddleware.attachUserToResponse);
app.use('/wishlist', wishlistRoutes);

app.use(async (req, res, next) => {
    if (req.session.userId) {
        try {
            if (res.locals.user === null && req.session.isAuthenticated) {
                req.session.destroy(() => {
                    res.redirect('/login?message=Your account has been blocked by an administrator');
                });
                return;
            }
        } catch (error) {
            console.error('Block check middleware error:', error);
        }
    }
    next();
});


app.use('/', authRoutes);
app.use('/', otpRoutes); 
app.use('/', resetPasswordRoutes); 
app.use(checkoutRoutes);
app.use(orderRoutes);
app.use(cartMiddleware);
app.use('/wallet', walletRoutes);

app.use('/', userRoutes);
app.use('/api/coupons', couponApiRoutes);


app.use('/admin', adminroutes);

app.use((req, res, next) => {
    res.locals.successMessage = req.flash('success');
    res.locals.errorMessage = req.flash('error');
    next();
});

// Status endpoint for health checks
app.get('/status', (req, res) => {
    res.status(200).json({ status: 'ok', mongoConnection: mongoose.connection.readyState === 1 });
});

app.use((req, res) => res.status(404).render('error', { message: 'Page not found' }));
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).render('error', { message: 'Server error' });
});

// Updated to listen on all interfaces for Render
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});