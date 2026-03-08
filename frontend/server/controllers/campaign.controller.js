import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import pg from 'pg';
import jwt from 'jsonwebtoken';
import axios from 'axios';
import exotelService from '../services/exotel.service.js';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize pool with explicit config matching index.js
const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false
});

const APP_ENV = process.env.APP_ENV || 'production';
const getTableName = (baseTableName) => {
    if (APP_ENV === 'test') return `test_${baseTableName.toLowerCase()}`;
    return baseTableName;
};

const getAgentTelephonyConfig = async (agentId) => {
    try {
        const tableName = getTableName('Agent_Telephony_Config');
        const res = await pool.query(`SELECT exophone, app_id FROM "${tableName}" WHERE agent_id = $1`, [agentId]);
        if (res.rows.length > 0) return res.rows[0];
        return null;
    } catch (error) {
        console.error('Error fetching agent telephony config:', error);
        return null;
    }
};

// Fetch campaign line settings from System_Settings
const getCampaignLineSettings = async () => {
    try {
        const tableName = getTableName('System_Settings');
        const result = await pool.query(
            `SELECT setting_key, setting_value FROM "${tableName}" WHERE setting_key IN ('campaign_throttle_cpm', 'total_throttle_cpm', 'calls_throttle_cpm')`
        );
        let campaignLines = 2;
        let totalLines = 4;
        let callsLines = 2;
        result.rows.forEach(r => {
            if (r.setting_key === 'campaign_throttle_cpm') campaignLines = parseInt(r.setting_value) || 2;
            if (r.setting_key === 'total_throttle_cpm') totalLines = parseInt(r.setting_value) || 4;
            if (r.setting_key === 'calls_throttle_cpm') callsLines = parseInt(r.setting_value) || 2;
        });
        return { campaignLines: Math.min(campaignLines, totalLines), totalLines, callsLines };
    } catch (err) {
        console.warn('⚠️ Could not fetch line settings, using defaults:', err.message);
        return { campaignLines: 2, totalLines: 4, callsLines: 2 };
    }
};

// --- Local campaign DB table ---
const LOCAL_CAMPAIGNS_TABLE = getTableName('Local_Campaigns');

const ensureLocalCampaignsTable = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS "${LOCAL_CAMPAIGNS_TABLE}" (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                agent_id TEXT,
                status TEXT DEFAULT 'in-progress',
                total_contacts INTEGER DEFAULT 0,
                completed_calls INTEGER DEFAULT 0,
                failed_calls INTEGER DEFAULT 0,
                call_interval_sec INTEGER DEFAULT 10,
                concurrent_lines INTEGER DEFAULT 2,
                caller_id TEXT,
                app_id TEXT,
                contacts JSONB DEFAULT '[]',
                call_results JSONB DEFAULT '[]',
                date_created TIMESTAMPTZ DEFAULT NOW(),
                date_updated TIMESTAMPTZ DEFAULT NOW(),
                retries JSONB,
                schedule JSONB
            )
        `);
    } catch (err) {
        console.error('Error creating local campaigns table:', err.message);
    }
};
// Initialize table on load
ensureLocalCampaignsTable();

// In-memory map to track active campaign abort signals
const activeCampaigns = new Map(); // campaignId -> { aborted: false }

// --- Helper: make a single call via Exotel V1 API ---
const makeDirectCall = async (number, name, callerId, appId) => {
    const accountSid = process.env.EXOTEL_ACCOUNT_SID || 'farmvaidya1';
    const apiKey = process.env.EXOTEL_API_KEY;
    const apiToken = process.env.EXOTEL_API_TOKEN;
    const subdomain = process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com';

    const url = `https://${subdomain}/v1/Accounts/${accountSid}/Calls/connect.json`;
    const auth = Buffer.from(`${apiKey}:${apiToken}`).toString('base64');
    const flowUrl = `https://my.exotel.com/${accountSid}/exoml/start_voice/${appId}`;

    const params = new URLSearchParams();
    params.append('From', number);
    params.append('CallerId', callerId);
    params.append('Url', flowUrl);
    if (name) params.append('CustomField', name);

    const response = await axios.post(url, params, {
        headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/x-www-form-urlencoded'
        }
    });
    return response.data;
};

// --- Helper: poll Exotel V1 for call status until terminal state ---
const TERMINAL_CALL_STATUSES = new Set(['completed', 'failed', 'busy', 'no-answer', 'canceled', 'not-answered']);

