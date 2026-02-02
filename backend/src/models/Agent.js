const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { getTableName } = require('../config/tables');

const Agent = sequelize.define('Agent', {
    agent_id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    session_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    total_duration: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    last_synced: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    // Enhanced Metadata
    project_id: { type: DataTypes.STRING },
    region: { type: DataTypes.STRING },
    created_at_pipecat: { type: DataTypes.DATE },

    // Config/Deployment details
    min_instances: { type: DataTypes.INTEGER, defaultValue: 0 },
    max_instances: { type: DataTypes.INTEGER, defaultValue: 1 },

    // Status
    status: { type: DataTypes.STRING, defaultValue: 'active' }
}, {
    tableName: getTableName('Agents'),
    timestamps: false
});

module.exports = Agent;
