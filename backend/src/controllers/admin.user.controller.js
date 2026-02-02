/**
 * Admin User Controller
 * Handles user management operations (admin only)
 */

const User = require('../models/User');
const UserAgentAssignment = require('../models/UserAgentAssignment');
const PasswordResetToken = require('../models/PasswordResetToken');
const { hashPassword, generateRandomPassword, validatePasswordStrength } = require('../utils/password');
const { sendWelcomeEmail, sendPasswordResetEmail } = require('../utils/email');
const { logAudit, AUDIT_ACTIONS } = require('../utils/audit');
const logger = require('../utils/logger');
const { v4: uuidv4 } = require('uuid');
const { Op } = require('sequelize');

/**
 * Get all users (with pagination and filtering)
 * GET /api/admin/users
 */
async function getAllUsers(req, res) {
    try {
        const { page = 1, limit = 10, role, isActive, search } = req.query;

        const offset = (page - 1) * limit;

        // Build where clause
        const where = {};
        if (role) where.role = role;
        if (isActive !== undefined) where.is_active = isActive === 'true';
        if (search) {
            where.email = { [Op.iLike]: `%${search}%` };
        }

        const { count, rows } = await User.findAndCountAll({
            where,
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [['created_at', 'DESC']],
            attributes: { exclude: ['password_hash'] }
        });

        // Get agent count for each user
        const usersWithAgentCount = await Promise.all(
            rows.map(async (user) => {
                const agentCount = await UserAgentAssignment.count({
                    where: { user_id: user.user_id }
                });
                return {
                    ...user.toJSON(),
                    agentCount
                };
            })
        );

        await logAudit({
            userId: req.user.user_id,
            action: 'admin_list_users',
            req
        });

        res.json({
            success: true,
            users: usersWithAgentCount,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(count / limit)
            }
        });

    } catch (error) {
        logger.error('Get all users error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch users'
        });
    }
}

/**
 * Get user by ID
 * GET /api/admin/users/:userId
 */
async function getUserById(req, res) {
    try {
        const { userId } = req.params;

        const user = await User.findByPk(userId, {
            attributes: { exclude: ['password_hash'] }
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Get user's agent assignments
        const assignments = await UserAgentAssignment.findAll({
            where: { user_id: userId }
        });

        await logAudit({
            userId: req.user.user_id,
            action: 'admin_view_user',
            resourceType: 'user',
            resourceId: userId,
            req
        });

        res.json({
            success: true,
            user: {
                ...user.toJSON(),
                assignments
            }
        });

    } catch (error) {
        logger.error('Get user by ID error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch user'
        });
    }
}

/**
 * Create new user
 * POST /api/admin/users
 */
async function createUser(req, res) {
    try {
        const { email, role = 'user', subscriptionTier = 'free', agents = [] } = req.body;

        // Validate input
        if (!email) {
            return res.status(400).json({
                success: false,
                error: 'Email is required'
            });
        }

        // Check if user already exists
        const existingUser = await User.findOne({ where: { email: email.toLowerCase() } });
        if (existingUser) {
            return res.status(400).json({
                success: false,
                error: 'User with this email already exists'
            });
        }

        // Generate random password
        const temporaryPassword = generateRandomPassword();
        const passwordHash = await hashPassword(temporaryPassword);

        // Create user
        const user = await User.create({
            email: email.toLowerCase(),
            password_hash: passwordHash,
            role,
            subscription_tier: subscriptionTier,
            is_active: true,
            must_change_password: true,
            created_by: req.user.user_id
        });

        // Assign agents if provided
        const agentAssignments = [];
        if (agents && agents.length > 0) {
            for (const agentConfig of agents) {
                const assignment = await UserAgentAssignment.create({
                    user_id: user.user_id,
                    agent_id: agentConfig.agentId,
                    can_view_sessions: agentConfig.canViewSessions !== false,
                    can_view_logs: agentConfig.canViewLogs || false,
                    can_view_conversations: agentConfig.canViewConversations !== false,
                    can_export_data: agentConfig.canExportData || false,
                    assigned_by: req.user.user_id
                });
                agentAssignments.push(assignment);
            }
        }

        // Send welcome email
        const emailResult = await sendWelcomeEmail(
            user.email,
            temporaryPassword,
            agents.map(a => ({ name: a.agentId })) // We'll fetch agent names later
        );

        // Log audit
        await logAudit({
            userId: req.user.user_id,
            action: AUDIT_ACTIONS.USER_CREATE,
            resourceType: 'user',
            resourceId: user.user_id,
            metadata: { email: user.email, role: user.role },
            req
        });

        logger.info(`User created: ${user.email} by admin: ${req.user.email}`);

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            user: user.toSafeObject(),
            temporaryPassword: temporaryPassword, // Return for testing (remove in production)
            emailSent: emailResult.success,
            agentAssignments: agentAssignments.length
        });

    } catch (error) {
        logger.error('Create user error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to create user',
            details: error.message
        });
    }
}

