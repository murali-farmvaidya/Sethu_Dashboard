import pg from 'pg';
import axios from 'axios';
import crypto from 'crypto';

const { Pool } = pg;

const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false
});

const getTableName = (baseTableName) => {
    return process.env.APP_ENV === 'test' ? `test_${baseTableName.toLowerCase()}` : baseTableName;
};

// Exotel Config
const exotelConfig = {
    apiKey: process.env.EXOTEL_API_KEY,
    apiToken: process.env.EXOTEL_API_TOKEN,
    accountSid: process.env.EXOTEL_ACCOUNT_SID,
    subdomain: process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com',
    pipecat_number: process.env.PIPECAT_NUMBER
};

// Helper: Get Admin by Phone Number
async function getAdminFromNumber(toNumber) {
    if (!toNumber) return null;
    const res = await pool.query(
        `SELECT * FROM "${getTableName('Users')}" WHERE phone_number = $1`,
        [toNumber]
    );
    return res.rows[0];
}

async function notifyAdmin(admin, message) {
    if (!admin) return;

    try {
        const now = new Date();
        const lastAlert = admin.last_low_credit_alert ? new Date(admin.last_low_credit_alert) : null;

        if (lastAlert && (now - lastAlert) < 30 * 60 * 1000) {
            return;
        }

        console.log(`🔔 ALERT to Admin (${admin.email}): ${message}`);

        await pool.query(
            `UPDATE "${getTableName('Users')}" SET last_low_credit_alert = NOW() WHERE user_id = $1`,
            [admin.user_id]
        );
        // Integrate SMS/Email notification here if needed
    } catch (err) {
        console.error('Error notifying admin:', err);
    }
}

// Helper: Get Admin by Exophone
async function getAdminFromExophone(exophone) {
    if (!exophone) return null;
    
    // Normalize input exophone: remove common prefixes
    const cleanNumber = exophone.replace(/^(\+91|91|0)/, '');
    
    console.log(`🔍 Mapping Exophone: ${exophone} (Cleaned: ${cleanNumber})`);

    const res = await pool.query(`
        SELECT u.*, atc.app_id, atc.agent_id
        FROM "${getTableName('Agent_Telephony_Config')}" atc
        JOIN "${getTableName('User_Agents')}" ua ON atc.agent_id = ua.agent_id
        JOIN "${getTableName('Users')}" u ON ua.user_id = u.user_id
        WHERE atc.exophone = $1 
           OR atc.exophone = $2
           OR atc.exophone LIKE '%' || $2
           OR $1 LIKE '%' || atc.exophone
        ORDER BY 
            CASE WHEN u.role = 'super_admin' THEN 1 WHEN u.role = 'admin' THEN 2 ELSE 3 END
        LIMIT 1
    `, [exophone, cleanNumber]);

    return res.rows[0];
}

