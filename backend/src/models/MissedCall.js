const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');

const MissedCall = sequelize.define('MissedCall', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    user_id: {
        type: DataTypes.UUID,
        allowNull: false
    },
    call_sid: {
        type: DataTypes.STRING(100),
        allowNull: false
    },
    from_number: {
        type: DataTypes.STRING(20),
        allowNull: true
    },
    to_number: {
        type: DataTypes.STRING(20),
        allowNull: true
    },
    status: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    detailed_status: {
        type: DataTypes.STRING(100),
        allowNull: true
    },
    error_message: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    disconnected_by: {
        type: DataTypes.STRING(50),
        allowNull: true
    },
    record_url: {
        type: DataTypes.STRING(255),
        allowNull: true
    },
    timestamp: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'MissedCalls',
    timestamps: true,
    underscored: true
});

module.exports = MissedCall;
