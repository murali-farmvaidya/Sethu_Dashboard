/**
 * Agent Authorization Middleware
 * Checks if user has access to specific agents
 */

const UserAgentAssignment = require('../models/UserAgentAssignment');
const logger = require('../utils/logger');

/**
 * Middleware to check if user has access to a specific agent
 * Expects agentId in req.params
 */
async function authorizeAgentAccess(req, res, next) {
    try {
        const { agentId } = req.params;
        const userId = req.user.user_id;
        const userRole = req.user.role;

        // Admins can access all agents
        if (userRole === 'admin') {
            req.agentPermissions = {
                can_view_sessions: true,
                can_view_logs: true,
                can_view_conversations: true,
                can_export_data: true
            };
            return next();
        }

        // Check if user has assignment
        const assignment = await UserAgentAssignment.findOne({
            where: {
                user_id: userId,
                agent_id: agentId
            }
        });

        if (!assignment) {
            return res.status(403).json({
                success: false,
                error: 'You do not have access to this agent'
            });
        }

        // Attach permissions to request
        req.agentPermissions = {
            can_view_sessions: assignment.can_view_sessions,
            can_view_logs: assignment.can_view_logs,
            can_view_conversations: assignment.can_view_conversations,
            can_export_data: assignment.can_export_data
        };

        next();
    } catch (error) {
        logger.error('Agent authorization error:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Authorization failed'
        });
    }
}

/**
 * Middleware to check specific permission
 * @param {string} permission - Permission to check (e.g., 'can_view_logs')
 */
function requirePermission(permission) {
    return (req, res, next) => {
        if (!req.agentPermissions) {
            return res.status(403).json({
                success: false,
                error: 'Agent access not verified'
            });
        }

        if (!req.agentPermissions[permission]) {
            return res.status(403).json({
                success: false,
                error: `You do not have permission to perform this action (${permission})`
            });
        }

        next();
    };
}

/**
 * Middleware to get list of agent IDs user has access to
 * Attaches to req.accessibleAgentIds
 */
async function getAccessibleAgents(req, res, next) {
    try {
        const userId = req.user.user_id;
        const userRole = req.user.role;

        // Admins have access to all agents (handled at query level)
        if (userRole === 'admin') {
            req.accessibleAgentIds = null; // null means all agents
            return next();
        }

        // Get user's agent assignments
        const assignments = await UserAgentAssignment.findAll({
            where: { user_id: userId },
            attributes: ['agent_id']
        });

        req.accessibleAgentIds = assignments.map(a => a.agent_id);
        next();
    } catch (error) {
        logger.error('Error fetching accessible agents:', error.message);
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch accessible agents'
        });
    }
}

module.exports = {
    authorizeAgentAccess,
    requirePermission,
    getAccessibleAgents
};