const getCallStatus = async (callSid) => {
    const accountSid = process.env.EXOTEL_ACCOUNT_SID || 'farmvaidya1';
    const apiKey = process.env.EXOTEL_API_KEY;
    const apiToken = process.env.EXOTEL_API_TOKEN;
    const subdomain = process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com';

    const url = `https://${subdomain}/v1/Accounts/${accountSid}/Calls/${callSid}.json`;
    const auth = Buffer.from(`${apiKey}:${apiToken}`).toString('base64');

    const response = await axios.get(url, {
        headers: { 'Authorization': `Basic ${auth}` }
    });
    const call = response.data?.Call || {};
    // Exotel V1 returns Duration (total ring+talk) and ConversationDuration (talk only)
    // Use ConversationDuration if available, fall back to Duration
    const conversationDuration = parseInt(call.ConversationDuration) || 0;
    const totalDuration = parseInt(call.Duration) || 0;
    const duration = conversationDuration > 0 ? conversationDuration : totalDuration;

    return {
        sid: call.Sid,
        status: (call.Status || '').toLowerCase(),
        duration: duration,
        conversationDuration: conversationDuration,
        totalDuration: totalDuration,
        startTime: call.StartTime,
        endTime: call.EndTime,
        price: call.Price,
        direction: call.Direction,
        recordingUrl: call.RecordingUrl || null
    };
};

const waitForCallEnd = async (callSid, signal, maxWaitMs = 300000) => {
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const start = Date.now();
    const pollInterval = 5000; // Poll every 5 seconds

    while (Date.now() - start < maxWaitMs) {
        if (signal.aborted || signal.abort) return { status: 'aborted', duration: 0 };

        try {
            const info = await getCallStatus(callSid);
            if (TERMINAL_CALL_STATUSES.has(info.status)) {
                // Exotel often returns duration=0 right at the moment of completion.
                // Wait 3s and fetch once more to get the finalized duration.
                if (info.duration === 0) {
                    await sleep(3000);
                    try {
                        const finalInfo = await getCallStatus(callSid);
                        console.log(`📊 Call ${callSid} final fetch: status=${finalInfo.status}, duration=${finalInfo.duration}s (conversation=${finalInfo.conversationDuration}s, total=${finalInfo.totalDuration}s)`);
                        return finalInfo;
                    } catch (retryErr) {
                        console.warn(`⚠️ Final duration fetch failed for ${callSid}: ${retryErr.message}`);
                    }
                }
                return info;
            }
            // Call still active (ringing, in-progress, queued, etc.)
        } catch (err) {
            console.warn(`⚠️ Poll error for ${callSid}: ${err.message}`);
        }

        await sleep(pollInterval);
    }

    // Timed out waiting — treat as completed to free the line
    console.warn(`⏰ Call ${callSid} poll timed out after ${maxWaitMs / 1000}s — releasing line`);
    return { status: 'timeout', duration: 0 };
};

