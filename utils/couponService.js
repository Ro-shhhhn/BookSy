const validateCoupon = async (code, cartTotal) => {
    try {
      const response = await fetch('/api/coupons/validate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ code, cartTotal }),
      });
  
      return await response.json();
    } catch (error) {
      console.error('Error validating coupon:', error);
      return { success: false, message: 'Failed to validate coupon' };
    }
  };
  
  const applyCoupon = (cartTotal, couponDetails) => {
    if (!couponDetails || !couponDetails.discount) {
      return { discountedTotal: cartTotal, discountAmount: 0 };
    }
  
    const discountAmount = (cartTotal * couponDetails.discount) / 100;
    const discountedTotal = cartTotal - discountAmount;
  
    return {
      discountedTotal,
      discountAmount,
    };
  };
  
  const removeCoupon = () => {
    sessionStorage.removeItem('appliedCoupon');
    return { success: true, message: 'Coupon removed successfully' };
  };
  
  module.exports = {
    validateCoupon,
    applyCoupon,
    removeCoupon,
  };
  