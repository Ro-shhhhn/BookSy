const mongoose = require('mongoose');
const Admin = require('./models/adminuser');

// Connect to MongoDB
mongoose.connect('mongodb://localhost:27017/BookSy', { 
    useNewUrlParser: true, 
    useUnifiedTopology: true 
})
.then(async () => {
    console.log("MongoDB Connected...");
    
    try {
        // Check if admin already exists
        const existingAdmin = await Admin.findOne({ email: 'roshantheadmin@gmail.com' });
        
        if (existingAdmin) {
            console.log('Admin user already exists');
        } else {
            // Create new admin
            const admin = new Admin({
                email: 'roshantheadmin@gmail.com',
                password: 'RoshanMunnu', //  hashed by presave
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