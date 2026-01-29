/**
 * Check if test tables exist
 */
const path = require('path');
require('dotenv').config();
const { sequelize } = require(path.join(__dirname, '../src/config/database'));

async function checkTables() {
    try {
        await sequelize.authenticate();
        console.log('✅ Connected to database\n');

        const [result] = await sequelize.query(`
            SELECT tablename 
            FROM pg_tables 
            WHERE schemaname='public' 
            AND (tablename LIKE 'test_%' OR tablename IN ('Agents', 'Sessions', 'Conversations'))
            ORDER BY tablename
        `);

        console.log('📋 Tables found:');
        result.forEach(r => console.log(`   - ${r.tablename}`));

        await sequelize.close();
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

checkTables();
