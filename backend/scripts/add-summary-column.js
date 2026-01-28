require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    ssl: { rejectUnauthorized: false }
});

async function addSummaryColumn() {
    try {
        await pool.query('ALTER TABLE "Conversations" ADD COLUMN IF NOT EXISTS summary TEXT');
        console.log('✅ Summary column added successfully');
    } catch (error) {
        if (error.message.includes('already exists')) {
            console.log('✅ Summary column already exists');
        } else {
            console.error('Error:', error.message);
        }
    } finally {
        await pool.end();
    }
}

addSummaryColumn();
