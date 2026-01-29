/**
 * Table Configuration Utility
 * 
 * Manages dynamic table names based on environment (production vs test)
 * This allows safe testing without affecting production data
 */

require('dotenv').config();

const APP_ENV = process.env.APP_ENV || 'production';

/**
 * Returns the appropriate table name based on environment
 * @param {string} baseTableName - Base name like 'Agents', 'Sessions', 'Conversations'
 * @returns {string} Prefixed table name
 */
function getTableName(baseTableName) {
    if (APP_ENV === 'test') {
        // Use lowercase: test_agents, test_sessions, test_conversations
        return `test_${baseTableName.toLowerCase()}`;
    }
    return baseTableName;
}

/**
 * Gets all table names for current environment
 * @returns {Object} Object with agents, sessions, conversations table names
 */
function getAllTableNames() {
    return {
        agents: getTableName('Agents'),
        sessions: getTableName('Sessions'),
        conversations: getTableName('Conversations')
    };
}

/**
 * Logs current environment configuration
 */
function logEnvironmentInfo() {
    const tables = getAllTableNames();
    console.log(`📊 Environment: ${APP_ENV}`);
    console.log(`📋 Tables: ${tables.agents}, ${tables.sessions}, ${tables.conversations}`);
}

module.exports = {
    APP_ENV,
    getTableName,
    getAllTableNames,
    logEnvironmentInfo
};
