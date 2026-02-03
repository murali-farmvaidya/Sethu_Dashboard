const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { getTableName } = require('../config/tables');

const Session = sequelize.define('Session', {
    session_id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    agent_id: DataTypes.STRING,
    agent_name: DataTypes.STRING,
    started_at: DataTypes.DATE,
    ended_at: DataTypes.DATE,
    status: DataTypes.STRING,
    bot_start_seconds: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    cold_start: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    duration_seconds: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    last_synced: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    cost: DataTypes.FLOAT,
    custom_data: DataTypes.JSONB,
    // New Fields
    service_id: DataTypes.STRING,
    org_id: DataTypes.STRING,
    deployment_id: DataTypes.STRING,
    cluster: DataTypes.STRING,
    conversation_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    }
}, {
    tableName: getTableName('Sessions'),
    timestamps: false,
    underscored: true
});

module.exports = Session;
