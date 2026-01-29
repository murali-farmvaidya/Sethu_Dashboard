# Quick Reference: Testing vs Production

## Switch to Testing Mode

**Both files need this change:**

### `backend/.env`
```env
APP_ENV=test
```

### `frontend/.env`
```env
APP_ENV=test
```

**Then restart both servers**

---

## Switch to Production Mode  

**Both files need this change:**

### `backend/.env`
```env
APP_ENV=production
```

### `frontend/.env`
```env
APP_ENV=production
```

**Then restart both servers**

---

## What This Does

| Mode | Backend Tables | Frontend Queries | Use Case |
|------|---------------|------------------|----------|
| **production** | `Agents`, `Sessions`, `Conversations` | Same tables | Live deployment |
| **test** | `test_Agents`, `test_Sessions`, `test_Conversations` | Same test tables | Safe testing |

---

## Verification

After changing and restarting, check console logs:

```
📊 Environment: test
📋 Tables: test_Agents, test_Sessions, test_Conversations
```

---

## ⚠️ Important Rules

1. **Always match** `APP_ENV` in both backend and frontend
2. **Always restart** servers after changing `.env`
3. **Never test on** `APP_ENV=production` when experimenting

---

For full details, see [ENVIRONMENT_SETUP.md](./ENVIRONMENT_SETUP.md)
