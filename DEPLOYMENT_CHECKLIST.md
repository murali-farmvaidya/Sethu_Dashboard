# Deployment Checklist

Use this checklist when deploying or testing to ensure correct environment setup.

## Before Testing (Local Development)

- [ ] Set `APP_ENV=test` in `backend/.env`
- [ ] Set `APP_ENV=test` in `frontend/.env`
- [ ] Restart backend sync service
- [ ] Restart frontend server
- [ ] Verify logs show: `Environment: test`
- [ ] Verify logs show: `Tables: test_Agents, test_Sessions, test_Conversations`
- [ ] Test functionality
- [ ] Verify data appears in `test_*` tables (not production tables)

## Before Production Deployment

- [ ] Set `APP_ENV=production` in `backend/.env`
- [ ] Set `APP_ENV=production` in `frontend/.env`
- [ ] Verify both .env files match
- [ ] Test locally first if possible
- [ ] Deploy backend
- [ ] Deploy frontend
- [ ] Verify logs show: `Environment: production`
- [ ] Verify logs show: `Tables: Agents, Sessions, Conversations`
- [ ] Smoke test: Check dashboard loads
- [ ] Smoke test: Verify data is production data
- [ ] Monitor for errors in first 10 minutes

## Environment Verification Commands

### Check Backend Environment
```bash
cd backend
grep APP_ENV .env
```
Expected: `APP_ENV=production` or `APP_ENV=test`

### Check Frontend Environment
```bash
cd frontend
grep APP_ENV .env
```
Expected: `APP_ENV=production` or `APP_ENV=test`

### Verify They Match
```bash
# Run this from project root
echo "Backend:" && grep APP_ENV backend/.env
echo "Frontend:" && grep APP_ENV frontend/.env
```

## Common Mistakes to Avoid

❌ **DO NOT:**
- Mix environments (backend=production, frontend=test)
- Forget to restart services after changing .env
- Test directly on `APP_ENV=production`
- Deploy without verifying .env files

✅ **DO:**
- Always match frontend and backend `APP_ENV`
- Restart services after changing .env
- Test on `APP_ENV=test` first
- Double-check .env before deploying

## Rollback Procedure

If something goes wrong in production:

1. [ ] Check logs for errors
2. [ ] Verify `APP_ENV=production` in both .env files
3. [ ] Verify deployment used correct .env files
4. [ ] If needed, deploy previous working version
5. [ ] Investigation on `APP_ENV=test` environment

## Testing the Configuration

### Quick Test (Development)

1. Set both to `APP_ENV=test`
2. Restart services
3. Open dashboard
4. Create/sync some test data
5. Query database directly:
   ```sql
   SELECT COUNT(*) FROM test_Agents;
   SELECT COUNT(*) FROM Agents;
   ```
   - `test_Agents` should have data
   - `Agents` should be unchanged

### Production Verification

1. Set both to `APP_ENV=production`
2. Deploy/restart services
3. Open dashboard
4. Verify familiar production data appears
5. Query database:
   ```sql
   SELECT COUNT(*) FROM Agents;
   ```
   - Should show production data

## Emergency Contacts

If you encounter issues:

1. **Check logs first** - they show which environment is active
2. **Verify .env files** - make sure they match
3. **Database console** - check which tables have data
4. **Rollback if needed** - use previous deployment

## Notes Section

Use this space to track your deployments:

```
Date: __________ 
Deployed By: __________
Environment: [ ] Production [ ] Test
Backend version: __________
Frontend version: __________
Notes: _________________________________________________
__________________________________________________________
```

---

**Remember:** When in doubt, check the logs! They always show which environment and tables are being used. 📊
