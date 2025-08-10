import crypto from 'crypto';
import jwt from 'jsonwebtoken';

// JWT secret for storefront tokens (should be in env vars)
const JWT_SECRET = process.env.JWT_SECRET || 'your-jwt-secret-change-in-production';

/**
 * Generate JWT token for storefront requests
 * @param {string} shop - Shop domain
 * @param {string} customerId - Customer ID (optional for guests)
 * @param {number} expiresIn - Token expiration time in seconds (default: 1 hour)
 * @returns {string} JWT token
 */
export function generateStorefrontToken(shop, customerId = null, expiresIn = 3600) {
  const payload = {
    shop,
    customerId,
    type: 'storefront',
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + expiresIn
  };

  return jwt.sign(payload, JWT_SECRET);
}

/**
 * Verify JWT token from storefront
 * @param {string} token - JWT token
 * @returns {object|null} Decoded token payload or null if invalid
 */
export function verifyStorefrontToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    console.error('JWT verification failed:', error.message);
    return null;
  }
}

/**
 * Verify Shopify App Proxy HMAC signature
 * @param {object} req - Express request object
 * @param {string} shopifyApiSecret - Shopify API secret
 * @returns {boolean} True if signature is valid
 */
export function verifyAppProxyHMAC(req, shopifyApiSecret) {
  const hmac = req.headers['x-shopify-hmac-sha256'];
  if (!hmac) {
    console.error('Missing HMAC header');
    return false;
  }

  // Get the raw body
  const rawBody = req.rawBody || JSON.stringify(req.body);
  
  // Calculate expected HMAC
  const expectedHmac = crypto
    .createHmac('sha256', shopifyApiSecret)
    .update(Buffer.from(rawBody, 'utf8'))
    .digest('base64');

  // Compare HMACs
  return crypto.timingSafeEqual(
    Buffer.from(hmac, 'base64'),
    Buffer.from(expectedHmac, 'base64')
  );
}

/**
 * Middleware to verify app proxy requests
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next function
 */
export function verifyAppProxyRequest(req, res, next) {
  const shopifyApiSecret = process.env.SHOPIFY_API_SECRET;
  
  if (!shopifyApiSecret) {
    console.error('SHOPIFY_API_SECRET not configured');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  if (!verifyAppProxyHMAC(req, shopifyApiSecret)) {
    console.error('Invalid HMAC signature');
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Extract shop from URL or headers
  const shop = req.headers['x-shopify-shop-domain'] || 
               req.query.shop || 
               req.body.shop;

  if (!shop) {
    console.error('Shop domain not found in request');
    return res.status(400).json({ error: 'Shop domain required' });
  }

  req.shop = shop;
  next();
}

/**
 * Middleware to handle customer authentication
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {function} next - Express next function
 */
export function authenticateCustomer(req, res, next) {
  // Check for JWT token in Authorization header
  const authHeader = req.headers.authorization;
  let customerId = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = verifyStorefrontToken(token);
    
    if (decoded && decoded.shop === req.shop) {
      customerId = decoded.customerId;
    }
  }

  // For app proxy, we might also get customer info from Shopify
  if (!customerId) {
    customerId = req.headers['x-shopify-customer-id'] || 
                 req.query.customer_id || 
                 req.body.customer_id;
  }

  req.customerId = customerId;
  next();
}

/**
 * Generate guest session token
 * @param {string} shop - Shop domain
 * @param {string} guestId - Guest session ID
 * @returns {string} JWT token for guest
 */
export function generateGuestToken(shop, guestId) {
  return generateStorefrontToken(shop, `guest_${guestId}`, 86400); // 24 hours for guests
}

/**
 * Extract customer ID from token (handles both registered and guest customers)
 * @param {string} customerId - Customer ID from token
 * @returns {object} { isGuest: boolean, customerId: string }
 */
export function parseCustomerId(customerId) {
  if (!customerId) {
    return { isGuest: true, customerId: null };
  }

  if (customerId.startsWith('guest_')) {
    return { isGuest: true, customerId: customerId.substring(6) };
  }

  return { isGuest: false, customerId };
} 