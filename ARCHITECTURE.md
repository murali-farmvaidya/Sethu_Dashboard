# Environment Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Azure PostgreSQL Database                    │
│                  (sethu-admin.postgres.database.azure.com)      │
│                                                                  │
│  ┌──────────────────────────┐  ┌──────────────────────────┐   │
│  │   PRODUCTION TABLES      │  │      TEST TABLES         │   │
│  │                          │  │                          │   │
│  │  • Agents                │  │  • test_Agents           │   │
│  │  • Sessions              │  │  • test_Sessions         │   │
│  │  • Conversations         │  │  • test_Conversations    │   │
│  │                          │  │                          │   │
│  │  [Live User Data]        │  │  [Testing Data]          │   │
│  └──────────────────────────┘  └──────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                    ▲                           ▲
                    │                           │
        ┌───────────┴───────────┐   ┌──────────┴───────────┐
        │                       │   │                      │
        │   APP_ENV=production  │   │   APP_ENV=test       │
        │                       │   │                      │
        └───────────────────────┘   └──────────────────────┘
```

## Data Flow

### Production Mode (APP_ENV=production)
```
┌─────────────┐
│  Backend    │  APP_ENV=production
│  Sync Script├──────┐
└─────────────┘      │
                     ▼
              ┌─────────────┐
              │   Agents    │
              │  Sessions   │
              │Conversations│
              └─────────────┘
                     ▲
                     │
┌─────────────┐      │
│  Frontend   │  APP_ENV=production
│  API Server ├──────┘
└─────────────┘
```

### Test Mode (APP_ENV=test)
```
┌─────────────┐
│  Backend    │  APP_ENV=test
│  Sync Script├──────┐
└─────────────┘      │
                     ▼
              ┌─────────────┐
              │test_Agents  │
              │test_Sessions│
              │test_Convers.│
              └─────────────┘
                     ▲
                     │
┌─────────────┐      │
│  Frontend   │  APP_ENV=test
│  API Server ├──────┘
└─────────────┘
```

## Key Concepts

### ✅ Correct Configuration
```
Backend:  APP_ENV=test
Frontend: APP_ENV=test
Result:   Both use test_* tables ✓
```

### ❌ Incorrect Configuration
```
Backend:  APP_ENV=production
Frontend: APP_ENV=test
Result:   Backend writes to production, Frontend reads from test ✗
```

### 🔄 Switching Environments

**Step 1:** Update both .env files
```bash
# backend/.env
APP_ENV=test

# frontend/.env  
APP_ENV=test
```

**Step 2:** Restart services
```bash
# Backend
cd backend
npm run sync  # or your sync command

# Frontend
cd frontend
npm run dev
```

**Step 3:** Verify logs
```
📊 Environment: test
📋 Tables: test_Agents, test_Sessions, test_Conversations
```

## Use Cases

| Scenario | Backend ENV | Frontend ENV | Tables Used |
|----------|-------------|--------------|-------------|
| 🚀 **Production** | production | production | Agents, Sessions, Conversations |
| 🧪 **Testing** | test | test | test_Agents, test_Sessions, test_Conversations |
| 👨‍💻 **Local Dev** | test | test | test_Agents, test_Sessions, test_Conversations |
| ⚠️ **DO NOT DO** | production | test | Mismatch - will break! |
