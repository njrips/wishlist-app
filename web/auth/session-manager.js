import { PrismaClient } from '@prisma/client';
import { generateStorefrontToken, generateGuestToken } from './proxy-auth.js';

const prisma = new PrismaClient();

/**
 * Session Manager for customer authentication and token handling
 */
export class SessionManager {
  /**
   * Create or update customer session
   * @param {string} shop - Shop domain
   * @param {object} customerData - Customer data from Shopify
   * @returns {object} Session data with token
   */
  static async createCustomerSession(shop, customerData) {
    try {
      // Find or create shop
      let shopRecord = await prisma.shop.findUnique({
        where: { domain: shop }
      });

      if (!shopRecord) {
        shopRecord = await prisma.shop.create({
          data: {
            domain: shop,
            accessToken: 'placeholder', // Will be updated during app install
            installedAt: new Date()
          }
        });
      }

      // Find or create customer
      let customer = await prisma.customer.findFirst({
        where: {
          shopId: shopRecord.id,
          shopCustomerId: BigInt(customerData.id)
        }
      });

      if (!customer) {
        customer = await prisma.customer.create({
          data: {
            shopId: shopRecord.id,
            shopCustomerId: BigInt(customerData.id),
            email: customerData.email
          }
        });
      } else {
        // Update customer data
        customer = await prisma.customer.update({
          where: { id: customer.id },
          data: {
            email: customerData.email
          }
        });
      }

      // Generate session token
      const token = generateStorefrontToken(shop, customerData.id.toString());

      return {
        success: true,
        customer: {
          id: customer.id,
          shopCustomerId: customer.shopCustomerId.toString(),
          email: customer.email
        },
        token,
        expiresIn: 3600 // 1 hour
      };

    } catch (error) {
      console.error('Error creating customer session:', error);
      throw error;
    }
  }

  /**
   * Create guest session
   * @param {string} shop - Shop domain
   * @param {string} guestId - Guest session ID
   * @returns {object} Session data with token
   */
  static async createGuestSession(shop, guestId = null) {
    try {
      // Find or create shop
      let shopRecord = await prisma.shop.findUnique({
        where: { domain: shop }
      });

      if (!shopRecord) {
        shopRecord = await prisma.shop.create({
          data: {
            domain: shop,
            accessToken: 'placeholder',
            installedAt: new Date()
          }
        });
      }

      // Generate guest ID if not provided
      const sessionGuestId = guestId || `guest_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Generate guest token
      const token = generateGuestToken(shop, sessionGuestId);

      return {
        success: true,
        guest: {
          id: sessionGuestId,
          isGuest: true
        },
        token,
        expiresIn: 86400 // 24 hours
      };

    } catch (error) {
      console.error('Error creating guest session:', error);
      throw error;
    }
  }

  /**
   * Validate session token
   * @param {string} token - JWT token
   * @param {string} shop - Shop domain
   * @returns {object|null} Session data or null if invalid
   */
  static async validateSession(token, shop) {
    try {
      const { verifyStorefrontToken } = await import('./proxy-auth.js');
      const decoded = verifyStorefrontToken(token);

      if (!decoded || decoded.shop !== shop) {
        return null;
      }

      // Check if token is expired
      if (decoded.exp < Math.floor(Date.now() / 1000)) {
        return null;
      }

      return {
        shop: decoded.shop,
        customerId: decoded.customerId,
        type: decoded.type,
        expiresAt: new Date(decoded.exp * 1000)
      };

    } catch (error) {
      console.error('Error validating session:', error);
      return null;
    }
  }

  /**
   * Refresh session token
   * @param {string} token - Current JWT token
   * @param {string} shop - Shop domain
   * @returns {object|null} New session data or null if invalid
   */
  static async refreshSession(token, shop) {
    try {
      const session = await this.validateSession(token, shop);
      
      if (!session) {
        return null;
      }

      // Generate new token
      const newToken = generateStorefrontToken(shop, session.customerId);

      return {
        success: true,
        token: newToken,
        expiresIn: 3600,
        customerId: session.customerId
      };

    } catch (error) {
      console.error('Error refreshing session:', error);
      return null;
    }
  }

  /**
   * Get customer data by ID
   * @param {string} shop - Shop domain
   * @param {string} customerId - Customer ID
   * @returns {object|null} Customer data or null if not found
   */
  static async getCustomer(shop, customerId) {
    try {
      const shopRecord = await prisma.shop.findUnique({
        where: { domain: shop }
      });

      if (!shopRecord) {
        return null;
      }

      const customer = await prisma.customer.findFirst({
        where: {
          shopId: shopRecord.id,
          shopCustomerId: BigInt(customerId)
        }
      });

      return customer;

    } catch (error) {
      console.error('Error getting customer:', error);
      return null;
    }
  }

  /**
   * Log customer activity
   * @param {string} shop - Shop domain
   * @param {string} customerId - Customer ID (optional for guests)
   * @param {string} type - Event type
   * @param {object} payload - Event payload
   */
  static async logActivity(shop, customerId, type, payload) {
    try {
      const shopRecord = await prisma.shop.findUnique({
        where: { domain: shop }
      });

      if (!shopRecord) {
        return;
      }

      let customerRecord = null;
      if (customerId && !customerId.startsWith('guest_')) {
        customerRecord = await prisma.customer.findFirst({
          where: {
            shopId: shopRecord.id,
            shopCustomerId: BigInt(customerId)
          }
        });
      }

      await prisma.event.create({
        data: {
          shopId: shopRecord.id,
          customerId: customerRecord?.id || null,
          type,
          payload
        }
      });

    } catch (error) {
      console.error('Error logging activity:', error);
    }
  }
} 