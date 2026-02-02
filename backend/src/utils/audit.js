/**
 * Audit Logger Utility
 * Logs user actions to the database for security and compliance
 */

const AuditLog = require('../models/AuditLog');
const logger = require('./logger');

/**
 * Log an audit event
 * @param {Object} params - Audit log parameters
 * @param {string} params.userId - User ID who performed the action
 * @param {string} params.action - Action performed (e.g., 'login', 'create_user', 'view_session')
 * @param {string} params.resourceType - Type of resource (e.g., 'user', 'agent', 'session')
 * @param {string} params.resourceId - ID of the resource
 * @param {Object} params.req - Express request object (for IP and user agent)
 * @param {Object} params.metadata - Additional metadata
 */
async function logAudit({ userId, action, resourceType, resourceId, req, metadata = {} }) {
    try {
        const ipAddress = req?.ip || req?.connection?.remoteAddress || null;
        const userAgent = req?.get('user-agent') || null;

        await AuditLog.create({
            user_id: userId,
            action,
            resource_type: resourceType,
            resource_id: resourceId,
            ip_address: ipAddress,
            user_agent: userAgent,
            metadata
        });

        logger.debug(`Audit log created: ${action} by user ${userId}`);
    } catch (error) {
        logger.error('Failed to create audit log:', error.message);
        // Don't throw - audit logging should not break the application
    }
}

/**
 * Common audit actions as constants
 */
const AUDIT_ACTIONS = {
    // Authentication
    LOGIN: 'login',
    LOGOUT: 'logout',
    PASSWORD_CHANGE: 'password_change',
    PASSWORD_RESET_REQUEST: 'password_reset_request',
    PASSWORD_RESET_COMPLETE: 'password_reset_complete',

    // User Management
    USER_CREATE: 'user_create',
    USER_UPDATE: 'user_update',
    USER_DELETE: 'user_delete',
    USER_ACTIVATE: 'user_activate',
    USER_DEACTIVATE: 'user_deactivate',

    // Agent Assignment
    AGENT_ASSIGN: 'agent_assign',
    AGENT_UNASSIGN: 'agent_unassign',
    PERMISSION_UPDATE: 'permission_update',

    // Data Access
    VIEW_AGENTS: 'view_agents',
    VIEW_SESSIONS: 'view_sessions',
    VIEW_CONVERSATIONS: 'view_conversations',
    VIEW_LOGS: 'view_logs',
    EXPORT_DATA: 'export_data'
};

module.exports = {
    logAudit,
    AUDIT_ACTIONS
};