// --- Background call processor (slot-based concurrency) ---
const processCampaignCalls = async (campaignId, contacts, callerId, appId, callIntervalSec, concurrentLines, retries, schedule) => {
    const signal = { aborted: false, abort: false };
    activeCampaigns.set(campaignId, signal);

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    let completedCalls = 0;
    let failedCalls = 0;
    const callResults = [];
    const retriesCount = retries?.number_of_retries || 0;
    const retryIntervalMin = retries?.interval_mins || 10;

    // Daily time window helpers
    const getDailyEndMinutes = () => {
        if (!schedule?.daily_end_time) return null;
        const [h, m] = schedule.daily_end_time.split(':').map(Number);
        return h * 60 + m;
    };
    const getDailyStartMinutes = () => {
        if (!schedule?.daily_start_time) return 9 * 60; // default 09:00
        const [h, m] = schedule.daily_start_time.split(':').map(Number);
        return h * 60 + m;
    };
    const isAfterDailyEnd = () => {
        const endMins = getDailyEndMinutes();
        if (endMins === null) return false;
        const now = new Date();
        return (now.getHours() * 60 + now.getMinutes()) >= endMins;
    };
    const waitUntilNextDailyStart = async () => {
        const startMins = getDailyStartMinutes();
        const now = new Date();
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(Math.floor(startMins / 60), startMins % 60, 0, 0);
        const waitMs = tomorrow - now;
        const waitHrs = (waitMs / 3_600_000).toFixed(1);
        console.log(`⏸️ [Campaign ${campaignId}] Daily end time reached. Pausing ${waitHrs}h until ${tomorrow.toLocaleString()}`);
        await pool.query(
            `UPDATE "${LOCAL_CAMPAIGNS_TABLE}" SET status = 'paused-daily', date_updated = NOW() WHERE id = $1`,
            [campaignId]
        ).catch(() => { });

        // Sleep in 1-minute chunks so abort is responsive
        const chunk = 60_000;
        let waited = 0;
        while (waited < waitMs) {
            if (signal.aborted || signal.abort) return;
            await sleep(Math.min(chunk, waitMs - waited));
            waited += chunk;
        }
        await pool.query(
            `UPDATE "${LOCAL_CAMPAIGNS_TABLE}" SET status = 'in-progress', date_updated = NOW() WHERE id = $1`,
            [campaignId]
        ).catch(() => { });
        console.log(`▶️ [Campaign ${campaignId}] Resuming daily calls.`);
    };

    // Slot-based concurrency: track active lines
    let activeLines = 0;

    // Update or insert a call result record (keyed by phone number)
    const updateCallResult = (number, newRecord) => {
        const idx = callResults.findIndex(r => r.number === number);
        if (idx > -1) callResults.splice(idx, 1, newRecord);
        else callResults.push(newRecord);
    };

    console.log(`📞 [Campaign ${campaignId}] Starting slot-based progressive calls: ${contacts.length} contacts, ${concurrentLines} max lines, ${callIntervalSec}s between calls`);

    // Make a single call attempt (no retry loop — caller handles scheduling retries)
    // Returns: { success: bool, shouldRetry: bool, error?: string }
    const processOneAttempt = async (contact, contactIndex, attempt) => {
        try {
            const result = await makeDirectCall(contact.number, contact.first_name, callerId, appId);
            const callSid = result?.Call?.Sid;
            console.log(`📲 [Campaign ${campaignId}] Call ${contactIndex}/${contacts.length} to ${contact.number} initiated (SID: ${callSid}, attempt ${attempt + 1})`);

            if (callSid) {
                const finalStatus = await waitForCallEnd(callSid, signal);
                console.log(`📞 [Campaign ${campaignId}] Call ${contactIndex}/${contacts.length} to ${contact.number} ended: ${finalStatus.status} (${finalStatus.duration}s)`);

                if (finalStatus.status === 'completed' || finalStatus.status === 'timeout') {
                    updateCallResult(contact.number, {
                        number: contact.number,
                        name: contact.first_name,
                        status: 'completed',
                        attempts_done: attempt + 1,
                        call_sid: callSid,
                        duration: finalStatus.duration,
                        exotel_status: finalStatus.status,
                        timestamp: new Date().toISOString()
                    });
                    completedCalls++;
                    return { success: true, shouldRetry: false };
                } else {
                    // Not connected (busy, no-answer, failed, canceled) — line released immediately
                    console.warn(`⚠️ [Campaign ${campaignId}] Call ${contactIndex} to ${contact.number} - ${finalStatus.status} (attempt ${attempt + 1})`);
                    return { success: false, shouldRetry: attempt < retriesCount };
                }
            } else {
                // No SID — treat as initiated (fire-and-forget success)
                updateCallResult(contact.number, {
                    number: contact.number,
                    name: contact.first_name,
                    status: 'completed',
                    attempts_done: attempt + 1,
                    call_sid: null,
                    timestamp: new Date().toISOString()
                });
                completedCalls++;
                return { success: true, shouldRetry: false };
            }
        } catch (callErr) {
            const errMsg = callErr.response?.data?.RestException?.Message || callErr.message;
            console.error(`❌ [Campaign ${campaignId}] Call ${contactIndex}/${contacts.length} to ${contact.number} - FAILED (attempt ${attempt + 1}): ${errMsg}`);
            return { success: false, shouldRetry: attempt < retriesCount, error: errMsg };
        }
    };

    try {
        // pendingQueue: fresh contacts + matured retries ready to call
        // retryHold:   failed contacts waiting for their retry interval to elapse
        const pendingQueue = contacts.map((contact, i) => ({ contact, contactIndex: i + 1, attempt: 0 }));
        const retryHold = []; // { contact, contactIndex, attempt, retryAfter }
        const pendingPromises = [];

        console.log(`📞 [Campaign ${campaignId}] Starting: ${contacts.length} contacts, ${concurrentLines} max lines, ${callIntervalSec}s call interval, ${retriesCount} retries after ${retryIntervalMin}min`);

        while (pendingQueue.length > 0 || retryHold.length > 0 || activeLines > 0) {
            if (signal.aborted || signal.abort) {
                console.log(`⏹️ [Campaign ${campaignId}] Aborted by user`);
                break;
            }

            // Daily time window check
            while (isAfterDailyEnd()) {
                if (signal.aborted || signal.abort) break;
                await waitUntilNextDailyStart();
                if (signal.aborted || signal.abort) break;
            }
            if (signal.aborted || signal.abort) break;

            // Move any matured retries into the pending queue
            const now = Date.now();
            for (let ri = retryHold.length - 1; ri >= 0; ri--) {
                if (retryHold[ri].retryAfter <= now) {
                    const item = retryHold.splice(ri, 1)[0];
                    pendingQueue.push(item);
                    console.log(`🔄 [Campaign ${campaignId}] Retry ${item.attempt}/${retriesCount} for ${item.contact.number} is now due — queued`);
                }
            }

            if (activeLines < concurrentLines && pendingQueue.length > 0) {
                const item = pendingQueue.shift();
                activeLines++;
                const isRetry = item.attempt > 0;
                if (isRetry) {
                    console.log(`🔵 [Campaign ${campaignId}] Line acquired (${activeLines}/${concurrentLines}) — retry ${item.attempt}/${retriesCount} for ${item.contact.number}`);
                } else {
                    console.log(`🔵 [Campaign ${campaignId}] Line acquired (${activeLines}/${concurrentLines}) — calling ${item.contactIndex}/${contacts.length}: ${item.contact.number}`);
                }

                const callPromise = processOneAttempt(item.contact, item.contactIndex, item.attempt)
                    .then(({ success, shouldRetry, error }) => {
                        if (!success && shouldRetry) {
                            // Schedule retry — release line immediately
                            const retryAfter = Date.now() + retryIntervalMin * 60 * 1000;
                            const attemptsDone = item.attempt + 1;
                            const retriesLeft = retriesCount - attemptsDone;
                            console.log(`📅 [Campaign ${campaignId}] Will retry ${item.contact.number} in ${retryIntervalMin}min (attempt ${attemptsDone}/${retriesCount})`);
                            // Write retrying status so UI shows progress immediately
                            updateCallResult(item.contact.number, {
                                number: item.contact.number,
                                name: item.contact.first_name,
                                status: 'retrying',
                                attempts_done: attemptsDone,
                                retries_left: retriesLeft,
                                retry_after: new Date(retryAfter).toISOString(),
                                timestamp: new Date().toISOString()
                            });
                            retryHold.push({ ...item, attempt: attemptsDone, retryAfter });
                        } else if (!success) {
                            // All attempts exhausted
                            failedCalls++;
                            updateCallResult(item.contact.number, {
                                number: item.contact.number,
                                name: item.contact.first_name,
                                status: 'failed',
                                attempts_done: item.attempt + 1,
                                error: error || 'Unknown error',
                                timestamp: new Date().toISOString()
                            });
                        }
                    })
                    .finally(() => {
                        activeLines--;
                        console.log(`🟢 [Campaign ${campaignId}] Line released (${activeLines}/${concurrentLines} in use)`);
                        pool.query(
                            `UPDATE "${LOCAL_CAMPAIGNS_TABLE}" SET completed_calls = $1, failed_calls = $2, call_results = $3, date_updated = NOW() WHERE id = $4`,
                            [completedCalls, failedCalls, JSON.stringify(callResults), campaignId]
                        ).catch(dbErr => console.warn(`⚠️ [Campaign ${campaignId}] DB update error:`, dbErr.message));
                    });

                pendingPromises.push(callPromise);

                // Rate limit only between first-attempt calls (retries fire immediately when due)
                if (!isRetry && (pendingQueue.some(q => q.attempt === 0) || retryHold.length > 0) && !signal.aborted && !signal.abort) {
                    console.log(`⏳ [Campaign ${campaignId}] Waiting ${callIntervalSec}s before next call...`);
                    await sleep(callIntervalSec * 1000);
                }
            } else {
                // Lines busy or nothing ready yet — wait briefly and re-check
                await sleep(2000);
            }
        }

        // Wait for all in-flight calls to settle
        await Promise.allSettled(pendingPromises);

        const finalStatus = (signal.aborted || signal.abort) ? 'paused' : 'completed';
        await pool.query(
            `UPDATE "${LOCAL_CAMPAIGNS_TABLE}" SET status = $1, completed_calls = $2, failed_calls = $3, call_results = $4, date_updated = NOW() WHERE id = $5`,
            [finalStatus, completedCalls, failedCalls, JSON.stringify(callResults), campaignId]
        );

        console.log(`📊 [Campaign ${campaignId}] Complete: ${completedCalls} success, ${failedCalls} failed out of ${contacts.length}`);
    } catch (err) {
        console.error(`❌ [Campaign ${campaignId}] Fatal error:`, err.message);
        try {
            await pool.query(
                `UPDATE "${LOCAL_CAMPAIGNS_TABLE}" SET status = 'failed', call_results = $1, date_updated = NOW() WHERE id = $2`,
                [JSON.stringify(callResults), campaignId]
            );
        } catch (_) { }
    } finally {
        activeCampaigns.delete(campaignId);
    }
};

