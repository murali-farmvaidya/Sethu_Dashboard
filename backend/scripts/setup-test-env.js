/**
 * Simple Test Table Creator
 * Creates test tables by copying structure from production tables
 */

const path = require('path');
require('dotenv').config();
const { sequelize } = require(path.join(__dirname, '../src/config/database'));

async function setupTest() {
    try {
        console.log('🔧 Creating test tables...\n');
        await sequelize.authenticate();

        // Simply duplicate the existing tables
        console.log('Creating test_Agents (copy of Agents structure)...');
        await sequelize.query('CREATE TABLE IF NOT EXISTS test_Agents (LIKE "Agents" INCLUDING ALL)');
        console.log('✅ Done\n');

        console.log('Creating test_Sessions (copy of Sessions structure)...');
        await sequelize.query('CREATE TABLE IF NOT EXISTS test_Sessions (LIKE "Sessions" INCLUDING ALL)');
        console.log('✅ Done\n');

        console.log('Creating test_Conversations (copy of Conversations structure)...');
        await sequelize.query('CREATE TABLE IF NOT EXISTS test_Conversations (LIKE "Conversations" INCLUDING ALL)');
        console.log('✅ Done\n');

        // Now copy data (truncate first to avoid conflicts)
        console.log('📋 Copying data from production to test...\n');

        console.log('Clearing existing test data...');
        await sequelize.query('DELETE FROM test_Conversations');
        await sequelize.query('DELETE FROM test_Sessions');
        await sequelize.query('DELETE FROM test_Agents');
        console.log('✅ Cleared\n');

        await sequelize.query('INSERT INTO test_Agents SELECT * FROM "Agents"');
        console.log('✅ Agents copied\n');

        await sequelize.query('INSERT INTO test_Sessions SELECT * FROM "Sessions"');
        console.log('✅ Sessions copied\n');

        await sequelize.query('INSERT INTO test_Conversations SELECT * FROM "Conversations"');
        console.log('✅ Conversations copied\n');

        // Verify
        const [agentCount] = await sequelize.query('SELECT COUNT(*) FROM test_Agents');
        const [sessionCount] = await sequelize.query('SELECT COUNT(*) FROM test_Sessions');
        const [convCount] = await sequelize.query('SELECT COUNT(*) FROM test_Conversations');

        console.log('✅ TEST ENVIRONMENT READY!\n');
        console.log('📊 Test tables populated:');
        console.log(`   test_Agents: ${agentCount[0].count}`);
        console.log(`   test_Sessions: ${sessionCount[0].count}`);
        console.log(`   test_Conversations: ${convCount[0].count}\n`);

        console.log('🎯 How to use:');
        console.log('   1. Currently using: APP_ENV=production (your data is safe)');
        console.log('   2. When ready to test:');
        console.log('      a. Set APP_ENV=test in both backend/.env and frontend/.env');
        console.log('      b. Restart frontend server');
        console.log('      c. Test safely - production data untouched!');
        console.log('   3. To go back: Set APP_ENV=production and restart\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error);
    } finally {
        await sequelize.close();
    }
}

setupTest();
