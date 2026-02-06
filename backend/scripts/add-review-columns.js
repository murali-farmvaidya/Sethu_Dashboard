/**
 * Database Migration Script
 * Adds review tracking to Conversations table and mark permissions to User_Agents
 */

const path = require('path');
require('dotenv').config();
const { sequelize } = require(path.join(__dirname, '../src/config/database'));
const { getTableName } = require(path.join(__dirname, '../src/config/tables'));

async function runMigration() {
    try {
        await sequelize.authenticate();
        console.log('✅ Connected to database\n');

        // Add review columns to Conversations table
        const conversationsTable = getTableName('Conversations');
        console.log(`📝 Adding review columns to ${conversationsTable}...`);

        await sequelize.query(`
            ALTER TABLE "${conversationsTable}" 
            ADD COLUMN IF NOT EXISTS review_status VARCHAR(20) DEFAULT 'pending',
            ADD COLUMN IF NOT EXISTS reviewed_by TEXT,
            ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMP;
        `);

        console.log(`✅ Updated ${conversationsTable}`);

        // Add can_mark to UserAgentAssignments table
        const assignmentsTable = process.env.APP_ENV === 'test'
            ? 'test_useragentassignments'
            : 'UserAgentAssignments';

        console.log(`📝 Adding can_mark permission to ${assignmentsTable}...`);

        await sequelize.query(`
            ALTER TABLE "${assignmentsTable}" 
            ADD COLUMN IF NOT EXISTS can_mark BOOLEAN DEFAULT FALSE;
        `);

        console.log(`✅ Updated ${assignmentsTable}\n`);
        console.log('✅ Migration completed successfully!');

        await sequelize.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    }
}

runMigration();
