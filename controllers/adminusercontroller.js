const User = require('../models/user');

exports.getAllUsers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = 10; 
        const skip = (page - 1) * limit;
        const search = req.query.search || '';
        const sort = req.query.sort || 'newest';

        let searchQuery = {};
        if (search) {
            searchQuery = {
                $or: [
                    { name: { $regex: search, $options: 'i' } },
                    { email: { $regex: search, $options: 'i' } }
                ]
            };
        }

        let sortOptions = {};
        switch (sort) {
            case 'oldest':
                sortOptions = { createdAt: 1 };
                break;
            case 'name_asc':
                sortOptions = { name: 1 };
                break;
            case 'name_desc':
                sortOptions = { name: -1 };
                break;
            case 'newest':
            default:
                sortOptions = { createdAt: -1 };
                break;
        }

        const users = await User.find(searchQuery)
            .sort(sortOptions)
            .skip(skip)
            .limit(limit);

        const totalUsers = await User.countDocuments(searchQuery);
        const totalPages = Math.ceil(totalUsers / limit);

        res.render('admin/users', {
            users,
            currentPage: page,
            totalPages,
            totalUsers,
            limit,
            search,
            sort
        });
    } catch (error) {
        console.error('Error in getAllUsers:', error);
        res.status(500).render('error', { message: 'Server error' });
    }
};

exports.blockUser = async (req, res) => {
    try {
        const userId = req.params.id;
        await User.findByIdAndUpdate(userId, { isBlocked: true });
        
        const { page, search, sort } = req.query;
        let redirectUrl = '/admin/users';
        
        const queryParams = [];
        if (page) queryParams.push(`page=${page}`);
        if (search) queryParams.push(`search=${search}`);
        if (sort) queryParams.push(`sort=${sort}`);
        
        if (queryParams.length > 0) {
            redirectUrl += '?' + queryParams.join('&');
        }
        
        res.redirect(redirectUrl);
    } catch (error) {
        console.error('Error in blockUser:', error);
        res.status(500).render('error', { message: 'Server error' });
    }
};

exports.unblockUser = async (req, res) => {
    try {
        const userId = req.params.id;
        await User.findByIdAndUpdate(userId, { isBlocked: false });
        
        const { page, search, sort } = req.query;
        let redirectUrl = '/admin/users';
        
        const queryParams = [];
        if (page) queryParams.push(`page=${page}`);
        if (search) queryParams.push(`search=${search}`);
        if (sort) queryParams.push(`sort=${sort}`);
        
        if (queryParams.length > 0) {
            redirectUrl += '?' + queryParams.join('&');
        }
        
        res.redirect(redirectUrl);
    } catch (error) {
        console.error('Error in unblockUser:', error);
        res.status(500).render('error', { message: 'Server error' });
    }
};