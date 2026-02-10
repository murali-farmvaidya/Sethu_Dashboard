const pg = require('pg');
require('dotenv').config();

const pool = new pg.Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

async function main() {
    try {
        // Show current exclusions
        const current = await pool.query('SELECT id, item_type, item_id, reason FROM test_excluded_items ORDER BY id');
        console.log('Current exclusions:');
        current.rows.forEach(row => console.log(`  [${row.id}] ${row.item_type} | ${row.item_id} | ${row.reason}`));

        // Delete orphaned session exclusions (parent agent already restored)
        const result = await pool.query("DELETE FROM test_excluded_items WHERE reason = 'Parent agent deleted' RETURNING id, item_id");
        console.log(`\nDeleted ${result.rowCount} orphaned session exclusions:`);
        result.rows.forEach(row => console.log(`  - ${row.item_id}`));

        // Show remaining
        const remaining = await pool.query('SELECT id, item_type, item_id, reason FROM test_excluded_items ORDER BY id');
        console.log(`\nRemaining exclusions: ${remaining.rowCount}`);
        remaining.rows.forEach(row => console.log(`  [${row.id}] ${row.item_type} | ${row.item_id} | ${row.reason}`));
    } catch (e) {
        console.error('Error:', e.message);
    } finally {
        await pool.end();
    }
}

main();
