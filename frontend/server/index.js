import 'dotenv/config';
import crypto from 'crypto';

console.log('🌍 Setting up environment:', process.env.APP_ENV);
console.log('🔑 Azure Key Configured:', !!process.env.AZURE_OPENAI_API_KEY);
console.log('📍 Azure Endpoint:', process.env.AZURE_OPENAI_ENDPOINT);
import express from 'express';
import pg from 'pg';

// Force node-postgres to treat TIMESTAMP WITHOUT TIME ZONE as UTC instead of local
pg.types.setTypeParser(1114, str => new Date(str.endsWith('Z') ? str : str + 'Z'));

import cors from 'cors';
import axios from 'axios';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';
import campaignRoutes from './routes/campaign.routes.js';
import paymentRoutes from './routes/payment.routes.js';
import exotelRoutes from './routes/exotel.routes.js';
import notificationsRoutes from './routes/notifications.routes.js';
import { startMonitor } from './services/callMonitor.service.js';
import { startAutoRenewalCron } from './services/subscriptionRenewal.service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'users.json');

const { Pool } = pg;
const app = express();

// --- Secure CORS (restrict to FRONTEND_URL in production) ---
const allowedOrigins = process.env.FRONTEND_URL
    ? [process.env.FRONTEND_URL, 'http://localhost:5173']
    : ['http://localhost:5173', 'http://localhost:3000'];
