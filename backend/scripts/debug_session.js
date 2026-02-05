const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') }); // explicit path to .env
const { sequelize } = require('../src/config/database');
const { getTableName } = require('../src/config/tables');

async function checkSession() {
    try {
        await sequelize.authenticate();
        console.log('Connection has been established successfully.');

        const conversationTable = getTableName('Conversations');
        const sessionId = 'cac40c36-19ea-4e9a-9631-2ca193d17397';

        const [results] = await sequelize.query(`SELECT * FROM "${conversationTable}" WHERE session_id = '${sessionId}'`);

        if (results.length > 0) {
            console.log('Found conversation:', results[0].session_id);
            console.log('Current turns:', JSON.stringify(results[0].turns).substring(0, 200) + '...');
        } else {
            console.log('Conversation not found.');
        }

    } catch (error) {
        console.error('Unable to connect to the database:', error);
    } finally {
        await sequelize.close();
    }
}

checkSession();
