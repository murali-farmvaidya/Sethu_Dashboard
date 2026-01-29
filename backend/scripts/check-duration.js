const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const { sequelize } = require(path.join(__dirname, '../src/config/database'));
const { getTableName } = require(path.join(__dirname, '../src/config/tables'));

async function checkDuration() {
    try {
        await sequelize.authenticate();
        console.log('✅ Connected to database');

        const tableName = getTableName('Sessions');

        // Check total sessions
        const totalResult = await sequelize.query(
            `SELECT COUNT(*) as count FROM "${tableName}"`,
            { type: sequelize.QueryTypes.SELECT }
        );
        console.log(`\nTotal Sessions: ${totalResult[0].count}`);

        // Check sessions with duration
        const withDurationResult = await sequelize.query(
            `SELECT COUNT(*) as count FROM "${tableName}" WHERE duration_seconds > 0`,
            { type: sequelize.QueryTypes.SELECT }
        );
        console.log(`Sessions with duration > 0: ${withDurationResult[0].count}`);

        // Check sessions with NULL duration
        const nullDurationResult = await sequelize.query(
            `SELECT COUNT(*) as count FROM "${tableName}" WHERE duration_seconds IS NULL`,
            { type: sequelize.QueryTypes.SELECT }
        );
        console.log(`Sessions with NULL duration: ${nullDurationResult[0].count}`);

        // Check sessions with 0 duration
        const zeroDurationResult = await sequelize.query(
            `SELECT COUNT(*) as count FROM "${tableName}" WHERE duration_seconds = 0`,
            { type: sequelize.QueryTypes.SELECT }
        );
        console.log(`Sessions with 0 duration: ${zeroDurationResult[0].count}`);

        // Check SUM
        const sumResult = await sequelize.query(
            `SELECT SUM(duration_seconds) as total FROM "${tableName}"`,
            { type: sequelize.QueryTypes.SELECT }
        );
        console.log(`\nTotal Duration (SUM): ${sumResult[0].total} seconds`);

        // Sample some sessions
        const sampleResult = await sequelize.query(
            `SELECT session_id, started_at, ended_at, duration_seconds FROM "${tableName}" LIMIT 5`,
            { type: sequelize.QueryTypes.SELECT }
        );
        console.log('\nSample Sessions:');
        sampleResult.forEach(s => {
            console.log(`  ${s.session_id}: started=${s.started_at}, ended=${s.ended_at}, duration=${s.duration_seconds}s`);
        });

        await sequelize.close();
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkDuration();
