/**
 * User Model - Sequelize Definition
 * Manages user accounts with authentication and authorization
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { getTableName, APP_ENV } = require('../config/tables');

const User = sequelize.define('User', {
    user_id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
        allowNull: false
    },
    email: {
        type: DataTypes.STRING(255),
        allowNull: false,
        unique: true,
        validate: {
            isEmail: true
        }
    },
    password_hash: {
        type: DataTypes.STRING(255),
        allowNull: false
    },
    role: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'user',
        validate: {
            isIn: [['admin', 'manager', 'user']]
        }
    },
    subscription_tier: {
        type: DataTypes.STRING(50),
        allowNull: false,
        defaultValue: 'free',
        validate: {
            isIn: [['free', 'pro', 'enterprise']]
        }
    },
    is_active: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    must_change_password: {
        type: DataTypes.BOOLEAN,
        defaultValue: true
    },
    last_login: {
        type: DataTypes.DATE,
        allowNull: true
    },
    created_by: {
        type: DataTypes.UUID,
        allowNull: true,
        references: {
            model: APP_ENV === 'test' ? 'test_users' : 'Users',
            key: 'user_id'
        }
    }
}, {
    tableName: APP_ENV === 'test' ? 'test_users' : 'Users',
    timestamps: true,
    underscored: true,
    indexes: [
        {
            unique: true,
            fields: ['email']
        },
        {
            fields: ['role']
        },
        {
            fields: ['is_active']
        }
    ]
});

// Instance methods
User.prototype.toSafeObject = function () {
    const { password_hash, ...safeUser } = this.toJSON();
    return safeUser;
};

module.exports = User;
