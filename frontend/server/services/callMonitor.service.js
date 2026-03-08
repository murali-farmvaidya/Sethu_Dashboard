import pg from 'pg';
import axios from 'axios';
import crypto from 'crypto';
import nodemailer from 'nodemailer';

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: process.env.SMTP_SECURE === 'true',
    auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
    }
});

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

const exotelConfig = {
    apiKey: process.env.EXOTEL_API_KEY,
    apiToken: process.env.EXOTEL_API_TOKEN,
    accountSid: process.env.EXOTEL_ACCOUNT_SID,
    subdomain: process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com'
};

const terminateCall = async (callSid) => {
    try {
        const auth = Buffer.from(`${exotelConfig.apiKey}:${exotelConfig.apiToken}`).toString('base64');
        const url = `https://${exotelConfig.subdomain}/v1/Accounts/${exotelConfig.accountSid}/Calls/${callSid}.json`;
        await axios.post(url, {}, { headers: { 'Authorization': `Basic ${auth}` } });
        console.log(`🔪 Monitor terminated call ${callSid}`);
    } catch (error) {
        console.error(`Failed to terminate call ${callSid}:`, error.message);
    }
};

export const startMonitor = () => {
    console.log('🏁 Starting Call Monitor Service (Polling Mode)...');

    const checkCallStatus = async (call) => {
        let status = null;
        try {
            const auth = Buffer.from(`${exotelConfig.apiKey}:${exotelConfig.apiToken}`).toString('base64');
            const url = `https://${exotelConfig.subdomain}/v1/Accounts/${exotelConfig.accountSid}/Calls/${call.call_sid}.json`;

            const response = await axios.get(url, { headers: { 'Authorization': `Basic ${auth}` } });
            const callDetails = response.data?.Call;

            if (!callDetails) return;

            status = callDetails.Status; // in-progress, completed, failed, busy, no-answer, canceled, ringing

            if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(status)) {
                console.log(`📞 Call ${call.call_sid} finished with status: ${status}`);
                console.log(`🔍 Raw Call Details:`, JSON.stringify(callDetails));

                let duration = parseInt(callDetails.Duration) || 0;

                // Fallback: If Exotel returns null Duration (common for outbound calls in production),
                // calculate it from StartTime and EndTime if available
                if (duration === 0 && callDetails.StartTime && callDetails.EndTime) {
                    const start = new Date(callDetails.StartTime);
                    const end = new Date(callDetails.EndTime);
                    const computedSecs = Math.round((end - start) / 1000);
                    if (computedSecs > 0) {
                        duration = computedSecs;
                        console.log(`⏱️ Duration from timestamps (Start→End): ${duration}s (Exotel sent null)`);
                    }
                }

                // Check how old the call is in ActiveCalls queue
                const callAgeMinutes = (new Date() - new Date(call.created_at)) / (1000 * 60);

                // If completed but duration is STILL 0 (no timestamps either), wait or force-remove
                if (status === 'completed' && duration === 0) {
                    if (callAgeMinutes > 15) {
                        console.log(`⚠️ Call ${call.call_sid} has no duration after 15 minutes. Forcing removal.`);
                        // Fall through to finally block to be deleted
                    } else {
                        console.log(`⏳ Call ${call.call_sid} completed but Duration is 0. Waiting for Exotel update... (Age: ${Math.floor(callAgeMinutes)}m)`);
                        return;
                    }
                }

                const durationMinutes = parseFloat((duration / 60).toFixed(2));
                if (durationMinutes > 0) {
                    console.log(`Calculated Duration in Min (Precise): ${durationMinutes}`);
                    const usersTable = getTableName('Users');
                    const usageTable = getTableName('UsageLogs');

                    const uRes = await pool.query(`SELECT role, created_by FROM "${usersTable}" WHERE user_id = $1`, [call.user_id]);
                    const u = uRes.rows[0];

                    if (u) {
                        // Exemption Logic
                        const isExempt = u.role === 'super_admin' || call.user_id === 'master_root_0';

                        if (!isExempt) {
                            let billableUserId = call.user_id;
                            if (u.role === 'user' && u.created_by) {
                                billableUserId = u.created_by;
                            }

                            const creditsToDeduct = parseFloat((durationMinutes * 3.5).toFixed(2));
                            console.log(`💰 Deducting ${creditsToDeduct} credits (${durationMinutes} min) from user ${billableUserId}`);

                            const updateRes = await pool.query(
                                `UPDATE "${usersTable}" SET minutes_balance = ROUND((minutes_balance - $1)::numeric, 2), updated_at = NOW() WHERE user_id = $2 RETURNING minutes_balance, low_balance_threshold, email, last_low_credit_alert, role`,
                                [creditsToDeduct, billableUserId]
                            );

                            if (updateRes.rows.length > 0) {
                                const adminUser = updateRes.rows[0];
                                const threshold = adminUser.low_balance_threshold || 50;

                                if (adminUser.minutes_balance <= threshold && adminUser.role !== 'user') {
                                    console.log(`🔔 Low Balance Call Alert triggered for ${adminUser.email} (Balance: ${adminUser.minutes_balance})`);

                                    const message = adminUser.minutes_balance <= 0
                                        ? "You are receiving calls but your balance is zero. Please recharge immediately to avoid service interruption."
                                        : "You are receiving calls but you are getting low with the balance please recharge.";

                                    // Create Notification unconditionally on every call
                                    await pool.query(
                                        `INSERT INTO "${getTableName('Notifications')}" (user_id, type, title, message) VALUES ($1, $2, $3, $4)`,
                                        [
                                            billableUserId,
                                            'low_balance_call',
                                            'Call While Balance Low',
                                            message
                                        ]
                                    ).catch(err => console.error('Failed to create notification:', err));
                                }
                            }

                            // Log Usage with full call details — check for duplicate call_sid before inserting
                            const direction = callDetails.Direction === 'inbound' ? 'inbound' : 'outbound';
                            const existingLog = await pool.query(`SELECT id FROM "${usageTable}" WHERE call_sid = $1 LIMIT 1`, [call.call_sid]);
                            if (existingLog.rows.length > 0) {
                                console.log(`⚠️ Skipping duplicate UsageLog for call_sid ${call.call_sid}`);
                            } else {
                                await pool.query(
                                    `INSERT INTO "${usageTable}" (id, user_id, call_sid, minutes_used, duration_seconds, direction, from_number, to_number, call_status, recording_url, timestamp, created_at, updated_at)
                                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), NOW(), NOW())`,
                                    [
                                        crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(7),
                                        call.user_id,
                                        call.call_sid,
                                        durationMinutes,
                                        duration,
                                        direction,
                                        callDetails.From || null,
                                        callDetails.To || null,
                                        callDetails.Status || 'completed',
                                        callDetails.RecordingUrl || null
                                    ]
                                );
                            }

                        } else {
                            console.log(`StartMonitor: Skipping deduction for Exempt User ${call.user_id}`);
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Failed to check status for ${call.call_sid}:`, error.message);
        } finally {
            // ALWAYS remove from ActiveCalls if it's no longer in-progress
            if (['completed', 'failed', 'busy', 'no-answer', 'canceled'].includes(status)) {
                await pool.query(`DELETE FROM "${getTableName('ActiveCalls')}" WHERE call_sid = $1`, [call.call_sid])
                    .catch(e => console.error('Failed to clear ActiveCall:', e.message));
            }
        }
    };

    setInterval(async () => {
        try {
            const activeCalls = await pool.query(`SELECT * FROM "${getTableName('ActiveCalls')}"`);
            if (activeCalls.rows.length === 0) return;

            for (const call of activeCalls.rows) {
                await checkCallStatus(call); // Check each call
            }
        } catch (error) {
            console.error('Monitor loop error:', error);
        }
    }, 10000); // Check every 10 seconds

    // Monitor for low balances and expired subscriptions every 1 minute
    setInterval(async () => {
        try {
            const usersTable = getTableName('Users');
            const res = await pool.query(
                `SELECT user_id, email, minutes_balance, low_balance_threshold, last_low_credit_alert, role, subscription_expiry, last_expiry_alert_at
                 FROM "${usersTable}" 
                 WHERE role != 'user' AND role != 'super_admin' AND is_active = true`
            );

            for (const adminUser of res.rows) {
                const threshold = adminUser.low_balance_threshold || 50;

                if (adminUser.minutes_balance <= threshold && adminUser.user_id !== 'master_root_0') {
                    const now = new Date();
                    const lastAlert = adminUser.last_low_credit_alert ? new Date(adminUser.last_low_credit_alert) : null;

                    // Send alert if no previous alert or 24h have passed since last alert
                    if (!lastAlert || (now - lastAlert) > 24 * 60 * 60 * 1000) {
                        console.log(`🔔 Low Balance Alert triggered for ${adminUser.email} (Balance: ${adminUser.minutes_balance}, Threshold: ${threshold})`);

                        // Create Dashboard Notification
                        await pool.query(
                            `INSERT INTO "${getTableName('Notifications')}" (user_id, type, title, message) VALUES ($1, $2, $3, $4)`,
                            [
                                adminUser.user_id,
                                'low_balance',
                                'Low Balance Alert',
                                `Your call credit balance has dropped to ${adminUser.minutes_balance} credits, which is below your threshold of ${threshold} credits. Please recharge to avoid service interruption.`
                            ]
                        ).catch(err => console.error('Failed to create notification:', err));

                        // Send Email Notification
                        if (process.env.SMTP_HOST) {
                            try {
                                await transporter.sendMail({
                                    from: process.env.SMTP_FROM || '"FarmVaidya System" <admin@farmvaidya.ai>',
                                    to: adminUser.email,
                                    subject: '⚠️ Low Call Credit Balance Alert',
                                    html: `
                                        <h3>Low Balance Alert</h3>
                                        <p>Hello,</p>
                                        <p>Your FarmVaidya call credit balance has dropped to <strong>${adminUser.minutes_balance} credits</strong>, which is below your designated threshold of <strong>${threshold} credits</strong>.</p>
                                        <p>Please recharge your account soon to ensure uninterrupted service.</p>
                                        <p><a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/billing">Go to Billing Dashboard</a></p>
                                    `
                                });
                            } catch (emailErr) {
                                console.error('❌ Failed to send low balance email:', emailErr.message);
                            }
                        }

                        // Update last alert time
                        await pool.query(
                            `UPDATE "${usersTable}" SET last_low_credit_alert = NOW() WHERE user_id = $1`,
                            [adminUser.user_id]
                        );
                    }
                }
                // Subcription Expiry Check
                if (adminUser.subscription_expiry) {
                    const expiryDate = new Date(adminUser.subscription_expiry);
                    const now = new Date();
                    if (expiryDate < now && adminUser.user_id !== 'master_root_0') {
                        const lastExpiryAlert = adminUser.last_expiry_alert_at ? new Date(adminUser.last_expiry_alert_at) : null;

                        if (!lastExpiryAlert || (now - lastExpiryAlert) > 24 * 60 * 60 * 1000) {
                            console.log(`⛔ Subscription Expired Alert triggered for ${adminUser.email}`);

                            await pool.query(
                                `INSERT INTO "${getTableName('Notifications')}" (user_id, type, title, message) VALUES ($1, $2, $3, $4)`,
                                [
                                    adminUser.user_id,
                                    'subscription_expired',
                                    'Subscription Expired',
                                    'Your monthly platform subscription has expired. Inbound and outbound services are paused. Please renew to restore access.'
                                ]
                            ).catch(err => console.error('Failed to create expiry notification:', err));

                            if (process.env.SMTP_HOST) {
                                try {
                                    await transporter.sendMail({
                                        from: process.env.SMTP_FROM || '"FarmVaidya System" <admin@farmvaidya.ai>',
                                        to: adminUser.email,
                                        subject: '⛔ Your FarmVaidya Subscription Has Expired',
                                        html: `
                                            <h3>Subscription Expired</h3>
                                            <p>Hello,</p>
                                            <p>Your FarmVaidya monthly platform subscription expired on <strong>${expiryDate.toLocaleDateString()}</strong>.</p>
                                            <p>To prevent unwanted billing and service disruption, all inbound and outbound telephony services have been immediately paused. Your end-users cannot generate new campaigns at this time.</p>
                                            <p>Please renew your subscription to instantly unlock your dashboard and resume operations.</p>
                                            <p><a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/billing">Go to Billing Dashboard</a></p>
                                        `
                                    });
                                } catch (emailErr) {
                                    console.error('❌ Failed to send expiry email:', emailErr.message);
                                }
                            }

                            // Update last expiry alert time
                            await pool.query(
                                `UPDATE "${usersTable}" SET last_expiry_alert_at = NOW() WHERE user_id = $1`,
                                [adminUser.user_id]
                            ).catch(err => { }); // Ignores column not found before migration
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Low balance monitor error:', error);
        }
    }, 60000); // Check every 60 seconds
};
