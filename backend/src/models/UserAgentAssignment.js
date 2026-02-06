/**
 * UserAgentAssignment Model - Sequelize Definition
 * Maps users to agents with granular permissions
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { getTableName, APP_ENV } = require('../config/tables');

const UserAgentAssignment = sequelize.define('UserAgentAssignment', {
    assignment_id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    user_id: {
        type: DataTypes.UUID,
        allowNull: false,
        references: {
            model: APP_ENV === 'test' ? 'test_users' : 'Users',
            key: 'user_id'
        },
        onDelete: 'CASCADE'
    },
    agent_id: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    can_view_sessions: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    can_view_logs: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    can_view_conversations: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    can_export_data: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    can_mark: {
        type: DataTypes.BOOLEAN,
        defaultValue: false  // Admins must explicitly grant this
    },
    assigned_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    assigned_by: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: APP_ENV === 'test' ? 'test_users' : 'Users',
            key: 'user_id'
        },
        onDelete: 'SET NULL'
    }
}, {
    tableName: APP_ENV === 'test' ? 'test_useragentassignments' : 'UserAgentAssignments',
    timestamps: false,
    underscored: true,
    indexes: [
        {
            unique: true,
            fields: ['user_id', 'agent_id']
        },
        {
            fields: ['user_id']
        },
        {
            fields: ['agent_id']
        }
    ]
});

module.exports = UserAgentAssignment;
