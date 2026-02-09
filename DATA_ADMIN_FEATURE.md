# Data Admin Feature - Complete Implementation Guide

## Overview
This feature provides **Super Admin** users with special powers to manage and delete data from the dashboard, with the critical requirement that **deleted items will NOT be re-synced** from the Pipecat API.

## Key Features

### 1. **Delete Operations** (Super Admin Only)
- ✅ Delete individual sessions
- ✅ Delete agents (and all their sessions/conversations)
- ✅ Delete conversations

### 2. **Edit Operations** (Super Admin Only)
- ✅ Edit conversation summaries

### 3. **Exclusion System**
- **Critical Feature**: When an item is deleted, it's added to an `Excluded_Items` table
- The sync service checks this table before syncing
- Excluded items are **permanently** skipped during sync
- Can be restored if needed (allowing re-sync)

## Database Schema

### New Table: `Excluded_Items`
```sql
CREATE TABLE "Excluded_Items" (
    id SERIAL PRIMARY KEY,
    item_type TEXT NOT NULL,           -- 'agent', 'session', or 'conversation'
    item_id TEXT NOT NULL,             -- The ID of the excluded item
    excluded_by TEXT NOT NULL,         -- User ID who excluded this
    excluded_at TIMESTAMP DEFAULT NOW,
    reason TEXT,                       -- Optional reason
    UNIQUE(item_type, item_id)
)
```

## API Endpoints

All endpoints require **Super Admin** role authentication.

### Delete Operations
- `DELETE /api/data-admin/sessions/:sessionId` - Delete a session and exclude from sync
- `DELETE /api/data-admin/agents/:agentId` - Delete agent and all related data
  
### Edit Operations
- `PATCH /api/data-admin/conversations/:sessionId/summary` - Update summary
  - Request body: `{ "summary": "New summary text" }`

### Exclusion Management
- `GET /api/data-admin/excluded` - View all excluded items
- `DELETE /api/data-admin/excluded/:itemType/:itemId` - Restore item (allow re-sync)

## How It Works

### Deletion Flow
1. **Super Admin** clicks delete on a session/agent
2. Frontend calls the delete endpoint
3. Backend:
   - Deletes from database (Sessions, Conversations, Agents tables)
   - Adds entry to `Excluded_Items` table
   - Returns success
4. **Sync Service** on next cycle:
   - Loads exclusion list at start
   - Skips any excluded items
   - Does NOT re-insert deleted data

### Sync Protection
The sync service has been modified in two key functions:

#### `syncAgents()`:
```javascript
// Loads excluded agents
const excludedAgents = await sequelize.query(`
    SELECT item_id FROM "Excluded_Items" WHERE item_type = 'agent'
`);

// Skips excluded agents
if (excludedAgentIds.has(agent.id)) {
    logger.debug(`Skipping excluded agent: ${agent.name}`);
    continue;
}
```

#### `syncSessions()`:
```javascript
// Loads excluded sessions once at start
const excludedSessions = await sequelize.query(`
    SELECT item_id FROM "Excluded_Items" WHERE item_type = 'session'
`);

// Skips excluded sessions
if (excludedSessionIds.has(session.sessionId)) {
    logger.debug(`Skipping excluded session: ${session.sessionId}`);
    continue;
}
```

## Usage Examples

### Example 1: Delete a Session
```javascript
// DELETE /api/data-admin/sessions/abc123
// Headers: Authorization: Bearer <super_admin_token>

// Response:
{
  "success": true,
  "message": "Session deleted and excluded from future syncs"
}
```

### Example 2: Delete an Agent
```javascript
// DELETE /api/data-admin/agents/my-agent-id
// Response:
{
  "success": true,
  "message": "Agent and all related data deleted and excluded from future syncs",
  "sessionCount": 42  // Number of sessions deleted
}
```

### Example 3: Edit Summary
```javascript
// PATCH /api/data-admin/conversations/abc123/summary
// Body: { "summary": "Customer inquired about product pricing." }

// Response:
{
  "success": true,
  "message": "Summary updated successfully"
}
```

### Example 4: View Excluded Items
```javascript
// GET /api/data-admin/excluded
// Response:
{
  "success": true,
  "excluded": [
    {
      "id": 1,
      "item_type": "session",
      "item_id": "abc123",
      "excluded_by": "admin_1",
      "excluded_at": "2026-02-06T10:30:00Z",
      "reason": "Deleted by data admin"
    },
    // ... more items
  ]
}
```

### Example 5: Restore (Un-exclude) an Item
```javascript
// DELETE /api/data-admin/excluded/session/abc123
// Response:
{
  "success": true,
  "message": "session abc123 will be re-synced on next cycle"
}
```

## Security
- **Role Check**: All endpoints verify user has `super_admin` role
- **Authentication**: JWT token required
- **Audit Trail**: All operations logged with user ID and timestamp

## Files Modified

### Backend
1. `backend/src/models/ExcludedItem.js` - New model
2. `backend/src/controllers/data.admin.controller.js` - New controller
3. `backend/src/routes/data.admin.routes.js` - New routes
4. `backend/src/server.js` - Route registration
5. `backend/scripts/sync-realtime.js` - Exclusion checks added

### Frontend Server
1. `frontend/server/index.js`:
   - Added `Excluded_Items` table initialization
   - Added all data admin API endpoints
   - Integrated with existing auth middleware

## Testing Checklist

- [ ] Super Admin can delete a session
- [ ] Deleted session is NOT re-synced
- [ ] Super Admin can delete an agent
- [ ] Deleting an agent also deletes all its sessions/conversations
- [ ] All deleted items appear in exclusion list
- [ ] Super Admin can edit summaries
- [ ] Restored items re-appear after next sync
- [ ] Non-super-admin users get 403 error

## Deployment Notes

1. **Database Migration**: 
   - The `Excluded_Items` table is created automatically on server startup
   - Safe to deploy - uses `CREATE TABLE IF NOT EXISTS`

2. **Restart Required**:
   - Backend sync service must restart to pick up exclusion checks
   - Frontend server must restart for new endpoints

3. **No Data Loss**:
   - Existing data is not affected
   - Only new deletions will be tracked

## Future Enhancements (Optional)

- [ ] Add UI page for data admin operations
- [ ] Bulk delete operations
- [ ] Soft delete with restore capability
- [ ] Export deleted items before permanent deletion
- [ ] Add "reason" field when deleting
- [ ] Email notification when items are deleted
