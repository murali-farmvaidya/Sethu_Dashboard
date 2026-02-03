/**
 * Authentication Controller
 * Handles login, logout, password change, and password reset
 */

const User = require('../models/User');
const PasswordResetToken = require('../models/PasswordResetToken');
const { comparePassword, hashPassword, validatePasswordStrength } = require('../utils/password');
const { generateTokenPair } = require('../utils/jwt');
const { sendPasswordResetEmail } = require('../utils/email');
const { logAudit, AUDIT_ACTIONS } = require('../utils/audit');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * Login user
 * POST /api/auth/login
 */
async function login(req, res) {
    try {
        const { email, username, password } = req.body;
        const loginEmail = (email || username);

        // Validate input
        if (!loginEmail || !password) {
            return res.status(400).json({
                success: false,
                error: 'Email/Username and password are required'
            });
        }

        // Find user
        const user = await User.findOne({ where: { email: loginEmail.toLowerCase() } });

        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        // Check if user is active
        if (!user.is_active) {
            return res.status(403).json({
                success: false,
                error: 'Account is deactivated. Please contact your administrator.'
            });
        }

        // Verify password
        const isPasswordValid = await comparePassword(password, user.password_hash);

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                error: 'Invalid email or password'
            });
        }

        // Update last login
        await user.update({ last_login: new Date() });

        // Generate tokens
        const tokens = generateTokenPair(user);

        // Log audit
        await logAudit({
            userId: user.user_id,
            action: AUDIT_ACTIONS.LOGIN,
            req
        });

        // Return user info and tokens
        res.json({
            success: true,
            user: user.toSafeObject(),
            token: tokens.accessToken,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            mustChangePassword: user.must_change_password
        });

    } catch (error) {
        logger.error('Login error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Login failed'
        });
    }
}

/**
 * Get current user profile
 * GET /api/auth/me
 */
async function getMe(req, res) {
    try {
        // req.user is already attached by authenticate middleware
        res.json({
            success: true,
            user: req.user
        });
    } catch (error) {
        logger.error('Get profile error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch profile'
        });
    }
}

/**
 * Change password
 * POST /api/auth/change-password
 */
async function changePassword(req, res) {
    try {
        const { currentPassword, newPassword } = req.body;
        const userId = req.user.user_id;

        // Validate input
        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                success: false,
                error: 'Current password and new password are required'
            });
        }

        // Validate password strength
        const validation = validatePasswordStrength(newPassword);
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                error: 'Password does not meet requirements',
                details: validation.errors
            });
        }

        // Find user
        const user = await User.findByPk(userId);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Verify current password
        const isPasswordValid = await comparePassword(currentPassword, user.password_hash);

        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                error: 'Current password is incorrect'
            });
        }

        // Hash new password
        const newPasswordHash = await hashPassword(newPassword);

        // Update password
        await user.update({
            password_hash: newPasswordHash,
            must_change_password: false
        });

        // Log audit
        await logAudit({
            userId: user.user_id,
            action: AUDIT_ACTIONS.PASSWORD_CHANGE,
            req
        });

        logger.info(`Password changed for user: ${user.email}`);

        res.json({
            success: true,
            message: 'Password changed successfully'
        });

    } catch (error) {
        logger.error('Change password error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to change password'
        });
    }
}

/**
 * Request password reset
 * POST /api/auth/forgot-password
 */
async function forgotPassword(req, res) {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }

        // Find user
        const user = await User.findOne({ where: { email: email.toLowerCase() } });

        // Always return success to prevent email enumeration
        if (!user) {
            return res.json({
                success: true,
                message: 'If an account with that email exists, a password reset link has been sent.'
            });
        }

        // Generate reset token
        const resetToken = uuidv4();
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        // Save token
        await PasswordResetToken.create({
            user_id: user.user_id,
            token: resetToken,
            expires_at: expiresAt
        });

        // Send email
        await sendPasswordResetEmail(user.email, resetToken);

        // Log audit
        await logAudit({
            userId: user.user_id,
            action: AUDIT_ACTIONS.PASSWORD_RESET_REQUEST,
            req
        });

        logger.info(`Password reset requested for user: ${user.email}`);

        res.json({
            success: true,
            message: 'If an account with that email exists, a password reset link has been sent.'
        });

    } catch (error) {
        logger.error('Forgot password error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to process password reset request'
        });
    }
}

/**
 * Reset password with token
 * POST /api/auth/reset-password
 */
async function resetPassword(req, res) {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({
                success: false,
                error: 'Token and new password are required'
            });
        }

        // Validate password strength
        const validation = validatePasswordStrength(newPassword);
        if (!validation.valid) {
            return res.status(400).json({
                success: false,
                error: 'Password does not meet requirements',
                details: validation.errors
            });
        }

        // Find token
        const resetToken = await PasswordResetToken.findOne({
            where: { token }
        });

        if (!resetToken || !resetToken.isValid()) {
            return res.status(400).json({
                success: false,
                error: 'Invalid or expired reset token'
            });
        }

        // Find user
        const user = await User.findByPk(resetToken.user_id);

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Hash new password
        const newPasswordHash = await hashPassword(newPassword);

        // Update password
        await user.update({
            password_hash: newPasswordHash,
            must_change_password: false
        });

        // Mark token as used
        await resetToken.update({ used: true });

        // Log audit
        await logAudit({
            userId: user.user_id,
            action: AUDIT_ACTIONS.PASSWORD_RESET_COMPLETE,
            req
        });

        logger.info(`Password reset completed for user: ${user.email}`);

        res.json({
            success: true,
            message: 'Password reset successfully'
        });

    } catch (error) {
        logger.error('Reset password error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to reset password'
        });
    }
}

/**
 * Logout (client-side token invalidation)
 * POST /api/auth/logout
 */
async function logout(req, res) {
    try {
        // Log audit
        await logAudit({
            userId: req.user.user_id,
            action: AUDIT_ACTIONS.LOGOUT,
            req
        });

        res.json({
            success: true,
            message: 'Logged out successfully'
        });
    } catch (error) {
        logger.error('Logout error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Logout failed'
        });
    }
}

module.exports = {
    login,
    getMe,
    changePassword,
    forgotPassword,
    resetPassword,
    logout
};
