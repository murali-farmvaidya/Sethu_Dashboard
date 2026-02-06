/**
 * User Sessions Controller
 * Handles viewing sessions for assigned agents (with permission checks)
 */

const UserAgentAssignment = require('../models/UserAgentAssignment');
const { sequelize } = require('../config/database');
const { getTableName } = require('../config/tables');
const { logAudit } = require('../utils/audit');
const logger = require('../utils/logger');
const { Op } = require('sequelize');
const exotelService = require('../services/exotel.service');

/**
 * Check if user has permission to view sessions for agent
 */
async function checkSessionPermission(userId, agentId) {
    const assignment = await UserAgentAssignment.findOne({
        where: { user_id: userId, agent_id: agentId }
    });

    if (!assignment) {
        return { hasAccess: false, error: 'You do not have access to this agent' };
    }

    if (!assignment.can_view_sessions) {
        return { hasAccess: false, error: 'You do not have permission to view sessions for this agent' };
    }

    return { hasAccess: true, assignment };
}

/**
 * Get sessions for an agent (paginated)
 * GET /api/user/agents/:agentId/sessions
 */
async function getAgentSessions(req, res) {
    try {
        const userId = req.user.user_id;
        const { agentId } = req.params;
        const { page = 1, limit = 20, status, startDate, endDate } = req.query;

        // Check permission
        const permCheck = await checkSessionPermission(userId, agentId);
        if (!permCheck.hasAccess) {
            return res.status(403).json({
                success: false,
                error: permCheck.error
            });
        }

        const offset = (page - 1) * limit;
        const sessionsTableName = getTableName('Sessions');

        // Build where clause
        let whereClause = 'agent_id = :agentId';
        const replacements = { agentId, limit: parseInt(limit), offset: parseInt(offset) };

        if (status) {
            whereClause += ' AND status = :status';
            replacements.status = status;
        }
        if (startDate) {
            whereClause += ' AND started_at >= :startDate';
            replacements.startDate = startDate;
        }
        if (endDate) {
            whereClause += ' AND started_at <= :endDate';
            replacements.endDate = endDate;
        }

        // Get sessions
        const conversationsTableName = getTableName('Conversations');
        const sessions = await sequelize.query(`
            SELECT 
                s.session_id,
                s.agent_id,
                s.agent_name,
                s.status,
                s.started_at,
                s.ended_at,
                EXTRACT(EPOCH FROM (s.ended_at - s.started_at)) as duration_seconds,
                s.metadata,
                c.review_status,
                c.reviewed_by,
                c.reviewed_at
            FROM ${sessionsTableName} s
            LEFT JOIN ${conversationsTableName} c ON s.session_id = c.session_id
            WHERE ${whereClause.replace(/(\w+) =/g, 's.$1 =')}
            ORDER BY s.started_at DESC
            LIMIT :limit OFFSET :offset
        `, {
            replacements,
            type: sequelize.QueryTypes.SELECT
        });

        // Get total count
        const countResult = await sequelize.query(`
            SELECT COUNT(*) as total
            FROM ${sessionsTableName}
            WHERE ${whereClause}
        `, {
            replacements: { ...replacements, limit: undefined, offset: undefined },
            type: sequelize.QueryTypes.SELECT
        });

        const total = parseInt(countResult[0].total);

        await logAudit({
            userId,
            action: 'user_view_sessions',
            resourceType: 'agent',
            resourceId: agentId,
            req
        });

        res.json({
            success: true,
            sessions: sessions.map(s => ({
                ...s,
                duration_seconds: parseFloat(s.duration_seconds) || null
            })),
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                totalPages: Math.ceil(total / limit)
            }
        });

    } catch (error) {
        logger.error('Get agent sessions error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch sessions'
        });
    }
}

/**
 * Get session details by ID
 * GET /api/user/sessions/:sessionId
 */
async function getSessionDetails(req, res) {
    try {
        const userId = req.user.user_id;
        const { sessionId } = req.params;

        const sessionsTableName = getTableName('Sessions');

        // Get session
        const sessions = await sequelize.query(`
            SELECT *
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
        const permCheck = await checkSessionPermission(userId, session.agent_id);
        if (!permCheck.hasAccess) {
            return res.status(403).json({
                success: false,
                error: permCheck.error
            });
        }

        // Get conversation count for this session (if user has permission)
        let conversationCount = 0;
        if (permCheck.assignment.can_view_conversations) {
            const conversationsTableName = getTableName('Conversations');
            const countResult = await sequelize.query(`
                SELECT COUNT(*) as total
                FROM ${conversationsTableName}
                WHERE session_id = :sessionId
            `, {
                replacements: { sessionId },
                type: sequelize.QueryTypes.SELECT
            });
            conversationCount = parseInt(countResult[0].total);
        }

        await logAudit({
            userId,
            action: 'user_view_session_details',
            resourceType: 'session',
            resourceId: sessionId,
            req
        });

        // Check for recording URL in metadata or try to fetch it
        let recordingUrl = null;
        const metadata = typeof session.metadata === 'string' ? JSON.parse(session.metadata) : session.metadata;
        const telephony = metadata?.telephony;

        if (telephony?.call_id && telephony?.transport === 'exotel') {
            // Try to fetch recording URL if we have a CallSid
            recordingUrl = await exotelService.getRecordingUrl(telephony.call_id);
        }

        res.json({
            success: true,
            session: {
                ...session,
                metadata, // return parsed metadata
                recordingUrl,
                conversationCount,
                canViewConversations: permCheck.assignment.can_view_conversations,
                canViewLogs: permCheck.assignment.can_view_logs
            }
        });

    } catch (error) {
        logger.error('Get session details error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch session details'
        });
    }
}

module.exports = {
    getAgentSessions,
    getSessionDetails
};
