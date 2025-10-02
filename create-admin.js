require('dotenv').config();
const mongoose = require('mongoose');
const Admin = require('./models/adminuser');

// Read admin credentials from environment variables
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    console.error('ADMIN_EMAIL and ADMIN_PASSWORD must be set in the environment (or .env file). Aborting.');
    process.exit(1);
}

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/BookSy', { 
    useNewUrlParser: true, 
    useUnifiedTopology: true 
})
.then(async () => {
    console.log("MongoDB Connected...");
    
    try {
        // Check if admin already exists
        const existingAdmin = await Admin.findOne({ email: ADMIN_EMAIL });
        
        if (existingAdmin) {
            console.log('Admin user already exists');
        } else {
            // Create new admin using env credentials
            const admin = new Admin({
                email: ADMIN_EMAIL,
                password: ADMIN_PASSWORD, // hashed by pre-save hook in model
                name: 'Admin User',
                role: 'admin'
            });
            
            await admin.save();
            console.log('Admin user created successfully!');
        }
    } catch (error) {
        console.error('Error creating admin:', error);
    } finally {
        mongoose.disconnect();
        console.log('MongoDB Disconnected');
    }
})
.catch(err => {
    console.log("MongoDB Connection Error:", err);
});