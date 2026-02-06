/**
 * User Conversations Controller
 * Handles viewing conversations for assigned agents (with permission checks)
 */

const UserAgentAssignment = require('../models/UserAgentAssignment');
const { sequelize } = require('../config/database');
const { getTableName } = require('../config/tables');
const { logAudit } = require('../utils/audit');
const logger = require('../utils/logger');

/**
 * Check if user has permission to view conversations
 */
async function checkConversationPermission(userId, agentId) {
    const assignment = await UserAgentAssignment.findOne({
        where: { user_id: userId, agent_id: agentId }
    });

    if (!assignment) {
        return { hasAccess: false, error: 'You do not have access to this agent' };
    }

    if (!assignment.can_view_conversations) {
        return { hasAccess: false, error: 'You do not have permission to view conversations for this agent' };
    }

    return { hasAccess: true, assignment };
}

/**
 * Get conversations for a session
 * GET /api/user/sessions/:sessionId/conversations
 */
async function getSessionConversations(req, res) {
    try {
        const userId = req.user.user_id;
        const { sessionId } = req.params;
        const { page = 1, limit = 50 } = req.query;

        const sessionsTableName = getTableName('Sessions');
        const conversationsTableName = getTableName('Conversations');

        // Get session to check agent_id
        const sessions = await sequelize.query(`
            SELECT agent_id, agent_name
            FROM ${sessionsTableName}
            WHERE session_id = :sessionId
        `, {
            replacements: { sessionId },
            type: sequelize.QueryTypes.SELECT
        });

        if (sessions.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }

        const session = sessions[0];

        // Check permission
        const permCheck = await checkConversationPermission(userId, session.agent_id);
        if (!permCheck.hasAccess) {
            return res.status(403).json({
                success: false,
                error: permCheck.error
            });
        }

        const offset = (page - 1) * limit;

        // Get conversations
        const conversations = await sequelize.query(`
            SELECT 
                conversation_id,
                session_id,
                agent_id,
                agent_name,
                turns,
                summary,
                summary_language,
                created_at
            FROM ${conversationsTableName}
            WHERE session_id = :sessionId
            ORDER BY created_at ASC
            LIMIT :limit OFFSET :offset
        `, {
            replacements: { sessionId, limit: parseInt(limit), offset: parseInt(offset) },
            type: sequelize.QueryTypes.SELECT
        });

        // Get total count
        const countResult = await sequelize.query(`
            SELECT COUNT(*) as total
            FROM ${conversationsTableName}
            WHERE session_id = :sessionId
        `, {
            replacements: { sessionId },
            type: sequelize.QueryTypes.SELECT
        });

        const total = parseInt(countResult[0].total);

        await logAudit({
            userId,
            action: 'user_view_conversations',
            resourceType: 'session',
            resourceId: sessionId,
            req
        });

        res.json({
            success: true,
            conversations,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        logger.error('Get session conversations error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch conversations'
        });
    }
}

/**
 * Get all conversations for an agent (paginated)
 * GET /api/user/agents/:agentId/conversations
 */
async function getAgentConversations(req, res) {
    try {
        const userId = req.user.user_id;
        const { agentId } = req.params;
        const { page = 1, limit = 50, search } = req.query;

        // Check permission
        const permCheck = await checkConversationPermission(userId, agentId);
        if (!permCheck.hasAccess) {
            return res.status(403).json({
                success: false,
                error: permCheck.error
            });
        }

        const offset = (page - 1) * limit;
        const conversationsTableName = getTableName('Conversations');

        // Build where clause
        let whereClause = 'agent_id = :agentId';
        const replacements = { agentId, limit: parseInt(limit), offset: parseInt(offset) };

        if (search) {
            whereClause += ` AND (summary ILIKE :search OR turns::text ILIKE :search)`;
            replacements.search = `%${search}%`;
        }

        // Get conversations
        const conversations = await sequelize.query(`
            SELECT 
                conversation_id,
                session_id,
                agent_id,
                agent_name,
                turns,
                summary,
                summary_language,
                created_at
            FROM ${conversationsTableName}
            WHERE ${whereClause}
            ORDER BY created_at DESC
            LIMIT :limit OFFSET :offset
        `, {
            replacements,
            type: sequelize.QueryTypes.SELECT
        });

        // Get total count
        const countResult = await sequelize.query(`
            SELECT COUNT(*) as total
            FROM ${conversationsTableName}
            WHERE ${whereClause}
        `, {
            replacements: { ...replacements, limit: undefined, offset: undefined },
            type: sequelize.QueryTypes.SELECT
        });

        const total = parseInt(countResult[0].total);

        await logAudit({
            userId,
            action: 'user_view_agent_conversations',
            resourceType: 'agent',
            resourceId: agentId,
            req
        });

        res.json({
            success: true,
            conversations,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        logger.error('Get agent conversations error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch conversations'
        });
    }
}

/**
 * Get conversation details by ID
 * GET /api/user/conversations/:conversationId
 */
async function getConversationDetails(req, res) {
    try {
        const userId = req.user.user_id;
        const { conversationId } = req.params;

        const conversationsTableName = getTableName('Conversations');

        // Get conversation
        const conversations = await sequelize.query(`
            SELECT *
            FROM ${conversationsTableName}
            WHERE conversation_id = :conversationId
        `, {
            replacements: { conversationId },
            type: sequelize.QueryTypes.SELECT
        });

        if (conversations.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Conversation not found'
            });
        }

        const conversation = conversations[0];

        // Check permission
        const permCheck = await checkConversationPermission(userId, conversation.agent_id);
        if (!permCheck.hasAccess) {
            return res.status(403).json({
                success: false,
                error: permCheck.error
            });
        }

        await logAudit({
            userId,
            action: 'user_view_conversation_details',
            resourceType: 'conversation',
            resourceId: conversationId,
            req
        });

        res.json({
            success: true,
            conversation
        });

    } catch (error) {
        logger.error('Get conversation details error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch conversation details'
        });
    }
}

