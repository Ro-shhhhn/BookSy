// middleware/adminauth.js
exports.isAdminAuthenticated = (req, res, next) => {
    if (req.session.admin) {
        next();
    } else {
        res.redirect('/admin/login');
    }
};