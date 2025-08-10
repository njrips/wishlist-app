import express from 'express';
import { PrismaClient } from '@prisma/client';
import { 
  verifyAppProxyRequest, 
  authenticateCustomer, 
  generateStorefrontToken,
  parseCustomerId 
} from '../auth/proxy-auth.js';

const router = express.Router();
const prisma = new PrismaClient();

// Middleware to capture raw body for HMAC verification
router.use(express.json({
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));

// Apply auth middleware to all routes
router.use(verifyAppProxyRequest);
router.use(authenticateCustomer);

/**
 * GET /apps/wishlist - Get customer's wishlist
 */
router.get('/', async (req, res) => {
  try {
    const { shop, customerId } = req;
    const { isGuest, customerId: parsedCustomerId } = parseCustomerId(customerId);

    // Find the shop
    const shopRecord = await prisma.shop.findUnique({
      where: { domain: shop }
    });

    if (!shopRecord) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    let wishlist;

    if (isGuest) {
      // For guests, create or find a guest wishlist
      wishlist = await prisma.wishlist.findFirst({
        where: {
          shopId: shopRecord.id,
          customerId: null,
          shareUUID: parsedCustomerId || 'default-guest'
        }
      });

      if (!wishlist) {
        // Create new guest wishlist
        wishlist = await prisma.wishlist.create({
          data: {
            shopId: shopRecord.id,
            shareUUID: parsedCustomerId || `guest_${Date.now()}`,
            items: {
              create: []
            }
          },
          include: {
            items: true
          }
        });
      }
    } else {
      // For registered customers
      const customer = await prisma.customer.findFirst({
        where: {
          shopId: shopRecord.id,
          shopCustomerId: BigInt(parsedCustomerId)
        }
      });

      if (!customer) {
        return res.status(404).json({ error: 'Customer not found' });
      }

      wishlist = await prisma.wishlist.findUnique({
        where: {
          shopId_customerId: {
            shopId: shopRecord.id,
            customerId: customer.id
          }
        },
        include: {
          items: true
        }
      });

      if (!wishlist) {
        // Create new customer wishlist
        wishlist = await prisma.wishlist.create({
          data: {
            shopId: shopRecord.id,
            customerId: customer.id,
            shareUUID: `customer_${customer.id}_${Date.now()}`,
            items: {
              create: []
            }
          },
          include: {
            items: true
          }
        });
      }
    }

    // Generate token for future requests
    const token = generateStorefrontToken(shop, customerId);

    res.json({
      success: true,
      wishlist: {
        id: wishlist.id,
        shareUUID: wishlist.shareUUID,
        items: wishlist.items.map(item => ({
          id: item.id,
          productId: item.productId.toString(),
          variantId: item.variantId.toString(),
          handle: item.handle,
          createdAt: item.createdAt
        }))
      },
      token
    });

  } catch (error) {
    console.error('Error fetching wishlist:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/wishlist/items - Add item to wishlist
 */
router.post('/items', async (req, res) => {
  try {
    const { shop, customerId } = req;
    const { productId, variantId, handle } = req.body;

    if (!productId || !variantId || !handle) {
      return res.status(400).json({ 
        error: 'Missing required fields: productId, variantId, handle' 
      });
    }

    const { isGuest, customerId: parsedCustomerId } = parseCustomerId(customerId);

    // Find the shop
    const shopRecord = await prisma.shop.findUnique({
      where: { domain: shop }
    });

    if (!shopRecord) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    let wishlist;

    if (isGuest) {
      // For guests
      wishlist = await prisma.wishlist.findFirst({
        where: {
          shopId: shopRecord.id,
          customerId: null,
          shareUUID: parsedCustomerId || 'default-guest'
        }
      });

      if (!wishlist) {
        wishlist = await prisma.wishlist.create({
          data: {
            shopId: shopRecord.id,
            shareUUID: parsedCustomerId || `guest_${Date.now()}`,
          }
        });
      }
    } else {
      // For registered customers
      const customer = await prisma.customer.findFirst({
        where: {
          shopId: shopRecord.id,
          shopCustomerId: BigInt(parsedCustomerId)
        }
      });

      if (!customer) {
        return res.status(404).json({ error: 'Customer not found' });
      }

      wishlist = await prisma.wishlist.findUnique({
        where: {
          shopId_customerId: {
            shopId: shopRecord.id,
            customerId: customer.id
          }
        }
      });

      if (!wishlist) {
        wishlist = await prisma.wishlist.create({
          data: {
            shopId: shopRecord.id,
            customerId: customer.id,
            shareUUID: `customer_${customer.id}_${Date.now()}`,
          }
        });
      }
    }

    // Check if item already exists
    const existingItem = await prisma.wishlistItem.findFirst({
      where: {
        wishlistId: wishlist.id,
        productId: BigInt(productId),
        variantId: BigInt(variantId)
      }
    });

    if (existingItem) {
      return res.status(409).json({ 
        error: 'Item already in wishlist',
        item: {
          id: existingItem.id,
          productId: existingItem.productId.toString(),
          variantId: existingItem.variantId.toString(),
          handle: existingItem.handle
        }
      });
    }

    // Add item to wishlist
    const wishlistItem = await prisma.wishlistItem.create({
      data: {
        wishlistId: wishlist.id,
        productId: BigInt(productId),
        variantId: BigInt(variantId),
        handle
      }
    });

    // Log event
    await prisma.event.create({
      data: {
        shopId: shopRecord.id,
        customerId: isGuest ? null : customer?.id,
        type: 'add',
        payload: {
          productId,
          variantId,
          handle,
          isGuest
        }
      }
    });

    // Generate new token
    const token = generateStorefrontToken(shop, customerId);

    res.status(201).json({
      success: true,
      item: {
        id: wishlistItem.id,
        productId: wishlistItem.productId.toString(),
        variantId: wishlistItem.variantId.toString(),
        handle: wishlistItem.handle,
        createdAt: wishlistItem.createdAt
      },
      token
    });

  } catch (error) {
    console.error('Error adding item to wishlist:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /apps/wishlist/items/:id - Remove item from wishlist
 */
router.delete('/items/:id', async (req, res) => {
  try {
    const { shop, customerId } = req;
    const { id } = req.params;

    const { isGuest, customerId: parsedCustomerId } = parseCustomerId(customerId);

    // Find the shop
    const shopRecord = await prisma.shop.findUnique({
      where: { domain: shop }
    });

    if (!shopRecord) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Find the wishlist item
    const wishlistItem = await prisma.wishlistItem.findUnique({
      where: { id },
      include: {
        wishlist: true
      }
    });

    if (!wishlistItem) {
      return res.status(404).json({ error: 'Item not found' });
    }

    // Verify the item belongs to the correct shop
    if (wishlistItem.wishlist.shopId !== shopRecord.id) {
      return res.status(403).json({ error: 'Access denied' });
    }

    // For registered customers, verify ownership
    if (!isGuest) {
      const customer = await prisma.customer.findFirst({
        where: {
          shopId: shopRecord.id,
          shopCustomerId: BigInt(parsedCustomerId)
        }
      });

      if (!customer || wishlistItem.wishlist.customerId !== customer.id) {
        return res.status(403).json({ error: 'Access denied' });
      }
    } else {
      // For guests, verify it's a guest wishlist
      if (wishlistItem.wishlist.customerId !== null) {
        return res.status(403).json({ error: 'Access denied' });
      }
    }

    // Delete the item
    await prisma.wishlistItem.delete({
      where: { id }
    });

    // Log event
    await prisma.event.create({
      data: {
        shopId: shopRecord.id,
        customerId: isGuest ? null : customer?.id,
        type: 'remove',
        payload: {
          productId: wishlistItem.productId.toString(),
          variantId: wishlistItem.variantId.toString(),
          handle: wishlistItem.handle,
          isGuest
        }
      }
    });

    // Generate new token
    const token = generateStorefrontToken(shop, customerId);

    res.json({
      success: true,
      message: 'Item removed from wishlist',
      token
    });

  } catch (error) {
    console.error('Error removing item from wishlist:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /apps/wishlist/migrate - Migrate guest wishlist to customer account
 */
router.post('/migrate', async (req, res) => {
  try {
    const { shop, customerId } = req;
    const { guestToken } = req.body;

    if (!guestToken) {
      return res.status(400).json({ error: 'Guest token required' });
    }

    const { isGuest, customerId: parsedCustomerId } = parseCustomerId(customerId);

    if (isGuest) {
      return res.status(400).json({ error: 'Must be logged in to migrate wishlist' });
    }

    // Find the shop
    const shopRecord = await prisma.shop.findUnique({
      where: { domain: shop }
    });

    if (!shopRecord) {
      return res.status(404).json({ error: 'Shop not found' });
    }

    // Find the customer
    const customer = await prisma.customer.findFirst({
      where: {
        shopId: shopRecord.id,
        shopCustomerId: BigInt(parsedCustomerId)
      }
    });

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Extract guest ID from token
    const guestId = guestToken.replace('guest_', '');

    // Find guest wishlist
    const guestWishlist = await prisma.wishlist.findFirst({
      where: {
        shopId: shopRecord.id,
        customerId: null,
        shareUUID: guestId
      },
      include: {
        items: true
      }
    });

    if (!guestWishlist || guestWishlist.items.length === 0) {
      return res.json({
        success: true,
        message: 'No guest wishlist to migrate',
        migrated: false
      });
    }

    // Find or create customer wishlist
    let customerWishlist = await prisma.wishlist.findUnique({
      where: {
        shopId_customerId: {
          shopId: shopRecord.id,
          customerId: customer.id
        }
      }
    });

    if (!customerWishlist) {
      customerWishlist = await prisma.wishlist.create({
        data: {
          shopId: shopRecord.id,
          customerId: customer.id,
          shareUUID: `customer_${customer.id}_${Date.now()}`,
        }
      });
    }

    // Migrate items (avoid duplicates)
    let migratedCount = 0;
    for (const item of guestWishlist.items) {
      const existingItem = await prisma.wishlistItem.findFirst({
        where: {
          wishlistId: customerWishlist.id,
          productId: item.productId,
          variantId: item.variantId
        }
      });

      if (!existingItem) {
        await prisma.wishlistItem.create({
          data: {
            wishlistId: customerWishlist.id,
            productId: item.productId,
            variantId: item.variantId,
            handle: item.handle
          }
        });
        migratedCount++;
      }
    }

    // Delete guest wishlist
    await prisma.wishlist.delete({
      where: { id: guestWishlist.id }
    });

    // Log migration event
    await prisma.event.create({
      data: {
        shopId: shopRecord.id,
        customerId: customer.id,
        type: 'migrate',
        payload: {
          migratedCount,
          guestId
        }
      }
    });

    // Generate new token
    const token = generateStorefrontToken(shop, customerId);

    res.json({
      success: true,
      message: `Migrated ${migratedCount} items to your account`,
      migrated: true,
      migratedCount,
      token
    });

  } catch (error) {
    console.error('Error migrating wishlist:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router; 