/**
 * PasswordResetToken Model - Sequelize Definition
 * Manages password reset requests
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { getTableName, APP_ENV } = require('../config/tables');

const PasswordResetToken = sequelize.define('PasswordResetToken', {
    token_id: {
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
    token: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true
    },
    expires_at: {
        type: DataTypes.DATE,
        allowNull: false
    },
    used: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: APP_ENV === 'test' ? 'test_passwordresettokens' : 'PasswordResetTokens',
    timestamps: false,
    underscored: true,
    indexes: [
        {
            unique: true,
            fields: ['token']
        },
        {
            fields: ['user_id']
        },
        {
            fields: ['expires_at']
        }
    ]
});

// Instance method to check if token is valid
PasswordResetToken.prototype.isValid = function () {
    return !this.used && new Date() < this.expires_at;
};

module.exports = PasswordResetToken;
