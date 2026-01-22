import 'dotenv/config';
import pg from 'pg';

const { Pool } = pg;
const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

async function check() {
    try {
        console.log("Checking case-sensitive tables...");
        try {
            const a = await pool.query('SELECT COUNT(*) FROM "Agents"');
            console.log("Agents (Capital A):", a.rows[0].count);
        } catch (e) {
            console.log("Agents (Capital A) not found");
        }

        try {
            const s = await pool.query('SELECT COUNT(*) FROM "Sessions"');
            console.log("Sessions (Capital S):", s.rows[0].count);
        } catch (e) {
            console.log("Sessions (Capital S) not found");
        }

        try {
            const c = await pool.query('SELECT COUNT(*) FROM "Conversations"');
            console.log("Conversations (Capital C):", c.rows[0].count);
        } catch (e) {
            console.log("Conversations (Capital C) not found");
        }

        console.log("\nChecking lowercase tables...");
        try {
            const a = await pool.query('SELECT COUNT(*) FROM agents');
            console.log("agents (lowercase):", a.rows[0].count);
        } catch (e) {
            console.log("agents (lowercase) not found");
        }

    } finally {
        await pool.end();
    }
}

check();
