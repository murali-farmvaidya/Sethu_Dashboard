# How to Copy Production Data to Test Tables

## Quick Steps

1. **Wait for sync to complete** (it's running now and will create test tables)

2. **Once sync is running smoothly**, run the copy script:
   ```bash
   cd backend
   node scripts/copy-to-test.js
   ```

3. **Verify the copy worked** - the script will show you a comparison table

## Alternative: Manual SQL Method

If you prefer to run SQL directly in Azure Portal:

1. Go to Azure Portal → Your PostgreSQL database → Query editor

2. Run this SQL:
   ```sql
   -- Copy Agents
   INSERT INTO test_Agents SELECT * FROM "Agents"
   ON CONFLICT (agent_id) DO NOTHING;

   -- Copy Sessions  
   INSERT INTO test_Sessions SELECT * FROM "Sessions"
   ON CONFLICT (session_id) DO NOTHING;

   -- Copy Conversations
   INSERT INTO test_Conversations SELECT * FROM "Conversations"
   ON CONFLICT (session_id) DO NOTHING;
   
   -- Verify
   SELECT 'Agents' as t, COUNT(*) FROM "Agents"
   UNION ALL SELECT 'test_Agents', COUNT(*) FROM test_Agents;
   ```

## What's Happening Now

Your sync script is running with `APP_ENV=test`, so it's:
1. Creating test_Agents, test_Sessions, test_Conversations tables
2. Starting to sync data into those tables

**You have two options:**

### Option A: Let it sync naturally
- Just let the current sync run
- It will populate test tables with fresh data from Pipecat API
- Takes a bit longer but gets latest data

### Option B: Copy existing production data  
- Stop the sync (Ctrl+C)
- Run `node scripts/copy-to-test.js`
- Restart sync with test data already populated

## Recommendation

**I recommend Option A** - let the sync finish its current cycle. It's already creating the test tables and fetching data. Once it completes one full cycle, you'll have test data ready to use!

Check the sync logs - once you see "✅ Synced X conversations", you're good to go!
