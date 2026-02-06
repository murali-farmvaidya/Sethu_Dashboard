const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { sequelize } = require('../src/config/database');
const { getTableName } = require('../src/config/tables');

async function fixSession() {
    try {
        await sequelize.authenticate();
        console.log('Connection has been established successfully.');

        const conversationTable = getTableName('Conversations');
        const sessionId = 'cac40c36-19ea-4e9a-9631-2ca193d17397';

        // Delete the conversation so it gets re-synced with new parsing logic
        const result = await sequelize.query(`DELETE FROM "${conversationTable}" WHERE session_id = '${sessionId}'`);

        console.log(`Deleted conversation ${sessionId}. Result:`, result);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await sequelize.close();
    }
}

fixSession();
