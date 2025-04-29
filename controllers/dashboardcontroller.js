exports.dashboard = (req, res) => {
    
    res.render('admin/Dashboard', {
        title: 'Admin Dashboard',
        user: req.session.admin 
    });
};
