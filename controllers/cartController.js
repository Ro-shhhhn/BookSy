const Cart = require('../models/cartModel');
const Product = require('../models/productModel');
const Wishlist = require('../models/wishlistModel');
const Category = require('../models/categoryModel');
const offerUtils = require('../utils/offerUtils');


async function processCartItems(cart) {
    const validItems = [];
    const unavailableItems = [];
    let priceUpdated = false;
    let cartUpdated = false;
    let restoredItemsCount = 0;
    
    for (const item of cart.items) {
        if (item.product && item.product.isActive && item.product.stock > 0) {
            const category = await Category.findById(item.product.category);
            if (category && category.status) {
                const categoryOffer = await offerUtils.getActiveCategoryOffer(category._id);
                
                const discountInfo = offerUtils.calculateBestDiscount(
                    item.product.price,
                    item.product.discountPrice,
                    categoryOffer
                );
                
                if (item.price !== discountInfo.finalPrice || !item.discountSource || !item.discountPercentage) {
                    item.price = discountInfo.finalPrice;
                    item.discountSource = discountInfo.discountSource;
                    item.discountPercentage = discountInfo.discountPercentage;
                    priceUpdated = true;
                }
                
                if (item.quantity > item.product.stock) {
                    item.quantity = Math.max(1, item.product.stock);
                    priceUpdated = true;
                }
                
                validItems.push(item);
            } else {
                unavailableItems.push({
                    item,
                    reason: 'categoryUnavailable'
                });
                cartUpdated = true;
            }
        } else if (item.product) {
            unavailableItems.push({
                item,
                reason: !item.product.isActive ? 'productUnavailable' : 'outOfStock'
            });
            cartUpdated = true;
        }
    }
    
    if (cart.unavailableItems && cart.unavailableItems.length > 0) {
        for (const unavailableItem of cart.unavailableItems) {
            if (!unavailableItem.item.product) continue;
            
            if (unavailableItem.item.product.isActive && unavailableItem.item.product.stock > 0) {
                const category = await Category.findById(unavailableItem.item.product.category);
                if (category && category.status) {
                    const categoryOffer = await offerUtils.getActiveCategoryOffer(category._id);
                    
                    const discountInfo = offerUtils.calculateBestDiscount(
                        unavailableItem.item.product.price,
                        unavailableItem.item.product.discountPrice,
                        categoryOffer
                    );
                    
                    let quantity = unavailableItem.item.quantity;
                    if (quantity > unavailableItem.item.product.stock) {
                        quantity = Math.max(1, unavailableItem.item.product.stock);
                    }
                    
                    validItems.push({
                        product: unavailableItem.item.product,
                        quantity: quantity,
                        price: discountInfo.finalPrice,
                        discountSource: discountInfo.discountSource,
                        discountPercentage: discountInfo.discountPercentage
                    });
                    
                    restoredItemsCount++;
                    cartUpdated = true;
                } else {
                    unavailableItems.push(unavailableItem);
                }
            } else {
                unavailableItems.push(unavailableItem);
            }
        }
    }
    
    return {
        validItems,
        unavailableItems,
        priceUpdated,
        cartUpdated,
        restoredItemsCount
    };
}

exports.getCart = async (req, res) => {
    try {
        let cart = await Cart.findOne({ user: req.session.userId })
            .populate({
                path: 'items.product',
                select: 'title author coverImage price discountPrice stock isActive category'
            })
            .populate({
                path: 'unavailableItems.item.product',
                select: 'title author coverImage price discountPrice stock isActive category'
            });

        if (!cart) {
            cart = { items: [], unavailableItems: [], totalAmount: 0 };
        } else {
            const { 
                validItems, 
                unavailableItems, 
                priceUpdated, 
                cartUpdated,
                restoredItemsCount 
            } = await processCartItems(cart);
            
            cart.items = validItems;
            cart.unavailableItems = unavailableItems;
            
            if (priceUpdated || cartUpdated || validItems.length !== cart.items.length) {
                cart.calculateTotalAmount();
                await cart.save();
            }

            res.render('user/cart', { 
                cart,
                user: req.session.user || {},
                userId: req.session.userId,
                hasUnavailableItems: cart.unavailableItems && cart.unavailableItems.length > 0,
                itemsRestoredCount: restoredItemsCount
            });
            return;
        }

        res.render('user/cart', { 
            cart,
            user: req.session.user || {},
            userId: req.session.userId,
            hasUnavailableItems: cart.unavailableItems && cart.unavailableItems.length > 0
        });
    } catch (error) {
        console.error('Cart page error:', error);
        res.status(500).render('error', { 
            message: 'Error loading your cart',
            error
        });
    }
};

