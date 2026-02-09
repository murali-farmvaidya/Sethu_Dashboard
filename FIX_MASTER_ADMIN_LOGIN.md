# URGENT FIX: Master Admin Login Redirect Issue

## Problem
The master admin login succeeds, but immediately redirects back to the login page because the `/api/me` endpoint doesn't recognize the master admin.

## Solution
Add master admin handling to the `/api/me` endpoint in `frontend/server/index.js`

## Step-by-Step Fix

### 1. Find the `/api/me` endpoint

Open `frontend/server/index.js` and search for one of these patterns:
- `/api/me`
- `app.get('/api/me'`
- `Get Current User`
- `getProfile`

### 2. Add Master Admin Check

RIGHT AFTER the JWT verification (after `jwt.verify(token, JWT_SECRET)`), add this code:

```javascript
// ============ MASTER ADMIN CHECK ============
// If this is the master admin, return directly without DB lookup
if (decoded.isMaster && decoded.userId === 'master_root_0') {
    console.log('✅ Master Admin /api/me verification successful');
    return res.json({
        user: {
            id: 'master_root_0',
            username: decoded.email,
            email: decoded.email,
            role: 'super_admin',
            isActive: true,
            deactivationReason: null,
            mustChangePassword: false
        }
    });
}
// ============ END MASTER ADMIN CHECK ============
```

### 3. The Full Context

The `/api/me` endpoint should look something like this after the change:

```javascript
app.get('/api/me', async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'No token' });

    const token = authHeader.split(' ')[1];
    let userId = null;

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded.userId;
        
        // ============ MASTER ADMIN CHECK ============ (ADD THIS!)
        if (decoded.isMaster && decoded.userId === 'master_root_0') {
            console.log('✅ Master Admin /api/me verification successful');
            return res.json({
                user: {
                    id: 'master_root_0',
                    username: decoded.email,
                    email: decoded.email,
                    role: 'super_admin',
                    isActive: true,
                    deactivationReason: null,
                    mustChangePassword: false
                }
            });
        }
        // ============ END MASTER ADMIN CHECK ============
    } catch (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
    }

    // ... rest of the endpoint (database lookup for normal users)
});
```

### 4. Save and Restart

After making this change:
1. Save the file (Ctrl+S)
2. Stop the server (Ctrl+C in the terminal running `npm start`)
3. Restart: `npm start`

### 5. Test

1. Go to http://localhost:5173/login
2. Login with:
   - Email: `root@system.internal`
   - Password: `Sys@2026!Master#Root`
3. Should now stay logged in and redirect to /admin dashboard

## Why This Fixes It

- The `/api/login` endpoint already handles master admin (returns token)
- But after login, the frontend calls `/api/me` to verify the user
- Without this check, `/api/me` fails to find the master admin in the database
- This causes a logout and redirect back to login

## Expected Console Output After Fix

```
[0] 🔐 Master Admin login detected
[0] ✅ Master Admin /api/me verification successful
```

Instead of just:
```
[0] 🔐 Master Admin login detected
[0] 🔐 Master Admin login detected
```
