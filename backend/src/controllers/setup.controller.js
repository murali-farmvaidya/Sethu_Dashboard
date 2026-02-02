/**
 * Setup Controller
 * Handles initial system setup and database initialization
 */

const User = require('../models/User');
const UserAgentAssignment = require('../models/UserAgentAssignment');
const AuditLog = require('../models/AuditLog');
const PasswordResetToken = require('../models/PasswordResetToken');
const { hashPassword } = require('../utils/password');
const logger = require('../utils/logger');

/**
 * Initialize user management tables and create default admin
 * POST /api/setup/init
 */
async function initializeSystem(req, res) {
    try {
        logger.info('🚀 Initializing user management system...');

        // Import sequelize instance
        const { sequelize } = require('../config/database');

        // Sync all models at once (this creates tables if they don't exist)
        await sequelize.sync();

        logger.info(`✅ All tables created/verified:`);
        logger.info(`   - ${User.tableName}`);
        logger.info(`   - ${UserAgentAssignment.tableName}`);
        logger.info(`   - ${AuditLog.tableName}`);
        logger.info(`   - ${PasswordResetToken.tableName}`);

        // Check for default admin
        const adminEmail = 'admin@sethu.ai';
        let adminCreated = false;
        let adminExists = false;

        const existingAdmin = await User.findOne({ where: { email: adminEmail } });

        if (!existingAdmin) {
            const defaultPassword = 'Admin@123';
            const passwordHash = await hashPassword(defaultPassword);

            await User.create({
                email: adminEmail,
                password_hash: passwordHash,
                role: 'admin',
                is_active: true,
                must_change_password: false
            });

            adminCreated = true;
            logger.info('✅ Default admin user created');
        } else {
            adminExists = true;
            logger.info('✅ Default admin user already exists');
        }

        logger.info('🎉 User management system initialized successfully!');

        res.json({
            success: true,
            message: 'User management system initialized successfully',
            tables: {
                Users: User.tableName,
                UserAgentAssignments: UserAgentAssignment.tableName,
                AuditLogs: AuditLog.tableName,
                PasswordResetTokens: PasswordResetToken.tableName
            },
            admin: {
                created: adminCreated,
                alreadyExists: adminExists,
                email: adminCreated ? adminEmail : undefined,
                temporaryPassword: adminCreated ? 'Admin@123' : undefined,
                warning: adminCreated ? 'CHANGE THIS PASSWORD IMMEDIATELY!' : undefined
            },
            nextSteps: [
                'Update EMAIL_USER and EMAIL_PASSWORD in .env for email functionality',
                'Change JWT_SECRET to a strong random value in production',
                adminCreated ? 'Login with admin@sethu.ai / Admin@123 and change the password' : 'Login with your existing admin credentials'
            ]
        });

    } catch (error) {
        logger.error('❌ System initialization failed:', error.message);
        res.status(500).json({
            success: false,
            error: 'System initialization failed',
            details: error.message
        });
    }
}

/**
 * Check system status
 * GET /api/setup/status
 */
async function getSystemStatus(req, res) {
    try {
        const userCount = await User.count();
        const adminCount = await User.count({ where: { role: 'admin' } });
        const assignmentCount = await UserAgentAssignment.count();

        res.json({
            success: true,
            status: {
                initialized: userCount > 0,
                userCount,
                adminCount,
                assignmentCount,
                tables: {
                    Users: User.tableName,
                    UserAgentAssignments: UserAgentAssignment.tableName,
                    AuditLogs: AuditLog.tableName,
                    PasswordResetTokens: PasswordResetToken.tableName
                }
            }
        });
    } catch (error) {
        logger.error('Status check failed:', error.message);
        res.status(500).json({
            success: false,
            error: 'Status check failed',
            details: error.message
        });
    }
}

module.exports = {
    initializeSystem,
    getSystemStatus
};
