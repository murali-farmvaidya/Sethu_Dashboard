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

async function diagnose() {
    try {
        console.log("Checking database connection...");
        const res = await pool.query('SELECT NOW()');
        console.log("Connected at:", res.rows[0].now);

        console.log("\nChecking tables...");
        const tables = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        console.log("Tables found:", tables.rows.map(r => r.table_name));

        for (const table of ['agents', 'sessions', 'conversations']) {
            console.log(`\nChecking columns for ${table}...`);
            const cols = await pool.query("SELECT column_name, data_type FROM information_schema.columns WHERE table_name = $1", [table]);
            console.log(cols.rows.map(r => `${r.column_name} (${r.data_type})`));

            const count = await pool.query(`SELECT COUNT(*) FROM ${table}`);
            console.log(`Total rows in ${table}:`, count.rows[0].count);

            if (parseInt(count.rows[0].count) > 0) {
                console.log(`Sample from ${table}:`);
                const sample = await pool.query(`SELECT * FROM ${table} LIMIT 1`);
                console.log(sample.rows[0]);
            }
        }

    } catch (err) {
        console.error("Diagnosis failed:", err);
    } finally {
        await pool.end();
    }
}

diagnose();
