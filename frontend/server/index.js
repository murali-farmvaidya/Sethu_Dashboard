import 'dotenv/config';
import express from 'express';
import pg from 'pg';
import cors from 'cors';
import axios from 'axios';

const { Pool } = pg;
const app = express();
app.use(cors());
app.use(express.json());

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
console.log(`📋 Tables: ${getTableName('Agents')}, ${getTableName('Sessions')}, ${getTableName('Conversations')}`);

// OpenAI Configuration
const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

// --- DATABASE CONNECTION ---
// --- DATABASE CONNECTION ---
const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 5,
    connectionTimeoutMillis: 30000,
    idleTimeoutMillis: 30000
});

pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
    process.exit(-1);
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

// Login (Mock)
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === 'admin@farmvaidya.ai' && password === 'FarmVaidya@2026!Admin') {
        res.json({ success: true, token: 'mock-token-123', user: { username } });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

// Get Agents with Pagination and Sorting
app.get('/api/agents', async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const sortBy = req.query.sortBy || 'agent_id';
        const sortOrder = req.query.sortOrder === 'asc' ? 'ASC' : 'DESC';
        const search = req.query.search || '';
        const offset = (page - 1) * limit;

        // Build Query with quoted table names for case-sensitivity
        let countQuery = `
            SELECT a.*, 
            (SELECT COUNT(*) FROM "${getTableName('Sessions')}" s WHERE s.agent_id = a.agent_id) as computed_session_count 
            FROM "${getTableName('Agents')}" a
        `;
        let whereClause = '';
        let params = [];

        if (search) {
            whereClause = `WHERE a.name ILIKE $1 OR a.agent_id ILIKE $1`;
            params.push(`%${search}%`);
        }

        const finalSortBy = sortBy === 'session_count' ? 'computed_session_count' : `a."${sortBy}"`;

        const dataQuery = `
            ${countQuery} 
            ${whereClause}
            ORDER BY ${finalSortBy} ${sortOrder}
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;

        const countTotalQuery = `SELECT COUNT(*) FROM "${getTableName('Agents')}" a ${whereClause}`;

        const queryParams = [...params, limit, offset];

        const [dataResult, countResult] = await Promise.all([
            pool.query(dataQuery, queryParams),
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
    } catch (error) {
        console.error("Error fetching agents:", error);
        res.status(500).json({ error: error.message });
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

// Start Server
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Server running on port ${PORT}`);
});
