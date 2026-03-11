const { User, ActiveCall, UsageLog, MissedCall } = require('../models');
const { exotel, razorpay } = require('../config/platform'); // razorpay unused here
const logger = require('../utils/logger');
const axios = require('axios');

// Helper to check user by incoming number
async function getAdminFromNumber(toNumber) {
    // Assuming the 'To' number is the Virtual Number assigned to the user
    // We search for a user who has this phone_number. 
    // If 'phone_number' stores the admin's personal number, we might need a separate field 'virtual_number'.
    // For now, assuming phone_number in User is the Virtual Number.
    // NOTE: In production, you might need a mapping table (VirtualNumbers -> Users) if users have multiple numbers.
    const user = await User.findOne({ where: { phone_number: toNumber } });
    // If not found by phone_number, maybe try to match any user (single tenant mode fallback?)
    // But logic says "Each Admin (customer) has... Mobile Number -> 500", so multi-tenant.
    return user;
}

async function notifyAdmin(admin, message) {
    if (!admin) return;

    try {
        const now = new Date();
        const lastAlert = admin.last_low_credit_alert ? new Date(admin.last_low_credit_alert) : null;

        // 30 min cooldown
        if (lastAlert && (now - lastAlert) < 30 * 60 * 1000) {
            return; // Too soon
        }

        // Send alert (Log for now, implement SMS/Email/WhatsApp later)
        logger.info(`[ALERT to ${admin.email}/${admin.phone_number}]: ${message}`);
        // Optionally update last_low_credit_alert
        admin.last_low_credit_alert = now;
        await admin.save();

        // Example: Send SMS using Exotel (Option A)
        // await sendSMS(admin.phone_number, message); 

    } catch (error) {
        logger.error('Error notifying admin:', error);
    }
}

exports.handleIncoming = async (req, res) => {
    // Exotel sends data in Query Params for GET or Body for POST. 
    // Usually it's GET for Passthru, but user said "app.post('/exotel/incoming')"
    const { CallSid, From, To, CallType } = req.body; // or req.query

    logger.info(`Incoming Call: ${CallSid} From: ${From} To: ${To}`);

    try {
        const admin = await getAdminFromNumber(To);

        if (!admin) {
            return res.send(`
                <Response>
                    <Say>Number not assigned.</Say>
                    <Hangup/>
                </Response>
            `);
        }

        // 1. Subscription Check
        const now = new Date();
        if (!admin.subscription_expiry || new Date(admin.subscription_expiry) < now) {
            return res.send(`
                <Response>
                    <Say>Your subscription has expired. Please renew.</Say>
                    <Hangup/>
                </Response>
            `);
        }

        // 2. Credits Check
        if (admin.minutes_balance <= 0) {
            await notifyAdmin(admin, "Incoming call blocked: your call credits are finished. Please recharge.");
            return res.send(`
                <Response>
                    <Say>Your call credits are exhausted. Please recharge.</Say>
                    <Hangup/>
                </Response>
            `);
        }

        // 3. Concurrency Check
        const activeCallsCount = await ActiveCall.count({ where: { user_id: admin.user_id } });
        // The prompt says "2 Concurrent Lines -> 2000". Assuming active_lines counts current active calls.
        // Wait, prompt says "2 concurrent lines". If >= 2, block.
        // If the user upgraded to more, we should check admin.concurrent_limit (need to add field or hardcode 2).
        if (activeCallsCount >= 2) {
            return res.send(`
                <Response>
                    <Say>All lines are busy.</Say>
                    <Hangup/>
                </Response>
            `);
        }

        // If Blocked checks pass:
        // Create ActiveCall record (tracked by CallMonitor)
        await ActiveCall.create({
            call_sid: CallSid,
            user_id: admin.user_id,
            start_time: new Date()
        });

        // Forward to Pipecat
        // Using "Dial".
        // Use StatusCallback to track end of call for logging/cleanup if monitor misses it.
        // Replace PIPECAT_NUMBER with actual number
        const callbacks = ""; // Add status callback url if needed
        res.send(`
            <Response>
                <Dial>
                    <Number>${exotel.pipecat_number}</Number>
                </Dial>
            </Response>
        `);

    } catch (error) {
        logger.error('Error handling incoming call:', error);
        res.send(`
            <Response>
                <Say>An error occurred.</Say>
                <Hangup/>
            </Response>
        `);
    }
};

