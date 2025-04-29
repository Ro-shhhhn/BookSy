const Coupon = require('../models/couponModel');

exports.getAllCoupons = async (req, res) => {
  try {
    const { search, sortBy } = req.query;
    
    let query = {};
    
    if (search) {
      query.code = { $regex: search, $options: 'i' }; 
    }
    
    let sortOptions = { createdAt: -1 }; 
    
    if (sortBy) {
      switch (sortBy) {
        case 'newest':
          sortOptions = { createdAt: -1 };
          break;
        case 'oldest':
          sortOptions = { createdAt: 1 };
          break;
        case 'nameAsc':
          sortOptions = { code: 1 };
          break;
        case 'nameDesc':
          sortOptions = { code: -1 };
          break;
        default:
          sortOptions = { createdAt: -1 };
      }
    }
    
    const coupons = await Coupon.find(query).sort(sortOptions);
    
    res.render('admin/coupons', { 
      coupons, 
      title: 'Coupon Management',
      path: '/admin/coupons',
      currentSearch: search || '',
      currentSort: sortBy || 'newest'
    });
  } catch (error) {
    console.error('Error fetching coupons:', error);
    req.flash('error', 'Failed to fetch coupons');
    res.redirect('/admin/dashboard');
  }
};

exports.getAddCoupon = async (req, res) => {
  try {
    const coupons = await Coupon.find().sort({ createdAt: -1 });
    res.render('admin/add-coupon', { 
      coupons,
      title: 'Add Coupon',
      path: '/admin/coupons/add',
      errorMessage: req.flash('error')
    });
  } catch (error) {
    console.error('Error in add coupon page:', error);
    req.flash('error', 'Something went wrong');
    res.redirect('/admin/coupons');
  }
};

exports.createCoupon = async (req, res) => {
  try {
    const { code, discount, minAmount, maxAmount,  expirationDate } = req.body;

    if (!code || !discount || !minAmount || !maxAmount  || !expirationDate) {
      req.flash('error', 'All fields are required');
      return res.redirect('/admin/coupons/add');
    }

    const existingCoupon = await Coupon.findOne({ code: code.toUpperCase() });
    if (existingCoupon) {
      req.flash('error', 'Coupon code already exists');
      return res.redirect('/admin/coupons/add');
    }

    const newCoupon = new Coupon({
      code: code.toUpperCase(),
      discount: parseInt(discount),
      minAmount: parseInt(minAmount),
      maxAmount: parseInt(maxAmount),
      expirationDate: new Date(expirationDate)
    });

    await newCoupon.save();
    req.flash('success', 'Coupon created successfully');
    res.redirect('/admin/coupons');
  } catch (error) {
    console.error('Error creating coupon:', error);
    req.flash('error', 'Failed to create coupon');
    res.redirect('/admin/coupons/add');
  }
};

exports.toggleCouponStatus = async (req, res) => {
  try {
    const { couponId } = req.params;
    const coupon = await Coupon.findById(couponId);
    
    if (!coupon) {
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }
    
    coupon.isActive = !coupon.isActive;
    await coupon.save();
    
    res.status(200).json({ 
      success: true, 
      message: `Coupon ${coupon.isActive ? 'activated' : 'deactivated'} successfully`,
      isActive: coupon.isActive 
    });
  } catch (error) {
    console.error('Error toggling coupon status:', error);
    res.status(500).json({ success: false, message: 'Failed to update coupon status' });
  }
};

exports.deleteCoupon = async (req, res) => {
  try {
    const { couponId } = req.params;
    const result = await Coupon.findByIdAndDelete(couponId);
    
    if (!result) {
      return res.status(404).json({ success: false, message: 'Coupon not found' });
    }
    
    res.status(200).json({ success: true, message: 'Coupon deleted successfully' });
  } catch (error) {
    console.error('Error deleting coupon:', error);
    res.status(500).json({ success: false, message: 'Failed to delete coupon' });
  }
};
exports.getEditCoupon = async (req, res) => {
  try {
    const couponId = req.params.couponId;
    const coupon = await Coupon.findById(couponId);
    
    if (!coupon) {
      req.flash('error', 'Coupon not found');
      return res.redirect('/admin/coupons');
    }
    
    const formattedDate = coupon.expirationDate.toISOString().split('T')[0];
    
    res.render('admin/edit-coupon', { 
      coupon,
      formattedDate,
      title: 'Edit Coupon',
      path: '/admin/coupons/edit',
      errorMessage: req.flash('error')
    });
  } catch (error) {
    console.error('Error in edit coupon page:', error);
    req.flash('error', 'Something went wrong');
    res.redirect('/admin/coupons');
  }
};

exports.updateCoupon = async (req, res) => {
  try {
    const couponId = req.params.couponId;
    const { code, discount, minAmount, maxAmount, expirationDate } = req.body;

    if (!code || !discount || !minAmount || !maxAmount || !expirationDate) {
      req.flash('error', 'All fields are required');
      return res.redirect(`/admin/coupons/edit/${couponId}`);
    }

    const existingCoupon = await Coupon.findOne({ 
      code: code.toUpperCase(),
      _id: { $ne: couponId }
    });
    
    if (existingCoupon) {
      req.flash('error', 'Coupon code already exists');
      return res.redirect(`/admin/coupons/edit/${couponId}`);
    }

    await Coupon.findByIdAndUpdate(couponId, {
      code: code.toUpperCase(),
      discount: parseInt(discount),
      minAmount: parseInt(minAmount),
      maxAmount: parseInt(maxAmount),
      expirationDate: new Date(expirationDate)
    });

    req.flash('success', 'Coupon updated successfully');
    res.redirect('/admin/coupons');
  } catch (error) {
    console.error('Error updating coupon:', error);
    req.flash('error', 'Failed to update coupon');
    res.redirect('/admin/coupons');
  }
};