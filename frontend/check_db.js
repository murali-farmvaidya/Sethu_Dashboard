import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false
});
try {
    const res = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
    const tables = res.rows.map(r => r.table_name);
    console.log('ALL TABLES:', tables);

    for (const t of ['Agents', 'Sessions', 'Conversations', 'agents', 'sessions', 'conversations']) {
        try {
            const check = await pool.query(`SELECT count(*) FROM "${t}"`);
            console.log(`✅ Table "${t}" exists. Count: ${check.rows[0].count}`);
        } catch (e) {
            console.log(`❌ Table "${t}" NOT found or accessible.`);
        }
    }
} catch (err) {
    console.error('ERROR:', err);
} finally {
    await pool.end();
}