exports.addToCart = async (req, res) => {
    try {
        const { productId, quantity = 1 } = req.body;
        const userId = req.session.userId;

        const product = await Product.findById(productId);
        if (!product) {
            return res.status(404).json({ success: false, message: 'Product not found' });
        }

        if (!product.isActive) {
            return res.status(400).json({ success: false, message: 'This product is currently unavailable' });
        }

        if (product.stock <= 0) {
            return res.status(400).json({ success: false, message: 'Product is out of stock' });
        }

        const category = await Category.findById(product.category);
        if (!category || !category.status) {
            return res.status(400).json({ success: false, message: 'This product category is currently unavailable' });
        }

        const requestedQuantity = parseInt(quantity);
        if (isNaN(requestedQuantity) || requestedQuantity <= 0) {
            return res.status(400).json({ success: false, message: 'Invalid quantity' });
        }
        const maxAllowedQuantity = Math.min(4, product.stock);
        const finalQuantity = Math.min(requestedQuantity, maxAllowedQuantity);

        let cart = await Cart.findOne({ user: userId });
        if (!cart) {
            cart = new Cart({ user: userId, items: [], unavailableItems: [], totalAmount: 0 });
        }

        const existingItemIndex = cart.items.findIndex(item => 
            item.product.toString() === productId.toString()
        );

        let quantityMessage = '';
        
        // Get category offer and calculate best discount
        const categoryOffer = await offerUtils.getActiveCategoryOffer(product.category);
        const discountInfo = offerUtils.calculateBestDiscount(
            product.price,
            product.discountPrice,
            categoryOffer
        );
        const currentPrice = discountInfo.finalPrice;
        
        if (existingItemIndex > -1) {
            const newQuantity = Math.min(cart.items[existingItemIndex].quantity + finalQuantity, maxAllowedQuantity);
            
            if (newQuantity < cart.items[existingItemIndex].quantity + requestedQuantity) {
                if (product.stock < 4) {
                    quantityMessage = `Limited to ${product.stock} units due to stock availability.`;
                } else {
                    quantityMessage = 'Limited to maximum 4 units per order.';
                }
            }
            
            cart.items[existingItemIndex].quantity = newQuantity;
            cart.items[existingItemIndex].price = currentPrice;
            cart.items[existingItemIndex].discountSource = discountInfo.discountSource;
            cart.items[existingItemIndex].discountPercentage = discountInfo.discountPercentage;
        } else {
            if (finalQuantity < requestedQuantity) {
                if (product.stock < 4) {
                    quantityMessage = `Limited to ${product.stock} units due to stock availability.`;
                } else {
                    quantityMessage = 'Limited to maximum 4 units per order.';
                }
            }
            
            cart.items.push({
                product: productId,
                quantity: finalQuantity,
                price: currentPrice,
                discountSource: discountInfo.discountSource,
                discountPercentage: discountInfo.discountPercentage
            });
        }

        cart.calculateTotalAmount();
        await cart.save();

        await Wishlist.updateOne(
            { user: userId },
            { $pull: { products: productId } }
        );

        return res.status(200).json({ 
            success: true, 
            message: quantityMessage ? 
                `Product added to cart. ${quantityMessage}` : 
                'Product added to cart successfully' 
        });
    } catch (error) {
        console.error('Add to cart error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to add product to cart' 
        });
    }
};