/**
 * Update user
 * PUT /api/admin/users/:userId
 */
async function updateUser(req, res) {
    try {
        const { userId } = req.params;
        const { role, subscriptionTier, isActive } = req.body;

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Prevent admins from demoting themselves
        if (userId === req.user.user_id && role && role !== 'admin') {
            return res.status(400).json({
                success: false,
                error: 'You cannot change your own admin role'
            });
        }

        // Update user
        const updates = {};
        if (role) updates.role = role;
        if (subscriptionTier) updates.subscription_tier = subscriptionTier;
        if (isActive !== undefined) updates.is_active = isActive;

        await user.update(updates);

        await logAudit({
            userId: req.user.user_id,
            action: AUDIT_ACTIONS.USER_UPDATE,
            resourceType: 'user',
            resourceId: userId,
            metadata: updates,
            req
        });

        logger.info(`User updated: ${user.email} by admin: ${req.user.email}`);

        res.json({
            success: true,
            message: 'User updated successfully',
            user: user.toSafeObject()
        });

    } catch (error) {
        logger.error('Update user error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to update user'
        });
    }
}

/**
 * Delete user
 * DELETE /api/admin/users/:userId
 */
async function deleteUser(req, res) {
    try {
        const { userId } = req.params;

        // Prevent self-deletion
        if (userId === req.user.user_id) {
            return res.status(400).json({
                success: false,
                error: 'You cannot delete your own account'
            });
        }

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const userEmail = user.email;
        await user.destroy();

        await logAudit({
            userId: req.user.user_id,
            action: AUDIT_ACTIONS.USER_DELETE,
            resourceType: 'user',
            resourceId: userId,
            metadata: { email: userEmail },
            req
        });

        logger.info(`User deleted: ${userEmail} by admin: ${req.user.email}`);

        res.json({
            success: true,
            message: 'User deleted successfully'
        });

    } catch (error) {
        logger.error('Delete user error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to delete user'
        });
    }
}

/**
 * Toggle user active status
 * PATCH /api/admin/users/:userId/toggle-active
 */
async function toggleUserActive(req, res) {
    try {
        const { userId } = req.params;

        // Prevent self-deactivation
        if (userId === req.user.user_id) {
            return res.status(400).json({
                success: false,
                error: 'You cannot deactivate your own account'
            });
        }

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const newStatus = !user.is_active;
        await user.update({ is_active: newStatus });

        await logAudit({
            userId: req.user.user_id,
            action: newStatus ? AUDIT_ACTIONS.USER_ACTIVATE : AUDIT_ACTIONS.USER_DEACTIVATE,
            resourceType: 'user',
            resourceId: userId,
            metadata: { is_active: newStatus },
            req
        });

        logger.info(`User ${newStatus ? 'activated' : 'deactivated'}: ${user.email} by admin: ${req.user.email}`);

        res.json({
            success: true,
            message: `User ${newStatus ? 'activated' : 'deactivated'} successfully`,
            user: user.toSafeObject()
        });

    } catch (error) {
        logger.error('Toggle user active error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to toggle user status'
        });
    }
}

/**
 * Send password reset link to user
 * POST /api/admin/users/:userId/reset-password
 */
async function sendPasswordReset(req, res) {
    try {
        const { userId } = req.params;

        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Generate reset token
        const resetToken = uuidv4();
        const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

        await PasswordResetToken.create({
            user_id: user.user_id,
            token: resetToken,
            expires_at: expiresAt
        });

        // Send email
        const emailResult = await sendPasswordResetEmail(user.email, resetToken);

        await logAudit({
            userId: req.user.user_id,
            action: 'admin_send_password_reset',
            resourceType: 'user',
            resourceId: userId,
            req
        });

        logger.info(`Password reset sent to: ${user.email} by admin: ${req.user.email}`);

        res.json({
            success: true,
            message: 'Password reset email sent successfully',
            emailSent: emailResult.success
        });

    } catch (error) {
        logger.error('Send password reset error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to send password reset'
        });
    }
}

module.exports = {
    getAllUsers,
    getUserById,
    createUser,
    updateUser,
    deleteUser,
    toggleUserActive,
    sendPasswordReset
};
