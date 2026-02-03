/**
 * AuditLog Model - Sequelize Definition
 * Tracks user actions for security and compliance
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { getTableName, APP_ENV } = require('../config/tables');

const AuditLog = sequelize.define('AuditLog', {
    log_id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    user_id: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: APP_ENV === 'test' ? 'test_users' : 'Users',
            key: 'user_id'
        },
        onDelete: 'SET NULL'
    },
    action: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    resource_type: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    resource_id: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    ip_address: {
        type: DataTypes.STRING(45),
        allowNull: true
    },
    user_agent: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    metadata: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: {}
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: APP_ENV === 'test' ? 'test_auditlogs' : 'AuditLogs',
    timestamps: false,
    underscored: true,
    indexes: [
        {
            fields: ['user_id']
        },
        {
            fields: ['action']
        },
        {
            fields: ['created_at']
        },
        {
            fields: ['resource_type', 'resource_id']
        }
    ]
});

module.exports = AuditLog;
