const Coupon = require('../../models/couponModel');


exports.validateCoupon = async (req, res) => {
  try {
    const { code, cartTotal } = req.body;
    
    if (!code) {
      return res.status(400).json({ success: false, message: 'Coupon code is required' });
    }
    
    if (!cartTotal || isNaN(cartTotal) || cartTotal <= 0) {
      return res.status(400).json({ success: false, message: 'Valid cart total is required' });
    }
    
    const coupon = await Coupon.findOne({ 
      code: { $regex: new RegExp(`^${code}$`, 'i') }
    });
    
    if (!coupon) {
      return res.status(404).json({ success: false, message: 'Invalid coupon code' });
    }
    
    if (!coupon.isActive) {
      return res.status(400).json({ success: false, message: 'This coupon is inactive' });
    }
    
    if (new Date() > new Date(coupon.expirationDate)) {
      return res.status(400).json({ success: false, message: 'This coupon has expired' });
    }
    
   
    
    if (parseFloat(cartTotal) < coupon.minAmount) {
      return res.status(400).json({ 
        success: false, 
        message: `This coupon requires a minimum purchase of ₹${coupon.minAmount}`
      });
    }
    
    if (parseFloat(cartTotal) > coupon.maxAmount && coupon.maxAmount !== Infinity) {
      return res.status(400).json({ 
        success: false, 
        message: `This coupon is valid only for purchases up to ₹${coupon.maxAmount}`
      });
    }
    
    const parsedCartTotal = parseFloat(cartTotal);
    const discountAmount = (parsedCartTotal * coupon.discount) / 100;
    const discountedTotal = parsedCartTotal - discountAmount;
    
    req.session.appliedCoupon = {
      id: coupon._id,
      code: coupon.code,
      discount: coupon.discount,
      discountAmount: discountAmount,
      discountedTotal: discountedTotal
    };
    
    return res.status(200).json({
      success: true,
      message: 'Coupon applied successfully',
      coupon: {
        code: coupon.code,
        discount: coupon.discount,
        discountAmount,
        discountedTotal
      }
    });
    
  } catch (error) {
    console.error('Error validating coupon:', error);
    return res.status(500).json({ success: false, message: 'Failed to validate coupon' });
  }
};
exports.removeCoupon = (req, res) => {
  try {
    if (req.session.appliedCoupon) {
      delete req.session.appliedCoupon;
      return res.status(200).json({ success: true, message: 'Coupon removed successfully' });
    }
    
    return res.status(400).json({ success: false, message: 'No coupon applied' });
  } catch (error) {
    console.error('Error removing coupon:', error);
    return res.status(500).json({ success: false, message: 'Failed to remove coupon' });
  }
};