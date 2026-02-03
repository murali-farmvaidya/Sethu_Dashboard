/**
 * Authentication Middleware
 * Verifies JWT tokens and attaches user info to request
 */

const { verifyToken } = require('../utils/jwt');
const User = require('../models/User');
const logger = require('../utils/logger');

/**
 * Middleware to verify JWT token
 * Attaches user object to req.user if valid
 */
async function authenticate(req, res, next) {
    try {
        // Get token from Authorization header
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                error: 'No token provided'
            });
        }

        const token = authHeader.substring(7); // Remove 'Bearer ' prefix

        // Verify token
        const decoded = verifyToken(token);

        if (!decoded) {
            return res.status(401).json({
                success: false,
                error: 'Invalid or expired token'
            });
        }

        // Fetch user from database
        const user = await User.findOne({
            where: { user_id: decoded.userId }
        });

        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'User not found'
            });
        }

        // Check if user is active
        if (!user.is_active) {
            return res.status(403).json({
                success: false,
                error: 'Account is deactivated. Please contact your administrator.'
            });
        }

        // Attach user to request
        req.user = user.toSafeObject();
        next();

    } catch (error) {
        logger.error('Authentication error:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Authentication failed'
        });
    }
}

/**
 * Middleware to check if user has specific role(s)
 * @param {Array<string>} roles - Allowed roles
 */
function authorizeRoles(...roles) {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required'
            });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: 'Insufficient permissions'
            });
        }

        next();
    };
}

/**
 * Middleware to check if user must change password
 */
function checkPasswordChangeRequired(req, res, next) {
    if (req.user && req.user.must_change_password) {
        // Allow only password change endpoint
        if (!req.path.includes('/change-password')) {
            return res.status(403).json({
                success: false,
                error: 'Password change required',
                mustChangePassword: true
            });
        }
    }
    next();
}

module.exports = {
    authenticate,
    authorizeRoles,
    checkPasswordChangeRequired
};