export const initiateCampaign = async (req, res) => {
    let filePath = req.file?.path;
    const { campaignName, callerId, device_id, agentId, retries, schedule, flowUrl, message, throttle, flowType } = req.body;

    if (!filePath || !campaignName) {
        return res.status(400).json({ error: 'CSV file and Campaign Name are required' });
    }

    // --- 0. Credit Check ---
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        if (filePath && fs.existsSync(filePath)) fs.unlink(filePath, () => { });
        return res.status(401).json({ error: 'No token provided' });
    }

    try {
        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const userId = decoded.userId;

        const tableName = process.env.APP_ENV === 'test' ? 'test_users' : 'Users';
        const userRes = await pool.query(`SELECT minutes_balance, role, created_by, subscription_expiry, is_active FROM "${tableName}" WHERE user_id = $1`, [userId]);
        const user = userRes.rows[0];

        if (!user) throw new Error('User not found');

        let billableUser = user;
        if (user.role === 'user') {
            const parentRes = await pool.query(`SELECT minutes_balance, subscription_expiry, is_active FROM "${tableName}" WHERE user_id = $1`, [user.created_by]);
            if (parentRes.rows[0]) {
                billableUser = parentRes.rows[0];
            }
            if (filePath && fs.existsSync(filePath)) fs.unlink(filePath, () => { });
            return res.status(403).json({ error: 'Users are permitted to inspect campaigns, but cannot create campaigns. Contact your administrator.' });
        }

        const isExempt = user.role === 'super_admin' || userId === 'master_root_0';

        if (!isExempt) {
            if (!billableUser.is_active) throw new Error('Account deactivated');
            if (billableUser.subscription_expiry && new Date(billableUser.subscription_expiry) < new Date()) {
                throw new Error('Subscription expired');
            }

            if ((billableUser.minutes_balance || 0) <= 0) {
                console.warn(`⛔ Campaign blocked for user ${userId} due to insufficient organization credits (Balance: ${billableUser.minutes_balance})`);
                if (filePath && fs.existsSync(filePath)) fs.unlink(filePath, () => { });
                return res.status(403).json({ error: 'Insufficient organization credits! Please contact admin.' });
            }
        }
    } catch (authErr) {
        console.error('Auth/Credit Check Failed:', authErr.message);
        if (filePath && fs.existsSync(filePath)) fs.unlink(filePath, () => { });
        return res.status(401).json({ error: 'Authentication failed or insufficient credits' });
    }

    try {
        console.log(`🚀 Initiating campaign: ${campaignName} (Agent: ${agentId || 'None'})`);

        // --- 1. Normalize CSV (E.164 format) ---
        let fileContent = fs.readFileSync(filePath, 'utf8');
        let lines = fileContent.trim().split(/\r?\n/);

        if (req.file.originalname.match(/\.(xlsx|xls)$/i)) {
            try {
                const workbook = XLSX.readFile(filePath);
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                fileContent = XLSX.utils.sheet_to_csv(worksheet);
                lines = fileContent.trim().split(/\r?\n/);
            } catch (e) {
                throw new Error('Failed to convert Excel file: ' + e.message);
            }
        }

        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const numberIdx = headers.findIndex(h => h.includes('number') || h.includes('phone') || h.includes('mobile'));
        const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('fname') || h.includes('first'));

        if (numberIdx === -1) throw new Error('CSV must have a "number" column');

        const csvContacts = [];
        const uniqueNumbers = new Set();

        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map(c => c.trim());
            if (cols.length <= numberIdx) continue;

            let phone = cols[numberIdx].replace(/\D/g, '');
            let name = nameIdx !== -1 ? cols[nameIdx] : '';

            // Heuristic for Indian numbers
            if (phone.length === 10) phone = '+91' + phone;
            else if (phone.length === 12 && phone.startsWith('91')) phone = '+' + phone;
            else if (phone.length > 10 && !phone.startsWith('+')) phone = '+' + phone;

            if (phone && !uniqueNumbers.has(phone)) {
                uniqueNumbers.add(phone);
                csvContacts.push({ number: phone, first_name: name });
            }
        }

        if (csvContacts.length === 0) throw new Error('No valid contacts found in CSV');
        console.log(`📄 Parsed ${csvContacts.length} unique contacts from CSV.`);

        // --- 2. Resolve Contact SIDs ---
        console.log('🔄 Fetching all contacts from Exotel to resolve SIDs...');
        const existingContacts = await exotelService.getAllContacts();
        console.log(`✅ Fetched ${existingContacts.length} existing contacts.`);

        const existingMap = new Map(); // Last 10 Digits -> SID

        const getLast10 = (num) => {
            if (!num) return '';
            const digits = num.replace(/\D/g, '');
            return digits.length >= 10 ? digits.slice(-10) : digits;
        };

        // Enhanced: Log raw object to debug structure mismatch
        if (existingContacts.length > 0) {
            console.log('🔍 First Existing Contact Raw:', JSON.stringify(existingContacts[0]));
        }

        existingContacts.forEach(c => {
            // Handle potential API structure variations
            const num = c.number || c.Contact?.number || '';
            const sid = c.sid || c.Contact?.sid || c.Sid || c.Contact?.Sid;
            if (num && sid) {
                existingMap.set(getLast10(num), sid);
            }
        });

        // Debug Logging
        if (existingContacts.length > 0) {
            const sample = existingContacts.slice(0, 3).map(c => `${c.number || c.Contact?.number} (${c.sid || c.Contact?.sid})`).join(', ');
            console.log(`🔍 Sample Exotel: ${sample}`);
            console.log(`🔍 Test Key Gen: ${getLast10(existingContacts.length > 0 ? (existingContacts[0].number || existingContacts[0].Contact?.number) : '')}`);
        }

        const sidsToAdd = [];
        const contactsToCreate = [];

        csvContacts.forEach(c => {
            const key = getLast10(c.number);
            if (existingMap.has(key)) {
                console.log(`✅ Match: ${c.number} -> ${existingMap.get(key)}`);
                sidsToAdd.push(existingMap.get(key));
            } else {
                contactsToCreate.push(c);
            }
        });

        console.log(`🔍 Analysis: ${sidsToAdd.length} existing match, ${contactsToCreate.length} to create/fetch.`);

        // --- 3. Create New Contacts ---
        if (contactsToCreate.length > 0) {
            console.log(`📡 Creating ${contactsToCreate.length} contacts...`);
            const creationResponse = await exotelService.createContacts(contactsToCreate);
            const responseData = creationResponse.data || creationResponse;

            console.log('📦 Creation Response:', JSON.stringify(responseData));

            // CRITICAL FIX: Handle Exotel V2 response wrapper { response: [...] }
            let results = [];
            if (Array.isArray(responseData)) {
                results = responseData;
            } else if (responseData.response && Array.isArray(responseData.response)) {
                results = responseData.response;
            } else if (responseData.data && Array.isArray(responseData.data)) {
                // Fallback
                results = responseData.data;
            }

            if (results.length > 0) {
                results.forEach(r => {
                    // Check for success (200) OR Duplicate (409) - both return SID in 'data'
                    if ((r.code === 200 || r.code === 409) && r.data && r.data.sid) {
                        const prefix = r.code === 409 ? '♻️ Duplicate (Resolved)' : '✅ Created';
                        console.log(`${prefix}: ${r.data.sid}`);
                        sidsToAdd.push(r.data.sid);
                    } else if (r.sid) {
                        // Direct object fallback
                        sidsToAdd.push(r.sid);
                    } else {
                        console.warn('⚠️ Result entry failed:', JSON.stringify(r));
                    }
                });
            } else if (responseData && responseData.sid) {
                // Single object fallback
                sidsToAdd.push(responseData.sid);
            }
        }

        if (sidsToAdd.length === 0) {
            console.error('❌ FATAL: No SIDs resolved.');
            throw new Error('No valid contacts available for campaign (all failed or empty).');
        }

        // --- 4. Build contacts array from CSV (skip Exotel list/campaign) ---
        const campaignContacts = csvContacts.map(c => ({
            number: c.number,
            first_name: c.first_name || ''
        }));

        // --- 5. Get agent telephony config ---
        let agentAppId = null;
        let agentExophone = null;
        if (agentId) {
            const agentConfig = await getAgentTelephonyConfig(agentId);
            if (agentConfig) {
                console.log(`📞 Agent Config: App ${agentConfig.app_id}, Exo ${agentConfig.exophone}`);
                agentAppId = agentConfig.app_id;
                agentExophone = agentConfig.exophone;
            }
        }

        if (!agentAppId) {
            throw new Error('Agent telephony not configured (no app_id). Please configure Exophone first.');
        }

        const effectiveCallerId = callerId || agentExophone;
        if (!effectiveCallerId) {
            throw new Error('No caller ID or Exophone configured.');
        }

        // --- 6. Determine call interval and concurrent lines ---
        const lineSettings = await getCampaignLineSettings();
        let callIntervalSec = 10; // default
        if (throttle) {
            // throttle comes as CPM from frontend, convert to seconds interval
            const cpm = Math.max(1, parseInt(throttle));
            callIntervalSec = Math.max(5, Math.ceil(60 / cpm));
        }
        const concurrentLines = lineSettings.campaignLines;
        console.log(`⚙️ Campaign lines: ${concurrentLines}, Call interval: ${callIntervalSec}s`);

        let parsedRetries = undefined;
        let parsedSchedule = undefined;
        try {
            if (retries) parsedRetries = typeof retries === 'string' ? JSON.parse(retries) : retries;
            if (schedule) parsedSchedule = typeof schedule === 'string' ? JSON.parse(schedule) : schedule;
        } catch (e) { }

        // --- 7. Create local campaign record ---
        const campaignId = `local_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        const displayName = agentId ? `${campaignName}_AG${agentId.slice(-4)}` : campaignName;

        await pool.query(
            `INSERT INTO "${LOCAL_CAMPAIGNS_TABLE}" (id, name, agent_id, status, total_contacts, call_interval_sec, concurrent_lines, caller_id, app_id, contacts, retries, schedule)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
            [campaignId, displayName, agentId, 'in-progress', campaignContacts.length, callIntervalSec, concurrentLines,
                effectiveCallerId, agentAppId, JSON.stringify(campaignContacts),
                parsedRetries ? JSON.stringify(parsedRetries) : null,
                parsedSchedule ? JSON.stringify(parsedSchedule) : null]
        );

        console.log(`📋 Created local campaign: ${displayName} (${campaignId}) - ${campaignContacts.length} contacts`);

        // --- 8. Respond immediately, start calls in background ---
        if (filePath && fs.existsSync(filePath)) fs.unlink(filePath, () => { });

        res.json({
            success: true,
            message: `Campaign started: ${campaignContacts.length} calls will be made (${concurrentLines} lines, ${callIntervalSec}s interval)`,
            data: {
                id: campaignId,
                name: displayName,
                status: 'in-progress',
                total_contacts: campaignContacts.length,
                call_interval_sec: callIntervalSec,
                concurrent_lines: concurrentLines
            }
        });

        // Fire and forget — process calls in background
        processCampaignCalls(campaignId, campaignContacts, effectiveCallerId, agentAppId, callIntervalSec, concurrentLines, parsedRetries, parsedSchedule)
            .catch(err => console.error(`❌ Background campaign error: ${err.message}`));

    } catch (error) {
        console.error('❌ Campaign Init Error:', error);
        if (filePath && fs.existsSync(filePath)) fs.unlink(filePath, () => { });
        res.status(500).json({ error: error.message });
    }
};

