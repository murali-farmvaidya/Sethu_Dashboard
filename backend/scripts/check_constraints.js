
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../backend/.env') });
const { Sequelize } = require('sequelize');

const sequelize = new Sequelize(
    process.env.POSTGRES_DB,
    process.env.POSTGRES_USER,
    process.env.POSTGRES_PASSWORD,
    {
        host: process.env.POSTGRES_HOST,
        port: process.env.POSTGRES_PORT || 5432,
        dialect: 'postgres',
        logging: false,
        dialectOptions: process.env.POSTGRES_SSL === 'true' ? {
            ssl: {
                require: true,
                rejectUnauthorized: false
            }
        } : {}
    }
);

async function check() {
    try {
        await sequelize.authenticate();
        console.log('Connected.');
        
        const [results] = await sequelize.query(`
            SELECT
                conname AS constraint_name,
                contype AS constraint_type
            FROM
                pg_catalog.pg_constraint con
                INNER JOIN pg_catalog.pg_class rel ON rel.oid = con.conrelid
                INNER JOIN pg_catalog.pg_namespace nsp ON nsp.oid = rel.relnamespace
            WHERE
                nsp.nspname = 'public'
                AND rel.relname = 'Sessions';
        `);
        
        console.log('Constraints on "Sessions":');
        console.log(JSON.stringify(results, null, 2));
        
        await sequelize.close();
    } catch (err) {
        console.error(err);
    }
}

check();