export const handleIncoming = async (req, res) => {
    const params = { ...req.query, ...req.body };
    const { CallSid, From, To } = params;

    console.log(`📞 Incoming Call: ${CallSid} From: ${From} To: ${To}`);

    try {
        // 1. Find the Paying User (Admin) based on the Exophone (To)
        const admin = await getAdminFromExophone(To);

        if (!admin) {
            console.warn(`⚠️ No Admin found for Exophone ${To}. Rejecting call.`);
            res.set('Content-Type', 'text/xml');
            return res.send(`
                <Response>
                    <Say>Configuration error. Number not assigned.</Say>
                    <Hangup/>
                </Response>
            `);
        }

        // 2. Check Subscription & Credits
        const now = new Date();
        if (admin.subscription_expiry && new Date(admin.subscription_expiry) < now) {
            console.warn(`⛔ Subscription expired for ${admin.email}. Rejecting call.`);
            res.set('Content-Type', 'text/xml');
            return res.send(`
                <Response>
                    <Say>Subscription expired.</Say>
                    <Hangup/>
                </Response>
            `);
        }

        if ((admin.minutes_balance || 0) <= 0) {
            console.warn(`⛔ Low Balance (${admin.minutes_balance}) for ${admin.email}. Rejecting call.`);
            await notifyAdmin(admin, "Incoming call blocked: your call credits are exhausted. Please recharge.");
            res.set('Content-Type', 'text/xml');
            return res.send(`
                <Response>
                    <Say>Your call credits are exhausted. Please recharge.</Say>
                    <Hangup/>
                </Response>
            `);
        }

        // 3. Log Active Call (Prevent Concurrency abuse if needed)
        const activeRes = await pool.query(
            `SELECT COUNT(*) as count FROM "${getTableName('ActiveCalls')}" WHERE user_id = $1`,
            [admin.user_id]
        );
        const activeCount = parseInt(activeRes.rows[0].count || 0);

        if (activeCount >= (admin.active_lines || 2)) {
            res.set('Content-Type', 'text/xml');
            return res.send(`
                <Response>
                    <Say>All lines are busy.</Say>
                    <Hangup/>
                </Response>
            `);
        }

        // Track Call
        await pool.query(
            `INSERT INTO "${getTableName('ActiveCalls')}" (call_sid, user_id, start_time, created_at, updated_at) VALUES ($1, $2, NOW(), NOW(), NOW())`,
            [CallSid, admin.user_id]
        );

        // 4. Redirect to the Agent's configured Flow
        // Construct Flow URL: https://my.exotel.com/<account>/exoml/start_voice/<app_id>
        // Note: app_id comes from Agent_Telephony_Config via the join
        const appId = admin.app_id || '1175263'; // Default fallback from logs if missing
        const accountSid = exotelConfig.accountSid;
        const flowUrl = `https://my.exotel.com/${accountSid}/exoml/start_voice/${appId}`;

        console.log(`✅ Credits OK (${admin.minutes_balance}). Redirecting to Flow: ${flowUrl}`);

        res.set('Content-Type', 'text/xml');
        res.send(`
            <Response>
                <Redirect>${flowUrl}</Redirect>
            </Response>
        `);

    } catch (error) {
        console.error('Error handling incoming call:', error);
        res.set('Content-Type', 'text/xml');
        res.send(`
            <Response>
                <Say>An error occurred.</Say>
                <Hangup/>
            </Response>
        `);
    }
};


// Passthru Applet endpoint: Returns HTTP 200 if credits OK, HTTP 403 if not
export const handleCreditCheck = async (req, res) => {
    const params = { ...req.query, ...req.body };
    const { CallSid, From, To } = params;

    console.log(`🔍 Credit Check (Passthru): CallSid=${CallSid} From=${From} To=${To}`);

    try {
        const admin = await getAdminFromExophone(To);

        if (!admin) {
            console.warn(`⚠️ No Admin found for Exophone ${To}`);
            return res.status(403).json({ success: false, reason: 'Number not configured' });
        }

        // Check subscription
        const now = new Date();
        if (admin.subscription_expiry && new Date(admin.subscription_expiry) < now) {
            console.warn(`⛔ Subscription expired for ${admin.email}`);
            return res.status(403).json({ success: false, reason: 'Subscription expired' });
        }

        // Check credits
        if ((admin.minutes_balance || 0) <= 0) {
            console.warn(`⛔ Zero credits for ${admin.email} (Balance: ${admin.minutes_balance})`);
            await notifyAdmin(admin, "Incoming call blocked: your call credits are exhausted. Please recharge.");
            return res.status(403).json({ success: false, reason: 'Credits exhausted' });
        }

        // Check active lines
        const activeRes = await pool.query(
            `SELECT COUNT(*) as count FROM "${getTableName('ActiveCalls')}" WHERE user_id = $1`,
            [admin.user_id]
        );
        const activeCount = parseInt(activeRes.rows[0].count || 0);
        if (activeCount >= (admin.active_lines || 2)) {
            return res.status(403).json({ success: false, reason: 'All lines busy' });
        }

        // Track call
        await pool.query(
            `INSERT INTO "${getTableName('ActiveCalls')}" (call_sid, user_id, start_time, created_at, updated_at) VALUES ($1, $2, NOW(), NOW(), NOW()) ON CONFLICT DO NOTHING`,
            [CallSid, admin.user_id]
        );

        console.log(`✅ Credit Check PASSED for ${admin.email} (Balance: ${admin.minutes_balance})`);
        return res.status(200).json({ success: true, balance: admin.minutes_balance });

    } catch (error) {
        console.error('Error in credit check:', error);
        // On error, ALLOW the call (don't block paying customers due to our bug)
        return res.status(200).json({ success: true, reason: 'Error fallback - allowing call' });
    }
};

