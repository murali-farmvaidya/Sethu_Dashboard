import 'dotenv/config';
import express from 'express';
import pg from 'pg';
import cors from 'cors';
import axios from 'axios';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import jwt from 'jsonwebtoken';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_FILE = path.join(__dirname, 'users.json');

const { Pool } = pg;
const app = express();
app.use(cors());
app.use(express.json());

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

// Table Configuration (Matches backend)
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

const JWT_SECRET = process.env.JWT_SECRET || 'your-default-dev-secret-do-not-use-in-prod';


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

        console.log('✅ Database tables initialized/verified');

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

// OpenAI Configuration
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

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
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000
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
            if (user.created_by) {
                const creatorResult = await pool.query(
                    `SELECT is_active FROM "${getTableName('Users')}" WHERE user_id = $1`,
                    [user.created_by]
                );
                const creator = creatorResult.rows[0];
                if (creator && !creator.is_active) {
                    return res.status(401).json({ success: false, message: 'Organization account is deactivated. Please contact your administrator.' });
                }
            }

            const token = jwt.sign(
                { userId: user.user_id, email: user.email, role: user.role },
                JWT_SECRET,
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
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded.userId;
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
            if (isEffectiveActive && user.created_by) {
                const creatorResult = await pool.query(`SELECT is_active, role FROM "${getTableName('Users')}" WHERE user_id = $1`, [user.created_by]);
                const creator = creatorResult.rows[0];
                if (creator && !creator.is_active) {
                    isEffectiveActive = false;
                    const actor = creator.role === 'admin' ? 'Admin' : 'Super Admin';
                    // If my creator is an Admin and he got deactivated, it was likely by a Super Admin.
                    // But for the end user, they just need to know their Admin is down.
                    deactivationReason = `Your Organization Admin has been deactivated.`;
                }
            }

            res.json({
                user: {
                    id: user.user_id,
                    username: user.email,
                    email: user.email,
                    role: user.role,
                    isActive: isEffectiveActive,
                    deactivationReason: deactivationReason
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
        const decoded = jwt.verify(token, JWT_SECRET);
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

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        requesterId = decoded.userId;
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
        const userRes = await pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [requesterId]);
        const user = userRes.rows[0];
        if (!user) return res.status(401).json({ error: 'User not found' });

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const sortBy = req.query.sortBy || 'agent_id';
        const sortOrder = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';
        const search = req.query.search || '';
        const offset = (page - 1) * limit;

        let baseQuery = `FROM "${getTableName('Agents')}" a`;
        let whereClauses = [];
        let params = [];

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
        const finalSortBy = sortBy === 'session_count' ? 'computed_session_count' : `a."${sortBy}"`;

        const dataQuery = `
            SELECT a.*, 
            (SELECT COUNT(*) FROM "${getTableName('Sessions')}" s WHERE s.agent_id = a.agent_id) as computed_session_count,
            (SELECT COALESCE(SUM(duration_seconds), 0) FROM "${getTableName('Sessions')}" s WHERE s.agent_id = a.agent_id AND s.started_at >= '2026-01-01') as computed_total_duration
            ${baseQuery}
            ${whereSql}
            ORDER BY ${finalSortBy} ${sortOrder}
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;

        const countTotalQuery = `SELECT COUNT(a.*) ${baseQuery} ${whereSql}`;

        const [dataResult, countResult] = await Promise.all([
            pool.query(dataQuery, [...params, limit, offset]),
            pool.query(countTotalQuery, params)
        ]);

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

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        requesterId = decoded.userId;
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
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

        const agentRes = await pool.query(`SELECT * FROM "${getTableName('Agents')}" WHERE agent_id = $1`, [agentId]);
        if (agentRes.rows.length === 0) {
            return res.status(404).json({ error: 'Agent not found' });
        }

        res.json(agentRes.rows[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get Stats (Global) - Cached
let statsCache = null;
let statsCacheTime = 0;
const STATS_CACHE_DURATION = 30000;

app.get('/api/stats', async (req, res) => {
    try {
        const now = Date.now();
        if (statsCache && (now - statsCacheTime) < STATS_CACHE_DURATION) {
            return res.json(statsCache);
        }

        const [agentsRes, sessionsRes, completedRes, durationRes] = await Promise.all([
            pool.query(`SELECT COUNT(*) FROM "${getTableName('Agents')}"`),
            pool.query(`SELECT COUNT(*) FROM "${getTableName('Sessions')}"`),
            pool.query(`SELECT COUNT(*) FROM "${getTableName('Sessions')}" WHERE status = 'HTTP_COMPLETED'`),
            pool.query(`SELECT SUM(duration_seconds) as total_duration FROM "${getTableName('Sessions')}"`)
        ]);

        const totalAgents = parseInt(agentsRes.rows[0].count);
        const totalSessions = parseInt(sessionsRes.rows[0].count);
        const completedSessions = parseInt(completedRes.rows[0].count);
        const totalDuration = parseInt(durationRes.rows[0].total_duration || 0);

        statsCache = {
            totalAgents,
            totalSessions,
            totalDuration,
            successRate: totalSessions > 0 ? ((completedSessions / totalSessions) * 100).toFixed(1) : 0
        };
        statsCacheTime = now;

        res.json(statsCache);
    } catch (error) {
        console.error("Error fetching stats:", error);
        res.status(500).json({ error: error.message });
    }
});

// Get Sessions for Agent
app.get('/api/sessions', async (req, res) => {
    const { agent_id, page = 1, limit = 10, sortBy = 'session_id', sortOrder = 'desc', search = '' } = req.query;
    if (!agent_id) return res.status(400).json({ error: "Agent ID required" });

    try {
        const pageNum = parseInt(page);
        const limitNum = parseInt(limit);
        const offset = (pageNum - 1) * limitNum;
        const dbSortOrder = sortOrder === 'asc' ? 'ASC' : 'DESC';

        // Join with Conversations to get summary
        let query = `
            SELECT s.*, c.summary 
            FROM "${getTableName('Sessions')}" s 
            LEFT JOIN "${getTableName('Conversations')}" c ON s.session_id = c.session_id
            WHERE s.agent_id = $1
        `;
        let params = [agent_id];
        let paramCount = 1;

        if (search) {
            paramCount++;
            query += ` AND s.session_id ILIKE $${paramCount}`;
            params.push(`%${search}%`);
        }

        const countQuery = `SELECT COUNT(*) FROM "${getTableName('Sessions')}" WHERE agent_id = $1 ${search ? `AND session_id ILIKE $2` : ''}`;

        // Agent specific stats query
        const agentStatsQuery = `
            SELECT 
                COUNT(*) as total_sessions,
                SUM(duration_seconds) as total_duration,
                COUNT(*) FILTER (WHERE status = 'HTTP_COMPLETED') as success_sessions,
                COUNT(*) FILTER (WHERE conversation_count = 0 OR conversation_count IS NULL) as zero_turn_sessions
            FROM "${getTableName('Sessions')}"
            WHERE agent_id = $1
        `;

        query += ` ORDER BY s."${sortBy}" ${dbSortOrder} LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(limitNum, offset);

        const [dataRes, countRes, agentStatsRes] = await Promise.all([
            pool.query(query, params),
            pool.query(countQuery, params.slice(0, paramCount)),
            pool.query(agentStatsQuery, [agent_id])
        ]);

        const totalAgentSessions = parseInt(agentStatsRes.rows[0].total_sessions || 0);
        const successAgentSessions = parseInt(agentStatsRes.rows[0].success_sessions || 0);
        const zeroTurnSessions = parseInt(agentStatsRes.rows[0].zero_turn_sessions || 0);
        const totalDuration = parseInt(agentStatsRes.rows[0].total_duration || 0);

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

// Generate Summary for a Session (on-demand)
app.post('/api/conversation/:sessionId/generate-summary', async (req, res) => {
    const { sessionId } = req.params;

    if (!OPENAI_API_KEY) {
        return res.status(500).json({ error: 'OpenAI API key not configured' });
    }

    try {
        // Fetch conversation
        const convResult = await pool.query(`SELECT * FROM "${getTableName('Conversations')}" WHERE session_id = $1`, [sessionId]);
        if (convResult.rows.length === 0) {
            return res.status(404).json({ error: 'Conversation not found' });
        }

        const conversation = convResult.rows[0];
        const turns = conversation.turns || [];

        if (turns.length === 0) {
            return res.status(400).json({ error: 'No conversation turns to summarize' });
        }

        // Format conversation for the prompt
        const conversationText = turns.map((t) => {
            let text = `User: ${t.user_message || '(empty)'}`;
            if (t.assistant_message) {
                text += `\nAssistant: ${t.assistant_message}`;
            }
            return text;
        }).join('\n---\n');

        const systemPrompt = `You are an expert at summarizing customer service conversations.
Write a simple, easy-to-understand summary in 50 words or less.

IMPORTANT LANGUAGE INSTRUCTION:
- Analyze the language(s) used in the conversation below
- If the user speaks primarily in Telugu, write the summary in Telugu
- If the user speaks primarily in Hindi, write the summary in Hindi  
- If the user speaks primarily in English, write the summary in English
- If multiple languages are used, choose the language the USER spoke the most
- The summary MUST be in the same language as the user's primary language

Focus on: what the user asked about, what help was given, and how it ended.
Avoid technical words. Be clear and friendly.`;

        // Call OpenAI
        const openaiResponse = await axios.post(
            OPENAI_API_URL,
            {
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: conversationText }
                ],
                max_tokens: 100,
                temperature: 0.3
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        const summary = openaiResponse.data?.choices?.[0]?.message?.content?.trim();

        if (!summary) {
            return res.status(500).json({ error: 'Failed to generate summary' });
        }

        // Save to database
        await pool.query(`UPDATE "${getTableName('Conversations')}" SET summary = $1 WHERE session_id = $2`, [summary, sessionId]);

        res.json({ summary });
    } catch (error) {
        console.error('Summary generation error:', error.message);
        res.status(500).json({ error: 'Failed to generate summary: ' + error.message });
    }
});

// Get Conversation (Details)
app.get('/api/conversation/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    try {
        const result = await pool.query(`SELECT * FROM "${getTableName('Conversations')}" WHERE session_id = $1`, [sessionId]);
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
        res.json(result.rows[0]);
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

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        requesterId = decoded.userId;
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
        const reqUserRes = await pool.query(`SELECT role, user_id FROM "${getTableName('Users')}" WHERE user_id = $1`, [requesterId]);
        const reqUser = reqUserRes.rows[0];

        if (!reqUser) return res.status(401).json({ error: 'User not found' });

        let query = `
            SELECT u.*, 
            (SELECT COUNT(*) FROM "${getTableName('User_Agents')}" ua WHERE ua.user_id = u.user_id) as agent_count,
            creator.email as creator_email
            FROM "${getTableName('Users')}" u
            LEFT JOIN "${getTableName('Users')}" creator ON u.created_by = creator.user_id
        `;
        let whereClauses = [];
        let params = [];

        if (reqUser.role === 'admin') {
            whereClauses.push(`(u.created_by = $${params.length + 1} OR u.user_id = $${params.length + 1})`);
            params.push(requesterId);
        } else if (reqUser.role !== 'super_admin') {
            whereClauses.push(`u.user_id = $${params.length + 1}`);
            params.push(requesterId);
        }

        // Additional filters from query
        if (req.query.role) {
            whereClauses.push(`u.role = $${params.length + 1}`);
            params.push(req.query.role);
        }
        if (req.query.createdBy && req.query.createdBy !== 'all') {
            whereClauses.push(`u.created_by = $${params.length + 1}`);
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

        query += ` LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
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

        for (let user of users) {
            if (user.role === 'super_admin') {
                user.agents = allAgentIds;
                user.agentCount = allAgentIds.length;
            } else if (user.role === 'admin' && reqUser.role === 'super_admin') {
                // For super_admin viewing an admin, show that admin's specifically assigned agents
                const agentIds = await pool.query(`SELECT agent_id FROM "${getTableName('User_Agents')}" WHERE user_id = $1`, [user.user_id]);
                user.agents = agentIds.rows.map(r => r.agent_id);
                user.agentCount = user.agents.length;
            } else if (user.role === 'admin' && user.user_id === requesterId) {
                // For admin viewing themselves, show their assigned agents
                const agentIds = await pool.query(`SELECT agent_id FROM "${getTableName('User_Agents')}" WHERE user_id = $1`, [user.user_id]);
                user.agents = agentIds.rows.map(r => r.agent_id);
                user.agentCount = user.agents.length;
            } else {
                // Regular users or users managed by an admin
                const agentIds = await pool.query(`SELECT agent_id FROM "${getTableName('User_Agents')}" WHERE user_id = $1`, [user.user_id]);
                user.agents = agentIds.rows.map(r => r.agent_id);
                user.agentCount = user.agents.length;
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
        const decoded = jwt.verify(token, JWT_SECRET);
        requesterId = decoded.userId;
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { email, role, subscriptionTier, agents } = req.body;
    const user_id = `user_${Date.now()}`;
    const password = 'Password123!';

    try {
        const reqUserRes = await pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [requesterId]);
        const reqUser = reqUserRes.rows[0];

        if (!reqUser) return res.status(401).json({ error: 'Requester not found' });

        // Hierarchy Check
        if (reqUser.role === 'admin' && (role === 'super_admin' || role === 'admin')) {
            return res.status(403).json({ error: 'Admins can only create regular users.' });
        }
        if (reqUser.role === 'user') {
            return res.status(403).json({ error: 'Users cannot create other users.' });
        }

        console.log(`👤 Creating user: ${email} (Role: ${role}, Created by: ${requesterId})`);
        // Create User
        await pool.query(`
            INSERT INTO "${getTableName('Users')}" 
            (user_id, email, password_hash, role, subscription_tier, is_active, must_change_password, created_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [user_id, email, password, role || 'user', subscriptionTier || 'free', true, true, requesterId, new Date(), new Date()]);

        // Assign Agents
        if (agents && agents.length > 0) {
            for (const agentId of agents) {
                await pool.query(`
                    INSERT INTO "${getTableName('User_Agents')}" (user_id, agent_id)
                    VALUES ($1, $2)
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
                        <h3>Welcome to FarmVaidya!</h3>
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
    const { role, subscriptionTier, isActive } = req.body;
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    const token = authHeader.split(' ')[1];
    let requesterId = null;

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        requesterId = decoded.userId;
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
        const [reqUserRes, targetUserRes] = await Promise.all([
            pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [requesterId]),
            pool.query(`SELECT role, created_by FROM "${getTableName('Users')}" WHERE user_id = $1`, [userId])
        ]);

        const reqUser = reqUserRes.rows[0];
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
            updates.push(`role = $${params.length + 1}`);
            params.push(role);
        }
        if (subscriptionTier) {
            updates.push(`subscription_tier = $${params.length + 1}`);
            params.push(subscriptionTier);
        }
        if (isActive !== undefined) {
            updates.push(`is_active = $${params.length + 1}`);
            params.push(isActive);
        }

        updates.push(`updated_at = $${params.length + 1}`);
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
        jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { agentId } = req.body;

    try {
        await pool.query(`
            INSERT INTO "${getTableName('User_Agents')}" (user_id, agent_id)
            VALUES ($1, $2) ON CONFLICT DO NOTHING
        `, [userId, agentId]);

        const agents = await pool.query(`SELECT agent_id FROM "${getTableName('User_Agents')}" WHERE user_id = $1`, [userId]);
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
        jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    const { agents } = req.body; // Expects array of agent IDs

    try {
        await pool.query(`DELETE FROM "${getTableName('User_Agents')}" WHERE user_id = $1`, [userId]);

        if (agents && agents.length > 0) {
            for (const agentId of agents) {
                await pool.query(`
                    INSERT INTO "${getTableName('User_Agents')}" (user_id, agent_id)
                    VALUES ($1, $2)
                `, [userId, agentId]);
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
    let requesterId = null;

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        requesterId = decoded.userId;
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
        const [reqResult, targetResult] = await Promise.all([
            pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [requesterId]),
            pool.query(`SELECT email, created_by, role FROM "${getTableName('Users')}" WHERE user_id = $1`, [userId])
        ]);

        const requester = reqResult.rows[0];
        const target = targetResult.rows[0];

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
                            <h3>${childSubject}</h3>
                            <p>${childMessage}</p>
                            <p>If you believe this is an error, please contact support.</p>
                        `
                    }).catch(e => console.error(`Failed to send delete email to ${child.email}:`, e));
                });
            }

            // Delete Child Users
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
                    <h3>${subject}</h3>
                    <p>${message}</p>
                `
            }).catch(e => console.error(`Failed to send delete email to ${target.email}:`, e));
        }

        // Delete the Target User
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
        const decoded = jwt.verify(token, JWT_SECRET);
        requesterId = decoded.userId;
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
        const [reqResult, targetResult] = await Promise.all([
            pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [requesterId]),
            pool.query(`SELECT * FROM "${getTableName('Users')}" WHERE user_id = $1`, [userId])
        ]);

        const requester = reqResult.rows[0];
        const user = targetResult.rows[0];

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
                    <h3>${subject}</h3>
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
        const decoded = jwt.verify(tokenFromReq, JWT_SECRET);
        requesterId = decoded.userId;
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
        const [reqResult, targetResult] = await Promise.all([
            pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [requesterId]),
            pool.query(`SELECT email, created_by, role FROM "${getTableName('Users')}" WHERE user_id = $1`, [userId])
        ]);

        const requester = reqResult.rows[0];
        const user = targetResult.rows[0];

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

        const resetLink = `${process.env.FRONTEND_URL || 'http://localhost:5173'}/reset-password/${token}`;

        if (process.env.SMTP_HOST) {
            try {
                await transporter.sendMail({
                    from: process.env.SMTP_FROM || '"FarmVaidya Admin" <admin@farmvaidya.ai>',
                    to: user.email,
                    subject: 'Reset Your Password - Sevak Dashboard',
                    html: `
                        <h3>Password Reset Request</h3>
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
        const decoded = jwt.verify(token, JWT_SECRET);
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
            whereClauses.push(`ua.user_id = $${queryParams.length + 1}`);
            queryParams.push(userId);
        }

        if (search) {
            whereClauses.push(`(a.name ILIKE $${queryParams.length + 1} OR a.agent_id ILIKE $${queryParams.length + 1})`);
            queryParams.push(`%${search}%`);
        }

        const whereSql = whereClauses.length > 0 ? ` WHERE ` + whereClauses.join(' AND ') : '';

        // Get total count
        const countRes = await pool.query(`SELECT COUNT(*) ${baseQuery} ${whereSql}`, queryParams);
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
        jwt.verify(authHeader.split(' ')[1], JWT_SECRET);
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    try {
        const result = await pool.query(`
            SELECT DISTINCT u.user_id, u.email 
            FROM "${getTableName('Users')}" u
            WHERE u.user_id IN (SELECT DISTINCT created_by FROM "${getTableName('Users')}")
            OR u.role IN ('super_admin', 'admin')
        `);
        res.json({ creators: result.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    await initDatabase();
    console.log(`Server running on port ${PORT}`);
});
