/**
 * Express API Server for User Management
 * Provides authentication and user management endpoints
 */

const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
require('dotenv').config();

const logger = require('./utils/logger');
const { testConnection } = require('./config/database');

// Import routes
const authRoutes = require('./routes/auth.routes');
const setupRoutes = require('./routes/setup.routes');
const adminRoutes = require('./routes/admin.routes');
const userRoutes = require('./routes/user.routes');
const dataAdminRoutes = require('./routes/data.admin.routes');

const app = express();
const PORT = process.env.API_PORT || 8000;

// Middleware
app.use(helmet()); // Security headers
app.use(cors()); // Enable CORS
app.use(express.json()); // Parse JSON bodies
app.use(express.urlencoded({ extended: true })); // Parse URL-encoded bodies

// Request logging middleware
app.use((req, res, next) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API Routes
app.use('/api/setup', setupRoutes);
app.use('/api/auth', authRoutes);
app.use('/api', authRoutes); // Fallback for /api/login, /api/me etc.
app.use('/api/admin', adminRoutes);
app.use('/api/user', userRoutes);
app.use('/api/data-admin', dataAdminRoutes);

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        error: 'Endpoint not found'
    });
});

// Error handler
app.use((err, req, res, next) => {
    logger.error('Server error:', err.message);
    res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
});

// Start server
async function startServer() {
    try {
        // Test database connection
        await testConnection();

        app.listen(PORT, () => {
            logger.info(`🚀 API Server running on port ${PORT}`);
            logger.info(`📍 Health check: http://localhost:${PORT}/health`);
            logger.info(`🔧 Setup endpoint: http://localhost:${PORT}/api/setup/init`);
            logger.info(`🔐 Auth endpoint: http://localhost:${PORT}/api/auth/login`);
        });
    } catch (error) {
        logger.error('Failed to start server:', error.message);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', () => {
    logger.info('Shutting down gracefully...');
    process.exit(0);
});

// Start the server
startServer();

module.exports = app;