export const handleReject = async (req, res) => {
    res.set('Content-Type', 'text/xml');
    res.send(`
        <Response>
            <Reject reason="busy"/>
        </Response>
    `);
};

export const terminateCall = async (callSid) => {
    try {
        const auth = Buffer.from(`${exotelConfig.apiKey}:${exotelConfig.apiToken}`).toString('base64');
        const url = `https://${exotelConfig.subdomain}/v1/Accounts/${exotelConfig.accountSid}/Calls/${callSid}.json`;

        await axios.post(url, {}, {
            headers: { 'Authorization': `Basic ${auth}` }
        });

        console.log(`🔪 Terminated call ${callSid} due to low balance.`);
    } catch (error) {
        console.error(`Failed to terminate call ${callSid}: ${error.message}`);
    }
};

export const handleStatusCallback = async (req, res) => {
    const params = { ...req.query, ...req.body };
    const { CallSid, Status, Duration, Direction, From, To, RecordingUrl } = params;

    // Normalize Status
    const terminalStatuses = ['completed', 'failed', 'busy', 'no-answer', 'canceled'];

    if (terminalStatuses.includes(Status)) {
        try {
            // ... existing logic ...
            const callRes = await pool.query(
                `SELECT * FROM "${getTableName('ActiveCalls')}" WHERE call_sid = $1`,
                [CallSid]
            );
            let call = callRes.rows[0];
            let userId = call?.user_id;

            if (!userId) {
                const exophoneRes = await pool.query(`
                    SELECT u.user_id 
                    FROM "${getTableName('Agent_Telephony_Config')}" atc
                    JOIN "${getTableName('User_Agents')}" ua ON atc.agent_id = ua.agent_id
                    JOIN "${getTableName('Users')}" u ON ua.user_id = u.user_id
                    WHERE atc.exophone = $1 OR atc.exophone = $2 OR atc.exophone LIKE '%' || $2
                    LIMIT 1
                `, [From, From.replace(/^(\+91|91|0)/, '')]);

                if (exophoneRes.rows[0]) {
                    userId = exophoneRes.rows[0].user_id;
                }
            }

            if (userId) {
            const durationSeconds = parseInt(Duration) || 0;
            const durationMinutes = Math.ceil(durationSeconds / 60);
            
            // LOG AS MISSED if duration is 0 and it's an inbound call
            const isActuallyMissed = (durationSeconds === 0 && terminalStatuses.includes(Status)) || 
                                     ['failed', 'busy', 'no-answer', 'canceled'].includes(Status?.toLowerCase());

            if (isActuallyMissed) {
                const admin = await pool.query(`
                    SELECT agent_id FROM "${getTableName('Agent_Telephony_Config')}" 
                    WHERE exophone = $1 OR exophone = $2 OR exophone LIKE '%' || $2
                    LIMIT 1
                `, [To, To.replace(/^(\+91|91|0)/, '')]);

                await pool.query(
                    `INSERT INTO "${getTableName('MissedCalls')}" (
                        user_id, agent_id, call_sid, from_number, to_number, 
                        status, detailed_status, error_message,
                        timestamp, created_at, updated_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), NOW())
                    ON CONFLICT (call_sid) DO NOTHING`,
                    [
                        userId,
                        admin.rows[0]?.agent_id || null,
                        CallSid,
                        From,
                        To,
                        Status,
                        params.DetailedStatus || 'Zero Duration',
                        params.ErrorMessage || null
                    ]
                );
            }

            if (durationMinutes > 0) {
                    const uRes = await pool.query(`SELECT role, created_by FROM "${getTableName('Users')}" WHERE user_id = $1`, [userId]);
                    const u = uRes.rows[0];
                    let billableUserId = userId;

                    if (u && u.role === 'user' && u.created_by) {
                        billableUserId = u.created_by;
                    }

                    const isExempt = u.role === 'super_admin' || userId === 'master_root_0';

                    if (!isExempt) {
                        const creditsToDeduct = parseFloat((durationMinutes * 3.5).toFixed(2));
                        await pool.query(
                            `UPDATE "${getTableName('Users')}" SET minutes_balance = ROUND((minutes_balance - $1)::numeric, 2), updated_at = NOW() WHERE user_id = $2`,
                            [creditsToDeduct, billableUserId]
                        );
                    }

                    // Better Direction Detection: If To is an exophone, it's inbound
                    const atcCheck = await pool.query(`SELECT 1 FROM "${getTableName('Agent_Telephony_Config')}" WHERE exophone = $1 OR exophone = $2 OR exophone LIKE '%' || $2 LIMIT 1`, [To, To.replace(/^(\+91|91|0)/, '')]);
                    let stdDirection = Direction || (atcCheck.rows.length > 0 ? 'inbound' : (call ? 'inbound' : 'outbound'));

                    await pool.query(
                        `INSERT INTO "${getTableName('UsageLogs')}" (
                            id, user_id, call_sid, minutes_used, timestamp, 
                            direction, from_number, to_number, call_status, recording_url, 
                            created_at, updated_at
                        ) VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, $9, NOW(), NOW())
                        ON CONFLICT (call_sid) DO NOTHING`,
                        [
                            crypto.randomUUID(),
                            userId, 
                            CallSid,
                            durationMinutes,
                            stdDirection,
                            From,
                            To,
                            Status,
                            RecordingUrl || null
                        ]
                    );
                }

                if (call) {
                    await pool.query(`DELETE FROM "${getTableName('ActiveCalls')}" WHERE call_sid = $1`, [CallSid]);
                }
            }
        } catch (err) {
            console.error('Error in status callback:', err);
        }
    }

    res.send('OK');
};

