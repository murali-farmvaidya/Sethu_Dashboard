/**
 * Copy production data to test tables - Smart version
 * Handles cases where tables might not exist yet
 */
const path = require('path');
require('dotenv').config();
const { sequelize } = require(path.join(__dirname, '../src/config/database'));

async function smartCopy() {
    console.log('🔄 Smart copy: Production → Test tables\n');

    try {
        await sequelize.authenticate();
        console.log('✅ Database connected\n');

        // Check if tables exist
        const [tables] = await sequelize.query(`
            SELECT tablename FROM pg_tables 
            WHERE schemaname='public' 
            AND tablename IN ('test_Agents', 'test_Sessions', 'test_Conversations')
        `);

        if (tables.length < 3) {
            console.log('❌ Test tables not found. Please run the sync script first to create them.');
            console.log('   Run: npm run sync (with APP_ENV=test)');
            process.exit(1);
        }

        // Get counts
        const [prodAgents] = await sequelize.query('SELECT COUNT(*) as count FROM "Agents"');
        const [testAgents] = await sequelize.query('SELECT COUNT(*) as count FROM test_Agents');

        console.log('📊 Current status:');
        console.log(`   Production Agents: ${prodAgents[0].count}`);
        console.log(`   Test Agents: ${testAgents[0].count}\n`);

        if (prodAgents[0].count == 0) {
            console.log('⚠️  No production data to copy!');
            process.exit(0);
        }

        // Delete existing test data
        console.log('🗑️  Clearing test data...');
        await sequelize.query('DELETE FROM test_Conversations WHERE session_id IN (SELECT session_id FROM test_Sessions)');
        await sequelize.query('DELETE FROM test_Sessions WHERE agent_id IN (SELECT agent_id FROM test_Agents)');
        await sequelize.query('DELETE FROM test_Agents');
        console.log('   ✅ Cleared\n');

        // Copy with ON CONFLICT handling
        console.log('📋 Copying Agents...');
        const [agentResult] = await sequelize.query(`
            INSERT INTO test_Agents 
            SELECT * FROM "Agents"
            ON CONFLICT (agent_id) DO UPDATE SET
                name = EXCLUDED.name,
                session_count = EXCLUDED.session_count,
                last_synced = EXCLUDED.last_synced
        `);
        console.log(`   ✅ Copied ${prodAgents[0].count} agents\n`);

        console.log('📋 Copying Sessions...');
        const [prodSessions] = await sequelize.query('SELECT COUNT(*) as count FROM "Sessions"');
        await sequelize.query(`
            INSERT INTO test_Sessions 
            SELECT * FROM "Sessions"
            ON CONFLICT (session_id) DO UPDATE SET
                status = EXCLUDED.status,
                ended_at = EXCLUDED.ended_at
        `);
        console.log(`   ✅ Copied ${prodSessions[0].count} sessions\n`);

        console.log('📋 Copying Conversations...');
        const [prodConvs] = await sequelize.query('SELECT COUNT(*) as count FROM "Conversations"');
        await sequelize.query(`
            INSERT INTO test_Conversations 
            SELECT * FROM "Conversations"
            ON CONFLICT (session_id) DO UPDATE SET
                turns = EXCLUDED.turns,
                total_turns = EXCLUDED.total_turns
        `);
        console.log(`   ✅ Copied ${prodConvs[0].count} conversations\n`);

        // Final verification
        const [finalAgents] = await sequelize.query('SELECT COUNT(*) as count FROM test_Agents');
        const [finalSessions] = await sequelize.query('SELECT COUNT(*) as count FROM test_Sessions');
        const [finalConvs] = await sequelize.query('SELECT COUNT(*) as count FROM test_Conversations');

        console.log('✅ COPY COMPLETE!\n');
        console.log('📊 Final counts:');
        console.log(`   test_Agents: ${finalAgents[0].count}`);
        console.log(`   test_Sessions: ${finalSessions[0].count}`);
        console.log(`   test_Conversations: ${finalConvs[0].count}\n`);

        console.log('🎯 Next steps:');
        console.log('   1. Make sure APP_ENV=test in both backend/.env and frontend/.env');
        console.log('   2. Restart frontend server (Ctrl+C then npm start)');
        console.log('   3. Restart backend sync if needed');
        console.log('   4. Refresh your dashboard\n');

    } catch (error) {
        console.error('❌ Error:', error.message);
        if (error.code === '42P01') {
            console.error('\n💡 Tables don\'t exist yet. Run sync script first with APP_ENV=test');
        }
        process.exit(1);
    } finally {
        await sequelize.close();
    }
}

smartCopy();