// Helper for Call Monitor
exports.terminateCall = async (callSid) => {
    try {
        const url = `https://${exotel.sid}:${exotel.token}@${exotel.subdomain}.exotel.com/v1/Accounts/${exotel.sid}/Calls/${callSid}.json`; // Verify Exotel API URL
        // Exotel Hangup API might differ?
        // Usually it's POST /v1.../Calls/{CallSid} with status defaults? 
        // Or simply terminate.
        // Documentation: https://developer.exotel.com/api/#terminate-call (Uses POST)
        // URL: https://<api_key>:<api_token><subdomain>/v1/Accounts/<sid>/Calls/<call_sid>
        // But with just "Hangup" logic.
        // Actually, we usually don't need body, just the properly auth'd request.

        // Wait, Exotel API for terminate requires POST.

        await axios.post(url);
        logger.info(`Terminated call ${callSid} due to low balance.`);
    } catch (error) {
        logger.error(`Failed to terminate call ${callSid}: ${error.message}`);
    }
};

// Callback for when call ends events (Optional if monitor handles it)
// But we need to clean ActiveCalls if standard flow finishes.
exports.handleStatusCallback = async (req, res) => {
    const { CallSid, Status, Duration } = req.body;
    // Remove from ActiveCalls
    try {
        const activeCall = await ActiveCall.findByPk(CallSid);
        if (activeCall) {
            // Deduct minutes if not done
            // Update User balance logic is in UsageLog or here?
            // "When call ends: duration = end_time - start_time. minutes_balance -= duration"

            // We can do it here.
            const user = await User.findByPk(activeCall.user_id);
            if (user) {
                const durationMinutes = Math.ceil((Duration || 0) / 60); // Round UP
                if (durationMinutes > 0) {
                    user.minutes_balance -= durationMinutes;
                    await user.save();

                    await UsageLog.create({
                        user_id: user.user_id,
                        call_sid: CallSid,
                        minutes_used: durationMinutes,
                        timestamp: new Date()
                    });
                }
            }
            await activeCall.destroy();
        }
    } catch (e) {
        logger.error('Error in status callback:', e);
    }
    res.send('OK');
};

exports.handlePassthru = async (req, res) => {
    // Handle both GET (query) and POST (body)
    const params = { ...req.query, ...req.body };
    logger.info(`Exotel Passthru received: ${JSON.stringify(params)}`);

    try {
        let streamData = {};
        
        // 1. Handle JSON string in 'Stream' key
        if (params.Stream && typeof params.Stream === 'string' && params.Stream.startsWith('{')) {
            try {
                streamData = JSON.parse(params.Stream);
            } catch (e) {
                logger.error('Error parsing Stream JSON:', e);
            }
        } else {
            // 2. Handle flat format or object (Stream[Status], etc.)
            // Note: express/body-parser/query-parser might already nest these if configured
            // but we'll manually check just in case.
            
            streamData = {
                StreamSID: params['Stream[StreamSID]'] || (params.Stream && params.Stream.StreamSID),
                Status: params['Stream[Status]'] || (params.Stream && params.Stream.Status),
                Duration: params['Stream[Duration]'] || (params.Stream && params.Stream.Duration),
                StreamUrl: params['Stream[StreamUrl]'] || (params.Stream && params.Stream.StreamUrl),
                RecordingUrl: params['Stream[RecordingUrl]'] || (params.Stream && params.Stream.RecordingUrl),
                DisconnectedBy: params['Stream[DisconnectedBy]'] || (params.Stream && params.Stream.DisconnectedBy),
                DetailedStatus: params['Stream[DetailedStatus]'] || (params.Stream && params.Stream.DetailedStatus),
                Error: params['Stream[Error]'] || (params.Stream && params.Stream.Error)
            };
        }

        const callSid = params.CallSid;
        const from = params.From;
        const to = params.To;
        
        // Find user by virtual number
        const admin = await getAdminFromNumber(to);

        if (admin) {
            // Log as missed call if status is not 'completed' or if specifically requested
            // Keeping it simple: log everything that hits Passthru as a call record
            // The UI can filter by Status.
            await MissedCall.create({
                call_sid: callSid,
                user_id: admin.user_id,
                from_number: from,
                to_number: to,
                status: streamData.Status,
                detailed_status: streamData.DetailedStatus,
                error_message: streamData.Error,
                disconnected_by: streamData.DisconnectedBy,
                record_url: streamData.RecordingUrl,
                timestamp: new Date()
            });
            
            logger.info(`Logged call record for ${callSid} (Status: ${streamData.Status})`);
        }

    } catch (error) {
        logger.error('Error in handlePassthru:', error);
    }

    // Passthru should always return something to avoid hanging Exotel's flow
    res.send('OK');
};
