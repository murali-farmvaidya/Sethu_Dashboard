/**
 * Initialize User Management Tables
 * Run this script to create all necessary tables for user authentication
 */

const path = require('path');
require('dotenv').config();
const { sequelize, testConnection } = require(path.join(__dirname, '../src/config/database'));
const { getTableName, logEnvironmentInfo } = require(path.join(__dirname, '../src/config/tables'));
const logger = require(path.join(__dirname, '../src/utils/logger'));

// Import all models
const User = require(path.join(__dirname, '../src/models/User'));
const UserAgentAssignment = require(path.join(__dirname, '../src/models/UserAgentAssignment'));
const AuditLog = require(path.join(__dirname, '../src/models/AuditLog'));
const PasswordResetToken = require(path.join(__dirname, '../src/models/PasswordResetToken'));
const { hashPassword } = require(path.join(__dirname, '../src/utils/password'));

async function initializeUserTables() {
    logger.info('🚀 Starting User Management Table Initialization');
    logEnvironmentInfo();

    try {
        // Test database connection
        await testConnection();

        // Sync tables in order (Users first, then others with foreign keys)
        logger.info('📦 Creating/Updating tables...');

        // Create Users table first
        await User.sync({ alter: true });
        logger.info(`✅ ${User.tableName} table created/updated`);

        // Then create tables with foreign keys to Users
        await UserAgentAssignment.sync({ alter: true });
        logger.info(`✅ ${UserAgentAssignment.tableName} table created/updated`);

        await AuditLog.sync({ alter: true });
        logger.info(`✅ ${AuditLog.tableName} table created/updated`);

        await PasswordResetToken.sync({ alter: true });
        logger.info(`✅ ${PasswordResetToken.tableName} table created/updated`);

        // Create default admin user if not exists
        logger.info('👤 Checking for default admin user...');
        const adminEmail = 'admin@sevak.ai';
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

            logger.info('✅ Default admin user created:');
            logger.info(`   Email: ${adminEmail}`);
            logger.info(`   Password: ${defaultPassword}`);
            logger.info('   ⚠️  CHANGE THIS PASSWORD IN PRODUCTION!');
        } else {
            logger.info('✅ Default admin user already exists');
        }

        logger.info('🎉 User Management System initialized successfully!');
        logger.info('');
        logger.info('Next steps:');
        logger.info('1. Update EMAIL_USER and EMAIL_PASSWORD in .env for email functionality');
        logger.info('2. Change JWT_SECRET to a strong random value in production');
        logger.info('3. Login with admin@sevak.ai / Admin@123 and change the password');

        process.exit(0);

    } catch (error) {
        logger.error('❌ Initialization failed:', error.message);
        if (error.original) {
            logger.error('Database error:', error.original.message);
        }
        logger.error(error.stack);
        process.exit(1);
    }
}

initializeUserTables();
