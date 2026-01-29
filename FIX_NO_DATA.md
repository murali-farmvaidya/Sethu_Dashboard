# 🚨 Data Not Showing - Quick Fix Guide

## Current Situation
- ✅ Both backend and frontend are set to `APP_ENV=test`
- ❌ Dashboard shows no data
- ⏸️  Sync was interrupted

## ✅ **Solution (3 Easy Steps)**

### **Step 1: Copy Production Data**

Open a **NEW PowerShell terminal** in the backend folder and run:

```powershell
cd c:\Users\mural\db\Sethu_Dashboard\backend
node scripts/copy-to-test.js
```

Wait for it to complete. You should see:
```
✅ COPY COMPLETE!
📊 Final counts:
   test_Agents: X
   test_Sessions: Y
   test_Conversations: Z
```

---

### **Step 2: Restart Frontend Server**

1. In the terminal running `npm start`, press **Ctrl+C**
2. Then run again:
   ```powershell
   npm start
   ```

You should see in the startup logs:
```
📊 Frontend API Environment: test
📋 Tables: test_Agents, test_Sessions, test_Conversations
```

---

### **Step 3: Refresh Dashboard**

- Open your browser
- Go to the dashboard
- Press **Ctrl+Shift+R** (hard refresh)
- Data should now appear!

---

## 🔍 **If Still No Data**

### Check 1: Verify Test Tables Have Data

Run this to check:
```powershell
cd backend
node scripts/check-tables.js
```

Then run this to count records:
```powershell
node -e "const {sequelize} = require('./src/config/database'); async function check() { await sequelize.authenticate(); const [r1] = await sequelize.query('SELECT COUNT(*) FROM test_Agents'); const [r2] = await sequelize.query('SELECT COUNT(*) FROM test_Sessions'); console.log('test_Agents:', r1[0].count); console.log('test_Sessions:', r2[0].count); await sequelize.close(); } check();"
```

Should show numbers, not zeros.

---

### Check 2: Verify Frontend is Using Test Mode

Look at the frontend terminal when it starts. You should see:
```
📊 Frontend API Environment: test
```

If you see `production` instead, the frontend didn't reload the .env file.

**Fix:** Stop and restart the frontend server.

---

### Check 3: Browser Cache

Sometimes the browser caches old API responses.

**Fix:**
1. Open browser DevTools (F12)
2. Go to Network tab  
3. Check "Disable cache"
4. Refresh page (Ctrl+Shift+R)

---

## 🎯 **Alternative: Switch Back to Production**

If testing with test tables is causing issues, you can quickly switch back to production data:

**Both .env files** (backend and frontend):
```env
APP_ENV=production
```

Then restart both servers. You'll see your production data immediately.

---

## 📞 **Still Having Issues?**

Run this diagnostic command:
```powershell
cd backend
echo "Backend .env:" && type .env | findstr APP_ENV
echo ""
echo "Frontend .env:" && type ..\frontend\.env | findstr APP_ENV
echo ""
node scripts/check-tables.js
```

This will show:
1. What environment both .env files are set to
2. What tables exist in the database
