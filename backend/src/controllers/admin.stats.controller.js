/**
 * Admin Stats Controller
 * Provides monitoring and statistics for admin dashboard
 */

const User = require('../models/User');
const UserAgentAssignment = require('../models/UserAgentAssignment');
const AuditLog = require('../models/AuditLog');
const Agent = require('../models/Agent');
const Session = require('../models/Session');
const logger = require('../utils/logger');
const { Op } = require('sequelize');

/**
 * Get admin dashboard statistics
 * GET /api/admin/stats
 */
async function getAdminStats(req, res) {
    try {
        // User statistics
        const totalUsers = await User.count();
        const activeUsers = await User.count({ where: { is_active: true } });
        const adminUsers = await User.count({ where: { role: 'admin' } });

        // Agent & Session Statistics (Global)
        const totalAgents = await Agent.count();
        const totalSessions = await Session.count();
        const totalDuration = (await Session.sum('duration_seconds')) || 0;

        // User growth (last 7 days)
        const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        const newUsersLastWeek = await User.count({
            where: {
                created_at: { [Op.gte]: sevenDaysAgo }
            }
        });

        // Assignment statistics
        const totalAssignments = await UserAgentAssignment.count();

        // Subscription tier breakdown
        const subscriptionBreakdown = await User.findAll({
            attributes: [
                'subscription_tier',
                [User.sequelize.fn('COUNT', '*'), 'count']
            ],
            group: ['subscription_tier']
        });

        // Recent activity (last 10 audit logs)
        const recentActivity = await AuditLog.findAll({
            limit: 10,
            order: [['created_at', 'DESC']]
        });

        // Fetch user emails for recent activity
        const activityWithUsers = await Promise.all(
            recentActivity.map(async (log) => {
                let userEmail = 'Unknown';
                if (log.user_id) {
                    const user = await User.findByPk(log.user_id, { attributes: ['email'] });
                    if (user) userEmail = user.email;
                }
                return {
                    action: log.action,
                    userEmail,
                    timestamp: log.created_at,
                    resource: log.resource_type,
                    resourceId: log.resource_id
                };
            })
        );

        res.json({
            success: true,
            totalAgents, // Top-level for Dashboard compatibility
            totalSessions,
            totalDuration,
            stats: {
                totalAgents, // Duplicate inside stats for cleaner structure if Dashboard updates
                totalSessions,
                totalDuration,
                users: {
                    total: totalUsers,
                    active: activeUsers,
                    inactive: totalUsers - activeUsers,
                    admins: adminUsers,
                    newLastWeek: newUsersLastWeek
                },
                assignments: {
                    total: totalAssignments,
                    averagePerUser: totalUsers > 0 ? (totalAssignments / totalUsers).toFixed(2) : 0
                },
                subscriptions: subscriptionBreakdown.map(item => ({
                    tier: item.subscription_tier,
                    count: parseInt(item.dataValues.count)
                }))
            },
            recentActivity: activityWithUsers
        });

    } catch (error) {
        logger.error('Get admin stats error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch admin statistics'
        });
    }
}

/**
 * Get audit logs (with pagination and filtering)
 * GET /api/admin/audit-logs
 */
async function getAuditLogs(req, res) {
    try {
        const { page = 1, limit = 50, userId, action, startDate, endDate } = req.query;

        const offset = (page - 1) * limit;

        // Build where clause
        const where = {};
        if (userId) where.user_id = userId;
        if (action) where.action = action;
        if (startDate || endDate) {
            where.created_at = {};
            if (startDate) where.created_at[Op.gte] = new Date(startDate);
            if (endDate) where.created_at[Op.lte] = new Date(endDate);
        }

        const { count, rows } = await AuditLog.findAndCountAll({
            where,
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [['created_at', 'DESC']]
        });

        // Fetch user info for each log
        const logsWithUsers = await Promise.all(
            rows.map(async (log) => {
                let userEmail = null;
                let userRole = null;
                if (log.user_id) {
                    const user = await User.findByPk(log.user_id, { attributes: ['email', 'role'] });
                    if (user) {
                        userEmail = user.email;
                        userRole = user.role;
                    }
                }
                return {
                    ...log.toJSON(),
                    user: userEmail ? { email: userEmail, role: userRole } : null
                };
            })
        );

        res.json({
            success: true,
            logs: logsWithUsers,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(count / limit)
            }
        });

    } catch (error) {
        logger.error('Get audit logs error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch audit logs'
        });
    }
}

module.exports = {
    getAdminStats,
    getAuditLogs
};
