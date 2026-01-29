# ✅ COMPLETE SETUP GUIDE - Testing Environment

## Current Status

✅ **You're currently in PRODUCTION mode** - your dashboard is working with real data
✅ **Production data is safe** - nothing has been changed
⏳ **Test environment needs setup** - we'll do this now

---

## STEP-BY-STEP: Set Up Testing Environment

### STEP 1: Restart Frontend to See Data (NOW)

Your frontend is running but needs to reload the .env file:

```powershell
# In the terminal running npm start:
Ctrl+C
npm start
```

You should now see your dashboard with data!

---

### STEP 2: Create Test Tables (Manual - Safest Way)

Open **Azure Portal** → Your PostgreSQL Database → **Query Editor**

Run this SQL:

```sql
-- Create test tables (exact copies of production structure)
CREATE TABLE test_Agents (LIKE "Agents" INCLUDING ALL);
CREATE TABLE test_Sessions (LIKE "Sessions" INCLUDING ALL);
CREATE TABLE test_Conversations (LIKE "Conversations" INCLUDING ALL);

-- Copy all production data to test tables  
INSERT INTO test_Agents SELECT * FROM "Agents";
INSERT INTO test_Sessions SELECT * FROM "Sessions";
INSERT INTO test_Conversations SELECT * FROM "Conversations";

-- Verify the copy
SELECT 'Production Agents' as source, COUNT(*) as count FROM "Agents"
UNION ALL
SELECT 'Test Agents', COUNT(*) FROM test_Agents
UNION ALL
SELECT 'Production Sessions', COUNT(*) FROM "Sessions"
UNION ALL
SELECT 'Test Sessions', COUNT(*) FROM test_Sessions;
```

You should see matching counts!

---

### STEP 3: Switch to Test Mode When Ready

**When you want to test your log normalization changes:**

1. **Update both .env files:**
   ```env
   # backend/.env
   APP_ENV=test
   
   # frontend/.env
   APP_ENV=test
   ```

2. **Restart services:**
   - Frontend: Ctrl+C, then `npm start`
   - Backend: Ctrl+C, then `npm run sync`

3. **Verify logs show:**
   ```
   📊 Environment: test
   📋 Tables: test_Agents, test_Sessions, test_Conversations
   ```

4. **Test safely!** Your changes only affect test tables

---

### STEP 4: Switch Back to Production

**When done testing:**

1. **Update both .env files back:**
   ```env
   APP_ENV=production
   ```

2. **Restart services**

3. **Your production data is untouched!**

---

## Why This Approach?

✅ **Production data stays safe** - completely separate tables  
✅ **Easy switching** - just change one variable  
✅ **Same database** - cost-efficient  
✅ **Full isolation** - test without fear

---

## Alternative: Script-Based Setup (If SQL doesn't work)

If you can't access Azure Portal Query Editor, we can fix the Node.js script. But the SQL method above is the safest and most reliable.

---

## Next Steps

1. ✅ Restart frontend now (you're in production mode)
2. ✅ Verify dashboard shows data
3. ⏳ Run the SQL in Azure Portal when ready
4. ⏳ Switch to test mode when you want to test

**Your production data is completely safe!** 🎉
