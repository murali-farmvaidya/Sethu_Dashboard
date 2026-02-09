/**
 * Data Admin Controller
 * Special admin endpoints for managing and deleting data
 * IMPORTANT: Deleted items are excluded from future syncs
 */

const { sequelize } = require('../config/database');
const { getTableName } = require('../config/tables');
const { logAudit } = require('../utils/audit');
const logger = require('../utils/logger');
const ExcludedItem = require('../models/ExcludedItem');

/**
 * Delete a session and exclude from future syncs
 * DELETE /api/data-admin/sessions/:sessionId
 */
async function deleteSession(req, res) {
    try {
        const userId = req.user.user_id;
        const { sessionId } = req.params;

        // Delete from Conversations table first (foreign key constraint)
        await sequelize.query(`
            DELETE FROM "${getTableName('Conversations')}"
            WHERE session_id = $1
        `, {
            replacements: [sessionId],
            type: sequelize.QueryTypes.DELETE
        });

        // Delete from Sessions table
        await sequelize.query(`
            DELETE FROM "${getTableName('Sessions')}"
            WHERE session_id = $1
        `, {
            replacements: [sessionId],
            type: sequelize.QueryTypes.DELETE
        });

        // Add to exclusion list to prevent re-sync
        await ExcludedItem.create({
            item_type: 'session',
            item_id: sessionId,
            excluded_by: userId,
            reason: 'Deleted by data admin'
        });

        await logAudit({
            userId,
            action: 'delete_session',
            resourceType: 'session',
            resourceId: sessionId,
            req
        });

        logger.info(`Session ${sessionId} deleted and excluded by ${userId}`);

        res.json({
            success: true,
            message: 'Session deleted and excluded from future syncs'
        });

    } catch (error) {
        logger.error('Delete session error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to delete session'
        });
    }
}

/**
 * Delete a conversation and exclude from future syncs
 * DELETE /api/data-admin/conversations/:sessionId
 */
async function deleteConversation(req, res) {
    try {
        const userId = req.user.user_id;
        const { sessionId } = req.params;

        // Delete from Conversations table
        await sequelize.query(`
            DELETE FROM "${getTableName('Conversations')}"
            WHERE session_id = $1
        `, {
            replacements: [sessionId],
            type: sequelize.QueryTypes.DELETE
        });

        // Add to exclusion list
        await ExcludedItem.create({
            item_type: 'conversation',
            item_id: sessionId,
            excluded_by: userId,
            reason: 'Deleted by data admin'
        });

        await logAudit({
            userId,
            action: 'delete_conversation',
            resourceType: 'conversation',
            resourceId: sessionId,
            req
        });

        logger.info(`Conversation ${sessionId} deleted and excluded by ${userId}`);

        res.json({
            success: true,
            message: 'Conversation deleted and excluded from future syncs'
        });

    } catch (error) {
        logger.error('Delete conversation error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to delete conversation'
        });
    }
}

/**
 * Delete an agent and all its data
 * DELETE /api/data-admin/agents/:agentId
 */
async function deleteAgent(req, res) {
    try {
        const userId = req.user.user_id;
        const { agentId } = req.params;

        // Get all sessions for this agent before deleting
        const sessions = await sequelize.query(`
            SELECT session_id FROM "${getTableName('Sessions')}"
            WHERE agent_id = $1
        `, {
            replacements: [agentId],
            type: sequelize.QueryTypes.SELECT
        });

        // Delete all conversations for these sessions
        for (const session of sessions) {
            await sequelize.query(`
                DELETE FROM "${getTableName('Conversations')}"
                WHERE session_id = $1
            `, {
                replacements: [session.session_id],
                type: sequelize.QueryTypes.DELETE
            });

            // Exclude each session
            await ExcludedItem.findOrCreate({
                where: {
                    item_type: 'session',
                    item_id: session.session_id
                },
                defaults: {
                    excluded_by: userId,
                    reason: 'Parent agent deleted by data admin'
                }
            });
        }

        // Delete all sessions for this agent
        await sequelize.query(`
            DELETE FROM "${getTableName('Sessions')}"
            WHERE agent_id = $1
        `, {
            replacements: [agentId],
            type: sequelize.QueryTypes.DELETE
        });

        // Delete agent
        await sequelize.query(`
            DELETE FROM "${getTableName('Agents')}"
            WHERE agent_id = $1
        `, {
            replacements: [agentId],
            type: sequelize.QueryTypes.DELETE
        });

        // Exclude agent from future syncs
        await ExcludedItem.create({
            item_type: 'agent',
            item_id: agentId,
            excluded_by: userId,
            reason: 'Deleted by data admin'
        });

        await logAudit({
            userId,
            action: 'delete_agent',
            resourceType: 'agent',
            resourceId: agentId,
            req
        });

        logger.info(`Agent ${agentId} and all related data deleted and excluded by ${userId}`);

        res.json({
            success: true,
            message: 'Agent and all related data deleted and excluded from future syncs',
            sessionCount: sessions.length
        });

    } catch (error) {
        logger.error('Delete agent error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to delete agent'
        });
    }
}

/**
 * Update conversation summary
 * PATCH /api/data-admin/conversations/:sessionId/summary
 */
async function updateSummary(req, res) {
    try {
        const userId = req.user.user_id;
        const { sessionId } = req.params;
        const { summary } = req.body;

        if (!summary) {
            return res.status(400).json({
                success: false,
                error: 'Summary is required'
            });
        }

        await sequelize.query(`
            UPDATE "${getTableName('Conversations')}"
            SET summary = $1, updated_at = NOW()
            WHERE session_id = $2
        `, {
            replacements: [summary, sessionId],
            type: sequelize.QueryTypes.UPDATE
        });

        await logAudit({
            userId,
            action: 'update_summary',
            resourceType: 'conversation',
            resourceId: sessionId,
            metadata: { summary },
            req
        });

        logger.info(`Summary updated for session ${sessionId} by ${userId}`);

        res.json({
            success: true,
            message: 'Summary updated successfully'
        });

    } catch (error) {
        logger.error('Update summary error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to update summary'
        });
    }
}

/**
 * Get all excluded items
 * GET /api/data-admin/excluded
 */
async function getExcludedItems(req, res) {
    try {
        const excluded = await ExcludedItem.findAll({
            order: [['excluded_at', 'DESC']]
        });

        res.json({
            success: true,
            excluded
        });

    } catch (error) {
        logger.error('Get excluded items error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch excluded items'
        });
    }
}

/**
 * Restore an excluded item (allow re-sync)
 * DELETE /api/data-admin/excluded/:itemType/:itemId
 */
async function restoreExcludedItem(req, res) {
    try {
        const userId = req.user.user_id;
        const { itemType, itemId } = req.params;

        await ExcludedItem.destroy({
            where: {
                item_type: itemType,
                item_id: itemId
            }
        });

        await logAudit({
            userId,
            action: 'restore_excluded_item',
            resourceType: itemType,
            resourceId: itemId,
            req
        });

        logger.info(`${itemType} ${itemId} restored to sync list by ${userId}`);

        res.json({
            success: true,
            message: `${itemType} ${itemId} will be re-synced on next cycle`
        });

    } catch (error) {
        logger.error('Restore excluded item error:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to restore item'
        });
    }
}

module.exports = {
    deleteSession,
    deleteConversation,
    deleteAgent,
    updateSummary,
    getExcludedItems,
    restoreExcludedItem
};