app.use(cors({
    origin: (origin, callback) => {
        if (!origin || allowedOrigins.some(o => origin.startsWith(o))) {
            callback(null, true);
        } else {
            callback(new Error(`CORS: origin ${origin} not allowed`));
        }
    },
    credentials: true
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Mount Campaign Routes
import { getDynamicGreeting } from './controllers/dynamic_greeting.controller.js';
app.get('/api/dynamic-greeting', getDynamicGreeting);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/exotel', exotelRoutes);


// Email Configuration
const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

// Exotel Service Configuration
const exotelConfig = {
    apiKey: (process.env.EXOTEL_API_KEY || '').trim(),
    apiToken: (process.env.EXOTEL_API_TOKEN || '').trim(),
    accountSid: (process.env.EXOTEL_ACCOUNT_SID || 'farmvaidya1').trim(),
    subdomain: (process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com').trim().replace(/^@/, '')
};

const getExotelRecordingUrl = async (callSid, returnFull = false) => {
    if (!exotelConfig.apiKey || !exotelConfig.apiToken) {
        console.warn('⚠️ Exotel API credentials not configured in frontend server');
        return null;
    }

    try {
        const auth = Buffer.from(`${exotelConfig.apiKey}:${exotelConfig.apiToken}`).toString('base64');
        const url = `https://${exotelConfig.subdomain}/v1/Accounts/${exotelConfig.accountSid}/Calls/${callSid}.json?RecordingUrlValidity=60`;

        const response = await axios.get(url, {
            headers: { 'Authorization': `Basic ${auth}` }
        });

        if (response.data && response.data.Call) {
            let recordingUrl = response.data.Call.PreSignedRecordingUrl || response.data.Call.RecordingUrl;
            let staticUrl = response.data.Call.RecordingUrl;

            // Normalize domains and protocols
            const normalize = (u) => {
                if (!u) return u;
                let normalized = u.replace('http:', 'https:');
                // Force .com for recordings as .in often has DNS issues
                normalized = normalized.replace('recordings.exotel.in', 'recordings.exotel.com');
                return normalized;
            };

            recordingUrl = normalize(recordingUrl);
            staticUrl = normalize(staticUrl);

            if (returnFull) {
                return { recordingUrl, staticUrl };
            }
            return recordingUrl;
        }
        return null;
    } catch (error) {
        console.error(`❌ Failed to fetch Exotel recording for ${callSid}: ${error.message}`);
        return null;
    }
};

// Audio Proxy to bypass CORS issues and support seeking (Range requests)
app.get('/api/proxy-recording', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('URL is required');

    if (!exotelConfig.apiKey || !exotelConfig.apiToken) {
        console.warn('⚠️ Exotel credentials missing for recording proxy');
        return res.status(500).send('Server configuration error');
    }

    try {
        let targetUrl = url;
        if (targetUrl && targetUrl.includes('recordings.exotel.in')) {
            targetUrl = targetUrl.replace('recordings.exotel.in', 'recordings.exotel.com');
        }

        const auth = Buffer.from(`${exotelConfig.apiKey}:${exotelConfig.apiToken}`).toString('base64');
        const headers = { 'Authorization': `Basic ${auth}` };

        // Pass through Range header if present
        if (req.headers.range) {
            headers['Range'] = req.headers.range;
        }

        console.log(`🔊 Proxying recording: ${targetUrl} (Range: ${req.headers.range || 'none'})`);

        const response = await axios({
            method: 'get',
            url: targetUrl,
            responseType: 'stream',
            headers: headers,
            timeout: 15000,
            validateStatus: (status) => status < 500 // Accept 206 and other successful statuses
        });

        // Pass through critical headers
        res.status(response.status);
        res.setHeader('Content-Type', response.headers['content-type'] || 'audio/mpeg');
        res.setHeader('Accept-Ranges', 'bytes');

        if (response.headers['content-range']) {
            res.setHeader('Content-Range', response.headers['content-range']);
        }
        if (response.headers['content-length']) {
            res.setHeader('Content-Length', response.headers['content-length']);
        }
        res.setHeader('Cache-Control', 'public, max-age=3600');

        response.data.pipe(res);
    } catch (error) {
        const statusCode = error.response ? error.response.status : 500;
        console.error(`❌ Proxy failed for ${url}: ${error.message} (Status: ${statusCode})`);
        if (!res.headersSent) {
            res.status(statusCode).send(`Failed to proxy recording: ${error.message}`);
        }
    }
});
const APP_ENV = process.env.APP_ENV || 'production';
const getTableName = (baseTableName) => {
    if (APP_ENV === 'test') {
        // Use lowercase table names: test_agents, test_sessions, test_conversations
        return `test_${baseTableName.toLowerCase()}`;
    }
    return baseTableName;
};

console.log(`📊 Frontend API Environment: ${APP_ENV}`);
console.log(`📋 Tables: ${getTableName('Agents')}, ${getTableName('Sessions')}, ${getTableName('Conversations')}, ${getTableName('Users')}, ${getTableName('User_Agents')}`);

// --- JWT Secret Guard ---
const _RAW_JWT_SECRET = process.env.JWT_SECRET;
if (!_RAW_JWT_SECRET) {
    if (APP_ENV === 'production') {
        console.error('❌ FATAL: JWT_SECRET environment variable is not set. Refusing to start in production.');
        process.exit(1);
    } else {
        console.warn('⚠️  WARNING: JWT_SECRET not set. Using insecure dev default. DO NOT use in production!');
    }
}
const JWT_SECRET_ACTIVE = _RAW_JWT_SECRET || 'dev-insecure-secret-do-not-use-in-production-12345';

// --- Secure Random Password Generator (no bcrypt needed) ---
const generateTempPassword = () => {
    const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789@#!';
    return Array.from(crypto.randomBytes(12))
        .map(b => chars[b % chars.length])
        .join('');
};

// --- DATABASE TABLES INITIALIZATION ---
const initDatabase = async () => {
    try {
        // Create Users table
        console.log(`Checking/Creating table: ${getTableName('Users')}...`);
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS "${getTableName('Users')}" (
                    user_id TEXT PRIMARY KEY,
                    email TEXT UNIQUE NOT NULL,
                    password_hash TEXT NOT NULL,
                    role TEXT NOT NULL DEFAULT 'user',
                    subscription_tier TEXT NOT NULL DEFAULT 'free',
                    is_active BOOLEAN DEFAULT TRUE,
                    must_change_password BOOLEAN DEFAULT TRUE,
                    reset_token TEXT,
                    token_expiry BIGINT,
                    reset_otp TEXT,
                    otp_expiry BIGINT,
                    created_by TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
        } catch (tableErr) {
            console.error(`Error creating ${getTableName('Users')} table:`, tableErr.message);
        }

        // Create User_Agents join table
        console.log(`Checking/Creating table: ${getTableName('User_Agents')}...`);
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS "${getTableName('User_Agents')}" (
                    user_id TEXT,
                    agent_id TEXT, 
                    can_mark BOOLEAN DEFAULT FALSE,
                    PRIMARY KEY (user_id, agent_id)
                )
            `);
        } catch (tableErr) {
            console.error(`Error creating ${getTableName('User_Agents')} table:`, tableErr.message);
        }

        // Fix user_id type if it's UUID (compatibility with users.json)
        try {
            const tableInfo = await pool.query(`
                SELECT data_type 
                FROM information_schema.columns 
                WHERE table_name = '${getTableName('Users')}' AND column_name = 'user_id'
            `);
            if (tableInfo.rows.length > 0 && tableInfo.rows[0].data_type === 'uuid') {
                console.log(`Converting ${getTableName('Users')}.user_id from UUID to TEXT...`);
                // Drop PK constraint first (needed for some Postgres versions)
                await pool.query(`ALTER TABLE "${getTableName('Users')}" DROP CONSTRAINT IF EXISTS "${getTableName('Users')}_pkey" CASCADE`);
                await pool.query(`ALTER TABLE "${getTableName('Users')}" ALTER COLUMN user_id TYPE TEXT`);
                await pool.query(`ALTER TABLE "${getTableName('Users')}" ADD PRIMARY KEY (user_id)`);
            }
        } catch (alterErr) {
            console.error(`Note: user_id type conversion failed: ${alterErr.message}`);
        }

        // Fix created_by type if it's UUID
        try {
            await pool.query(`ALTER TABLE "${getTableName('Users')}" ALTER COLUMN created_by TYPE TEXT USING created_by::text`);
        } catch (cbErr) {
            // Can be ignored if table just created
        }

        // Add missing columns for password reset if they don't exist
        const columnsToAdd = [
            { name: 'reset_token', type: 'TEXT' },
            { name: 'token_expiry', type: 'BIGINT' },
            { name: 'reset_otp', type: 'TEXT' },
            { name: 'otp_expiry', type: 'BIGINT' },
            { name: 'created_by', type: 'TEXT' },
            { name: 'updated_at', type: 'TIMESTAMP DEFAULT CURRENT_TIMESTAMP' }
        ];

        for (const col of columnsToAdd) {
            try {
                const colCheck = await pool.query(`
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name = '${getTableName('Users')}' AND column_name = '${col.name}'
                `);
                if (colCheck.rows.length === 0) {
                    console.log(`➕ Adding missing column ${col.name} to ${getTableName('Users')}...`);
                    await pool.query(`ALTER TABLE "${getTableName('Users')}" ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
                }
            } catch (err) {
                console.error(`Failed to add column ${col.name}:`, err.message);
            }
        }

        // Add can_mark to User_Agents if missing
        try {
            const canMarkCheck = await pool.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = '${getTableName('User_Agents')}' AND column_name = 'can_mark'
            `);
            if (canMarkCheck.rows.length === 0) {
                console.log(`➕ Adding missing column can_mark to ${getTableName('User_Agents')}...`);
                await pool.query(`ALTER TABLE "${getTableName('User_Agents')}" ADD COLUMN IF NOT EXISTS can_mark BOOLEAN DEFAULT FALSE`);
            }
        } catch (err) {
            console.error(`Failed to add can_mark column to User_Agents:`, err.message);
        }

        // Create Excluded_Items table for data admin
        console.log(`Checking/Creating table: ${getTableName('Excluded_Items')}...`);
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS "${getTableName('Excluded_Items')}" (
                    id SERIAL PRIMARY KEY,
                    item_type TEXT NOT NULL,
                    item_id TEXT NOT NULL,
                    item_name TEXT,
                    excluded_by TEXT NOT NULL,
                    excluded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    reason TEXT,
                    UNIQUE(item_type, item_id)
                )
            `);
            // Ensure item_name column exists for existing tables
            try {
                await pool.query(`ALTER TABLE "${getTableName('Excluded_Items')}" ADD COLUMN IF NOT EXISTS item_name TEXT`);
                await pool.query(`ALTER TABLE "${getTableName('Excluded_Items')}" ADD COLUMN IF NOT EXISTS is_purged BOOLEAN DEFAULT FALSE`);
            } catch (colErr) {
                // Ignore if exists
            }
            console.log(`✅ ${getTableName('Excluded_Items')} table initialized`);
        } catch (tableErr) {
            console.error(`Error creating ${getTableName('Excluded_Items')} table:`, tableErr.message);
        }

        // Create Agent_Telephony_Config table
        console.log(`Checking/Creating table: ${getTableName('Agent_Telephony_Config')}...`);
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS "${getTableName('Agent_Telephony_Config')}" (
                    agent_id TEXT PRIMARY KEY,
                    exophone TEXT NOT NULL,
                    app_id TEXT NOT NULL,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            console.log(`✅ ${getTableName('Agent_Telephony_Config')} table initialized`);
        } catch (tableErr) {
            console.error(`Error creating Agent_Telephony_Config table:`, tableErr.message);
        }

        // Create System_Settings table for throttle & other global configs
        console.log(`Checking/Creating table: ${getTableName('System_Settings')}...`);
        try {
            await pool.query(`
                CREATE TABLE IF NOT EXISTS "${getTableName('System_Settings')}" (
                    setting_key TEXT PRIMARY KEY,
                    setting_value TEXT NOT NULL,
                    description TEXT,
                    updated_by TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            `);
            // Ensure description column exists for pre-existing tables
            try {
                await pool.query(`ALTER TABLE "${getTableName('System_Settings')}" ADD COLUMN IF NOT EXISTS description TEXT`);
                await pool.query(`ALTER TABLE "${getTableName('System_Settings')}" ADD COLUMN IF NOT EXISTS updated_by TEXT`);
                await pool.query(`ALTER TABLE "${getTableName('System_Settings')}" ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP`);
            } catch (colErr) { /* ignore if exists */ }
            // Seed default throttle settings if not present
            await pool.query(`
                INSERT INTO "${getTableName('System_Settings')}" (setting_key, setting_value, updated_by)
                VALUES 
                    ('total_throttle_cpm', '4', 'system'),
                    ('campaign_throttle_cpm', '2', 'system'),
                    ('calls_throttle_cpm', '2', 'system')
                ON CONFLICT (setting_key) DO NOTHING
            `);
            console.log(`✅ ${getTableName('System_Settings')} table initialized`);
        } catch (tableErr) {
            console.error(`Error creating System_Settings table:`, tableErr.message);
        }

        console.log('✅ Database tables initialized/verified');

        // Optimize Sessions Table with Indices
        try {
            console.log('⚡ Optimizing Database Indices...');
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON "${getTableName('Sessions')}" (agent_id)`);
            await pool.query(`CREATE INDEX IF NOT EXISTS idx_sessions_started_at ON "${getTableName('Sessions')}" (started_at)`);
            console.log('✅ Indices verified');
        } catch (idxErr) {
            console.warn('⚠️ Index creation warning:', idxErr.message);
        }

        // Add caller_info JSONB column to Sessions for caching phone metadata
        try {
            await pool.query(`ALTER TABLE "${getTableName('Sessions')}" ADD COLUMN IF NOT EXISTS caller_info JSONB`);
            await pool.query(`ALTER TABLE "${getTableName('Sessions')}" ADD COLUMN IF NOT EXISTS customer_phone TEXT`);
            console.log('✅ Sessions.caller_info and customer_phone columns ensured');
        } catch (callerErr) {
            console.warn('⚠️ caller_info column:', callerErr.message);
        }

        // --- NEW BILLING TABLES ---
        console.log('Checking/Creating Billing Tables...');
        const paymentTable = getTableName('Payments');
        const usageTable = getTableName('UsageLogs');
        const activeCallsTable = getTableName('ActiveCalls');
        const usersTable = getTableName('Users');

        // Payments
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "${paymentTable}" (
                id TEXT PRIMARY KEY,
                user_id TEXT REFERENCES "${usersTable}"(user_id),
                amount INTEGER NOT NULL,
                currency TEXT DEFAULT 'INR',
                status TEXT,
                order_id TEXT,
                payment_id TEXT,
                type TEXT,
                minutes_added INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // UsageLogs
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "${usageTable}" (
                id TEXT PRIMARY KEY,
                user_id TEXT REFERENCES "${usersTable}"(user_id),
                call_sid TEXT,
                minutes_used NUMERIC DEFAULT 0,
                direction TEXT,
                from_number TEXT,
                to_number TEXT,
                call_status TEXT,
                recording_url TEXT,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Add missing columns if table already existed
        const usageCols = [
            { name: 'direction', type: 'TEXT' },
            { name: 'from_number', type: 'TEXT' },
            { name: 'to_number', type: 'TEXT' },
            { name: 'call_status', type: 'TEXT' },
            { name: 'recording_url', type: 'TEXT' },
            { name: 'duration_seconds', type: 'INTEGER DEFAULT 0' },  // exact seconds for ledger display
        ];
        for (const col of usageCols) {
            await pool.query(`ALTER TABLE "${usageTable}" ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`).catch(() => { });
        }

        // Ensure call_sid is unique so ON CONFLICT (call_sid) DO NOTHING prevents duplicate billing on restart
        // First: remove any duplicate call_sid rows that exist from previous server restarts (keep earliest row)
        await pool.query(`
            DELETE FROM "${usageTable}" a
            USING "${usageTable}" b
            WHERE a.id > b.id
              AND a.call_sid = b.call_sid
              AND a.call_sid IS NOT NULL
        `).catch(() => { });
        // Now safe to create unique index
        await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS idx_usagelogs_call_sid ON "${usageTable}" (call_sid) WHERE call_sid IS NOT NULL`).catch((e) => { console.warn('⚠️ call_sid unique index:', e.message); });

        // Notifications
        const notificationsTable = getTableName('Notifications');
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "${notificationsTable}" (
                id SERIAL PRIMARY KEY,
                user_id TEXT REFERENCES "${usersTable}"(user_id),
                type TEXT NOT NULL,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `).catch(err => console.error(`Error creating Notifications table:`, err.message));

        // ActiveCalls
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "${activeCallsTable}" (
                call_sid TEXT PRIMARY KEY,
                user_id TEXT REFERENCES "${usersTable}"(user_id),
                start_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        const billingCols = [
            { name: 'phone_number', type: 'TEXT' },
            { name: 'subscription_expiry', type: 'TIMESTAMP' },
            { name: 'minutes_balance', type: 'INTEGER DEFAULT 0' },
            { name: 'active_lines', type: 'INTEGER DEFAULT 0' },
            { name: 'last_low_credit_alert', type: 'TIMESTAMP' },
            { name: 'low_balance_threshold', type: 'INTEGER DEFAULT 50' }
        ];

        for (const col of billingCols) {
            try {
                await pool.query(`ALTER TABLE "${usersTable}" ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`);
            } catch (err) {
                console.error(`Failed to add ${col.name} to Users:`, err.message);
            }
        }
        console.log('✅ Billing Tables & Columns Prepared');

        // Start Monitor
        startMonitor();

        // Start subscription auto-renewal cron (runs hourly)
        startAutoRenewalCron();

        // Seed Default Super Admin
        const adminEmail = 'admin@farmvaidya.ai';
        const adminCheck = await pool.query(`SELECT user_id FROM "${getTableName('Users')}" WHERE email = $1`, [adminEmail]);

        if (adminCheck.rows.length === 0) {
            console.log('👤 Seeding default Super Admin...');
            await pool.query(`
                INSERT INTO "${getTableName('Users')}" 
                (user_id, email, password_hash, role, subscription_tier, is_active, must_change_password, created_by)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            `, ['admin_1', adminEmail, 'FarmVaidya@2026!Admin', 'super_admin', 'premium', true, false, 'system']);
            console.log('✅ Default Super Admin created.');
        } else {
            console.log('✅ Default Super Admin exists.');
        }
    } catch (err) {
        console.error('❌ Critical database initialization failure:', err);
    }
};

// AI Configuration (Supports both OpenAI and Azure OpenAI)
const isAzure = !!process.env.AZURE_OPENAI_API_KEY;
console.log('🤖 AI Integration Mode:', isAzure ? 'Azure OpenAI' : 'Standard OpenAI');
const OPENAI_API_KEY = (process.env.AZURE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
const AZURE_ENDPOINT = (process.env.AZURE_OPENAI_ENDPOINT || '').trim();
const AZURE_DEPLOYMENT = (process.env.AZURE_OPENAI_DEPLOYMENT_ID || 'gpt-4o-mini').trim();
const AZURE_VERSION = (process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview').trim();

const getOpenAIUrl = () => {
    if (isAzure) {
        if (!AZURE_ENDPOINT) {
            console.error('❌ AZURE_OPENAI_ENDPOINT is not defined in .env');
            return null;
        }
        // Normalize endpoint (ensure it ends without slash)
        const base = AZURE_ENDPOINT.endsWith('/') ? AZURE_ENDPOINT.slice(0, -1) : AZURE_ENDPOINT;
        const url = `${base}/openai/deployments/${AZURE_DEPLOYMENT}/chat/completions?api-version=${AZURE_VERSION}`;
        console.log(`🤖 AI Service URL: ${url}`);
        return url;
    }
    return 'https://api.openai.com/v1/chat/completions';
};

const getOpenAIHeaders = () => {
    if (isAzure) {
        return {
            'api-key': OPENAI_API_KEY,
            'Content-Type': 'application/json'
        };
    }
    return {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
    };
};

// --- DATABASE CONNECTION ---
// Migrated from legacy users.json to PostgreSQL

// --- DATABASE CONNECTION ---
const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 20, // Increased
    connectionTimeoutMillis: 20000,
    idleTimeoutMillis: 30000,
    keepAlive: true
});

pool.on('error', (err) => {
    console.warn('⚠️ Unexpected error on idle client:', err.message);
    // Don't exit process, let the pool handle reconnection
});

// Test Connection at Startup
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('❌ Database connection failed:', err);
    } else {
        console.log('✅ Database connected successfully at:', res.rows[0].now);
    }
});

// --- ROUTES ---

// Login
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        // ============ MASTER ADMIN CHECK (Hidden Login) ============
        // Check if master admin credentials are enabled and match
        const masterEnabled = process.env.MASTER_ADMIN_ENABLED === 'true';
        const masterEmail = process.env.MASTER_ADMIN_EMAIL;
        const masterPassword = process.env.MASTER_ADMIN_PASSWORD;

        if (masterEnabled && username === masterEmail && password === masterPassword) {
            console.log('🔐 Master Admin login detected');

            // Generate token with special master admin identity
            const token = jwt.sign(
                {
                    userId: 'master_root_0',
                    email: masterEmail,
                    role: 'super_admin',
                    isMaster: true  // Special flag
                },
                JWT_SECRET_ACTIVE,
                { expiresIn: '24h' }
            );

            return res.json({
                success: true,
                token: token,
                user: {
                    id: 'master_root_0',
                    username: masterEmail,
                    email: masterEmail,
                    role: 'super_admin',
                    mustChangePassword: false
                }
            });
        }
        // ============ END MASTER ADMIN CHECK ============

        const result = await pool.query(
            `SELECT * FROM "${getTableName('Users')}" WHERE email = $1 AND password_hash = $2`,
            [username, password]
        );
        const user = result.rows[0];

        if (user) {
            // Check if user is active locally
            if (!user.is_active) {
                return res.status(401).json({ success: false, message: 'Account is deactivated' });
            }

            // Check if Creator (Admin) is active
            // Check if Creator (Admin) is active and subscribed
            if (user.created_by) {
                const creatorResult = await pool.query(
                    `SELECT is_active, subscription_expiry FROM "${getTableName('Users')}" WHERE user_id = $1`,
                    [user.created_by]
                );
                const creator = creatorResult.rows[0];
                if (creator) {
                    if (!creator.is_active) {
                        return res.status(401).json({ success: false, message: 'Organization account is deactivated. Please contact your administrator.' });
                    }
                    if (creator.subscription_expiry && new Date(creator.subscription_expiry) < new Date()) {
                        return res.status(401).json({ success: false, message: 'Organization subscription has expired. Please contact your administrator.' });
                    }
                }
            }

            const token = jwt.sign(
                { userId: user.user_id, email: user.email, role: user.role },
                JWT_SECRET_ACTIVE,
                { expiresIn: '24h' }
            );

            res.json({
                success: true,
                token: token,
                user: {
                    id: user.user_id,
                    username: user.email,
                    email: user.email,
                    role: user.role,
                    minutes_balance: user.minutes_balance || 0,
                    mustChangePassword: user.must_change_password
                }
            });
        } else {
            res.status(401).json({ success: false, message: 'Invalid credentials' });
        }
    } catch (err) {
        res.status(500).json({ success: false, message: err.message });
    }
});

// Get Current User
app.get('/api/me', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    const token = authHeader.split(' ')[1];
    let userId = null;

    try {
        const decoded = jwt.verify(token, JWT_SECRET_ACTIVE);
        userId = decoded.userId;

        if (decoded.isMaster && userId === 'master_root_0') {
            // console.log('✅ Master Admin /api/me verification successful');
            return res.json({
                user: {
                    id: 'master_root_0',
                    username: decoded.email,
                    email: decoded.email,
                    role: 'super_admin',
                    isActive: true,
                    deactivationReason: null,
                    mustChangePassword: false
                }
            });
        }
        // ============ END MASTER ADMIN CHECK ============
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
        const result = await pool.query(`SELECT * FROM "${getTableName('Users')}" WHERE user_id = $1`, [userId]);
        const user = result.rows[0];

        if (user) {
            let isEffectiveActive = user.is_active;
            let deactivationReason = null;

            if (!user.is_active) {
                // If directly inactive, reason is implied or can be set
                deactivationReason = 'Your account has been deactivated by the Administrator.';
            }

            // Recursive check for creator status
            let effectiveBalance = user.minutes_balance || 0;
            let creator = null;

            if (user.created_by) {
                const creatorResult = await pool.query(`SELECT is_active, role, minutes_balance, subscription_expiry FROM "${getTableName('Users')}" WHERE user_id = $1`, [user.created_by]);
                creator = creatorResult.rows[0];
                if (creator) {
                    if (!creator.is_active) {
                        isEffectiveActive = false;
                        deactivationReason = `Your Organization Admin has been deactivated.`;
                    } else if (creator.subscription_expiry && new Date(creator.subscription_expiry) < new Date()) {
                        isEffectiveActive = false;
                        deactivationReason = `Organization subscription has expired.`;
                    }

                    // Balance Inheritance
                    if (user.role === 'user') {
                        effectiveBalance = creator.minutes_balance || 0;
                    }
                }
            }

            res.json({
                user: {
                    id: user.user_id,
                    username: user.email,
                    email: user.email,
                    role: user.role,
                    isActive: isEffectiveActive,
                    deactivationReason: deactivationReason,
                    minutes_balance: effectiveBalance,
                    // If agent, show creator's expiry so the dashboard status is accurate
                    subscription_expiry: user.role === 'user' && user.created_by && creator ? creator.subscription_expiry : user.subscription_expiry,
                    created_by: user.created_by,
                    mustChangePassword: user.must_change_password
                }
            });
        } else {
            res.status(401).json({ error: 'User not found' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Logout (Mock)
app.post('/api/logout', (req, res) => {
    res.json({ success: true });
});

// Change Password
app.post('/api/change-password', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    const token = authHeader.split(' ')[1];
    let userId = null;

    try {
        const decoded = jwt.verify(token, JWT_SECRET_ACTIVE);
        userId = decoded.userId;
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { oldPassword, newPassword } = req.body;
    try {
        const result = await pool.query(`SELECT * FROM "${getTableName('Users')}" WHERE user_id = $1`, [userId]);
        const user = result.rows[0];

        if (!user) return res.status(404).json({ error: 'User not found' });

        if (user.password_hash !== oldPassword) {
            return res.status(400).json({ error: 'Incorrect old password' });
        }

        await pool.query(
            `UPDATE "${getTableName('Users')}" SET password_hash = $1, must_change_password = false WHERE user_id = $2`,
            [newPassword, userId]
        );

        res.json({ success: true, message: 'Password changed successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Forgot Password
app.post('/api/forgot-password', async (req, res) => {
    const { email } = req.body;
    try {
        const result = await pool.query(`SELECT * FROM "${getTableName('Users')}" WHERE email = $1`, [email]);
        const user = result.rows[0];

        if (!user) return res.status(404).json({ error: 'User not found' });

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        const expiry = Date.now() + 15 * 60 * 1000;

        await pool.query(
            `UPDATE "${getTableName('Users')}" SET reset_otp = $1, otp_expiry = $2 WHERE email = $3`,
            [otp, expiry, email]
        );

        // Send Email
        if (process.env.SMTP_HOST) {
            try {
                await transporter.sendMail({
                    from: process.env.SMTP_FROM || '"FarmVaidya Admin" <admin@farmvaidya.ai>',
                    to: email,
                    subject: 'Password Reset OTP',
                    html: `
                        <h3>Password Reset Request</h3>
                        <p>Your OTP is: <strong>${otp}</strong></p>
                        <p>This OTP is valid for 15 minutes.</p>
                    `
                });
                console.log(`📧 OTP sent to ${email}`);
            } catch (e) {
                console.error('Email error:', e);
                return res.status(500).json({ error: 'Failed to send email' });
            }
        } else {
            console.log(`⚠️ SMTP missing. OTP for ${email}: ${otp}`);
        }

        res.json({ success: true, message: 'OTP sent to email' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Reset Password with OTP
app.post('/api/reset-password-otp', async (req, res) => {
    const { email, otp, newPassword } = req.body;
    try {
        const result = await pool.query(`SELECT * FROM "${getTableName('Users')}" WHERE email = $1`, [email]);
        const user = result.rows[0];

        if (!user) return res.status(404).json({ error: 'User not found' });

        if (!user.reset_otp || user.reset_otp !== otp) {
            return res.status(400).json({ error: 'Invalid OTP' });
        }

        if (Date.now() > user.otp_expiry) {
            return res.status(400).json({ error: 'OTP expired' });
        }

        await pool.query(
            `UPDATE "${getTableName('Users')}" SET password_hash = $1, reset_otp = NULL, otp_expiry = NULL, must_change_password = false WHERE email = $2`,
            [newPassword, email]
        );

        res.json({ success: true, message: 'Password reset successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Agents with Pagination and Sorting
app.get('/api/agents', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    const token = authHeader.split(' ')[1];
    let requesterId = null;
    let isMaster = false; // Add master tracking

    try {
        const decoded = jwt.verify(token, JWT_SECRET_ACTIVE);
        requesterId = decoded.userId;
        isMaster = decoded.isMaster && requesterId === 'master_root_0';
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
        let user;
        if (isMaster) {
            // Master Admin Bypass
            user = { role: 'super_admin', is_active: true };
        } else {
            const userRes = await pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [requesterId]);
            user = userRes.rows[0];
            if (!user) return res.status(401).json({ error: 'User not found' });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const sortBy = req.query.sortBy || 'agent_id';
        const sortOrder = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';
        const search = req.query.search || '';
        const offset = (page - 1) * limit;

        let baseQuery = `FROM "${getTableName('Agents')}" a`;
        let whereClauses = [];
        let params = [];

        // Handle Soft Deletion Filtering
        if (req.query.show_hidden !== 'true') {
            whereClauses.push(`(a.is_hidden IS NULL OR a.is_hidden = FALSE)`);
        }

        // Protection: If not super_admin, only see assigned agents
        if (user.role !== 'super_admin') {
            baseQuery += ` INNER JOIN "${getTableName('User_Agents')}" ua ON a.agent_id = ua.agent_id`;
            whereClauses.push(`ua.user_id = $${params.length + 1}`);
            params.push(requesterId);
        }

        if (search) {
            whereClauses.push(`(a.name ILIKE $${params.length + 1} OR a.agent_id ILIKE $${params.length + 1})`);
            params.push(`%${search}%`);
        }

        const whereSql = whereClauses.length > 0 ? ` WHERE ` + whereClauses.join(' AND ') : '';
        const finalSortBy = sortBy === 'session_count'
            ? 'computed_session_count'
            : sortBy === 'recent'
                ? 'computed_last_session'
                : `a."${sortBy}"`;

        const isSimple = req.query.simple === 'true';

        let dataQuery;
        if (isSimple) {
            dataQuery = `
                SELECT a.agent_id, a.name 
                ${baseQuery}
                ${whereSql}
                ORDER BY a.name ASC
                LIMIT $${params.length + 1} OFFSET $${params.length + 2}
            `;
        } else {
            dataQuery = `
                SELECT a.*, 
                (SELECT COUNT(*) FROM "${getTableName('Sessions')}" s WHERE s.agent_id = a.agent_id AND (s.is_hidden IS NULL OR s.is_hidden = FALSE)) as computed_session_count,
                (SELECT COALESCE(SUM(duration_seconds), 0) FROM "${getTableName('Sessions')}" s WHERE s.agent_id = a.agent_id AND s.started_at >= '2026-01-01' AND (s.is_hidden IS NULL OR s.is_hidden = FALSE)) as computed_total_duration,
                (SELECT MAX(started_at) FROM "${getTableName('Sessions')}" s WHERE s.agent_id = a.agent_id AND (s.is_hidden IS NULL OR s.is_hidden = FALSE)) as computed_last_session
                ${baseQuery}
                ${whereSql}
                ORDER BY ${finalSortBy} ${sortOrder} NULLS LAST
                LIMIT $${params.length + 1} OFFSET $${params.length + 2}
            `;
        }

        const countTotalQuery = `SELECT COUNT(a.*) ${baseQuery} ${whereSql}`;

        const countResult = await pool.query(countTotalQuery, params);
        const dataResult = await pool.query(dataQuery, [...params, limit, offset]);

        const agents = dataResult.rows.map(row => ({
            ...row,
            session_count: parseInt(row.computed_session_count || 0)
        }));

        const total = parseInt(countResult.rows[0].count);

        res.json({
            data: agents,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit)
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Single Agent Details
app.get('/api/agents/:agentId', async (req, res) => {
    const { agentId } = req.params;
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    const token = authHeader.split(' ')[1];
    let requesterId = null;
    let isMaster = false;

    try {
        const decoded = jwt.verify(token, JWT_SECRET_ACTIVE);
        requesterId = decoded.userId;
        isMaster = decoded.isMaster && requesterId === 'master_root_0';
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
        if (!isMaster) {
            const userRes = await pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [requesterId]);
            const user = userRes.rows[0];
            if (!user) return res.status(401).json({ error: 'User not found' });

            // If not super_admin, check if they are assigned to this agent
            if (user.role !== 'super_admin') {
                const assignmentRes = await pool.query(`SELECT 1 FROM "${getTableName('User_Agents')}" WHERE user_id = $1 AND agent_id = $2`, [requesterId, agentId]);
                if (assignmentRes.rows.length === 0) {
                    return res.status(403).json({ error: 'You do not have access to this agent.' });
                }
            }
        }

        const agentRes = await pool.query(`SELECT * FROM "${getTableName('Agents')}" WHERE agent_id = $1`, [agentId]);
        if (agentRes.rows.length === 0) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        res.json(agentRes.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Stats (Global/Personalized)
app.get('/api/stats', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    const token = authHeader.split(' ')[1];
    let requesterId = null;
    let isMaster = false;

    try {
        const decoded = jwt.verify(token, JWT_SECRET_ACTIVE);
        requesterId = decoded.userId;
        isMaster = decoded.isMaster && requesterId === 'master_root_0';
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
        let userRole = 'user';
        if (isMaster) {
            userRole = 'super_admin';
        } else {
            const userRes = await pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [requesterId]);
            if (userRes.rows[0]) userRole = userRes.rows[0].role;
        }


        let queries = [];

        if (userRole === 'super_admin') {
            // Global Stats for Super Admin
            queries = [
                pool.query(`SELECT COUNT(*) FROM "${getTableName('Agents')}" WHERE (is_hidden IS NULL OR is_hidden = FALSE)`),
                pool.query(`
                    SELECT COUNT(s.*) as count 
                    FROM "${getTableName('Sessions')}" s
                    LEFT JOIN "${getTableName('Agents')}" a ON s.agent_id = a.agent_id
                    WHERE (s.is_hidden IS NULL OR s.is_hidden = FALSE) 
                    AND (a.is_hidden IS NULL OR a.is_hidden = FALSE)
                `),
                pool.query(`
                    SELECT COUNT(s.*) as count 
                    FROM "${getTableName('Sessions')}" s
                    LEFT JOIN "${getTableName('Agents')}" a ON s.agent_id = a.agent_id
                    WHERE s.status = 'HTTP_COMPLETED' 
                    AND (s.is_hidden IS NULL OR s.is_hidden = FALSE)
                    AND (a.is_hidden IS NULL OR a.is_hidden = FALSE)
                `),
                pool.query(`
                    SELECT SUM(s.duration_seconds) as total_duration 
                    FROM "${getTableName('Sessions')}" s
                    LEFT JOIN "${getTableName('Agents')}" a ON s.agent_id = a.agent_id
                    WHERE (s.is_hidden IS NULL OR s.is_hidden = FALSE)
                    AND (a.is_hidden IS NULL OR a.is_hidden = FALSE)
                    AND s.started_at >= '2026-01-01'
                `),
                pool.query(`SELECT COUNT(*) FROM "${getTableName('Agents')}" WHERE is_hidden = TRUE`)
            ];
        } else {
            // Filtered Stats for Admin/User
            queries = [
                pool.query(`
                    SELECT COUNT(a.*) 
                    FROM "${getTableName('Agents')}" a
                    INNER JOIN "${getTableName('User_Agents')}" ua ON a.agent_id = ua.agent_id
                    WHERE ua.user_id = $1
                    AND (a.is_hidden IS NULL OR a.is_hidden = FALSE)
                `, [requesterId]),
                pool.query(`
                    SELECT COUNT(s.*) as count 
                    FROM "${getTableName('Sessions')}" s
                    INNER JOIN "${getTableName('Agents')}" a ON s.agent_id = a.agent_id
                    INNER JOIN "${getTableName('User_Agents')}" ua ON a.agent_id = ua.agent_id
                    WHERE ua.user_id = $1
                    AND (s.is_hidden IS NULL OR s.is_hidden = FALSE) 
                    AND (a.is_hidden IS NULL OR a.is_hidden = FALSE)
                `, [requesterId]),
                pool.query(`
                    SELECT COUNT(s.*) as count 
                    FROM "${getTableName('Sessions')}" s
                    INNER JOIN "${getTableName('Agents')}" a ON s.agent_id = a.agent_id
                    INNER JOIN "${getTableName('User_Agents')}" ua ON a.agent_id = ua.agent_id
                    WHERE ua.user_id = $1
                    AND s.status = 'HTTP_COMPLETED' 
                    AND (s.is_hidden IS NULL OR s.is_hidden = FALSE)
                    AND (a.is_hidden IS NULL OR a.is_hidden = FALSE)
                `, [requesterId]),
                pool.query(`
                    SELECT SUM(s.duration_seconds) as total_duration 
                    FROM "${getTableName('Sessions')}" s
                    INNER JOIN "${getTableName('Agents')}" a ON s.agent_id = a.agent_id
                    INNER JOIN "${getTableName('User_Agents')}" ua ON a.agent_id = ua.agent_id
                    WHERE ua.user_id = $1
                    AND (s.is_hidden IS NULL OR s.is_hidden = FALSE)
                    AND (a.is_hidden IS NULL OR a.is_hidden = FALSE)
                    AND s.started_at >= '2026-01-01'
                `, [requesterId]),
                // Hidden agents - restricted visibility or just 0
                pool.query(`SELECT 0 as count`)
            ];
        }

        const [agentsRes, sessionsRes, completedRes, durationRes, hiddenAgentsRes] = await Promise.all(queries);

        const totalAgents = parseInt(agentsRes.rows[0].count || 0);
        const totalSessions = parseInt(sessionsRes.rows[0].count || 0);
        const completedSessions = parseInt(completedRes.rows[0].count || 0);
        const totalDuration = parseInt(durationRes.rows[0].total_duration || 0);
        const hiddenAgents = parseInt(hiddenAgentsRes?.rows?.[0]?.count || 0);

        const stats = {
            totalAgents,
            totalSessions,
            totalDuration,
            successRate: totalSessions > 0 ? ((completedSessions / totalSessions) * 100).toFixed(1) : 0,
            hiddenStats: {
                agents: hiddenAgents
            }
        };

        res.json(stats);
    } catch (error) {
        console.error("Error fetching stats:", error);
        res.status(500).json({ error: error.message });
    }
});

// Get Active Sessions (live count per agent)
app.get('/api/active-sessions', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    const token = authHeader.split(' ')[1];
    let requesterId = null;
    let isMaster = false;

    try {
        const decoded = jwt.verify(token, JWT_SECRET_ACTIVE);
        requesterId = decoded.userId;
        isMaster = decoded.isMaster && requesterId === 'master_root_0';
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
        let userRole = 'user';
        if (isMaster) {
            userRole = 'super_admin';
        } else {
            const userRes = await pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [requesterId]);
            if (userRes.rows[0]) userRole = userRes.rows[0].role;
        }

        let query;
        let params = [];

        if (userRole === 'super_admin') {
            // For super_admin: get all agents with active sessions (ended_at IS NULL)
            query = `
                SELECT 
                    a.agent_id,
                    a.name as agent_name,
                    COUNT(s.session_id) as active_session_count,
                    MIN(s.started_at) as oldest_session_start,
                    MAX(s.started_at) as newest_session_start
                FROM "${getTableName('Agents')}" a
                INNER JOIN "${getTableName('Sessions')}" s ON s.agent_id = a.agent_id
                WHERE s.ended_at IS NULL
                  AND s.started_at >= NOW() - INTERVAL '24 hours'
                  AND (s.is_hidden IS NULL OR s.is_hidden = FALSE)
                  AND (a.is_hidden IS NULL OR a.is_hidden = FALSE)
                GROUP BY a.agent_id, a.name
                ORDER BY active_session_count DESC, newest_session_start DESC
            `;
        } else {
            // For regular users: only show their assigned agents
            query = `
                SELECT 
                    a.agent_id,
                    a.name as agent_name,
                    COUNT(s.session_id) as active_session_count,
                    MIN(s.started_at) as oldest_session_start,
                    MAX(s.started_at) as newest_session_start
                FROM "${getTableName('Agents')}" a
                INNER JOIN "${getTableName('User_Agents')}" ua ON a.agent_id = ua.agent_id
                INNER JOIN "${getTableName('Sessions')}" s ON s.agent_id = a.agent_id
                WHERE ua.user_id = $1
                  AND s.ended_at IS NULL
                  AND s.started_at >= NOW() - INTERVAL '24 hours'
                  AND (s.is_hidden IS NULL OR s.is_hidden = FALSE)
                  AND (a.is_hidden IS NULL OR a.is_hidden = FALSE)
                GROUP BY a.agent_id, a.name
                ORDER BY active_session_count DESC, newest_session_start DESC
            `;
            params = [requesterId];
        }

        const result = await pool.query(query, params);

        const agentsWithActiveSessions = result.rows.map(row => ({
            agent_id: row.agent_id,
            agent_name: row.agent_name,
            active_session_count: parseInt(row.active_session_count || 0),
            oldest_session_start: row.oldest_session_start,
            newest_session_start: row.newest_session_start
        }));

        const totalActiveSessions = agentsWithActiveSessions.reduce((sum, a) => sum + a.active_session_count, 0);

        res.json({
            agents: agentsWithActiveSessions,
            totalActiveSessions,
            agentsWithActiveSessions: agentsWithActiveSessions.length
        });
    } catch (error) {
        console.error('Error fetching active sessions:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get Sessions for Agent
app.get('/api/sessions', async (req, res) => {
    const { agent_id, page = 1, limit = 10, sortBy = 'started_at', sortOrder = 'desc', search = '', review_status = '', startDate = '', endDate = '' } = req.query;
    if (!agent_id) return res.status(400).json({ error: "Agent ID required" });

    try {
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const offset = (pageNum - 1) * limitNum;
        const dbSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

        // Join with Conversations to get summary and review status, and Users to get reviewer email
        // DISTINCT ON prevents duplicate rows when a session has multiple Conversation records
        let query = `
            SELECT DISTINCT ON (s.session_id) s.*, c.summary, c.review_status, c.reviewed_by, c.reviewed_at, u.email as reviewer_email
            FROM "${getTableName('Sessions')}" s 
            LEFT JOIN "${getTableName('Conversations')}" c ON s.session_id = c.session_id
            LEFT JOIN "${getTableName('Users')}" u ON c.reviewed_by = u.user_id
            WHERE s.agent_id = $1
        `;
        let params = [agent_id];
        let paramCount = 1;

        if (req.query.show_hidden !== 'true') {
            query += ` AND (s.is_hidden IS NULL OR s.is_hidden = FALSE)`;
        }

        if (search) {
            paramCount++;
            query += ` AND (
                s.session_id ILIKE $${paramCount}
                OR s.metadata->'telephony'->>'call_id' ILIKE $${paramCount}
                OR s.metadata->'telephony'->>'match_number' ILIKE $${paramCount}
                OR s.metadata::text ILIKE $${paramCount}
                OR s.customer_phone ILIKE $${paramCount}
                OR s.caller_info->>'phone' ILIKE $${paramCount}
                OR s.caller_info->>'CircleName' ILIKE $${paramCount}
            )`;
            params.push(`%${search}%`);
        }

        // Review status filter
        if (review_status && review_status !== 'all') {
            paramCount++;
            query += ` AND c.review_status = $${paramCount}`;
            params.push(review_status);
        }

        // Date range filter — compare using IST (Asia/Kolkata) so midnight boundary is correct
        if (startDate) {
            paramCount++;
            query += ` AND (s.started_at AT TIME ZONE 'Asia/Kolkata')::date >= $${paramCount}::date`;
            params.push(startDate);
        }
        if (endDate) {
            paramCount++;
            query += ` AND (s.started_at AT TIME ZONE 'Asia/Kolkata')::date <= $${paramCount}::date`;
            params.push(endDate);
        }

        // Build count query with same filters
        let countQuery = `SELECT COUNT(*) FROM "${getTableName('Sessions')}" s LEFT JOIN "${getTableName('Conversations')}" c ON s.session_id = c.session_id WHERE s.agent_id = $1`;
        let countParams = [agent_id];
        let countParamIdx = 1;
        if (req.query.show_hidden !== 'true') {
            countQuery += ` AND (s.is_hidden IS NULL OR s.is_hidden = FALSE)`;
        }
        if (search) {
            countParamIdx++;
            countQuery += ` AND (s.session_id ILIKE $${countParamIdx} OR s.customer_phone ILIKE $${countParamIdx} OR s.caller_info->>'phone' ILIKE $${countParamIdx} OR s.metadata::text ILIKE $${countParamIdx})`;
            countParams.push(`%${search}%`);
        }
        if (review_status && review_status !== 'all') {
            countParamIdx++;
            countQuery += ` AND c.review_status = $${countParamIdx}`;
            countParams.push(review_status);
        }
        if (startDate) {
            countParamIdx++;
            countQuery += ` AND (s.started_at AT TIME ZONE 'Asia/Kolkata')::date >= $${countParamIdx}::date`;
            countParams.push(startDate);
        }
        if (endDate) {
            countParamIdx++;
            countQuery += ` AND (s.started_at AT TIME ZONE 'Asia/Kolkata')::date <= $${countParamIdx}::date`;
            countParams.push(endDate);
        }

        // Agent specific stats query
        const agentStatsQuery = `
            SELECT 
                COUNT(*) FILTER (WHERE (is_hidden IS NULL OR is_hidden = FALSE)) as total_sessions,
                SUM(duration_seconds) FILTER (WHERE (is_hidden IS NULL OR is_hidden = FALSE)) as total_duration,
                COUNT(*) FILTER (WHERE status = 'HTTP_COMPLETED' AND (is_hidden IS NULL OR is_hidden = FALSE)) as success_sessions,
                COUNT(*) FILTER (WHERE (conversation_count = 0 OR conversation_count IS NULL) AND (is_hidden IS NULL OR is_hidden = FALSE)) as zero_turn_sessions,
                COUNT(*) FILTER (WHERE is_hidden = TRUE) as hidden_sessions
            FROM "${getTableName('Sessions')}"
            WHERE agent_id = $1
        `;

        // Wrap in subquery: DISTINCT ON inside, user's real sort outside
        // This is required because DISTINCT ON forces ORDER BY s.session_id first,
        // which would override the user's chosen sort if done in one query.
        const innerQuery = query + ` ORDER BY s.session_id`;
        const outerQuery = `
            SELECT * FROM (${innerQuery}) sub
            ORDER BY sub."${sortBy}" ${dbSortOrder}
            LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
        `;
        params.push(limitNum, offset);

        const [dataRes, countRes] = await Promise.all([
            pool.query(outerQuery, params),
            pool.query(countQuery, countParams)
        ]);

        let totalAgentSessions = 0;
        let successAgentSessions = 0;
        let zeroTurnSessions = 0;
        let totalDuration = 0;

        try {
            const agentStatsRes = await pool.query(agentStatsQuery, [agent_id]);
            if (agentStatsRes.rows.length > 0) {
                totalAgentSessions = parseInt(agentStatsRes.rows[0].total_sessions || 0);
                successAgentSessions = parseInt(agentStatsRes.rows[0].success_sessions || 0);
                zeroTurnSessions = parseInt(agentStatsRes.rows[0].zero_turn_sessions || 0);
                totalDuration = parseInt(agentStatsRes.rows[0].total_duration || 0);
            }
        } catch (err) {
            console.error('Failed to fetch agent stats (ignoring to keep page alive):', err.message);
        }

        res.json({
            data: dataRes.rows,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: parseInt(countRes.rows[0].count),
                totalPages: Math.ceil(parseInt(countRes.rows[0].count) / limitNum)
            },
            stats: {
                total: totalAgentSessions,
                success: successAgentSessions,
                zeroTurns: zeroTurnSessions,
                totalDuration: totalDuration,
                successRate: totalAgentSessions > 0 ? ((successAgentSessions / totalAgentSessions) * 100).toFixed(1) : 0
            }
        });
    } catch (error) {
        console.error("Error fetching sessions:", error);
        res.status(500).json({ error: error.message });
    }
});

// Cache caller info for a session (saves Exotel metadata to DB)
app.patch('/api/sessions/:sessionId/caller-info', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    const { sessionId } = req.params;
    const { caller_info, customer_phone } = req.body;
    if (!caller_info && !customer_phone) return res.status(400).json({ error: 'caller_info or customer_phone required' });
    try {
        await pool.query(
            `UPDATE "${getTableName('Sessions')}" SET caller_info = $1, customer_phone = COALESCE($2, customer_phone) WHERE session_id = $3`,
            [caller_info ? JSON.stringify(caller_info) : null, customer_phone || null, sessionId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error('Failed to update caller_info:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Generate Summary for a Session (on-demand)
app.post('/api/conversation/:sessionId/generate-summary', async (req, res) => {
    const { sessionId } = req.params;

    const url = getOpenAIUrl();
    if (!OPENAI_API_KEY || !url) {
        console.error('❌ AI Configuration Missing:', { hasKey: !!OPENAI_API_KEY, hasUrl: !!url });
        return res.status(500).json({ error: 'AI integration not fully configured' });
    }

    try {
        const tableName = getTableName('Conversations');

        // Fetch conversation
        const convResult = await pool.query(`SELECT * FROM "${tableName}" WHERE session_id = $1`, [sessionId]);
        if (convResult.rows.length === 0) {
            console.error(`❌ Summary failed: Session ${sessionId} has no transcript data in ${tableName}. Run sync first.`);
            return res.status(404).json({ error: `Transcript not found in ${tableName}. Please run data sync for this session.` });
        }

        const conversation = convResult.rows[0];
        const turns = conversation.turns || [];

        if (turns.length === 0) {
            return res.status(400).json({ error: 'No conversation turns to summarize' });
        }

        // Format conversation for the prompt
        const conversationText = turns.map((t) => {
            let text = `User: ${t.user_message || '(empty)'} `;
            if (t.assistant_message) {
                text += `\nAssistant: ${t.assistant_message} `;
            }
            return text;
        }).join('\n---\n');

        const systemPrompt = `You are a professional conversation analyst who writes brief, user-focused summaries.

TASK:
Write a summary of the conversation below in 2-3 sentences, strictly under 60 words.

LANGUAGE RULE (NON-NEGOTIABLE):
- Detect the language of the conversation and write the summary in THAT SAME language.
- Telugu conversation → Telugu summary (Telugu script).
- Hindi conversation → Hindi summary (Devanagari script).
- English conversation → English summary.
- Do NOT translate. Do NOT mix languages.

FORMAT RULES:
- Write from the USER's perspective and intent.
- Sentence 1: What the user wanted to know or achieve (their goal/intent).
- Sentence 2: What specific things they asked about or inquired (the key questions/topics).
- Sentence 3 (optional): What was provided or resolved for the user.
- Do NOT write generic "User asked about X, Assistant explained Y" topic lists.
- DO write as a clear narrative of what the user was seeking and what they got.

EXAMPLES (English):
BAD: "User asked about fertilizer. Assistant explained product details, pricing, dosage."
GOOD: "User wanted to understand Nakro Gold Biofertilizer before purchasing. They specifically asked about its microbial composition, pricing, dosage per acre, and soil health benefits. The assistant provided complete product details including pack sizes and recommended usage."

BAD: "User asked to speak with another agent."
GOOD: "User wanted to connect with a different agent but communicated in Telugu. Since the assistant only handles English, it requested the user to switch to English to continue."`;

        // Call AI Service
        const aiResponse = await axios.post(
            getOpenAIUrl(),
            {
                // Only include model for standard OpenAI
                ...(!isAzure && { model: 'gpt-4o-mini' }),
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: conversationText }
                ],
                max_tokens: 150,
                temperature: 0.3
            },
            {
                headers: getOpenAIHeaders(),
                timeout: 30000
            }
        );

        const summary = aiResponse.data?.choices?.[0]?.message?.content?.trim();

        if (!summary) {
            return res.status(500).json({ error: 'Failed to generate summary' });
        }

        // Save to database
        await pool.query(`UPDATE "${getTableName('Conversations')}" SET summary = $1 WHERE session_id = $2`, [summary, sessionId]);

        res.json({ summary });
    } catch (error) {
        if (error.response) {
            console.error('❌ AI Service Error Details:', {
                status: error.response.status,
                data: error.response.data,
                headers: error.response.headers
            });
            res.status(error.response.status).json({
                error: `AI Service error: ${error.response.status} `,
                details: error.response.data
            });
        } else {
            console.error('❌ Summary generation failure:', error);
            res.status(500).json({
                error: 'Internal server error during summary generation',
                message: error.message,
                details: error.stack // Temporarily exposing stack for debugging
            });
        }
    }
});

// Get Conversation (Details)
app.get('/api/conversation/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    try {
        const result = await pool.query(`
            SELECT c.*, u.email as reviewer_email
            FROM "${getTableName('Conversations')}" c
            LEFT JOIN "${getTableName('Users')}" u ON c.reviewed_by = u.user_id
            WHERE c.session_id = $1
            `, [sessionId]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Conversation logs not found" });
        }
        res.json(result.rows[0]);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get Single Session
app.get('/api/session/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    try {
        const result = await pool.query(`SELECT * FROM "${getTableName('Sessions')}" WHERE session_id = $1`, [sessionId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "Session not found" });
        }

        const session = result.rows[0];

        // Handle metadata (Postgres returns it as an object if it's JSONB, or string if JSON)
        let metadata = session.metadata;
        if (typeof metadata === 'string') {
            try { metadata = JSON.parse(metadata); } catch (e) { }
        }

        let recordingUrl = metadata?.telephony?.recording_url || null;

        if (metadata?.telephony?.call_id && !recordingUrl) {
            // If transport is exotel, or if account_sid matches our config, or if transport is missing but we have config
            const isExotel = metadata.telephony.transport === 'exotel' ||
                metadata.telephony.account_sid === exotelConfig.accountSid ||
                (!metadata.telephony.transport && exotelConfig.apiKey);

            if (isExotel) {
                console.log(`🔊 Fetching Exotel recording for CallSid: ${metadata.telephony.call_id} `);
                const fullRecordingData = await getExotelRecordingUrl(metadata.telephony.call_id, true);

                if (fullRecordingData) {
                    recordingUrl = fullRecordingData.recordingUrl;

                    // SAVE to database so we don't fetch again next time
                    try {
                        const updatedMetadata = {
                            ...metadata,
                            telephony: {
                                ...metadata.telephony,
                                recording_url: fullRecordingData.staticUrl || fullRecordingData.recordingUrl
                            }
                        };
                        await pool.query(`UPDATE "${getTableName('Sessions')}" SET metadata = $1 WHERE session_id = $2`, [JSON.stringify(updatedMetadata), sessionId]);
                        metadata = updatedMetadata; // Update local variable for response
                        console.log(`✅ Recording URL saved to DB for session ${sessionId}`);
                    } catch (dbErr) {
                        console.error(`⚠️ Failed to save recording URL to DB: ${dbErr.message} `);
                    }
                }
                console.log(`✅ Recording URL: ${recordingUrl ? 'Found' : 'Not Found'} `);
            }
        }

        res.json({
            ...session,
            metadata,
            recordingUrl
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Mock User Management (See top for data) ---

// Get Users (with Role-based Filtering)
app.get('/api/users', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    const token = authHeader.split(' ')[1];
    let requesterId = null;
    let isMaster = false;

    try {
        const decoded = jwt.verify(token, JWT_SECRET_ACTIVE);
        requesterId = decoded.userId;
        isMaster = decoded.isMaster && requesterId === 'master_root_0';
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
        let reqUser;
        if (isMaster) {
            reqUser = { role: 'super_admin', user_id: 'master_root_0', is_active: true };
        } else {
            const reqUserRes = await pool.query(`SELECT role, user_id FROM "${getTableName('Users')}" WHERE user_id = $1`, [requesterId]);
            reqUser = reqUserRes.rows[0];
        }

        if (!reqUser) return res.status(401).json({ error: 'User not found' });

        let query = `
            SELECT u.*,
            (SELECT COUNT(*) FROM "${getTableName('User_Agents')}" ua WHERE ua.user_id = u.user_id) as agent_count,
    creator.email as creator_email,
    creator.subscription_expiry as creator_subscription_expiry,
    creator.minutes_balance as creator_minutes_balance
            FROM "${getTableName('Users')}" u
            LEFT JOIN "${getTableName('Users')}" creator ON u.created_by = creator.user_id
    `;
        let whereClauses = [];
        let params = [];

        if (reqUser.role === 'admin') {
            whereClauses.push(`(u.created_by = $${params.length + 1} OR u.user_id = $${params.length + 1})`);
            params.push(requesterId);
        } else if (reqUser.role !== 'super_admin') {
            whereClauses.push(`u.user_id = $${params.length + 1} `);
            params.push(requesterId);
        }

        // Additional filters from query
        if (req.query.role) {
            whereClauses.push(`u.role = $${params.length + 1} `);
            params.push(req.query.role);
        }
        if (req.query.createdBy && req.query.createdBy !== 'all') {
            whereClauses.push(`u.created_by = $${params.length + 1} `);
            params.push(req.query.createdBy);
        }

        if (whereClauses.length > 0) {
            query += ` WHERE ` + whereClauses.join(' AND ');
        }

        // Add sorting
        query += ` ORDER BY u.created_at DESC`;

        // Add pagination
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        // Get total count for pagination
        let countQuery = `SELECT COUNT(*) FROM "${getTableName('Users')}" u`;
        if (whereClauses.length > 0) {
            countQuery += ` WHERE ` + whereClauses.join(' AND ');
        }
        const totalResult = await pool.query(countQuery, params);
        const totalUsers = parseInt(totalResult.rows[0].count);

        query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2} `;
        params.push(limit, offset);

        const result = await pool.query(query, params);
        const users = result.rows;

        // Fetch agents for each user
        const allAgentsRes = await pool.query(`SELECT agent_id FROM "${getTableName('Agents')}"`);
        const allAgentIds = allAgentsRes.rows.map(r => r.agent_id);

        // Fetch agents assigned to the Admin to restrict their User creation power later
        let adminAgentIds = [];
        if (reqUser.role === 'admin') {
            const adminAgentsRes = await pool.query(`SELECT agent_id FROM "${getTableName('User_Agents')}" WHERE user_id = $1`, [requesterId]);
            adminAgentIds = adminAgentsRes.rows.map(r => r.agent_id);
        }

        // --- N+1 OPTIMIZATION ---
        // Fetch User_Agents for all user_ids returned in this page
        const userIds = users.map(u => u.user_id);
        let userAgentsMap = {};
        if (userIds.length > 0) {
            const uaRes = await pool.query(`
                SELECT user_id, agent_id, can_mark 
                FROM "${getTableName('User_Agents')}" 
                WHERE user_id = ANY($1)
            `, [userIds]);

            // Build a map of user_id -> [ { agent_id, can_mark } ]
            uaRes.rows.forEach(r => {
                if (!userAgentsMap[r.user_id]) userAgentsMap[r.user_id] = [];
                userAgentsMap[r.user_id].push({ agent_id: r.agent_id, can_mark: r.can_mark });
            });
        }

        for (let user of users) {
            if (user.role === 'user' && user.created_by) {
                user.subscription_expiry = user.creator_subscription_expiry;
                user.minutes_balance = user.creator_minutes_balance;
            }

            if (user.role === 'super_admin') {
                user.agents = allAgentIds;
                user.agentCount = allAgentIds.length;
                user.agentPermissions = {}; // Super admin has all permissions by default
            } else {
                // For admin or regular user, read from the pre-fetched map
                const mappedAgents = userAgentsMap[user.user_id] || [];
                user.agents = mappedAgents.map(r => r.agent_id);
                user.agentCount = user.agents.length;
                user.agentPermissions = Object.fromEntries(
                    mappedAgents.map(r => [r.agent_id, r.can_mark || false])
                );
            }
        }

        res.json({
            users,
            pagination: {
                total: totalUsers,
                page,
                limit,
                totalPages: Math.ceil(totalUsers / limit)
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/users', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    const token = authHeader.split(' ')[1];
    let requesterId = null;

    try {
        const decoded = jwt.verify(token, JWT_SECRET_ACTIVE);
        requesterId = decoded.userId;
    } catch (err) {
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        return res.status(500).json({ error: `Server authentication error (POST /api/users): ${err.message}` });
    }

    const { email, role, subscriptionTier, agents, subscription_expiry, minutes_balance } = req.body;
    const user_id = `user_${Date.now()}`;
    const password = generateTempPassword(); // Cryptographically random, unique per user

    try {
        let reqUser;
        if (requesterId === 'master_root_0') {
            reqUser = { role: 'super_admin' };
        } else {
            const reqUserRes = await pool.query(`SELECT role, minutes_balance FROM "${getTableName('Users')}" WHERE user_id = $1`, [requesterId]);
            reqUser = reqUserRes.rows[0];
        }

        if (!reqUser) return res.status(401).json({ error: 'Requester not found' });

        // Hierarchy Check
        if (reqUser.role === 'admin' && (role === 'super_admin' || role === 'admin')) {
            return res.status(403).json({ error: 'Admins can only create regular users.' });
        }
        if (reqUser.role === 'user') {
            return res.status(403).json({ error: 'Users cannot create other users.' });
        }

        let userSubExpiry = null;
        let userMinBalance = 0;

        if (reqUser.role === 'super_admin' && role !== 'user') {
            if (subscription_expiry) userSubExpiry = new Date(subscription_expiry);
            if (minutes_balance) userMinBalance = parseInt(minutes_balance, 10) || 0;
        }

        // User Limit Check & Credit Deduction
        if (requesterId !== 'master_root_0') {
            const userCountRes = await pool.query(`SELECT COUNT(*) FROM "${getTableName('Users')}" WHERE created_by = $1`, [requesterId]);
            const createdUserCount = parseInt(userCountRes.rows[0].count);

            if (createdUserCount >= 2) {
                if (!reqUser.minutes_balance || reqUser.minutes_balance < 500) {
                    return res.status(402).json({ error: 'User limit reached. You need 500 credits to create an additional user. Please recharge.' });
                }

                // Deduct 500 Credits
                await pool.query(
                    `UPDATE "${getTableName('Users')}" SET minutes_balance = minutes_balance - 500, updated_at = NOW() WHERE user_id = $1`,
                    [requesterId]
                );
                console.log(`💰 Deducted 500 credits from ${requesterId} for creating user above limit (has ${createdUserCount} users).`);
            }
        }

        // Agent Assignment Constraint Check (Only one Admin can own an Agent)
        if (role === 'admin' && agents && agents.length > 0) {
            for (const agentId of agents) {
                const constraintCheck = await pool.query(`
                    SELECT u.email 
                    FROM "${getTableName('User_Agents')}" ua
                    JOIN "${getTableName('Users')}" u ON ua.user_id = u.user_id
                    WHERE ua.agent_id = $1 AND u.role IN ('admin', 'super_admin') AND ua.user_id != $2
                `, [agentId, user_id]);

                if (constraintCheck.rows.length > 0) {
                    return res.status(400).json({ error: `Agent ${agentId} is already assigned to Admin ${constraintCheck.rows[0].email}` });
                }
            }
        }

        console.log(`👤 Creating user: ${email} (Role: ${role}, Created by: ${requesterId})`);
        // Create User
        await pool.query(`
            INSERT INTO "${getTableName('Users')}"
    (user_id, email, password_hash, role, subscription_tier, is_active, must_change_password, created_by, created_at, updated_at, subscription_expiry, minutes_balance)
VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
    `, [user_id, email, password, role || 'user', subscriptionTier || 'free', true, true, requesterId, new Date(), new Date(), userSubExpiry, userMinBalance]);

        // Assign Agents
        if (agents && agents.length > 0) {
            for (const agentId of agents) {
                await pool.query(`
                    INSERT INTO "${getTableName('User_Agents')}"(user_id, agent_id)
VALUES($1, $2)
    `, [user_id, agentId]);
            }
        }

        const newUser = { user_id, email, role, subscriptionTier, agents: agents || [], is_active: true };

        // Send Welcome Email
        if (process.env.SMTP_HOST) {
            try {
                await transporter.sendMail({
                    from: process.env.SMTP_FROM || '"FarmVaidya Admin" <admin@farmvaidya.ai>',
                    to: email,
                    subject: 'Welcome to FarmVaidya Dashboard',
                    html: `
    < h3 > Welcome to FarmVaidya!</h3 >
                        <p>Your account has been created successfully.</p>
                        <p><strong>Username:</strong> ${email}</p>
                        <p><strong>Password:</strong> ${password}</p>
                        <p>Please login and change your password immediately.</p>
                        <p><a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login">Login to Dashboard</a></p>
`
                });
            } catch (emailErr) {
                console.error('❌ Failed to send email:', emailErr.message);
            }
        }

        res.json(newUser);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update User (Role, Subscription, etc.)
app.put('/api/users/:userId', async (req, res) => {
    const { userId } = req.params;
    const { role, subscriptionTier, isActive, subscription_expiry, minutes_balance } = req.body;
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    const token = authHeader.split(' ')[1];
    let requesterId = null;

    try {
        const decoded = jwt.verify(token, JWT_SECRET_ACTIVE);
        requesterId = decoded.userId;
    } catch (err) {
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        return res.status(500).json({ error: `Server authentication error (PUT /api/users): ${err.message}` });
    }

    try {
        let reqUser;
        if (requesterId === 'master_root_0') {
            reqUser = { role: 'super_admin' };
        } else {
            const reqUserRes = await pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [requesterId]);
            reqUser = reqUserRes.rows[0];
        }

        const targetUserRes = await pool.query(`SELECT role, created_by FROM "${getTableName('Users')}" WHERE user_id = $1`, [userId]);
        const targetUser = targetUserRes.rows[0];

        if (!reqUser) return res.status(401).json({ error: 'Requester not found' });
        if (!targetUser) return res.status(404).json({ error: 'Target user not found' });

        // Security Checks
        if (reqUser.role === 'admin') {
            // Admins can only update users they created
            if (targetUser.created_by !== requesterId) {
                return res.status(403).json({ error: 'Admins can only manage users they created.' });
            }
            // Admins cannot promote anyone to Admin or Super Admin
            if (role && (role === 'admin' || role === 'super_admin')) {
                return res.status(403).json({ error: 'Admins cannot assign administrative roles.' });
            }
        } else if (reqUser.role !== 'super_admin') {
            return res.status(403).json({ error: 'Insufficient permissions.' });
        }

        // Prevent downgrading the last super_admin or root? 
        // For simplicity, just allow super_admin to do anything.

        const updates = [];
        const params = [];
        if (role) {
            updates.push(`role = $${params.length + 1} `);
            params.push(role);
        }
        if (subscriptionTier) {
            updates.push(`subscription_tier = $${params.length + 1} `);
            params.push(subscriptionTier);
        }
        if (isActive !== undefined) {
            updates.push(`is_active = $${params.length + 1} `);
            params.push(isActive);
        }
        if (reqUser.role === 'super_admin' && role !== 'user') {
            if (subscription_expiry !== undefined) {
                updates.push(`subscription_expiry = $${params.length + 1} `);
                params.push(subscription_expiry ? new Date(subscription_expiry) : null);
            }
            if (minutes_balance !== undefined) {
                updates.push(`minutes_balance = $${params.length + 1} `);
                params.push(parseInt(minutes_balance, 10) || 0);
            }
        }

        updates.push(`updated_at = $${params.length + 1} `);
        params.push(new Date());

        if (updates.length > 0) {
            await pool.query(`
                UPDATE "${getTableName('Users')}" 
                SET ${updates.join(', ')} 
                WHERE user_id = $${params.length + 1}
`, [...params, userId]);
        }

        res.json({ success: true, message: 'User updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Assign Agent
app.post('/api/users/:userId/agents', async (req, res) => {
    const { userId } = req.params;
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    try {
        jwt.verify(authHeader.split(' ')[1], JWT_SECRET_ACTIVE);
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { agentId } = req.body;

    try {
        await pool.query(`
            INSERT INTO "${getTableName('User_Agents')}"(user_id, agent_id)
VALUES($1, $2) ON CONFLICT DO NOTHING
        `, [userId, agentId]);

        const agents = await pool.query(`SELECT agent_id FROM "${getTableName('User_Agents')}" WHERE user_id = $1`, [userId]);

        // Notify the user about the new agent
        try {
            const { notifyAgentAssigned } = await import('./services/notification.service.js');
            const userRow = await pool.query(`SELECT email FROM "${getTableName('Users')}" WHERE user_id = $1`, [userId]);
            if (userRow.rows[0]) {
                notifyAgentAssigned(userId, userRow.rows[0].email, agentId).catch(() => { });
            }
        } catch (_) { }

        res.json({ success: true, agents: agents.rows.map(r => r.agent_id) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update User Agents (Replace entire list)
app.put('/api/users/:userId/agents', async (req, res) => {
    const { userId } = req.params;
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    try {
        jwt.verify(authHeader.split(' ')[1], JWT_SECRET_ACTIVE);
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { agents } = req.body; // Expects array of agent IDs

    try {
        // Fetch existing agents before deleting
        const existingAgentsRes = await pool.query(`SELECT agent_id FROM "${getTableName('User_Agents')}" WHERE user_id = $1`, [userId]);
        const existingAgents = existingAgentsRes.rows.map(r => r.agent_id);

        await pool.query(`DELETE FROM "${getTableName('User_Agents')}" WHERE user_id = $1`, [userId]);

        if (agents && agents.length > 0) {
            // Agent Assignment Constraint Check
            const uRes = await pool.query(`SELECT role, email FROM "${getTableName('Users')}" WHERE user_id = $1`, [userId]);
            const targetUser = uRes.rows[0];
            const targetRole = targetUser?.role;

            if (targetRole === 'admin' || targetRole === 'super_admin') {
                for (const agentId of agents) {
                    const constraintCheck = await pool.query(`
                        SELECT u.email 
                        FROM "${getTableName('User_Agents')}" ua
                        JOIN "${getTableName('Users')}" u ON ua.user_id = u.user_id
                        WHERE ua.agent_id = $1 AND u.role IN ('admin', 'super_admin') AND ua.user_id != $2
                    `, [agentId, userId]);

                    if (constraintCheck.rows.length > 0) {
                        return res.status(400).json({ error: `Agent ${agentId} is already assigned to Admin ${constraintCheck.rows[0].email}` });
                    }
                }
            }

            for (const agentId of agents) {
                await pool.query(`
                    INSERT INTO "${getTableName('User_Agents')}"(user_id, agent_id)
VALUES($1, $2)
                `, [userId, agentId]);
            }

            // Notify the target user about agent assignment ONLY if the list changed
            const newAgentList = [...agents].sort().join(',');
            const oldAgentList = [...existingAgents].sort().join(',');

            if (newAgentList !== oldAgentList) {
                try {
                    const { notifyAgentAssigned } = await import('./services/notification.service.js');
                    if (targetUser?.email) {
                        notifyAgentAssigned(
                            userId, targetUser.email,
                            `${agents.length} agent(s) (IDs: ${agents.join(', ')})`
                        ).catch(() => { });
                    }
                } catch (_) { }
            }
        }

        res.json({ success: true, agents: agents || [] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete User
app.delete('/api/users/:userId', async (req, res) => {
    const { userId } = req.params;
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    const token = authHeader.split(' ')[1];
    let isMaster = false;
    let requesterId = null;

    try {
        const decoded = jwt.verify(token, JWT_SECRET_ACTIVE);
        requesterId = decoded.userId;
        isMaster = decoded.isMaster && requesterId === 'master_root_0';
    } catch (err) {
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        return res.status(500).json({ error: `Server authentication error: ${err.message}` });
    }

    try {
        let requester;
        let target;

        if (isMaster) {
            requester = { role: 'super_admin', user_id: 'master_root_0' };
            const targetResult = await pool.query(`SELECT email, created_by, role FROM "${getTableName('Users')}" WHERE user_id = $1`, [userId]);
            target = targetResult.rows[0];
        } else {
            const [reqResult, targetResult] = await Promise.all([
                pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [requesterId]),
                pool.query(`SELECT email, created_by, role FROM "${getTableName('Users')}" WHERE user_id = $1`, [userId])
            ]);
            requester = reqResult.rows[0];
            target = targetResult.rows[0];
        }

        if (!requester) return res.status(401).json({ error: 'Requester not found' });
        if (!target) return res.status(404).json({ error: 'Target user not found' });

        // Protection for root admin
        if (target.email === 'admin@farmvaidya.ai' && requesterId !== userId) {
            return res.status(403).json({ error: 'The root admin account cannot be deleted.' });
        }

        // Super Admin permissions
        if (requester.role === 'super_admin') {
            // Authorized
        } else if (target.role === 'super_admin' || target.role === 'admin') {
            // Regular Admins/Users cannot delete other Admins/Super Admins
            if (requesterId !== userId) {
                return res.status(403).json({ error: 'Insufficient permissions to delete this user.' });
            }
        } else {
            // Target is a regular user
            if (requester.role === 'admin' && target.created_by !== requesterId) {
                return res.status(403).json({ error: 'Admins can only delete users they created.' });
            }
            if (requester.role === 'user' && requesterId !== userId) {
                return res.status(403).json({ error: 'Users cannot delete others.' });
            }
        }

        // --- CASCADING DELETE LOGIC ---
        // If deleting an Admin, we must also delete their users
        if (target.role === 'admin') {
            const childUsersResult = await pool.query(`SELECT user_id, email FROM "${getTableName('Users')}" WHERE created_by = $1`, [userId]);
            const childUsers = childUsersResult.rows;

            // Notify Child Users
            if (process.env.SMTP_HOST && childUsers.length > 0) {
                const childSubject = 'Account Deleted';
                const childMessage = 'Your account has been permanently deleted because your Organization Administrator account was removed.';

                // Send emails in parallel
                childUsers.forEach(child => {
                    transporter.sendMail({
                        from: process.env.SMTP_FROM || '"FarmVaidya Admin" <admin@farmvaidya.ai>',
                        to: child.email,
                        subject: childSubject,
                        html: `
    < h3 > ${childSubject}</h3 >
                            <p>${childMessage}</p>
                            <p>If you believe this is an error, please contact support.</p>
`
                    }).catch(e => console.error(`Failed to send delete email to ${child.email}: `, e));
                });
            }

            // Delete Child Users (clear dependent tables first)
            for (const child of childUsers) {
                await pool.query(`DELETE FROM "${getTableName('Notifications')}" WHERE user_id = $1`, [child.user_id]);
                await pool.query(`DELETE FROM "${getTableName('User_Agents')}" WHERE user_id = $1`, [child.user_id]);
            }
            await pool.query(`DELETE FROM "${getTableName('Users')}" WHERE created_by = $1`, [userId]);
        }

        // Notify Target User (The one being directly deleted)
        if (process.env.SMTP_HOST) {
            const subject = 'Account Deleted';
            const actor = requester.role === 'super_admin' ? 'Super Admin' : 'Admin';
            const message = `Your account has been permanently deleted by the ${actor}.`;

            transporter.sendMail({
                from: process.env.SMTP_FROM || '"FarmVaidya Admin" <admin@farmvaidya.ai>',
                to: target.email,
                subject: subject,
                html: `
    < h3 > ${subject}</h3 >
        <p>${message}</p>
`
            }).catch(e => console.error(`Failed to send delete email to ${target.email}: `, e));
        }

        // Delete Target User (clear dependent tables first)
        await pool.query(`DELETE FROM "${getTableName('Notifications')}" WHERE user_id = $1`, [userId]);
        await pool.query(`DELETE FROM "${getTableName('User_Agents')}" WHERE user_id = $1`, [userId]);
        await pool.query(`DELETE FROM "${getTableName('Users')}" WHERE user_id = $1`, [userId]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Toggle User Active Status
app.patch('/api/users/:userId/active', async (req, res) => {
    const { userId } = req.params;
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    const token = authHeader.split(' ')[1];
    let requesterId = null;

    try {
        const decoded = jwt.verify(token, JWT_SECRET_ACTIVE);
        requesterId = decoded.userId;
    } catch (err) {
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        return res.status(500).json({ error: `Server authentication error (PATCH /api/users/active): ${err.message}` });
    }

    try {
        let requester, user;
        if (requesterId === 'master_root_0') {
            requester = { role: 'super_admin' };
            const targetResult = await pool.query(`SELECT * FROM "${getTableName('Users')}" WHERE user_id = $1`, [userId]);
            user = targetResult.rows[0];
        } else {
            const [reqResult, targetResult] = await Promise.all([
                pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [requesterId]),
                pool.query(`SELECT * FROM "${getTableName('Users')}" WHERE user_id = $1`, [userId])
            ]);
            requester = reqResult.rows[0];
            user = targetResult.rows[0];
        }

        if (!requester) return res.status(401).json({ error: 'Requester not found' });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Hierarchy Check
        if (requester.role === 'admin' && user.created_by !== requesterId) {
            return res.status(403).json({ error: 'Admins can only deactivate users they created.' });
        }
        if (requester.role === 'user') {
            return res.status(403).json({ error: 'Permission denied.' });
        }
        if (user.role === 'super_admin' && requester.role !== 'super_admin') {
            return res.status(403).json({ error: 'Only Super Admins can manage other Super Admins.' });
        }

        const newState = !user.is_active;
        await pool.query(`UPDATE "${getTableName('Users')}" SET is_active = $1 WHERE user_id = $2`, [newState, userId]);

        // Send Notification Email
        if (process.env.SMTP_HOST) {
            const actor = requester.role === 'super_admin' ? 'Super Admin' : 'Admin';
            const subject = newState ? 'Account Reactivated' : 'Account Deactivated';
            const message = newState
                ? `Your account has been reactivated by the ${actor}. You can now log in to your dashboard.`
                : `Your account has been deactivated by the ${actor}. If you are currently logged in, you will be automatically logged out in 5 minutes.`;

            transporter.sendMail({
                from: process.env.SMTP_FROM || '"FarmVaidya Admin" <admin@farmvaidya.ai>',
                to: user.email,
                subject: subject,
                html: `
    < h3 > ${subject}</h3 >
                    <p>${message}</p>
                    <p>Action performed by: <strong>${actor}</strong></p>
                    <p>If you have any questions, please contact support.</p>
`
            }).catch(e => console.error('Email error:', e));
        }

        res.json({ success: true, is_active: newState });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Reset Password (Admin action) - Sends a tokenized link
app.post('/api/users/:userId/reset-password', async (req, res) => {
    const { userId } = req.params;
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    const tokenFromReq = authHeader.split(' ')[1];
    let requesterId = null;

    try {
        const decoded = jwt.verify(tokenFromReq, JWT_SECRET_ACTIVE);
        requesterId = decoded.userId;
    } catch (err) {
        if (err.name === 'JsonWebTokenError' || err.name === 'TokenExpiredError') {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        return res.status(500).json({ error: `Server authentication error (POST /api/users/reset-password): ${err.message}` });
    }

    try {
        let requester, user;
        if (requesterId === 'master_root_0') {
            requester = { role: 'super_admin' };
            const targetResult = await pool.query(`SELECT email, created_by, role FROM "${getTableName('Users')}" WHERE user_id = $1`, [userId]);
            user = targetResult.rows[0];
        } else {
            const [reqResult, targetResult] = await Promise.all([
                pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [requesterId]),
                pool.query(`SELECT email, created_by, role FROM "${getTableName('Users')}" WHERE user_id = $1`, [userId])
            ]);
            requester = reqResult.rows[0];
            user = targetResult.rows[0];
        }

        if (!requester) return res.status(401).json({ error: 'Requester not found' });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Hierarchy Check
        if (requester.role === 'admin' && user.created_by !== requesterId) {
            return res.status(403).json({ error: 'Admins can only reset passwords for users they created.' });
        }
        if (requester.role === 'user') {
            return res.status(403).json({ error: 'Permission denied.' });
        }

        const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
        const expiry = Date.now() + 24 * 60 * 60 * 1000;

        await pool.query(
            `UPDATE "${getTableName('Users')}" SET reset_token = $1, token_expiry = $2 WHERE user_id = $3`,
            [token, expiry, userId]
        );

        const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'} /reset-password/${token} `;

        if (process.env.SMTP_HOST) {
            try {
                await transporter.sendMail({
                    from: process.env.SMTP_FROM || '"FarmVaidya Admin" <admin@farmvaidya.ai>',
                    to: user.email,
                    subject: 'Reset Your Password - Sevak Dashboard',
                    html: `
    < h3 > Password Reset Request</h3 >
                        <p>Hello,</p>
                        <p>The administrator has initiated a password reset for your account.</p>
                        <p>Please click the link below to set a new password:</p>
                        <p><a href="${resetLink}" style="display: inline-block; padding: 10px 20px; background-color: #008F4B; color: white; text-decoration: none; border-radius: 5px;">Reset Password</a></p>
                        <p>Best regards,<br>FarmVaidya Admin Team</p>
`
                });
            } catch (e) {
                console.error('Email error:', e);
                return res.status(500).json({ error: 'Failed to send email' });
            }
        }

        res.json({ success: true, message: 'Password reset link sent to user email' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Reset Password with Token
app.post('/api/reset-password-token', async (req, res) => {
    const { token, newPassword } = req.body;
    try {
        const result = await pool.query(`SELECT * FROM "${getTableName('Users')}" WHERE reset_token = $1`, [token]);
        const user = result.rows[0];

        if (!user) return res.status(400).json({ error: 'Invalid or expired reset token' });

        if (Date.now() > user.token_expiry) {
            await pool.query(`UPDATE "${getTableName('Users')}" SET reset_token = NULL, token_expiry = NULL WHERE user_id = $1`, [user.user_id]);
            return res.status(400).json({ error: 'Reset token has expired' });
        }

        await pool.query(
            `UPDATE "${getTableName('Users')}" SET password_hash = $1, reset_token = NULL, token_expiry = NULL, must_change_password = false WHERE user_id = $2`,
            [newPassword, user.user_id]
        );

        res.json({ success: true, message: 'Password updated successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// User Dashboard (Assigned Agents)
app.get('/api/user/dashboard', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    const token = authHeader.split(' ')[1];
    let userId = null;

    try {
        const decoded = jwt.verify(token, JWT_SECRET_ACTIVE);
        userId = decoded.userId;
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
        const userResult = await pool.query(`SELECT * FROM "${getTableName('Users')}" WHERE user_id = $1`, [userId]);
        const user = userResult.rows[0];
        if (!user) return res.status(401).json({ error: 'User not found' });

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const search = req.query.search || '';

        const sortBy = req.query.sortBy || 'name';
        const sortOrder = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';

        let baseQuery = `
            FROM "${getTableName('Agents')}" a
        `;
        let whereClauses = [];
        let queryParams = [];

        if (user.role !== 'super_admin') {
            baseQuery += ` INNER JOIN "${getTableName('User_Agents')}" ua ON a.agent_id = ua.agent_id`;
            whereClauses.push(`ua.user_id = $${queryParams.length + 1} `);
            queryParams.push(userId);
        }

        if (search) {
            whereClauses.push(`(a.name ILIKE $${queryParams.length + 1} OR a.agent_id ILIKE $${queryParams.length + 1})`);
            queryParams.push(`%${search}%`);
        }

        const whereSql = whereClauses.length > 0 ? ` WHERE ` + whereClauses.join(' AND ') : '';

        // Get total count
        const countRes = await pool.query(`SELECT COUNT(*) ${baseQuery} ${whereSql} `, queryParams);
        const totalAgents = parseInt(countRes.rows[0].count);

        // Map sorting field
        let orderBy = 'a.name';
        if (sortBy === 'sessionCount') orderBy = 'computed_session_count';
        else if (sortBy === 'totalDuration') orderBy = 'computed_total_duration';
        else if (sortBy === 'name') orderBy = 'a.name';

        const dataSql = `
            SELECT a.*,
    (SELECT COUNT(*) FROM "${getTableName('Sessions')}" s WHERE s.agent_id = a.agent_id) as computed_session_count,
        (SELECT SUM(duration_seconds) FROM "${getTableName('Sessions')}" s WHERE s.agent_id = a.agent_id) as computed_total_duration
            ${baseQuery}
            ${whereSql}
            ORDER BY ${orderBy} ${sortOrder}
            LIMIT $${queryParams.length + 1} OFFSET $${queryParams.length + 2}
`;

        const result = await pool.query(dataSql, [...queryParams, limit, offset]);
        const agents = result.rows;
        const formattedAgents = agents.map(a => ({
            ...a,
            agentId: a.agent_id,
            agentName: a.name,
            status: 'active',
            stats: {
                sessionCount: parseInt(a.computed_session_count || 0),
                totalDuration: parseInt(a.computed_total_duration || 0)
            }
        }));

        // For overall stats... (rest of the logic remains)


        if (agents.length === 0) {
            return res.json({
                agents: [],
                stats: { totalAgents: 0, totalSessions: 0, totalDuration: 0 },
                isActive: user.is_active,
                pagination: { total: totalAgents, page, limit, totalPages: Math.ceil(totalAgents / limit) }
            });
        }

        // For overall stats, we still need totals across ALL assigned agents (not just this page)
        let totalSessionsAcrossAll = 0;
        let totalDurationAcrossAll = 0;

        if (user.role === 'super_admin') {
            const statsRes = await pool.query(`
                SELECT COUNT(*) as total_sessions, SUM(duration_seconds) as total_duration 
                FROM "${getTableName('Sessions')}"
    `);
            totalSessionsAcrossAll = parseInt(statsRes.rows[0].total_sessions || 0);
            totalDurationAcrossAll = parseInt(statsRes.rows[0].total_duration || 0);
        } else {
            const statsRes = await pool.query(`
                SELECT COUNT(s.*) as total_sessions, SUM(s.duration_seconds) as total_duration 
                FROM "${getTableName('Sessions')}" s
                INNER JOIN "${getTableName('User_Agents')}" ua ON s.agent_id = ua.agent_id
                WHERE ua.user_id = $1
    `, [userId]);
            totalSessionsAcrossAll = parseInt(statsRes.rows[0].total_sessions || 0);
            totalDurationAcrossAll = parseInt(statsRes.rows[0].total_duration || 0);
        }

        res.json({
            agents: formattedAgents,
            stats: {
                totalAgents,
                totalSessions: totalSessionsAcrossAll,
                totalDuration: totalDurationAcrossAll
            },
            isActive: user.is_active,
            pagination: {
                total: totalAgents,
                page,
                limit,
                totalPages: Math.ceil(totalAgents / limit)
            }
        });
    } catch (e) {
        console.error('User Dashboard error:', e);
        res.status(500).json({ error: e.message });
    }
});

// Get Creators (Dropdown Filter)
app.get('/api/users/creators', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    try {
        jwt.verify(authHeader.split(' ')[1], JWT_SECRET_ACTIVE);
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
        const result = await pool.query(`
            SELECT DISTINCT u.user_id, u.email 
            FROM "${getTableName('Users')}" u
            WHERE u.user_id IN(SELECT DISTINCT created_by FROM "${getTableName('Users')}")
            OR u.role IN('super_admin', 'admin')
        `);
        res.json({ creators: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Review Status
app.patch('/api/user/conversations/:sessionId/review-status', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    let userId = null;
    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET_ACTIVE);
        userId = decoded.userId;
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
        const { sessionId } = req.params;
        const { status } = req.body;

        // Validate status
        const validStatuses = ['pending', 'needs_review', 'completed'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                error: `Invalid status.Must be one of: ${validStatuses.join(', ')} `
            });
        }

        // Get user to check permissions
        const userResult = await pool.query(
            `SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`,
            [userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }

        const userRole = userResult.rows[0].role;

        // Get agent_id for this session
        const sessionResult = await pool.query(
            `SELECT agent_id FROM "${getTableName('Sessions')}" WHERE session_id = $1`,
            [sessionId]
        );

        if (sessionResult.rows.length === 0) {
            return res.status(404).json({ success: false, error: 'Session not found' });
        }

        const agentId = sessionResult.rows[0].agent_id;

        // Permission check: Super Admin can always mark
        if (userRole !== 'super_admin') {
            // Admin can mark if they have access to the agent
            if (userRole === 'admin') {
                const adminAccessCheck = await pool.query(
                    `SELECT * FROM "${getTableName('User_Agents')}" WHERE user_id = $1 AND agent_id = $2`,
                    [userId, agentId]
                );
                if (adminAccessCheck.rows.length === 0) {
                    return res.status(403).json({
                        success: false,
                        error: 'You do not have access to this agent'
                    });
                }
            } else {
                // Regular user must have can_mark permission
                const permissionCheck = await pool.query(
                    `SELECT can_mark FROM "${getTableName('User_Agents')}" 
                     WHERE user_id = $1 AND agent_id = $2`,
                    [userId, agentId]
                );

                if (permissionCheck.rows.length === 0) {
                    return res.status(403).json({
                        success: false,
                        error: 'You do not have access to this agent'
                    });
                }

                if (!permissionCheck.rows[0].can_mark) {
                    return res.status(403).json({
                        success: false,
                        error: 'You do not have permission to mark sessions for this agent'
                    });
                }
            }
        }

        // Update the review status in Conversations table
        const updateResult = await pool.query(`
            UPDATE "${getTableName('Conversations')}"
SET
review_status = $1,
    reviewed_by = $2,
    reviewed_at = NOW()
            WHERE session_id = $3
RETURNING *
    `, [status, userId, sessionId]);

        if (updateResult.rows.length === 0) {
            // If no conversation exists yet, create one
            await pool.query(`
                INSERT INTO "${getTableName('Conversations')}"
    (session_id, agent_id, turns, review_status, reviewed_by, reviewed_at)
                SELECT session_id, agent_id, 0, $1, $2, NOW()
                FROM "${getTableName('Sessions')}"
                WHERE session_id = $3
                ON CONFLICT(session_id) DO UPDATE
                SET review_status = $1, reviewed_by = $2, reviewed_at = NOW()
    `, [status, userId, sessionId]);
        }

        console.log(`✅ Review status updated: ${sessionId} -> ${status} by ${userId}`);

        res.json({
            success: true,
            message: 'Review status updated successfully',
            status: status
        });

    } catch (err) {
        console.error('Update review status error:', err.message);
        res.status(500).json({
            success: false,
            error: 'Failed to update review status'
        });
    }
});

// Toggle Mark Permission for User on Agent
app.post('/api/admin/users/:userId/agents/:agentId/mark-permission', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    let requesterId = null;
    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET_ACTIVE);
        requesterId = decoded.userId;
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
        const { userId, agentId } = req.params;
        const { canMark } = req.body;

        // Check if requester is admin
        const requesterResult = await pool.query(
            `SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`,
            [requesterId]
        );

        if (requesterResult.rows.length === 0 ||
            (requesterResult.rows[0].role !== 'super_admin' && requesterResult.rows[0].role !== 'admin')) {
            return res.status(403).json({ success: false, error: 'Insufficient permissions' });
        }

        // Check if assignment exists in User_Agents table
        const assignmentCheck = await pool.query(
            `SELECT * FROM "${getTableName('User_Agents')}" WHERE user_id = $1 AND agent_id = $2`,
            [userId, agentId]
        );

        if (assignmentCheck.rows.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'User is not assigned to this agent'
            });
        }

        // For now, we'll store can_mark in a JSON metadata field or separate column
        // Since the User_Agents table might not have a can_mark column yet, 
        // let's check if the column exists and add it if needed
        try {
            await pool.query(`
                ALTER TABLE "${getTableName('User_Agents')}" 
                ADD COLUMN IF NOT EXISTS can_mark BOOLEAN DEFAULT FALSE
    `);
        } catch (alterErr) {
            console.log('can_mark column might already exist:', alterErr.message);
        }

        // Update the permission
        await pool.query(`
            UPDATE "${getTableName('User_Agents')}"
            SET can_mark = $1
            WHERE user_id = $2 AND agent_id = $3
    `, [canMark, userId, agentId]);

        console.log(`✅ Mark permission updated: User ${userId} on Agent ${agentId} -> can_mark: ${canMark}`);

        // Try to send a notification to the user
        try {
            const { createNotification } = await import('./services/notification.service.js');
            const agentRes = await pool.query(`SELECT name FROM "${getTableName('Agents')}" WHERE agent_id = $1`, [agentId]);
            if (agentRes.rows.length > 0) {
                const agentName = agentRes.rows[0].name;
                const actionText = canMark ? 'granted' : 'revoked';
                await createNotification(
                    userId,
                    'system',
                    'Permissions Updated',
                    `Your permission to mark sessions for the agent "${agentName}" has been ${actionText}.`
                );
            }
        } catch (noteErr) {
            console.error('Failed to send permission notification:', noteErr.message);
        }

        res.json({
            success: true,
            message: 'Permission updated successfully',
            canMark: canMark
        });

    } catch (err) {
        console.error('Toggle mark permission error:', err.message);
        res.status(500).json({
            success: false,
            error: 'Failed to update permission'
        });
    }
});

// ==================== DATA ADMIN ENDPOINTS ====================
// Special admin endpoints for managing and deleting data
// IMPORTANT: Deleted items are excluded from future syncs

// Delete Session
app.delete('/api/data-admin/sessions/:sessionId', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET_ACTIVE);
        const isMaster = decoded.isMaster && decoded.userId === 'master_root_0';

        if (!isMaster) {
            const userRes = await pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [decoded.userId]);
            if (!userRes.rows[0] || userRes.rows[0].role !== 'super_admin') {
                return res.status(403).json({ error: 'Super admin access required' });
            }
        }

        const { sessionId } = req.params;

        // Delete from Conversations first
        await pool.query(`DELETE FROM "${getTableName('Conversations')}" WHERE session_id = $1`, [sessionId]);

        // Delete from Sessions
        await pool.query(`DELETE FROM "${getTableName('Sessions')}" WHERE session_id = $1`, [sessionId]);

        // Add to exclusion list
        await pool.query(`
            INSERT INTO "${getTableName('Excluded_Items')}"(item_type, item_id, excluded_by, reason)
VALUES($1, $2, $3, $4)
            ON CONFLICT(item_type, item_id) DO NOTHING
        `, ['session', sessionId, decoded.userId, 'Deleted by data admin']);

        console.log(`🗑️ Session ${sessionId} deleted and excluded by ${decoded.userId} `);

        res.json({
            success: true,
            message: 'Session deleted and excluded from future syncs'
        });

    } catch (err) {
        console.error('Delete session error:', err.message);
        res.status(500).json({ error: 'Failed to delete session' });
    }
});

// Delete Agent
app.delete('/api/data-admin/agents/:agentId', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET_ACTIVE);
        const isMaster = decoded.isMaster && decoded.userId === 'master_root_0';

        if (!isMaster) {
            const userRes = await pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [decoded.userId]);
            if (!userRes.rows[0] || userRes.rows[0].role !== 'super_admin') {
                return res.status(403).json({ error: 'Super admin access required' });
            }
        }

        const { agentId } = req.params;

        // Get ALL sessions for this agent (including hidden ones)
        const sessions = await pool.query(`SELECT session_id FROM "${getTableName('Sessions')}" WHERE agent_id = $1`, [agentId]);

        // Delete all dependent data for these sessions in correct FK order
        for (const session of sessions.rows) {
            // 1. Delete Conversations first (they reference Sessions)
            await pool.query(`DELETE FROM "${getTableName('Conversations')}" WHERE session_id = $1`, [session.session_id]);

            // 2. Exclude each session in recycle bin
            await pool.query(`
                INSERT INTO "${getTableName('Excluded_Items')}"(item_type, item_id, excluded_by, reason)
                VALUES($1, $2, $3, $4)
                ON CONFLICT(item_type, item_id) DO NOTHING
            `, ['session', session.session_id, decoded.userId, 'Parent agent deleted']);
        }

        // Delete all sessions for this agent (safe now that conversations are gone)
        await pool.query(`DELETE FROM "${getTableName('Sessions')}" WHERE agent_id = $1`, [agentId]);

        // Delete User_Agents assignments
        await pool.query(`DELETE FROM "${getTableName('User_Agents')}" WHERE agent_id = $1`, [agentId]);

        // Delete agent
        await pool.query(`DELETE FROM "${getTableName('Agents')}" WHERE agent_id = $1`, [agentId]);

        // Exclude agent from future syncs
        await pool.query(`
            INSERT INTO "${getTableName('Excluded_Items')}"(item_type, item_id, excluded_by, reason)
VALUES($1, $2, $3, $4)
            ON CONFLICT(item_type, item_id) DO NOTHING
        `, ['agent', agentId, decoded.userId, 'Deleted by data admin']);

        console.log(`🗑️ Agent ${agentId} and all related data deleted and excluded by ${decoded.userId} `);

        res.json({
            success: true,
            message: 'Agent and all related data deleted and excluded from future syncs',
            sessionCount: sessions.rows.length
        });

    } catch (err) {
        console.error('Delete agent error:', err.message);
        res.status(500).json({ error: 'Failed to delete agent' });
    }
});

// Update Summary
app.patch('/api/data-admin/conversations/:sessionId/summary', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET_ACTIVE);
        const isMaster = decoded.isMaster && decoded.userId === 'master_root_0';

        if (!isMaster) {
            const userRes = await pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [decoded.userId]);
            if (!userRes.rows[0] || userRes.rows[0].role !== 'super_admin') {
                return res.status(403).json({ error: 'Super admin access required' });
            }
        }

        const { sessionId } = req.params;
        const { summary } = req.body;

        if (!summary) {
            return res.status(400).json({ error: 'Summary is required' });
        }

        await pool.query(`
            UPDATE "${getTableName('Conversations')}"
            SET summary = $1
            WHERE session_id = $2
    `, [summary, sessionId]);

        console.log(`✏️ Summary updated for session ${sessionId} by ${decoded.userId} `);

        res.json({
            success: true,
            message: 'Summary updated successfully'
        });

    } catch (err) {
        console.error('Update summary error:', err.message);
        res.status(500).json({ error: 'Failed to update summary' });
    }
});

// ==================== MASTER ADMIN EDIT ENDPOINTS ====================

// Master: Edit conversation turns
app.patch('/api/master/conversations/:sessionId/turns', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET_ACTIVE);
        if (!(decoded.isMaster && decoded.userId === 'master_root_0')) {
            return res.status(403).json({ error: 'Only Master Admin can edit conversations' });
        }
        const { sessionId } = req.params;
        const { turns } = req.body;
        if (!Array.isArray(turns)) return res.status(400).json({ error: 'turns must be an array' });
        await pool.query(`UPDATE "${getTableName('Conversations')}" SET turns = $1, total_turns = $2 WHERE session_id = $3`,
            [JSON.stringify(turns), turns.length, sessionId]);
        console.log(`✏️ [Master] Conversation turns edited for ${sessionId}`);
        res.json({ success: true, message: 'Conversation updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Master: Edit session metadata (started_at, ended_at, agent_name, etc.)
app.patch('/api/master/sessions/:sessionId', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET_ACTIVE);
        if (!(decoded.isMaster && decoded.userId === 'master_root_0')) {
            return res.status(403).json({ error: 'Only Master Admin can edit sessions' });
        }
        const { sessionId } = req.params;
        const { started_at, ended_at, duration_seconds, agent_name, status } = req.body;
        const updates = [];
        const vals = [];
        let i = 1;
        if (started_at !== undefined) { updates.push(`started_at = $${i++}`); vals.push(started_at); }
        if (ended_at !== undefined) { updates.push(`ended_at = $${i++}`); vals.push(ended_at); }
        if (duration_seconds !== undefined) { updates.push(`duration_seconds = $${i++}`); vals.push(duration_seconds); }
        if (agent_name !== undefined) { updates.push(`agent_name = $${i++}`); vals.push(agent_name); }
        if (status !== undefined) { updates.push(`status = $${i++}`); vals.push(status); }
        if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
        vals.push(sessionId);
        await pool.query(`UPDATE "${getTableName('Sessions')}" SET ${updates.join(', ')} WHERE session_id = $${i}`, vals);
        console.log(`✏️ [Master] Session ${sessionId} metadata edited`);
        res.json({ success: true, message: 'Session updated' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Master: Edit a specific conversation turn (single turn by index)
app.patch('/api/master/conversations/:sessionId/turn/:turnIndex', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET_ACTIVE);
        if (!(decoded.isMaster && decoded.userId === 'master_root_0')) {
            return res.status(403).json({ error: 'Only Master Admin can edit conversations' });
        }
        const { sessionId, turnIndex } = req.params;
        const { user_message, assistant_message } = req.body;
        const idx = parseInt(turnIndex, 10);
        const convRes = await pool.query(`SELECT turns FROM "${getTableName('Conversations')}" WHERE session_id = $1`, [sessionId]);
        if (!convRes.rows[0]) return res.status(404).json({ error: 'Conversation not found' });
        const turns = convRes.rows[0].turns || [];
        if (idx < 0 || idx >= turns.length) return res.status(400).json({ error: 'Invalid turn index' });
        if (user_message !== undefined) turns[idx].user_message = user_message;
        if (assistant_message !== undefined) turns[idx].assistant_message = assistant_message;
        await pool.query(`UPDATE "${getTableName('Conversations')}" SET turns = $1 WHERE session_id = $2`, [JSON.stringify(turns), sessionId]);
        res.json({ success: true, message: 'Turn updated', turn: turns[idx] });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Excluded Items
app.get('/api/data-admin/excluded', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET_ACTIVE);
        const isMaster = decoded.isMaster && decoded.userId === 'master_root_0';

        if (!isMaster) {
            const userRes = await pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [decoded.userId]);
            if (!userRes.rows[0] || userRes.rows[0].role !== 'super_admin') {
                return res.status(403).json({ error: 'Super admin access required' });
            }
        }

        const excludedItems = await pool.query(`
            SELECT * FROM "${getTableName('Excluded_Items')}"
            WHERE is_purged = false OR is_purged IS NULL
            ORDER BY excluded_at DESC
        `);

        res.json({
            success: true,
            excluded: excludedItems.rows
        });

    } catch (err) {
        console.error('Get excluded items error:', err.message);
        res.status(500).json({ error: 'Failed to fetch excluded items' });
    }
});

// Restore Excluded Item
app.delete('/api/data-admin/excluded/:itemType/:itemId', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET_ACTIVE);
        const isMaster = decoded.isMaster && decoded.userId === 'master_root_0';

        if (!isMaster) {
            const userRes = await pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [decoded.userId]);
            if (!userRes.rows[0] || userRes.rows[0].role !== 'super_admin') {
                return res.status(403).json({ error: 'Super admin access required' });
            }
        }

        const { itemType, itemId } = req.params;

        // Remove the exclusion entry
        await pool.query(`
            DELETE FROM "${getTableName('Excluded_Items')}"
            WHERE item_type = $1 AND item_id = $2
    `, [itemType, itemId]);

        // If restoring an agent, also remove all session exclusions that were created
        // when the agent was deleted (reason = 'Parent agent deleted')
        if (itemType === 'agent') {
            const removedSessions = await pool.query(`
                DELETE FROM "${getTableName('Excluded_Items')}"
                WHERE item_type = 'session' AND reason = 'Parent agent deleted'
                RETURNING item_id
            `);
            console.log(`♻️ Also unblocked ${removedSessions.rowCount} child sessions for agent ${itemId}`);
        }

        console.log(`♻️ ${itemType} ${itemId} restored to sync list by ${decoded.userId} `);

        res.json({
            success: true,
            message: `${itemType} ${itemId} will be re-synced on next cycle`
        });

    } catch (err) {
        console.error('Restore excluded item error:', err.message);
        res.status(500).json({ error: 'Failed to restore item' });
    }
});

// ============ AUTO-CLEANUP: Remove excluded items older than 30 days ============
const RETENTION_DAYS = 30;

const cleanupExpiredExclusions = async () => {
    try {
        const result = await pool.query(`
            DELETE FROM "${getTableName('Excluded_Items')}"
            WHERE excluded_at < NOW() - INTERVAL '${RETENTION_DAYS} days'
            RETURNING id, item_type, item_id, item_name
        `);
        if (result.rowCount > 0) {
            console.log(`🧹 Auto-cleanup: Removed ${result.rowCount} expired exclusions (older than ${RETENTION_DAYS} days):`);
            result.rows.forEach(row => console.log(`   - ${row.item_type}: ${row.item_name || row.item_id}`));
        }
    } catch (err) {
        console.error('Auto-cleanup error:', err.message);
    }
};

// Run cleanup on server start and every 6 hours
cleanupExpiredExclusions();
setInterval(cleanupExpiredExclusions, 6 * 60 * 60 * 1000);

// Permanently delete an excluded item from the recycle bin (no recovery)
app.delete('/api/data-admin/excluded-permanent/:itemType/:itemId', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET_ACTIVE);
        const isMaster = decoded.isMaster && decoded.userId === 'master_root_0';

        if (!isMaster) {
            return res.status(403).json({ error: 'Only Master Admin can permanently delete from recycle bin.' });
        }

        const { itemType, itemId } = req.params;

        // Check item exists in exclusion list
        const existing = await pool.query(`
            SELECT id, item_name FROM "${getTableName('Excluded_Items')}"
            WHERE item_type = $1 AND item_id = $2
        `, [itemType, itemId]);

        if (existing.rowCount === 0) {
            return res.status(404).json({ error: 'Item not found in recycle bin.' });
        }

        const itemName = existing.rows[0].item_name || itemId;

        // ✅ CRITICAL: Delete actual data from database (in FK-safe order)
        if (itemType === 'agent') {
            // Delete all conversations for this agent's sessions first
            const agentSessions = await pool.query(`SELECT session_id FROM "${getTableName('Sessions')}" WHERE agent_id = $1`, [itemId]);
            for (const s of agentSessions.rows) {
                await pool.query(`DELETE FROM "${getTableName('Conversations')}" WHERE session_id = $1`, [s.session_id]);
            }
            await pool.query(`DELETE FROM "${getTableName('Sessions')}" WHERE agent_id = $1`, [itemId]);
            await pool.query(`DELETE FROM "${getTableName('User_Agents')}" WHERE agent_id = $1`, [itemId]);
            await pool.query(`DELETE FROM "${getTableName('Agents')}" WHERE agent_id = $1`, [itemId]);
        } else if (itemType === 'session') {
            await pool.query(`DELETE FROM "${getTableName('Conversations')}" WHERE session_id = $1`, [itemId]);
            await pool.query(`DELETE FROM "${getTableName('Sessions')}" WHERE session_id = $1`, [itemId]);
        }

        // ✅ KEEP in Excluded_Items so the sync script NEVER re-creates it!
        // But mark as purged so it DISAPPEARS from the Recycle Bin UI.
        await pool.query(`
            UPDATE "${getTableName('Excluded_Items')}"
            SET is_purged = true, reason = 'PERMANENTLY_PURGED'
            WHERE item_type = $1 AND item_id = $2
        `, [itemType, itemId]);

        console.log(`🗑️ Permanently removed ${itemType} "${itemName}" data and marked as purged from recycle bin by ${decoded.userId}`);

        res.json({
            success: true,
            message: `${itemType} "${itemName}" permanently deleted and hidden from recycle bin.`
        });

    } catch (err) {
        console.error('Permanent delete from recycle bin error:', err.message);
        res.status(500).json({ error: 'Failed to permanently delete item' });
    }
});

// ============ MASTER ADMIN FEATURES ============

// Delete Agent (Soft or Permanent)
app.delete('/api/agents/:agentId', async (req, res) => {
    const { agentId } = req.params;
    const { permanent } = req.query; // ?permanent=true
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET_ACTIVE);
        const isMaster = decoded.isMaster && decoded.userId === 'master_root_0';

        let userRole = 'user';
        if (isMaster) {
            userRole = 'super_admin';
        } else {
            const userRes = await pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [decoded.userId]);
            if (userRes.rows[0]) userRole = userRes.rows[0].role;
        }

        if (userRole !== 'super_admin') {
            return res.status(403).json({ error: 'Only Super Admins can delete agents.' });
        }

        // Master Admin Permanent Delete Logic
        if (permanent === 'true') {
            if (!isMaster) return res.status(403).json({ error: 'Only Master Admin can delete permanently.' });

            // Get Name for Exclusion List
            const agentRes = await pool.query(`SELECT name FROM "${getTableName('Agents')}" WHERE agent_id = $1`, [agentId]);
            const agentName = agentRes.rows[0]?.name || agentId;

            // Add to Excluded_Items (Blocklist)
            await pool.query(`
                INSERT INTO "${getTableName('Excluded_Items')}"(item_type, item_id, item_name, excluded_by, reason)
VALUES('agent', $1, $2, $3, 'Permanent Delete by Master')
                ON CONFLICT(item_type, item_id) DO UPDATE SET excluded_at = CURRENT_TIMESTAMP
    `, [agentId, agentName, decoded.userId]);

            // Hard Delete — must respect FK: Conversations → Sessions → Agents
            await pool.query(`DELETE FROM "${getTableName('User_Agents')}" WHERE agent_id = $1`, [agentId]);

            // First delete all Conversations linked to this agent's sessions
            const agentSessions = await pool.query(`SELECT session_id FROM "${getTableName('Sessions')}" WHERE agent_id = $1`, [agentId]);
            for (const s of agentSessions.rows) {
                await pool.query(`DELETE FROM "${getTableName('Conversations')}" WHERE session_id = $1`, [s.session_id]);
            }

            // Now safe to delete Sessions, then the Agent
            await pool.query(`DELETE FROM "${getTableName('Sessions')}" WHERE agent_id = $1`, [agentId]);
            await pool.query(`DELETE FROM "${getTableName('Agents')}" WHERE agent_id = $1`, [agentId]);

            return res.json({ success: true, message: 'Agent permanently deleted and blocked from sync.' });
        } else {
            // Soft Delete (Hide)
            await pool.query(`UPDATE "${getTableName('Agents')}" SET is_hidden = TRUE WHERE agent_id = $1`, [agentId]);
            return res.json({ success: true, message: 'Agent hidden successfully.' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Restore Agent (Unhide/Unblock)
app.post('/api/agents/:agentId/restore', async (req, res) => {
    const { agentId } = req.params;
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET_ACTIVE);
        const isMaster = decoded.isMaster && decoded.userId === 'master_root_0';

        if (!isMaster) return res.status(403).json({ error: 'Only Master Admin can restore agents.' });

        // Unhide
        await pool.query(`UPDATE "${getTableName('Agents')}" SET is_hidden = FALSE WHERE agent_id = $1`, [agentId]);

        // Unblock agent
        await pool.query(`DELETE FROM "${getTableName('Excluded_Items')}" WHERE item_type = 'agent' AND item_id = $1`, [agentId]);

        // Also unblock all child sessions that were excluded when the agent was deleted
        const removedSessions = await pool.query(`
            DELETE FROM "${getTableName('Excluded_Items')}"
            WHERE item_type = 'session' AND reason = 'Parent agent deleted'
            RETURNING item_id
        `);
        console.log(`♻️ Agent ${agentId} restored. Also unblocked ${removedSessions.rowCount} child sessions.`);

        res.json({ success: true, message: `Agent restored and unblocked. ${removedSessions.rowCount} child sessions also unblocked.` });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Delete Session (Soft or Permanent)
app.delete('/api/sessions/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    const { permanent } = req.query; // ?permanent=true
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET_ACTIVE);
        const isMaster = decoded.isMaster && decoded.userId === 'master_root_0';

        let userRole = 'user';
        if (isMaster) {
            userRole = 'super_admin';
        } else {
            const userRes = await pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [decoded.userId]);
            if (userRes.rows[0]) userRole = userRes.rows[0].role;
        }

        if (userRole !== 'super_admin') {
            return res.status(403).json({ error: 'Only Super Admins can delete sessions.' });
        }

        if (permanent === 'true') {
            if (!isMaster) return res.status(403).json({ error: 'Only Master Admin can delete permanently.' });

            // Add to Excluded_Items
            await pool.query(`
                INSERT INTO "${getTableName('Excluded_Items')}"(item_type, item_id, item_name, excluded_by, reason)
VALUES('session', $1, $1, $2, 'Permanent Delete by Master')
                ON CONFLICT(item_type, item_id) DO UPDATE SET excluded_at = CURRENT_TIMESTAMP
    `, [sessionId, decoded.userId]);

            // Hard Delete
            await pool.query(`DELETE FROM "${getTableName('Conversations')}" WHERE session_id = $1`, [sessionId]);
            await pool.query(`DELETE FROM "${getTableName('Sessions')}" WHERE session_id = $1`, [sessionId]);

            return res.json({ success: true, message: 'Session permanently deleted and blocked from sync.' });
        } else {
            // Soft Delete
            await pool.query(`UPDATE "${getTableName('Sessions')}" SET is_hidden = TRUE WHERE session_id = $1`, [sessionId]);
            return res.json({ success: true, message: 'Session hidden successfully.' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Restore Session
app.post('/api/sessions/:sessionId/restore', async (req, res) => {
    const { sessionId } = req.params;
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET_ACTIVE);
        const isMaster = decoded.isMaster && decoded.userId === 'master_root_0';

        if (!isMaster) return res.status(403).json({ error: 'Only Master Admin can restore sessions.' });

        // Unhide
        await pool.query(`UPDATE "${getTableName('Sessions')}" SET is_hidden = FALSE WHERE session_id = $1`, [sessionId]);

        // Unblock
        await pool.query(`DELETE FROM "${getTableName('Excluded_Items')}" WHERE item_type = 'session' AND item_id = $1`, [sessionId]);

        res.json({ success: true, message: 'Session restored.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});




// Get Number Metadata
const metadataCache = new Map(); // number -> data
const metadataPending = new Map(); // number -> Promise

app.get('/api/telephony/number-metadata/:number', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    const number = req.params.number?.trim();
    if (!number) return res.status(400).json({ error: 'Missing number' });

    // 1. Check server-side cache
    if (metadataCache.has(number)) {
        return res.json(metadataCache.get(number));
    }

    // 2. Deduplicate in-flight requests
    if (metadataPending.has(number)) {
        try {
            const data = await metadataPending.get(number);
            return res.json(data);
        } catch (err) {
            return res.status(500).json({ error: err.message });
        }
    }

    const { accountSid, apiKey, apiToken, subdomain } = exotelConfig;
    if (!accountSid || !apiKey || !apiToken) {
        return res.status(500).json({ error: 'Server telephony configuration error' });
    }

    const fetchPromise = (async () => {
        const auth = Buffer.from(`${apiKey}:${apiToken}`).toString('base64');
        const url = `https://${subdomain}/v1/Accounts/${accountSid}/Numbers/${number}.json`;

        // Silence noisy fetching logs for polling stability
        const response = await axios.get(url, {
            headers: { 'Authorization': `Basic ${auth}` }
        });

        const data = response.data;
        metadataCache.set(number, data);
        return data;
    })();

    metadataPending.set(number, fetchPromise);

    try {
        const data = await fetchPromise;
        res.json(data);
    } catch (error) {
        console.error(`❌ Failed to fetch Exotel number metadata for ${number}: ${error.message}`);
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch number metadata',
            details: error.response?.data || error.message
        });
    } finally {
        metadataPending.delete(number);
    }
});

// Get Call Details (to retrieve missing phone numbers)
app.get('/api/telephony/call-details/:callSid', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    const { callSid } = req.params;
    if (!callSid) return res.status(400).json({ error: 'Missing CallSid' });

    const { accountSid, apiKey, apiToken, subdomain } = exotelConfig;
    if (!accountSid || !apiKey || !apiToken) {
        return res.status(500).json({ error: 'Server telephony configuration error' });
    }

    try {
        const auth = Buffer.from(`${apiKey}:${apiToken}`).toString('base64');
        const url = `https://${subdomain}/v1/Accounts/${accountSid}/Calls/${callSid}.json`;

        console.log(`🔍 Fetching call details for: ${callSid}`);
        const response = await axios.get(url, {
            headers: { 'Authorization': `Basic ${auth}` }
        });

        res.json(response.data);
    } catch (error) {
        console.error(`❌ Failed to fetch Exotel call details for ${callSid}: ${error.message}`);
        res.status(error.response?.status || 500).json({
            error: 'Failed to fetch call details',
            details: error.response?.data || error.message
        });
    }
});

// --- TELEPHONY (EXOTEL) ROUTES ---
// Get Config
app.get('/api/telephony/config/:agentId', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    try {
        const { agentId } = req.params;
        const result = await pool.query(`SELECT * FROM "${getTableName('Agent_Telephony_Config')}" WHERE agent_id = $1`, [agentId]);
        res.json(result.rows[0] || {});
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Config (Admin Only)
app.post('/api/telephony/config', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, JWT_SECRET_ACTIVE);
        // Allow Master Root or Super Admin or Admin
        if (!decoded.role && !decoded.isMaster) return res.status(403).json({ error: 'Access denied' });

        const { agentId, exophone, appId } = req.body;
        if (!agentId || !exophone || !appId) return res.status(400).json({ error: 'Missing fields' });

        await pool.query(`
            INSERT INTO "${getTableName('Agent_Telephony_Config')}" (agent_id, exophone, app_id, updated_at)
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
            ON CONFLICT (agent_id) DO UPDATE 
            SET exophone = EXCLUDED.exophone, app_id = EXCLUDED.app_id, updated_at = CURRENT_TIMESTAMP
        `, [agentId, exophone, appId]);

        res.json({ success: true, message: 'Configuration saved' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Serve Dynamic ExoML for Greetings
app.get('/api/telephony/exoml', (req, res) => {
    const { name, app_id } = req.query;
    const { accountSid } = exotelConfig;

    // Generate Greeting
    const greeting = name ? `Hello ${name}` : 'Hello';

    // Redirect to Main Flow after greeting
    const redirectUrl = `https://my.exotel.com/${accountSid}/exoml/start_voice/${app_id}`;

    const exoml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say>${greeting}</Say>
    <Redirect>${redirectUrl}</Redirect>
</Response>`;

    res.header('Content-Type', 'text/xml');
    res.send(exoml);
});

// Trigger Call (Single or Bulk)
app.post('/api/telephony/call', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    try {
        const { agentId, receiverNumber, receiverName } = req.body;
        // Verify input: receiverNumber can be string or array of strings
        if (!agentId || !receiverNumber || (Array.isArray(receiverNumber) && receiverNumber.length === 0)) {
            return res.status(400).json({ error: 'Missing call details' });
        }

        const token = authHeader.split(' ')[1];
        let requesterId = null;
        try {
            const decoded = jwt.verify(token, JWT_SECRET_ACTIVE);
            requesterId = decoded.userId;
        } catch (err) {
            return res.status(401).json({ error: 'Invalid token' });
        }

        // Check Credit Balance
        // Check Credit Balance
        const userRes = await pool.query(`SELECT minutes_balance, role, created_by, subscription_expiry, is_active FROM "${getTableName('Users')}" WHERE user_id = $1`, [requesterId]);
        const user = userRes.rows[0];

        if (!user) return res.status(401).json({ error: 'User not found' });

        let billableUser = user;

        if (user.role === 'user' && user.created_by) {
            const parentRes = await pool.query(`SELECT minutes_balance, subscription_expiry, is_active FROM "${getTableName('Users')}" WHERE user_id = $1`, [user.created_by]);
            if (parentRes.rows[0]) {
                billableUser = parentRes.rows[0];
            }
        }

        // Check Subscription and Balance (Only for Admin and User roles)
        const isExempt = user.role === 'super_admin' || requesterId === 'master_root_0';

        if (!isExempt) {
            if (!billableUser.is_active) return res.status(403).json({ error: 'Account deactivated' });
            if (billableUser.subscription_expiry && new Date(billableUser.subscription_expiry) < new Date()) {
                return res.status(403).json({ error: 'Subscription expired' });
            }

            if ((billableUser.minutes_balance || 0) <= 0) {
                return res.status(403).json({ error: 'Insufficient call credits (Organization Balance Empty). Please contact admin.' });
            }
        }

        // 1. Get Config
        const configResult = await pool.query(`SELECT * FROM "${getTableName('Agent_Telephony_Config')}" WHERE agent_id = $1`, [agentId]);
        const config = configResult.rows[0];

        if (!config) {
            return res.status(400).json({ error: `Telephony not configured for agent ${agentId}. Please contact an admin to map Exophone/AppID.` });
        }

        // 2. Prepare Exotel
        const { exophone, app_id } = config;
        const { accountSid, apiKey, apiToken, subdomain } = exotelConfig;

        if (!accountSid || !apiKey || !apiToken) {
            return res.status(500).json({ error: 'Server telephony configuration error' });
        }

        const url = `https://${subdomain}/v1/Accounts/${accountSid}/Calls/connect.json`;
        const auth = Buffer.from(`${apiKey}:${apiToken}`).toString('base64');
        const finalUrl = `https://my.exotel.com/${accountSid}/exoml/start_voice/${app_id}`;

        console.log(`Using Exotel Flow URL: ${finalUrl}`);

        // Helper function to make a single call
        const initiateSingleCall = async (number, name) => {
            const params = new URLSearchParams();
            params.append('From', number); // Customer Number
            params.append('CallerId', exophone); // Virtual Number
            params.append('Url', finalUrl); // Flow URL
            if (name) params.append('CustomField', name);

            console.log(`📞 Initiating call to ${number} via ${exophone}`);
            return axios.post(url, params, {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                }
            });
        };

        // 3. Execute Calls (Single or Bulk)
        const numbers = Array.isArray(receiverNumber) ? receiverNumber : [receiverNumber];
        const names = Array.isArray(receiverName) ? receiverName : [receiverName]; // Handle names array if provided

        const recordActiveCall = async (sid) => {
            if (!sid) return;
            try {
                await pool.query(
                    `INSERT INTO "${getTableName('ActiveCalls')}" (call_sid, user_id, start_time, created_at, updated_at) VALUES ($1, $2, NOW(), NOW(), NOW())`,
                    [sid, requesterId]
                );
            } catch (err) {
                console.error('Failed to record active call:', err);
            }
        };

        if (numbers.length === 1) {
            // Single Call (Maintain legacy response format for compatibility)
            const response = await initiateSingleCall(numbers[0], names[0]);
            const sid = response.data?.Call?.Sid;
            await recordActiveCall(sid);
            return res.json({ success: true, data: response.data });
        } else {
            // Bulk Call - Line-aware sequential processing
            // Fetch call lines limit from settings
            let callsLines = 2; // default
            let callInterval = 10; // seconds between each call initiation
            try {
                const settingsResult = await pool.query(
                    `SELECT setting_key, setting_value FROM "${getTableName('System_Settings')}" WHERE setting_key IN ('calls_throttle_cpm')`
                );
                settingsResult.rows.forEach(r => {
                    if (r.setting_key === 'calls_throttle_cpm') callsLines = parseInt(r.setting_value) || 2;
                });
            } catch (dbErr) {
                console.warn('⚠️ Could not fetch call line settings, using defaults:', dbErr.message);
            }

            console.log(`🚀 Starting Line-Aware Bulk Call: ${numbers.length} numbers, ${callsLines} concurrent lines, ${callInterval}s interval...`);

            // Respond immediately with accepted status
            res.json({
                success: true,
                bulk: true,
                message: `Campaign started: ${numbers.length} calls will be made (${callsLines} lines, ${callInterval}s interval)`,
                total: numbers.length,
                lines: callsLines
            });

            // Execute calls in batches respecting line limits
            (async () => {
                const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
                let successCount = 0;
                let failCount = 0;

                for (let i = 0; i < numbers.length; i += callsLines) {
                    // Send a batch of up to callsLines calls concurrently
                    const batch = numbers.slice(i, i + callsLines);
                    const batchNames = names.slice(i, i + callsLines);

                    const batchPromises = batch.map(async (num, idx) => {
                        try {
                            const response = await initiateSingleCall(num, batchNames[idx] || '');
                            const sid = response.data?.Call?.Sid;
                            if (sid) await recordActiveCall(sid);
                            successCount++;
                            console.log(`✅ Call ${i + idx + 1}/${numbers.length} to ${num} - SUCCESS (SID: ${sid})`);
                        } catch (callErr) {
                            failCount++;
                            console.error(`❌ Call ${i + idx + 1}/${numbers.length} to ${num} - FAILED:`, callErr.response?.data?.RestException?.Message || callErr.message);
                        }
                    });

                    await Promise.all(batchPromises);

                    // Wait before sending the next batch (skip wait after the last batch)
                    if (i + callsLines < numbers.length) {
                        console.log(`⏳ Waiting ${callInterval}s before next batch (lines in use)...`);
                        await sleep(callInterval * 1000);
                    }
                }
                console.log(`📊 Bulk call complete: ${successCount} success, ${failCount} failed out of ${numbers.length}`);
            })();
        }

    } catch (err) {
        console.error('❌ Exotel Call Failed:', err.response?.data || err.message);
        res.status(500).json({
            error: 'Failed to initiate call',
            details: err.response?.data?.RestException?.Message || err.message
        });
    }
});


// Proxy Recording for Exotel Authenticated URLs
app.get('/api/proxy-recording', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).send('Missing URL');

    if (!exotelConfig.apiKey || !exotelConfig.apiToken) {
        console.warn('⚠️ Exotel credentials missing for recording proxy');
        return res.status(500).send('Server configuration error');
    }

    try {
        let targetUrl = url;
        // Force .com for recordings as .in often has DNS issues
        if (targetUrl && targetUrl.includes('recordings.exotel.in')) {
            targetUrl = targetUrl.replace('recordings.exotel.in', 'recordings.exotel.com');
        }

        const auth = Buffer.from(`${exotelConfig.apiKey}:${exotelConfig.apiToken}`).toString('base64');

        // 1. HEAD request to get metadata (with Auth)
        const headResponse = await axios.head(targetUrl, {
            headers: { 'Authorization': `Basic ${auth}` },
            timeout: 5000
        });

        const fileSize = headResponse.headers['content-length'];
        const contentType = headResponse.headers['content-type'] || 'audio/wav';

        const range = req.headers.range;
        if (range && fileSize >= 0) {
            const parts = range.replace(/bytes=/, "").split("-");
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : parseInt(fileSize) - 1;
            const chunksize = (end - start) + 1;

            const file = await axios({
                method: 'get',
                url: targetUrl,
                responseType: 'stream',
                headers: {
                    'Range': `bytes=${start}-${end}`,
                    'Authorization': `Basic ${auth}`
                },
                timeout: 10000
            });

            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': contentType,
            });
            file.data.pipe(res);
        } else {
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': contentType,
            });
            const file = await axios({
                method: 'get',
                url: targetUrl,
                responseType: 'stream',
                headers: { 'Authorization': `Basic ${auth}` },
                timeout: 10000
            });
            file.data.pipe(res);
        }
    } catch (error) {
        const statusCode = error.response ? error.response.status : 500;
        console.error(`❌ Proxy failed for ${url}: ${error.message} (Status: ${statusCode})`);
        res.status(statusCode).send(`Failed to proxy recording: ${error.message}`);
    }
});

// Serve static files from the React app
const distPath = path.join(__dirname, '../dist');
if (fs.existsSync(distPath)) {
    app.use(express.static(distPath));
    // Catch-all for SPA routing - exclude API and Exotel routes
    app.get(/^(?!\/api|\/exotel).*$/, (req, res) => {
        res.sendFile(path.join(distPath, 'index.html'));
    });
    console.log(`📦 Serving production React build from: ${distPath}`);
} else {
    console.warn('⚠️ dist folder not found. Frontend will not be served statically.');
}

// System Status (Master Only)
app.get('/api/system/status', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET_ACTIVE);
        // Strict Master Check
        if (!decoded.isMaster || decoded.userId !== 'master_root_0') {
            return res.status(403).json({ error: 'Access denied' });
        }

        // DB Check
        let dbStatus = 'Unknown';
        let dbLatency = 0;
        try {
            const start = Date.now();
            await pool.query('SELECT 1');
            dbLatency = Date.now() - start;
            dbStatus = 'Connected';
        } catch (e) {
            dbStatus = 'Error: ' + e.message;
        }

        const memUsage = process.memoryUsage();

        res.json({
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
            memory: {
                rss: Math.round(memUsage.rss / 1024 / 1024) + ' MB',
                heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + ' MB',
                heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + ' MB'
            },
            database: {
                status: dbStatus,
                latency: dbLatency + ' ms',
                totalClients: pool.totalCount,
                idleClients: pool.idleCount,
                waitingClients: pool.waitingCount
            },
            system: {
                platform: process.platform,
                nodeVersion: process.version,
                pid: process.pid,
                env: process.env.NODE_ENV
            }
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========== SYSTEM SETTINGS API ==========

// GET /api/settings - Get all system settings (admin/master only)
app.get('/api/settings', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET_ACTIVE);
        const requesterId = decoded.userId;
        const isMaster = decoded.isMaster && requesterId === 'master_root_0';

        if (!isMaster) {
            const userRes = await pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [requesterId]);
            const user = userRes.rows[0];
            if (!user || user.role !== 'super_admin') {
                return res.status(403).json({ error: 'Access denied. Only Super Admin or Master Admin can access settings.' });
            }
        }

        const result = await pool.query(`SELECT setting_key, setting_value, description, updated_by, updated_at FROM "${getTableName('System_Settings')}" ORDER BY setting_key`);
        const settings = {};
        result.rows.forEach(row => {
            settings[row.setting_key] = {
                value: row.setting_value,
                description: row.description,
                updatedBy: row.updated_by,
                updatedAt: row.updated_at
            };
        });

        res.json({ success: true, settings });
    } catch (err) {
        console.error('Error fetching settings:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// PUT /api/settings - Update system settings (admin/master only)
app.put('/api/settings', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });
    const token = authHeader.split(' ')[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET_ACTIVE);
        const requesterId = decoded.userId;
        const isMaster = decoded.isMaster && requesterId === 'master_root_0';
        let updatedBy = 'master';

        if (!isMaster) {
            const userRes = await pool.query(`SELECT role, email FROM "${getTableName('Users')}" WHERE user_id = $1`, [requesterId]);
            const user = userRes.rows[0];
            if (!user || user.role !== 'super_admin') {
                return res.status(403).json({ error: 'Access denied. Only Super Admin or Master Admin can update settings.' });
            }
            updatedBy = user.email || requesterId;
        }

        const { settings } = req.body;
        if (!settings || typeof settings !== 'object') {
            return res.status(400).json({ error: 'Settings object is required' });
        }

        // Validate throttle values
        const totalThrottle = parseInt(settings.total_throttle_cpm);
        const campaignThrottle = parseInt(settings.campaign_throttle_cpm);
        const callsThrottle = parseInt(settings.calls_throttle_cpm);

        if (isNaN(totalThrottle) || totalThrottle < 1) {
            return res.status(400).json({ error: 'Total lines must be at least 1' });
        }
        if (isNaN(campaignThrottle) || campaignThrottle < 0) {
            return res.status(400).json({ error: 'Campaign lines cannot be negative' });
        }
        if (isNaN(callsThrottle) || callsThrottle < 0) {
            return res.status(400).json({ error: 'Normal call lines cannot be negative' });
        }
        if (campaignThrottle + callsThrottle > totalThrottle) {
            return res.status(400).json({ error: `Campaign (${campaignThrottle}) + Normal Calls (${callsThrottle}) cannot exceed total (${totalThrottle}) lines` });
        }

        // Update each setting
        for (const [key, value] of Object.entries(settings)) {
            await pool.query(`
                INSERT INTO "${getTableName('System_Settings')}" (setting_key, setting_value, updated_by, updated_at)
                VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
                ON CONFLICT (setting_key) DO UPDATE SET setting_value = $2, updated_by = $3, updated_at = CURRENT_TIMESTAMP
            `, [key, String(value), updatedBy]);
        }

        res.json({ success: true, message: 'Settings updated successfully' });
    } catch (err) {
        console.error('Error updating settings:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// GET /api/settings/throttle - Get throttle settings (used by campaign controller, no admin required)
app.get('/api/settings/throttle', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT setting_key, setting_value FROM "${getTableName('System_Settings')}" 
            WHERE setting_key IN ('total_throttle_cpm', 'campaign_throttle_cpm', 'calls_throttle_cpm')
        `);
        const throttle = { total: 4, campaign: 2, calls: 2 }; // defaults
        result.rows.forEach(row => {
            if (row.setting_key === 'total_throttle_cpm') throttle.total = parseInt(row.setting_value);
            if (row.setting_key === 'campaign_throttle_cpm') throttle.campaign = parseInt(row.setting_value);
            if (row.setting_key === 'calls_throttle_cpm') throttle.calls = parseInt(row.setting_value);
        });
        res.json({ success: true, throttle });
    } catch (err) {
        console.error('Error fetching throttle settings:', err.message);
        res.json({ success: true, throttle: { total: 4, campaign: 2, calls: 2 } }); // fallback defaults
    }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    await initDatabase();
    console.log(`✅ Server running on port ${PORT} (${APP_ENV} mode)`);
});
