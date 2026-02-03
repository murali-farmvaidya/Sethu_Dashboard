/**
 * Admin Agent Assignment Controller
 * Handles agent-to-user assignments and permissions (admin only)
 */

const UserAgentAssignment = require('../models/UserAgentAssignment');
const User = require('../models/User');
const Agent = require('../models/Agent'); // Added Agent model
const { logAudit, AUDIT_ACTIONS } = require('../utils/audit');
const logger = require('../utils/logger');

/**
 * Get all agent assignments for a user
 * GET /api/admin/users/:userId/agents
 */
async function getUserAgentAssignments(req, res) {
    try {
        const { userId } = req.params;

        // Verify user exists
        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const assignments = await UserAgentAssignment.findAll({
            where: { user_id: userId },
            order: [['assigned_at', 'DESC']]
        });

        res.json({
            success: true,
            user: user.toSafeObject(),
            assignments
        });

    } catch (error) {
        logger.error('Get user agent assignments error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch agent assignments'
        });
    }
}

/**
 * Assign agent to user
 * POST /api/admin/users/:userId/agents
 */
async function assignAgentToUser(req, res) {
    try {
        const { userId } = req.params;
        const {
            agentId,
            canViewSessions = true,
            canViewLogs = false,
            canViewConversations = true,
            canExportData = false
        } = req.body;

        // Validate input
        if (!agentId) {
            return res.status(400).json({
                success: false,
                error: 'Agent ID is required'
            });
        }

        // Verify user exists
        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Check if assignment already exists
        const existingAssignment = await UserAgentAssignment.findOne({
            where: { user_id: userId, agent_id: agentId }
        });

        if (existingAssignment) {
            return res.status(400).json({
                success: false,
                error: 'Agent already assigned to this user'
            });
        }

        // Create assignment
        const assignment = await UserAgentAssignment.create({
            user_id: userId,
            agent_id: agentId,
            can_view_sessions: canViewSessions,
            can_view_logs: canViewLogs,
            can_view_conversations: canViewConversations,
            can_export_data: canExportData,
            assigned_by: req.user.user_id
        });

        await logAudit({
            userId: req.user.user_id,
            action: AUDIT_ACTIONS.AGENT_ASSIGN,
            resourceType: 'agent_assignment',
            resourceId: assignment.assignment_id,
            metadata: { user_email: user.email, agent_id: agentId },
            req
        });

        logger.info(`Agent ${agentId} assigned to user ${user.email} by admin ${req.user.email}`);

        res.status(201).json({
            success: true,
            message: 'Agent assigned successfully',
            assignment
        });

    } catch (error) {
        logger.error('Assign agent to user error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to assign agent',
            details: error.message
        });
    }
}

/**
 * Update agent assignment permissions
 * PUT /api/admin/users/:userId/agents/:agentId
 */
async function updateAgentAssignment(req, res) {
    try {
        const { userId, agentId } = req.params;
        const {
            canViewSessions,
            canViewLogs,
            canViewConversations,
            canExportData
        } = req.body;

        const assignment = await UserAgentAssignment.findOne({
            where: { user_id: userId, agent_id: agentId }
        });

        if (!assignment) {
            return res.status(404).json({
                success: false,
                error: 'Agent assignment not found'
            });
        }

        // Update permissions
        const updates = {};
        if (canViewSessions !== undefined) updates.can_view_sessions = canViewSessions;
        if (canViewLogs !== undefined) updates.can_view_logs = canViewLogs;
        if (canViewConversations !== undefined) updates.can_view_conversations = canViewConversations;
        if (canExportData !== undefined) updates.can_export_data = canExportData;

        await assignment.update(updates);

        await logAudit({
            userId: req.user.user_id,
            action: AUDIT_ACTIONS.PERMISSION_UPDATE,
            resourceType: 'agent_assignment',
            resourceId: assignment.assignment_id,
            metadata: updates,
            req
        });

        logger.info(`Agent assignment permissions updated for user ${userId}, agent ${agentId}`);

        res.json({
            success: true,
            message: 'Agent assignment permissions updated successfully',
            assignment
        });

    } catch (error) {
        logger.error('Update agent assignment error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to update agent assignment'
        });
    }
}