export const getCampaigns = async (req, res) => {
    try {
        await ensureLocalCampaignsTable();
        const { agentId } = req.query;

        // Basic Auth check to determine role (to permit 'show all' behavior eventually)
        const authHeader = req.headers.authorization;
        let isSuperAdmin = false;
        if (authHeader) {
            try {
                const token = authHeader.split(' ')[1];
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                if (decoded && (decoded.role === 'super_admin' || decoded.userId === 'master_root_0')) {
                    isSuperAdmin = true;
                }
            } catch (e) { /* ignore auth failure for listing, it might be handled upstream */ }
        }

        // Fetch local campaigns from DB
        let localQuery = `SELECT * FROM "${LOCAL_CAMPAIGNS_TABLE}"`;
        const params = [];

        // If not super admin OR if explicit agentId provided, filter by it
        // Note: Even super admins usually want to see one agent's campaigns in the detail view
        if (agentId) {
            localQuery += ` WHERE agent_id = $1`;
            params.push(agentId);
        }
        localQuery += ` ORDER BY date_created DESC`;

        const localResult = await pool.query(localQuery, params);
        const localCampaigns = localResult.rows.map(row => ({
            data: {
                id: row.id,
                name: row.name,
                status: row.status,
                agent_id: row.agent_id,
                date_created: row.date_created,
                date_updated: row.date_updated,
                throttle: row.concurrent_lines,
                call_interval_sec: row.call_interval_sec,
                retries: row.retries,
                schedule: row.schedule,
                stats: {
                    total: row.total_contacts,
                    completed: row.completed_calls || 0,
                    failed: row.failed_calls || 0,
                    'in-progress': row.status === 'in-progress' ? (row.total_contacts - (row.completed_calls || 0) - (row.failed_calls || 0)) : 0,
                    pending: row.status === 'in-progress' ? (row.total_contacts - (row.completed_calls || 0) - (row.failed_calls || 0)) : 0
                },
                _local: true
            }
        }));

        // Fetch Exotel campaigns for legacy display
        let exotelCampaigns = [];
        try {
            const response = await exotelService.getAllCampaigns();
            exotelCampaigns = response?.response || response?.campaigns || [];

            // Filter out excluded campaigns
            try {
                const table = process.env.APP_ENV === 'test' ? 'test_excluded_items' : 'Excluded_Items';
                const excludedRes = await pool.query(`SELECT item_id FROM "${table}" WHERE item_type = 'campaign'`);
                const excludedIds = new Set(excludedRes.rows.map(r => r.item_id));

                // SUFFIX Match for agent isolation in Exotel (naming convention)
                const suffix = agentId ? `_ag${agentId.slice(-4)}`.toLowerCase() : '';

                exotelCampaigns = exotelCampaigns.filter(c => {
                    const id = c.sid || c.id || (c.data && c.data.id);
                    if (excludedIds.has(id)) return false;

                    // If agentId specified, strictly filter by name suffix
                    if (agentId) {
                        const name = (c.friendly_name || c.name || (c.data && c.data.name) || '').toLowerCase();
                        return name.includes(`_ag${agentId}`.toLowerCase()) || (suffix && name.includes(suffix));
                    }
                    return true;
                });
            } catch (dbErr) {
                console.error('Error filtering excluded campaigns:', dbErr);
            }
        } catch (exoErr) {
            console.warn('⚠️ Could not fetch Exotel campaigns:', exoErr.message);
        }

        // Merge: local campaigns first, then Exotel ones
        const allCampaigns = [...localCampaigns, ...exotelCampaigns];

        res.json({ success: true, data: allCampaigns });
    } catch (error) {
        console.error('Error fetching campaigns:', error);
        res.status(500).json({ error: error.message });
    }
};

