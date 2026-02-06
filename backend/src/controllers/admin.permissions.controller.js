/**
 * Admin Permissions Controller
 * Handles granting/revoking mark permissions for users on specific agents
 */

const UserAgentAssignment = require('../models/UserAgentAssignment');
const User = require('../models/User');
const { logAudit } = require('../utils/audit');
const logger = require('../utils/logger');

/**
 * Toggle mark permission for a user on a specific agent
 * POST /api/admin/users/:userId/agents/:agentId/mark-permission
 */
async function toggleMarkPermission(req, res) {
    try {
        const requestingUserId = req.user.user_id;
        const { userId, agentId } = req.params;
        const { canMark } = req.body; // true | false

        const requestingUser = await User.findByPk(requestingUserId);
        const targetUser = await User.findByPk(userId);

        if (!targetUser) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }

        // Verify requesting user has admin rights for this agent
        if (requestingUser.role !== 'super_admin') {
            // If admin, check if they have this agent assigned
            const adminAssignment = await UserAgentAssignment.findOne({
                where: { user_id: requestingUserId, agent_id: agentId }
            });

            if (!adminAssignment) {
                return res.status(403).json({
                    success: false,
                    error: 'You do not have permission to manage this agent'
                });
            }
        }

        // Find or create assignment
        const [assignment, created] = await UserAgentAssignment.findOrCreate({
            where: { user_id: userId, agent_id: agentId },
            defaults: {
                can_mark: canMark
            }
        });

        if (!created) {
            // Update existing assignment
            await assignment.update({ can_mark: canMark });
        }

        await logAudit({
            userId: requestingUserId,
            action: 'toggle_mark_permission',
            resourceType: 'user_agent_assignment',
            resourceId: `${userId}-${agentId}`,
            metadata: { can_mark: canMark, target_user: userId },
            req
        });

        logger.info(`Mark permission ${canMark ? 'granted' : 'revoked'} for user ${userId} on agent ${agentId} by ${requestingUserId}`);

        res.json({
            success: true,
            assignment: {
                user_id: assignment.user_id,
                agent_id: assignment.agent_id,
                can_mark: assignment.can_mark
            }
        });

    } catch (error) {
        logger.error('Toggle mark permission error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to update mark permission'
        });
    }
}

/**
 * Get all user-agent assignments with mark permissions
 * GET /api/admin/mark-permissions
 */
async function getMarkPermissions(req, res) {
    try {
        const userId = req.user.user_id;
        const user = await User.findByPk(userId);

        let whereClause = {};

        // If not super_admin, only show agents they manage
        if (user.role !== 'super_admin') {
            const adminAgents = await UserAgentAssignment.findAll({
                where: { user_id: userId },
                attributes: ['agent_id']
            });

            const agentIds = adminAgents.map(a => a.agent_id);
            whereClause.agent_id = agentIds;
        }

        const assignments = await UserAgentAssignment.findAll({
            where: whereClause,
            include: [
                {
                    model: User,
                    attributes: ['user_id', 'email', 'role']
                }
            ],
            order: [['agent_id', 'ASC'], ['user_id', 'ASC']]
        });

        res.json({
            success: true,
            assignments
        });

    } catch (error) {
        logger.error('Get mark permissions error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch mark permissions'
        });
    }
}

module.exports = {
    toggleMarkPermission,
    getMarkPermissions
};
