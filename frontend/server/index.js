import 'dotenv/config';
import express from 'express';
import pg from 'pg';
import cors from 'cors';

const { Pool } = pg;
const app = express();
app.use(cors());
app.use(express.json());

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
    console.log('GET /api/agents - Query:', req.query);
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
            (SELECT COUNT(*) FROM "Sessions" s WHERE s.agent_id = a.agent_id) as computed_session_count 
            FROM "Agents" a
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

        const countTotalQuery = `SELECT COUNT(*) FROM "Agents" a ${whereClause}`;

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

        const [agentsRes, sessionsRes, completedRes] = await Promise.all([
            pool.query('SELECT COUNT(*) FROM "Agents"'),
            pool.query('SELECT COUNT(*) FROM "Sessions"'),
            pool.query("SELECT COUNT(*) FROM \"Sessions\" WHERE status ILIKE '%success%' OR status ILIKE '%completed%' OR status ILIKE '%HTTP_COMPLETED%'")
        ]);

        const totalAgents = parseInt(agentsRes.rows[0].count);
        const totalSessions = parseInt(sessionsRes.rows[0].count);
        const completedSessions = parseInt(completedRes.rows[0].count);

        statsCache = {
            totalAgents,
            totalSessions,
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

        let query = `SELECT * FROM "Sessions" WHERE agent_id = $1`;
        let params = [agent_id];
        let paramCount = 1;

        if (search) {
            paramCount++;
            query += ` AND session_id ILIKE $${paramCount}`;
            params.push(`%${search}%`);
        }

        const countQuery = `SELECT COUNT(*) FROM "Sessions" WHERE agent_id = $1 ${search ? `AND session_id ILIKE $2` : ''}`;

        query += ` ORDER BY "${sortBy}" ${dbSortOrder} LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(limitNum, offset);

        const [dataRes, countRes] = await Promise.all([
            pool.query(query, params),
            pool.query(countQuery, params.slice(0, paramCount))
        ]);

        res.json({
            data: dataRes.rows,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total: parseInt(countRes.rows[0].count),
                totalPages: Math.ceil(parseInt(countRes.rows[0].count) / limitNum)
            }
        });
    } catch (error) {
        console.error("Error fetching sessions:", error);
        res.status(500).json({ error: error.message });
    }
});

// Get Conversation (Details)
app.get('/api/conversation/:sessionId', async (req, res) => {
    const { sessionId } = req.params;
    try {
        const result = await pool.query('SELECT * FROM "Conversations" WHERE session_id = $1', [sessionId]);
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
        const result = await pool.query('SELECT * FROM "Sessions" WHERE session_id = $1', [sessionId]);
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