export const deleteCampaign = async (req, res) => {
    const { campaignId } = req.params;
    try {
        // Check if it's a local campaign
        if (campaignId.startsWith('local_')) {
            // Abort if running
            if (activeCampaigns.has(campaignId)) {
                activeCampaigns.get(campaignId).abort = true;
                activeCampaigns.delete(campaignId);
            }
            await pool.query(`DELETE FROM "${LOCAL_CAMPAIGNS_TABLE}" WHERE id = $1`, [campaignId]);
            return res.json({ success: true, message: 'Campaign deleted' });
        }

        // Legacy Exotel campaign deletion
        try {
            await exotelService.stopCampaign(campaignId);
        } catch (stopErr) {
            console.warn(`Could not stop campaign ${campaignId} during deletion:`, stopErr.message);
        }

        const table = process.env.APP_ENV === 'test' ? 'test_excluded_items' : 'Excluded_Items';
        await pool.query(
            `INSERT INTO "${table}" (item_type, item_id, excluded_by, reason) VALUES ($1, $2, $3, $4) ON CONFLICT (item_type, item_id) DO NOTHING`,
            ['campaign', campaignId, 'admin', 'deleted_via_dashboard']
        );
        res.json({ success: true, message: 'Campaign deleted via exclusion' });
    } catch (error) {
        console.error('Error deleting campaign:', error);
        res.status(500).json({ error: error.message });
    }
};