/**
 * Check if user has permission to mark/review sessions
 */
async function checkMarkPermission(userId, agentId) {
    const User = require('../models/User');
    const user = await User.findByPk(userId);

    // Super admins always have permission
    if (user.role === 'super_admin') return true;

    // Check if user has this agent assigned with mark permission
    const assignment = await UserAgentAssignment.findOne({
        where: { user_id: userId, agent_id: agentId }
    });

    if (!assignment) return false;

    // Admins with the agent can mark, or users with explicit can_mark=true
    return user.role === 'admin' || assignment.can_mark === true;
}

/**
 * Update review status for a conversation
 * PATCH /api/user/conversations/:sessionId/review-status
 */
async function updateReviewStatus(req, res) {
    try {
        const userId = req.user.user_id;
        const { sessionId } = req.params;
        const { status } = req.body; // 'needs_review' | 'completed' | 'pending'

        const conversationsTableName = getTableName('Conversations');

        // Validate status
        const validStatuses = ['pending', 'needs_review', 'completed'];
        if (!status || !validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid status. Must be one of: pending, needs_review, completed'
            });
        }

        // Get conversation and check if it exists
        const conversations = await sequelize.query(`
            SELECT * FROM ${conversationsTableName}
            WHERE session_id = :sessionId
        `, {
            replacements: { sessionId },
            type: sequelize.QueryTypes.SELECT
        });

        if (conversations.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'Conversation not found'
            });
        }

        const conversation = conversations[0];

        // Check if user has permission to mark this session
        const hasPermission = await checkMarkPermission(userId, conversation.agent_id);
        if (!hasPermission) {
            return res.status(403).json({
                success: false,
                error: 'You do not have permission to mark sessions for this agent'
            });
        }

        // Update review status
        await sequelize.query(`
            UPDATE ${conversationsTableName}
            SET 
                review_status = :status,
                reviewed_by = :userId,
                reviewed_at = NOW(),
                updated_at = NOW()
            WHERE session_id = :sessionId
        `, {
            replacements: { status, userId, sessionId },
            type: sequelize.QueryTypes.UPDATE
        });

        // Fetch updated conversation
        const updatedConversations = await sequelize.query(`
            SELECT * FROM ${conversationsTableName}
            WHERE session_id = :sessionId
        `, {
            replacements: { sessionId },
            type: sequelize.QueryTypes.SELECT
        });

        await logAudit({
            userId,
            action: 'update_review_status',
            resourceType: 'conversation',
            resourceId: sessionId,
            metadata: { new_status: status },
            req
        });

        logger.info(`Session ${sessionId} marked as '${status}' by user ${userId}`);

        res.json({
            success: true,
            conversation: updatedConversations[0]
        });

    } catch (error) {
        logger.error('Update review status error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to update review status'
        });
    }
}

module.exports = {
    getSessionConversations,
    getAgentConversations,
    getConversationDetails,
    updateReviewStatus
};
