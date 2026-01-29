# Environment-Based Table Configuration

## Overview

This system allows you to safely test the dashboard without affecting production data by using **separate database tables** for testing and production environments.

## How It Works

The system uses the `APP_ENV` environment variable to dynamically switch between two sets of tables:

### Production Mode (`APP_ENV=production`)
- Uses tables: `Agents`, `Sessions`, `Conversations`
- This is your **live production data**
- Default mode if `APP_ENV` is not set

### Test Mode (`APP_ENV=test`)
- Uses tables: `test_Agents`, `test_Sessions`, `test_Conversations`
- This is your **isolated testing environment**
- Safe for experimentation and development

## Setup Instructions

### 1. For Testing

**Backend (`backend/.env`):**
```env
APP_ENV=test
```

**Frontend (`frontend/.env`):**
```env
APP_ENV=test
```

### 2. For Production

**Backend (`backend/.env`):**
```env
APP_ENV=production
```

**Frontend (`frontend/.env`):**
```env
APP_ENV=production
```

## Important Notes

⚠️ **CRITICAL**: Both frontend and backend `APP_ENV` **must match** or you'll query different tables!

✅ **Benefits:**
- ✨ Test safely without affecting live data
- 💰 Use the same cloud database (cost-efficient)
- 🔄 Easy switching between environments
- 🚀 No separate database setup needed

## Usage Examples

### Scenario 1: Testing New Log Normalization Logic

1. Set both `.env` files to `APP_ENV=test`
2. Restart both backend and frontend servers
3. Run your tests - data goes to `test_*` tables
4. Check logs to confirm:
   ```
   📊 Environment: test
   📋 Tables: test_Agents, test_Sessions, test_Conversations
   ```
5. When satisfied, switch back to `production`

### Scenario 2: Deployed Production System

1. Keep `APP_ENV=production` (or remove the line - production is default)
2. Your live system uses `Agents`, `Sessions`, `Conversations`
3. Users see real data

### Scenario 3: Parallel Testing While Live

1. **Production deployment**: `APP_ENV=production`
2. **Local development**: `APP_ENV=test`
3. Both can run simultaneously on the same database
4. No interference between environments

## First Time Setup

When you first switch to `APP_ENV=test`, the system will:
1. Create the `test_Agents`, `test_Sessions`, `test_Conversations` tables automatically
2. These tables start empty - they are independent from production
3. Run your sync script to populate test data

## Verification

After changing `APP_ENV`, check the logs on startup:

**Backend:**
```
📊 Environment: test
📋 Tables: test_Agents, test_Sessions, test_Conversations
```

**Frontend:**
```
📊 Frontend API Environment: test
📋 Tables: test_Agents, test_Sessions, test_Conversations
```

## Database Schema

Both table sets have identical structures. The test tables are complete duplicates:

```
Agents → test_Agents
Sessions → test_Sessions  
Conversations → test_Conversations
```

## Best Practices

1. **Always check environment** before running tests
2. **Match frontend and backend** `APP_ENV` values
3. **Document which environment** you're using in team communications
4. **Clear test data periodically** to keep database clean
5. **Never test on production** (`APP_ENV=production`)

## Troubleshooting

### Problem: No data appears after switching to test mode
**Solution**: The test tables are initially empty. Run the sync script to populate them.

### Problem: Frontend shows different data than expected  
**Solution**: Check that frontend and backend `.env` files have matching `APP_ENV` values.

### Problem: Changes appear in production when testing
**Solution**: Verify `APP_ENV=test` is set in BOTH `.env` files and servers were restarted.

## Code Implementation

The system uses a centralized table naming function:

```javascript
// backend/src/config/tables.js
function getTableName(baseTableName) {
    const APP_ENV = process.env.APP_ENV || 'production';
    return APP_ENV === 'test' ? `test_${baseTableName}` : baseTableName;
}
```

This is used throughout:
- Sequelize model definitions
- Raw SQL queries in API routes
- Database sync scripts

## Rollback to Previous Behavior

If you need to remove this feature:
1. Remove `APP_ENV` from both `.env` files
2. The system defaults to `production` mode
3. Only `Agents`, `Sessions`, `Conversations` tables are used