/**
 * Handle Passthru Applet data from Exotel
 * Captures missed calls and stream errors
 */
export const handlePassthru = async (req, res) => {
    const params = { ...req.query, ...req.body };
    const { CallSid, From, To, Status, DetailedStatus, Stream } = params;

    try {
        const admin = await getAdminFromExophone(To);
        const userId = admin?.user_id;

        let streamData = {};
        if (typeof Stream === 'string' && Stream.startsWith('{')) {
            try { streamData = JSON.parse(Stream); } catch (e) { }
        } else if (typeof Stream === 'object') {
            streamData = Stream;
        }

        const currentStatus = Status || streamData.Status || params['Stream[Status]'] || params['Status'];
        const currentDetailedStatus = DetailedStatus || streamData.DetailedStatus || params['Stream[DetailedStatus]'] || params['DetailedStatus'];

        const isMissed = ['failed', 'busy', 'no-answer', 'canceled'].includes(currentStatus?.toLowerCase()) || 
                         (currentDetailedStatus && (
                             currentDetailedStatus.toLowerCase().includes('throttle') || 
                             currentDetailedStatus.toLowerCase().includes('hung-up') ||
                             currentDetailedStatus.toLowerCase().includes('failed')
                         )) ||
                         (currentStatus?.toLowerCase() === 'failed');

        if (isMissed) {
            await pool.query(
                `INSERT INTO "${getTableName('MissedCalls')}" (
                    user_id, agent_id, call_sid, from_number, to_number, 
                    status, detailed_status, error_message,
                    timestamp, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW(), NOW())
                ON CONFLICT (call_sid) DO NOTHING`,
                [
                    userId,
                    admin?.agent_id || null,
                    CallSid,
                    From,
                    To,
                    currentStatus,
                    currentDetailedStatus,
                    params.ErrorMessage || streamData.ErrorMessage || null
                ]
            );
        }

        res.status(200).send('OK');
    } catch (error) {
        console.error('Error in handlePassthru:', error);
        res.status(200).send('OK');
    }
};
