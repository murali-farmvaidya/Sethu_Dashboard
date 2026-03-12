import 'dotenv/config';
import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ host: process.env.POSTGRES_HOST, port: process.env.POSTGRES_PORT, database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD, ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false });

async function check() {
    try {
        const u = await pool.query("SELECT * FROM test_agent_telephony_config WHERE agent_id = '20260302092331TNAUIFPRIA'");
        console.log('Result:', JSON.stringify(u.rows[0], null, 2));
        process.exit(0);
    } catch(e) { 
        console.error(e.message); 
        process.exit(1); 
    }
}
check();
