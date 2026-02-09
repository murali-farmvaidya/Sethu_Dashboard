/**
 * Excluded Items Model
 * Tracks items that should be excluded from sync (deleted by admin)
 */

const { DataTypes } = require('sequelize');
const { sequelize } = require('../config/database');
const { getTableName } = require('../config/tables');

const ExcludedItem = sequelize.define('ExcludedItem', {
    id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true
    },
    item_type: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'Type of item: agent, session, or conversation'
    },
    item_id: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'The ID of the excluded item'
    },
    excluded_by: {
        type: DataTypes.STRING,
        allowNull: false,
        comment: 'User ID who excluded this item'
    },
    excluded_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    reason: {
        type: DataTypes.TEXT,
        allowNull: true,
        comment: 'Optional reason for exclusion'
    }
}, {
    tableName: getTableName('Excluded_Items'),
    timestamps: false,
    underscored: true,
    indexes: [
        {
            unique: true,
            fields: ['item_type', 'item_id']
        },
        {
            fields: ['item_id']
        }
    ]
});

module.exports = ExcludedItem;