/**
 * Remove agent assignment from user
 * DELETE /api/admin/users/:userId/agents/:agentId
 */
async function removeAgentAssignment(req, res) {
    try {
        const { userId, agentId } = req.params;

        const assignment = await UserAgentAssignment.findOne({
            where: { user_id: userId, agent_id: agentId }
        });

        if (!assignment) {
            return res.status(404).json({
                success: false,
                error: 'Agent assignment not found'
            });
        }

        await assignment.destroy();

        await logAudit({
            userId: req.user.user_id,
            action: AUDIT_ACTIONS.AGENT_UNASSIGN,
            resourceType: 'agent_assignment',
            resourceId: assignment.assignment_id,
            metadata: { user_id: userId, agent_id: agentId },
            req
        });

        logger.info(`Agent ${agentId} unassigned from user ${userId}`);

        res.json({
            success: true,
            message: 'Agent assignment removed successfully'
        });

    } catch (error) {
        logger.error('Remove agent assignment error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to remove agent assignment'
        });
    }
}

/**
 * Bulk assign multiple agents to a user
 * POST /api/admin/users/:userId/agents/bulk
 */
async function bulkAssignAgents(req, res) {
    try {
        const { userId } = req.params;
        const { agents } = req.body; // Array of { agentId, permissions }

        if (!agents || !Array.isArray(agents) || agents.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Agents array is required'
            });
        }

        // Verify user exists
        const user = await User.findByPk(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        const assignments = [];
        const errors = [];

        for (const agentConfig of agents) {
            try {
                // Check if already assigned
                const existing = await UserAgentAssignment.findOne({
                    where: { user_id: userId, agent_id: agentConfig.agentId }
                });

                if (existing) {
                    errors.push({ agentId: agentConfig.agentId, error: 'Already assigned' });
                    continue;
                }

                const assignment = await UserAgentAssignment.create({
                    user_id: userId,
                    agent_id: agentConfig.agentId,
                    can_view_sessions: agentConfig.canViewSessions !== false,
                    can_view_logs: agentConfig.canViewLogs || false,
                    can_view_conversations: agentConfig.canViewConversations !== false,
                    can_export_data: agentConfig.canExportData || false,
                    assigned_by: req.user.user_id
                });

                assignments.push(assignment);
            } catch (err) {
                errors.push({ agentId: agentConfig.agentId, error: err.message });
            }
        }

        await logAudit({
            userId: req.user.user_id,
            action: 'bulk_assign_agents',
            resourceType: 'user',
            resourceId: userId,
            metadata: { assigned_count: assignments.length, error_count: errors.length },
            req
        });

        logger.info(`Bulk assigned ${assignments.length} agents to user ${user.email}`);

        res.json({
            success: true,
            message: `Successfully assigned ${assignments.length} agents`,
            assignments,
            errors: errors.length > 0 ? errors : undefined
        });

    } catch (error) {
        logger.error('Bulk assign agents error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to bulk assign agents'
        });
    }
}

/**
 * Get all agents (for admin dashboard)
 * GET /api/admin/agents
 */
async function getAllAgents(req, res) {
    try {
        const { page = 1, limit = 10, search = '', sortBy = 'session_count', sortOrder = 'desc' } = req.query;
        const offset = (page - 1) * limit;

        const where = {};
        if (search) {
            // where.name = { [Op.iLike]: `%${search}%` }; // Requires Op import if used
            // Simple match for now or add Op if imported
        }

        // Just fetch all for now, complex filtering can be added nicely with Sequelize Op
        const { count, rows } = await Agent.findAndCountAll({
            where,
            limit: parseInt(limit),
            offset: parseInt(offset),
            order: [[sortBy, sortOrder.toUpperCase()]]
        });

        res.json({
            success: true,
            data: rows,
            pagination: {
                total: count,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(count / limit)
            }
        });

    } catch (error) {
        logger.error('Get all agents error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch agents'
        });
    }
}

module.exports = {
    getUserAgentAssignments,
    assignAgentToUser,
    updateAgentAssignment,
    removeAgentAssignment,
    bulkAssignAgents,
    getAllAgents // Exported
};