exports.updateCartItem = async (req, res) => {
    try {
        const { productId, change } = req.body;
        const userId = req.session.userId;

        if (!productId || !change || ![1, -1].includes(parseInt(change))) {
            return res.status(400).json({ success: false, message: 'Invalid request' });
        }

        const cart = await Cart.findOne({ user: userId });
        if (!cart) {
            return res.status(404).json({ success: false, message: 'Cart not found' });
        }

        const itemIndex = cart.items.findIndex(item => 
            item.product.toString() === productId.toString()
        );

        if (itemIndex === -1) {
            return res.status(404).json({ success: false, message: 'Product not found in cart' });
        }

        const product = await Product.findById(productId);
        if (!product || !product.isActive) {
            return res.status(400).json({ success: false, message: 'Product is no longer available' });
        }

        const currentQty = cart.items[itemIndex].quantity;
        const newQty = currentQty + parseInt(change);
        const maxQty = Math.min(4, product.stock);

        if (newQty < 1) {
            return res.status(400).json({ 
                success: false, 
                message: 'Minimum quantity is 1. Use remove button to delete item.'
            });
        } else if (newQty <= maxQty) {
            cart.items[itemIndex].quantity = newQty;
        } else {
            let message;
            if (product.stock <= 4) {
                message = `Sorry, only ${product.stock} units of this product are in stock.`;
            } else {
                message = `Sorry, you can only purchase up to 4 units of this product per order.`;
            }
            
            return res.status(400).json({ 
                success: false, 
                limitReached: true,
                message: message
            });
        }

        cart.calculateTotalAmount();
        await cart.save();

        return res.status(200).json({ 
            success: true, 
            message: 'Cart updated successfully' 
        });
    } catch (error) {
        console.error('Update cart error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to update cart' 
        });
    }
};

exports.removeCartItem = async (req, res) => {
    try {
        const { productId, confirmed } = req.body;
        const userId = req.session.userId;

        if (!confirmed) {
            return res.status(200).json({
                success: false,
                requireConfirmation: true,
                message: 'Please confirm you want to remove this item from your cart',
                productId
            });
        }

        const cart = await Cart.findOne({ user: userId });
        
        if (!cart) {
            return res.status(404).json({ success: false, message: 'Cart not found' });
        }
        
        let itemRemoved = false;
        
        const initialItemsLength = cart.items.length;
        cart.items = cart.items.filter(item => 
            item.product.toString() !== productId.toString()
        );
        if (cart.items.length < initialItemsLength) {
            itemRemoved = true;
        }
        
        if (cart.unavailableItems && cart.unavailableItems.length > 0) {
            const initialUnavailableLength = cart.unavailableItems.length;
            cart.unavailableItems = cart.unavailableItems.filter(unavailableItem => 
                unavailableItem.item.product.toString() !== productId.toString()
            );
            if (cart.unavailableItems.length < initialUnavailableLength) {
                itemRemoved = true;
            }
        }
        
        if (!itemRemoved) {
            return res.status(404).json({ success: false, message: 'Item not found in cart' });
        }

        cart.calculateTotalAmount();
        await cart.save();
        
        const cartCount = cart.items.reduce((total, item) => total + item.quantity, 0);

        return res.status(200).json({ 
            success: true, 
            message: 'Item removed from cart successfully',
            cartCount 
        });
    } catch (error) {
        console.error('Remove from cart error:', error);
        return res.status(500).json({ 
            success: false, 
            message: 'Failed to remove item from cart' 
        });
    }
};

exports.validateCartForCheckout = async (req, res) => {
    try {
        const userId = req.session.userId;
        
        let cart = await Cart.findOne({ user: userId })
            .populate({
                path: 'items.product',
                select: 'title author coverImage price discountPrice stock isActive category'
            });
        
        if (!cart || cart.items.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Your cart is empty' 
            });
        }
        
        const invalidItems = [];
        let hasInvalidItems = false;
        
        for (const item of cart.items) {
            if (!item.product || !item.product.isActive) {
                invalidItems.push({
                    title: item.product ? item.product.title : 'Unknown product',
                    reason: 'This product is no longer available'
                });
                hasInvalidItems = true;
                continue;
            }
            
            if (item.product.stock <= 0) {
                invalidItems.push({
                    title: item.product.title,
                    reason: 'This product is out of stock'
                });
                hasInvalidItems = true;
                continue;
            }
            
            if (item.quantity > item.product.stock) {
                invalidItems.push({
                    title: item.product.title,
                    reason: `Only ${item.product.stock} items available (you requested ${item.quantity})`
                });
                hasInvalidItems = true;
                continue;
            }
            
            const category = await Category.findById(item.product.category);
            if (!category || !category.status) {
                invalidItems.push({
                    title: item.product.title,
                    reason: 'This product category is currently unavailable'
                });
                hasInvalidItems = true;
                continue;
            }
        }
        
        if (hasInvalidItems) {
            return res.status(400).json({
                success: false,
                message: 'Some items in your cart are no longer available',
                invalidItems: invalidItems
            });
        }
        
        return res.status(200).json({
            success: true,
            message: 'Cart validated successfully'
        });
        
    } catch (error) {
        console.error('Cart validation error:', error);
        return res.status(500).json({
            success: false,
            message: 'Error validating your cart'
        });
    }
};