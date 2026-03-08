import express from 'express';
import pg from 'pg';

const router = express.Router();
const { Pool } = pg;
const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false
});

const getTableName = (baseTableName) => {
    return process.env.APP_ENV === 'test' ? `test_${baseTableName.toLowerCase()}` : baseTableName;
};

// Middleware to mock verify token (assuming it's handled globally or you can pass user_id)
// We'll trust req.user extracted from token
const verifyToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    if (!authHeader) return res.status(401).send('Unauthorized');
    const token = authHeader.split(' ')[1];
    import('jsonwebtoken').then(jwt => {
        jwt.default.verify(token, process.env.JWT_SECRET || 'your-super-secret-jwt-key-change-this-in-production-2026', (err, user) => {
            if (err) return res.status(403).send('Invalid Token');
            req.user = user;
            next();
        });
    });
};

// Get notifications
router.get('/', verifyToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        const result = await pool.query(
            `SELECT * FROM "${getTableName('Notifications')}" WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
            [userId]
        );
        res.json({ success: true, notifications: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Mark single notification as read
router.patch('/:id/read', verifyToken, async (req, res) => {
    try {
        const { id } = req.params;
        const userId = req.user.userId;
        await pool.query(
            `UPDATE "${getTableName('Notifications')}" SET is_read = TRUE WHERE id = $1 AND user_id = $2`,
            [id, userId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

// Mark all notifications as read
router.patch('/read-all', verifyToken, async (req, res) => {
    try {
        const userId = req.user.userId;
        await pool.query(
            `UPDATE "${getTableName('Notifications')}" SET is_read = TRUE WHERE user_id = $1`,
            [userId]
        );
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

export default router;
