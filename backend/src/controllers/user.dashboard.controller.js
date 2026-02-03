/**
 * User Dashboard Controller
 * Handles user-level dashboard operations (viewing assigned agents and stats)
 */

const UserAgentAssignment = require('../models/UserAgentAssignment');
const { sequelize } = require('../config/database');
const { getTableName } = require('../config/tables');
const logger = require('../utils/logger');
const { Op } = require('sequelize');

/**
 * Get user's assigned agents with statistics
 * GET /api/user/dashboard
 */
async function getUserDashboard(req, res) {
    try {
        const userId = req.user.user_id;

        // Get all agent assignments for this user
        const assignments = await UserAgentAssignment.findAll({
            where: { user_id: userId }
        });

        if (assignments.length === 0) {
            return res.json({
                success: true,
                message: 'No agents assigned yet',
                agents: [],
                stats: {
                    totalAgents: 0,
                    totalSessions: 0,
                    totalConversations: 0
                }
            });
        }

        const agentIds = assignments.map(a => a.agent_id);

        // Fetch agent details from Sessions table (to get agent names)
        const sessionsTableName = getTableName('Sessions');
        const conversationsTableName = getTableName('Conversations');

        // Get agent details and session counts
        const agentStats = await sequelize.query(`
            SELECT 
                s.agent_id,
                s.agent_name,
                COUNT(DISTINCT s.session_id) as session_count,
                COUNT(DISTINCT c.conversation_id) as conversation_count,
                MAX(s.started_at) as last_session_date
            FROM ${sessionsTableName} s
            LEFT JOIN ${conversationsTableName} c ON s.session_id = c.session_id
            WHERE s.agent_id = ANY(ARRAY[:agentIds]::text[])
            GROUP BY s.agent_id, s.agent_name
        `, {
            replacements: { agentIds },
            type: sequelize.QueryTypes.SELECT
        });

        // Combine assignments with stats
        const agentsWithStats = assignments.map(assignment => {
            const stats = agentStats.find(s => s.agent_id === assignment.agent_id) || {
                agent_name: assignment.agent_id,
                session_count: 0,
                conversation_count: 0,
                last_session_date: null
            };

            return {
                agentId: assignment.agent_id,
                agentName: stats.agent_name,
                permissions: {
                    canViewSessions: assignment.can_view_sessions,
                    canViewLogs: assignment.can_view_logs,
                    canViewConversations: assignment.can_view_conversations,
                    canExportData: assignment.can_export_data
                },
                stats: {
                    sessionCount: parseInt(stats.session_count) || 0,
                    conversationCount: parseInt(stats.conversation_count) || 0,
                    lastSessionDate: stats.last_session_date
                },
                assignedAt: assignment.assigned_at
            };
        });

        // Calculate overall stats
        const totalStats = {
            totalAgents: agentsWithStats.length,
            totalSessions: agentsWithStats.reduce((sum, a) => sum + a.stats.sessionCount, 0),
            totalConversations: agentsWithStats.reduce((sum, a) => sum + a.stats.conversationCount, 0)
        };

        res.json({
            success: true,
            agents: agentsWithStats,
            stats: totalStats
        });

    } catch (error) {
        logger.error('Get user dashboard error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch dashboard data',
            details: error.message
        });
    }
}

/**
 * Get specific agent details for user
 * GET /api/user/agents/:agentId
 */
async function getAgentDetails(req, res) {
    try {
        const userId = req.user.user_id;
        const { agentId } = req.params;

        // Check if user has access to this agent (skip for admins)
        let formattedPermissions = {
            canViewSessions: true,
            canViewLogs: true,
            canViewConversations: true,
            canExportData: true
        };
        let assignedAt = null;

        if (req.user.role !== 'admin') {
            const assignment = await UserAgentAssignment.findOne({
                where: { user_id: userId, agent_id: agentId }
            });

            if (!assignment) {
                return res.status(403).json({
                    success: false,
                    error: 'You do not have access to this agent'
                });
            }

            formattedPermissions = {
                canViewSessions: assignment.can_view_sessions,
                canViewLogs: assignment.can_view_logs,
                canViewConversations: assignment.can_view_conversations,
                canExportData: assignment.can_export_data
            };
            assignedAt = assignment.assigned_at;
        }

        // Get agent statistics
        const sessionsTableName = getTableName('Sessions');
        const conversationsTableName = getTableName('Conversations');

        const agentStats = await sequelize.query(`
            SELECT 
                s.agent_id,
                s.agent_name,
                COUNT(DISTINCT s.session_id) as total_sessions,
                COUNT(DISTINCT c.conversation_id) as total_conversations,
                COUNT(DISTINCT CASE WHEN s.ended_at IS NOT NULL THEN s.session_id END) as completed_sessions,
                MIN(s.started_at) as first_session_date,
                MAX(s.started_at) as last_session_date,
                AVG(EXTRACT(EPOCH FROM (s.ended_at - s.started_at))) as avg_session_duration_seconds
            FROM ${sessionsTableName} s
            LEFT JOIN ${conversationsTableName} c ON s.session_id = c.session_id
            WHERE s.agent_id = :agentId
            GROUP BY s.agent_id, s.agent_name
        `, {
            replacements: { agentId },
            type: sequelize.QueryTypes.SELECT
        });

        const stats = agentStats[0] || {
            agent_name: agentId,
            total_sessions: 0,
            total_conversations: 0,
            completed_sessions: 0,
            first_session_date: null,
            last_session_date: null,
            avg_session_duration_seconds: 0
        };

        res.json({
            success: true,
            agent: {
                agentId: agentId,
                agentName: stats.agent_name,
                permissions: formattedPermissions,
                stats: {
                    totalSessions: parseInt(stats.total_sessions) || 0,
                    totalConversations: parseInt(stats.total_conversations) || 0,
                    completedSessions: parseInt(stats.completed_sessions) || 0,
                    firstSessionDate: stats.first_session_date,
                    lastSessionDate: stats.last_session_date,
                    avgSessionDuration: parseFloat(stats.avg_session_duration_seconds) || 0
                },
                assignedAt: assignedAt
            }
        });

    } catch (error) {
        logger.error('Get agent details error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch agent details'
        });
    }
}

module.exports = {
    getUserDashboard,
    getAgentDetails
};