export const getCampaignCallDetails = async (req, res) => {
    try {
        const { campaignId } = req.params;

        // Local campaign — return call results from DB
        if (campaignId.startsWith('local_')) {
            const result = await pool.query(
                `SELECT call_results, contacts, completed_calls, failed_calls, total_contacts FROM "${LOCAL_CAMPAIGNS_TABLE}" WHERE id = $1`,
                [campaignId]
            );
            if (result.rows.length === 0) {
                return res.json({ success: true, data: [] });
            }
            const row = result.rows[0];
            const callResults = row.call_results || {};
            const contacts = row.contacts || [];

            // Build a lookup map from call_results array
            const resultsArray = Array.isArray(callResults) ? callResults : [];
            const resultsMap = {};
            resultsArray.forEach(cr => {
                if (cr.number) resultsMap[cr.number] = cr;
            });

            // Build call detail records
            const callDetails = contacts.map((contact, idx) => {
                const cr = resultsMap[contact.number] || {};
                return {
                    data: {
                        id: cr.call_sid || `pending_${idx}`,
                        to: contact.number,
                        from: '',
                        name: contact.first_name || '',
                        status: cr.status || 'pending',
                        date_created: cr.timestamp || null,
                        duration: cr.duration || 0,
                        first_name: contact.first_name || '',
                        error: cr.error || null,
                        attempts_done: cr.attempts_done || 0,
                        retries_left: cr.retries_left !== undefined ? cr.retries_left : null,
                        retry_after: cr.retry_after || null,
                        _local: true
                    }
                };
            });
            return res.json({ success: true, data: callDetails });
        }

        // Exotel campaign
        const response = await exotelService.getCampaignCallDetails(campaignId);
        res.json({ success: true, data: response });
    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.warn(`Campaign ${req.params.campaignId} not found or no calls (Exotel 404). Returning empty list.`);
            return res.json({ success: true, data: [] });
        }
        console.error(`Error fetching call details for ${req.params.campaignId}:`, error);
        res.status(500).json({ error: error.message });
    }
};

export const stopCampaign = async (req, res) => {
    const { campaignId } = req.params;
    try {
        if (campaignId.startsWith('local_')) {
            // Abort the background processor
            if (activeCampaigns.has(campaignId)) {
                activeCampaigns.get(campaignId).abort = true;
            }
            await pool.query(
                `UPDATE "${LOCAL_CAMPAIGNS_TABLE}" SET status = 'paused', date_updated = NOW() WHERE id = $1`,
                [campaignId]
            );
            return res.json({ success: true, message: 'Campaign paused successfully' });
        }

        await exotelService.stopCampaign(campaignId);
        res.json({ success: true, message: 'Campaign paused successfully' });
    } catch (error) {
        console.error('Pause campaign error:', error);
        res.status(500).json({ error: error.message });
    }
};

export const resumeCampaign = async (req, res) => {
    const { campaignId } = req.params;
    try {
        if (campaignId.startsWith('local_')) {
            // Load campaign from DB and resume processing
            const result = await pool.query(
                `SELECT * FROM "${LOCAL_CAMPAIGNS_TABLE}" WHERE id = $1`,
                [campaignId]
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ error: 'Campaign not found' });
            }
            const campaign = result.rows[0];
            if (campaign.status !== 'paused') {
                return res.status(400).json({ error: `Campaign is ${campaign.status}, cannot resume` });
            }

            // Figure out remaining contacts (not yet called, failed, or still retrying)
            const callResultsArr = Array.isArray(campaign.call_results) ? campaign.call_results : [];
            const contacts = campaign.contacts || [];
            const remaining = contacts.filter(c => {
                const cr = callResultsArr.find(r => r.number === c.number);
                return !cr || cr.status === 'failed' || cr.status === 'retrying' || cr.status === 'pending';
            });

            if (remaining.length === 0) {
                await pool.query(
                    `UPDATE "${LOCAL_CAMPAIGNS_TABLE}" SET status = 'completed', date_updated = NOW() WHERE id = $1`,
                    [campaignId]
                );
                return res.json({ success: true, message: 'Campaign already completed (no remaining contacts)' });
            }

            // Update status and resume
            await pool.query(
                `UPDATE "${LOCAL_CAMPAIGNS_TABLE}" SET status = 'in-progress', date_updated = NOW() WHERE id = $1`,
                [campaignId]
            );

            res.json({ success: true, message: `Campaign resumed: ${remaining.length} remaining calls` });

            // Resume in background
            processCampaignCalls(campaignId, remaining, campaign.caller_id, campaign.app_id, campaign.call_interval_sec, campaign.concurrent_lines)
                .catch(err => console.error(`❌ Resume campaign error: ${err.message}`));
            return;
        }

        await exotelService.resumeCampaign(campaignId);
        res.json({ success: true, message: 'Campaign resumed successfully' });
    } catch (error) {
        console.error('Resume campaign error:', error);
        res.status(500).json({ error: error.message });
    }
};
