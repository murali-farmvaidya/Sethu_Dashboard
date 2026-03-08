import pg from 'pg';
import Razorpay from 'razorpay';
import crypto from 'crypto';
import { notifyRechargeSuccess, notifyAutoRenewalSuccess } from '../services/notification.service.js';
import { runSubscriptionRenewalCheck } from '../services/subscriptionRenewal.service.js';

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

const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

// ₹9999 combo pack: ₹6500 = platform access (30 days) + ₹3499 = call credits
const COMBO_PACK_AMOUNT = 999900;       // 9999 INR in paise
const PLATFORM_ACCESS_COST = 6500;     // credits deducted for platform access
const COMBO_CALL_CREDITS = 3499;       // call credits from the combo pack


export const createSubscriptionOrder = async (req, res) => {
    try {
        const userId = req.user.userId;

        // Master admin is not a real DB user — block payment creation
        if (userId === 'master_root_0' || req.user.isMaster) {
            return res.status(403).json({ success: false, message: 'Master admin account cannot make payments. Please use a regular admin account to manage subscriptions.' });
        }

        // ₹9999 Combo Pack: ₹6500 platform access + ₹3499 call credits
        const options = {
            amount: COMBO_PACK_AMOUNT,
            currency: 'INR',
            receipt: `combo_${userId}_${Date.now()}`,
            notes: { type: 'combo', userId }
        };

        const order = await razorpay.orders.create(options);

        // Record pending payment — minutes_added = 3499 (call credits portion)
        await pool.query(
            `INSERT INTO "${getTableName('Payments')}" (
                id, user_id, amount, currency, status, order_id, type, minutes_added, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
            [crypto.randomUUID(), userId, COMBO_PACK_AMOUNT, 'INR', 'created', order.id, 'subscription', COMBO_CALL_CREDITS]
        );

        res.json({
            success: true,
            order_id: order.id,
            amount: COMBO_PACK_AMOUNT,
            key_id: process.env.RAZORPAY_KEY_ID,
            currency: 'INR',
            pack_details: {
                total: 9999,
                platform_access: PLATFORM_ACCESS_COST,
                call_credits: COMBO_CALL_CREDITS
            }
        });

    } catch (error) {
        console.error('Error creating subscription order:', error);
        res.status(500).json({ success: false, message: 'Failed to create order' });
    }
};

export const createRechargeOrder = async (req, res) => {
    try {
        const userId = req.user.userId;

        // Master admin is not a real DB user — block payment creation
        if (userId === 'master_root_0' || req.user.isMaster) {
            return res.status(403).json({ success: false, message: 'Master admin account cannot make payments. Please use a regular admin account to manage credits.' });
        }

        const requestedAmount = parseInt(req.body.amount, 10);

        if (!requestedAmount || requestedAmount < 1000) {
            return res.status(400).json({ success: false, message: 'Minimum recharge amount is ₹1,000' });
        }

        const amountInPaise = requestedAmount * 100;
        const creditsToAdd = requestedAmount; // 1:1 ratio for Credits

        const options = {
            amount: amountInPaise,
            currency: "INR",
            receipt: `min_${userId}_${Date.now()}`,
            notes: {
                type: 'minutes',
                userId: userId
            }
        };

        const order = await razorpay.orders.create(options);

        await pool.query(
            `INSERT INTO "${getTableName('Payments')}" (
                id, user_id, amount, currency, status, order_id, type, minutes_added, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
            [crypto.randomUUID(), userId, amountInPaise, 'INR', 'created', order.id, 'minutes', creditsToAdd]
        );

        res.json({
            success: true,
            order_id: order.id,
            amount: amountInPaise,
            key_id: process.env.RAZORPAY_KEY_ID,
            currency: "INR"
        });

    } catch (error) {
        console.error('Error creating recharge order:', error);
        res.status(500).json({ success: false, message: 'Failed to create order' });
    }
};

export const verifyPayment = async (req, res) => {
    try {
        const { order_id, payment_id, signature } = req.body;
        const userId = req.user.userId;

        const generated_signature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(order_id + '|' + payment_id)
            .digest('hex');

        if (generated_signature !== signature) {
            return res.status(400).json({ success: false, message: 'Invalid signature' });
        }

        // Load payment record
        const paymentRes = await pool.query(
            `SELECT * FROM "${getTableName('Payments')}" WHERE order_id = $1`,
            [order_id]
        );
        const payment = paymentRes.rows[0];
        if (!payment) return res.status(404).json({ success: false, message: 'Payment record not found' });
        if (payment.status === 'captured') return res.json({ success: true, message: 'Payment already processed' });

        // Mark payment captured
        await pool.query(
            `UPDATE "${getTableName('Payments')}" SET status = 'captured', payment_id = $1, updated_at = NOW() WHERE order_id = $2`,
            [payment_id, order_id]
        );

        // Load user
        const userRes = await pool.query(
            `SELECT * FROM "${getTableName('Users')}" WHERE user_id = $1`, [userId]
        );
        let user = userRes.rows[0];

        if (!user) {
            console.error(`[PaymentVerify] User ${userId} not found for payment ${order_id}`);
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // ── Redirect to Billing Owner if this is an Agent account ──
        // Agents (role: 'user') inherit balance/expiry from their creator (Admin)
        let billingUserId = userId;
        let billingUser = user;

        if (user.role === 'user' && user.created_by) {
            console.log(`[PaymentVerify] User ${userId} is an Agent. Charging Creator ${user.created_by} instead.`);
            const ownerRes = await pool.query(
                `SELECT * FROM "${getTableName('Users')}" WHERE user_id = $1`, [user.created_by]
            );
            if (ownerRes.rows[0]) {
                billingUserId = user.created_by;
                billingUser = ownerRes.rows[0];
            }
        }

        console.log(`[PaymentVerify] Processing ${payment.type} for ${billingUser.email} (ID: ${billingUserId})`);
        console.log(`[PaymentVerify] Current Balance: ${billingUser.minutes_balance}, Current Expiry: ${billingUser.subscription_expiry}`);

        // Update the main variables for the rest of the function
        const userIdToUpdate = billingUserId;
        const userToUpdate = billingUser;

        if (!user) {
            console.error(`[PaymentVerify] User ${userId} not found for payment ${order_id}`);
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        console.log(`[PaymentVerify] Processing ${payment.type} for ${user.email} (ID: ${userId})`);
        console.log(`[PaymentVerify] Current Balance: ${user.minutes_balance}, Current Expiry: ${user.subscription_expiry}`);

        // ── COMBO PACK (₹9999): ₹6500 platform + ₹3499 call credits ──
        if (payment.type === 'subscription') {
            const now = new Date();
            let expiry = (userToUpdate.subscription_expiry && new Date(userToUpdate.subscription_expiry) > now)
                ? new Date(userToUpdate.subscription_expiry)
                : now;
            expiry.setDate(expiry.getDate() + 30);

            // Call credits = minutes_added stored at order creation (3499)
            const callCredits = parseInt(payment.minutes_added || COMBO_CALL_CREDITS);

            const updateRes = await pool.query(
                `UPDATE "${getTableName('Users')}"
                 SET subscription_expiry = $1,
                     minutes_balance = COALESCE(minutes_balance, 0) + $2,
                     updated_at = NOW()
                 WHERE user_id = $3`,
                [expiry, callCredits, userIdToUpdate]
            );

            console.log(`[PaymentVerify] Subscription Update Result for ${userIdToUpdate}:`, updateRes.rowCount, 'rows updated');
            console.log(`[PaymentVerify] New Expiry set to: ${expiry}`);

            // Fire notification
            notifyRechargeSuccess(
                userIdToUpdate, userToUpdate.email,
                9999, callCredits, 30
            ).catch(() => { });

            return res.json({
                success: true,
                message: `Platform access renewed for 30 days & ${callCredits} call credits added!`
            });
        }

        // ── CREDIT-ONLY RECHARGE (₹X → X credits) ──
        if (payment.type === 'minutes') {
            const creditsAdded = parseInt(payment.minutes_added || 0);
            const currentBalance = parseFloat(userToUpdate.minutes_balance || 0);
            let newBalance = currentBalance + creditsAdded;

            const now = new Date();
            const isExpired = !userToUpdate.subscription_expiry || new Date(userToUpdate.subscription_expiry) <= now;
            let autoRenewed = false;
            let newExpiry = null;

            if (isExpired && newBalance >= 6500) {
                // Auto-Renew if they have enough balance now
                newBalance -= 6500;
                newExpiry = new Date();
                newExpiry.setDate(newExpiry.getDate() + 30);
                autoRenewed = true;

                const updateRes = await pool.query(
                    `UPDATE "${getTableName('Users')}"
                     SET minutes_balance = $1, subscription_expiry = $2, updated_at = NOW()
                     WHERE user_id = $3`,
                    [newBalance, newExpiry, userIdToUpdate]
                );
                console.log(`[PaymentVerify] Auto-renewal Update Result for ${userIdToUpdate}:`, updateRes.rowCount, 'rows updated');

                // Create a payment record to log the auto-renewal deduction natively
                await pool.query(
                    `INSERT INTO "${getTableName('Payments')}" (id, user_id, amount, currency, status, order_id, type, minutes_added, created_at, updated_at)
                     VALUES (gen_random_uuid()::text, $1, 650000, 'INR', 'captured', $2, 'auto_renewal', -6500, NOW(), NOW())`,
                    [userIdToUpdate, `auto_renew_${Date.now()}`]
                );
            } else {
                const updateRes = await pool.query(
                    `UPDATE "${getTableName('Users')}"
                     SET minutes_balance = $1, updated_at = NOW()
                     WHERE user_id = $2`,
                    [newBalance, userIdToUpdate]
                );
                console.log(`[PaymentVerify] Balance-only Update Result for ${userIdToUpdate}:`, updateRes.rowCount, 'rows updated');
            }

            // Always send the base recharge success notification First
            notifyRechargeSuccess(
                userIdToUpdate, userToUpdate.email,
                Math.round(payment.amount / 100), creditsAdded, 0
            ).catch(() => { });

            // If we did an auto-renew, fire the success event for that too
            if (autoRenewed) {
                notifyAutoRenewalSuccess(
                    userIdToUpdate, userToUpdate.email,
                    6500, newBalance, newExpiry
                ).catch(() => { });
            }

            let responseMessage = `${creditsAdded} credits added to your account!`;
            if (autoRenewed) {
                responseMessage = `${creditsAdded} credits added! Your platform subscription was also automatically renewed.`;
            }

            return res.json({
                success: true,
                message: responseMessage
            });
        }

        res.json({ success: true, message: 'Payment verified and account updated' });

    } catch (error) {
        console.error('Error verifying payment:', error);
        res.status(500).json({ success: false, message: 'Verification failed' });
    }
};

export const getBalances = async (req, res) => {
    try {
        const userId = req.user.userId;
        const result = await pool.query(
            `SELECT user_id, role, created_by, subscription_expiry, minutes_balance, active_lines, phone_number FROM "${getTableName('Users')}" WHERE user_id = $1`,
            [userId]
        );
        const user = result.rows[0];

        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        // If Agent, fetch from Creator
        if (user.role === 'user' && user.created_by) {
            const creatorRes = await pool.query(
                `SELECT subscription_expiry, minutes_balance, active_lines, phone_number FROM "${getTableName('Users')}" WHERE user_id = $1`,
                [user.created_by]
            );
            if (creatorRes.rows[0]) {
                const creator = creatorRes.rows[0];
                return res.json({
                    success: true,
                    data: {
                        ...creator,
                        phone_number: user.phone_number // Keep agent's own phone
                    }
                });
            }
        }

        res.json({ success: true, data: user });
    } catch (error) {
        console.error('Error fetching balances:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch balances' });
    }
};

export const getTransactionHistory = async (req, res) => {
    try {
        let userId = req.user.userId;
        const paymentsTable = getTableName('Payments');
        const usageTable = getTableName('UsageLogs');
        const sessionsTable = getTableName('Sessions');
        const atcTable = getTableName('Agent_Telephony_Config');

        // Allow super_admin to query any user's data via targetUserId
        const isSuperAdmin = req.user.role === 'super_admin' || req.user.isMaster;
        if (isSuperAdmin && req.query.targetUserId) {
            userId = req.query.targetUserId;
        }
        console.log(`[getTransactionHistory] Requester: ${req.user.userId} (${req.user.role}, isMaster: ${req.user.isMaster}), Target: ${userId}, Filter: ${req.query.filter}`);


        const validFilters = ['payments', 'calls', 'all'];
        const filter = validFilters.includes(req.query.filter) ? req.query.filter : 'all';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        // Additional filters for calls
        const validDirections = ['inbound', 'outbound'];
        const direction = validDirections.includes(req.query.direction) ? req.query.direction : null;
        const search = (req.query.search || '').trim().replace(/\D/g, ''); // digits only

        let dataQuery = '';
        let countQuery = '';
        let params = [userId];

        // Helper for robust details JSON
        const detailsJson = `
            json_build_object(
                'from', CASE
                    WHEN ul.direction = 'outbound' OR ul.direction IS NULL THEN
                        COALESCE(NULLIF(ul.to_number, 'Unknown'), atc.exophone)
                    ELSE
                        COALESCE(NULLIF(ul.from_number, 'Unknown'), NULLIF(s.metadata->'telephony'->>'customer_number', ''))
                END,
                'to', CASE
                    WHEN ul.direction = 'outbound' OR ul.direction IS NULL THEN
                        COALESCE(NULLIF(ul.from_number, 'Unknown'), NULLIF(s.metadata->'telephony'->>'customer_number', ''))
                    ELSE
                        COALESCE(NULLIF(ul.to_number, 'Unknown'), atc.exophone)
                END,
                'status', COALESCE(NULLIF(ul.call_status, 'Unknown'), CASE WHEN ul.minutes_used > 0 THEN 'Completed' ELSE 'Attempted' END),
                'direction', COALESCE(ul.direction, 'outbound'),
                'duration', COALESCE(NULLIF(ul.duration_seconds, 0), ROUND(ul.minutes_used * 60)::int),
                'sid', ul.call_sid,
                'recording_url', ul.recording_url,
                'session_id', s.session_id
            )
        `;

        // Build extra WHERE clauses for direction + phone search
        let extraWhere = '';
        const extraParams = [];
        if (direction) {
            extraParams.push(direction);
            extraWhere += ` AND ul.direction = $${params.length + extraParams.length}`;
        }
        if (search) {
            extraParams.push(`%${search}%`);
            extraWhere += ` AND (ul.from_number LIKE $${params.length + extraParams.length} OR ul.to_number LIKE $${params.length + extraParams.length})`;
        }

        if (filter === 'payments') {
            dataQuery = `
                SELECT 
                    id, TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at, type, COALESCE(minutes_added, 0) as credit_amount, 0 as debit_amount, 'credit' as transaction_type,
                    CASE 
                        WHEN type = 'subscription' THEN 'Subscription Purchase'
                        WHEN type = 'minutes' THEN 'Minutes Recharge'
                        WHEN type = 'manual_adjustment' THEN 'Admin Adjustment'
                        ELSE type 
                    END as description,
                    json_build_object('order_id', order_id, 'payment_id', payment_id, 'status', status) as details
                FROM "${paymentsTable}" 
                WHERE user_id = $1
                ORDER BY created_at DESC 
                LIMIT $2 OFFSET $3
            `;
            countQuery = `SELECT COUNT(*) FROM "${paymentsTable}" WHERE user_id = $1`;

        } else if (filter === 'calls') {
            const callParams = [userId, ...extraParams, limit, offset];
            const countCallParams = [userId, ...extraParams];
            dataQuery = `
                SELECT 
                    ul.id, TO_CHAR(ul.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at, 'call' as type, 0 as credit_amount, ROUND((ul.minutes_used * 3.5)::numeric, 2) as debit_amount, 'debit' as transaction_type,
                    CASE 
                        WHEN ul.direction = 'inbound' THEN 'Incoming Call'
                        WHEN ul.direction = 'outbound' OR ul.direction IS NULL THEN 'Outgoing Call'
                        ELSE 'Call Usage' 
                    END as description,
                    ${detailsJson} as details
                FROM "${usageTable}" ul
                LEFT JOIN "${atcTable}" atc ON (
                    atc.exophone = ul.to_number OR atc.exophone = ul.from_number
                )
                LEFT JOIN LATERAL (
                    SELECT s.session_id, s.agent_id, s.metadata
                    FROM "${sessionsTable}" s
                    WHERE (
                        s.metadata->'telephony'->>'call_id' = ul.call_sid
                        OR (
                            s.agent_id = atc.agent_id
                            AND s.started_at BETWEEN (ul.created_at - INTERVAL '10 minutes') AND (ul.created_at + INTERVAL '10 minutes')
                        )
                    )
                    ORDER BY ABS(EXTRACT(EPOCH FROM (s.started_at - ul.created_at)))
                    LIMIT 1
                ) s ON true
                WHERE ul.user_id = $1${extraWhere}
                ORDER BY ul.created_at DESC 
                LIMIT $${callParams.length - 1} OFFSET $${callParams.length}
            `;
            countQuery = `SELECT COUNT(*) FROM "${usageTable}" ul WHERE ul.user_id = $1${extraWhere}`;

            const [dataRes, countRes] = await Promise.all([
                pool.query(dataQuery, callParams),
                pool.query(countQuery, countCallParams)
            ]);
            return res.json({
                success: true,
                data: dataRes.rows,
                pagination: {
                    total: parseInt(countRes.rows[0].count || 0),
                    page,
                    limit,
                    totalPages: Math.ceil(parseInt(countRes.rows[0].count || 0) / limit)
                }
            });
        } else {
            // ALL
            dataQuery = `
                SELECT * FROM (
                    SELECT 
                        id, TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at, type, COALESCE(minutes_added, 0) as credit_amount, 0 as debit_amount, 'credit' as transaction_type,
                        CASE 
                            WHEN type = 'subscription' THEN 'Subscription Purchase'
                            WHEN type = 'minutes' THEN 'Minutes Recharge'
                            WHEN type = 'manual_adjustment' THEN 'Admin Adjustment'
                            ELSE type 
                        END as description,
                        json_build_object('order_id', order_id, 'payment_id', payment_id, 'status', status) as details
                    FROM "${paymentsTable}" 
                    WHERE user_id = $1
                    
                    UNION ALL
                    
                    SELECT 
                        ul.id, TO_CHAR(ul.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as created_at, 'call' as type, 0 as credit_amount, ROUND((ul.minutes_used * 3.5)::numeric, 2) as debit_amount, 'debit' as transaction_type,
                        CASE 
                            WHEN ul.direction = 'inbound' THEN 'Incoming Call'
                            WHEN ul.direction = 'outbound' THEN 'Outgoing Call'
                            ELSE 'Call Usage' 
                        END as description,
                        ${detailsJson} as details
                    FROM "${usageTable}" ul
                    LEFT JOIN "${atcTable}" atc ON (
                        atc.exophone = ul.to_number OR atc.exophone = ul.from_number
                    )
                    LEFT JOIN LATERAL (
                        SELECT s.session_id, s.agent_id, s.metadata
                        FROM "${sessionsTable}" s
                        WHERE (
                            s.metadata->'telephony'->>'call_id' = ul.call_sid
                            OR (
                                s.agent_id = atc.agent_id
                                AND s.started_at BETWEEN (ul.created_at - INTERVAL '10 minutes') AND (ul.created_at + INTERVAL '10 minutes')
                            )
                        )
                        ORDER BY ABS(EXTRACT(EPOCH FROM (s.started_at - ul.created_at)))
                        LIMIT 1
                    ) s ON true
                    WHERE ul.user_id = $1
                ) as combined_history
                ORDER BY created_at DESC 
                LIMIT $2 OFFSET $3
            `;
            countQuery = `
                SELECT SUM(cnt) as count FROM (
                    SELECT COUNT(*) as cnt FROM "${paymentsTable}" WHERE user_id = $1
                    UNION ALL
                    SELECT COUNT(*) as cnt FROM "${usageTable}" WHERE user_id = $1
                ) as total_counts
            `;
        }

        const [dataRes, countRes] = await Promise.all([
            pool.query(dataQuery, [userId, limit, offset]),
            pool.query(countQuery, [userId])
        ]);

        res.json({
            success: true,
            data: dataRes.rows,
            pagination: {
                total: parseInt(countRes.rows[0].count || 0),
                page,
                limit,
                totalPages: Math.ceil(parseInt(countRes.rows[0].count || 0) / limit)
            }
        });
    } catch (error) {
        console.error('Error fetching combined history:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch history' });
    }
};

export const adjustCredits = async (req, res) => {
    try {
        const { amount, targetUserId } = req.body;
        const adminId = req.user.userId;

        // Verify Admin (Double check, though route should protect)
        const adminCheck = await pool.query(`SELECT role FROM "${getTableName('Users')}" WHERE user_id = $1`, [adminId]);
        if (!adminCheck.rows[0] || (adminCheck.rows[0].role !== 'super_admin' && adminId !== 'master_root_0')) {
            return res.status(403).json({ success: false, message: 'Unauthorized' });
        }

        const userId = targetUserId || adminId; // Default to self if not specified (for now UI adjusts self)

        // Record Adjustment
        await pool.query(
            `INSERT INTO "${getTableName('Payments')}" (
                id, user_id, amount, currency, status, order_id, type, minutes_added, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
            [crypto.randomUUID(), userId, 0, 'INR', 'captured', `adj_${Date.now()}`, 'manual_adjustment', amount]
        );

        // Update Balance
        await pool.query(
            `UPDATE "${getTableName('Users')}" SET minutes_balance = COALESCE(minutes_balance, 0) + $1, updated_at = NOW() WHERE user_id = $2`,
            [amount, userId]
        );

        // Check for auto-renewal after adjustment
        // Wrap in setTimeout to let DB persist and not block the response
        setTimeout(() => {
            runSubscriptionRenewalCheck().catch(e => console.error('[AdjustCredits] Renewal error:', e));
        }, 500);

        res.json({ success: true, message: 'Credits adjusted successfully' });
    } catch (error) {
        console.error('Error adjusting credits:', error);
        res.status(500).json({ success: false, message: 'Failed to adjust credits' });
    }
};

// GET /api/payment/heatmap — Returns daily minute usage for the past 365 days
export const getUsageHeatmap = async (req, res) => {
    try {
        const requestingUserId = req.user.userId;
        const requestingRole = req.user.role;
        const isMaster = req.user.isMaster && requestingUserId === 'master_root_0';

        // Admins/master can query any userId, regular users see their own
        let targetUserId = requestingUserId;
        if ((requestingRole === 'super_admin' || requestingRole === 'admin' || isMaster) && req.query.userId) {
            targetUserId = req.query.userId;
        }

        const usageTable = getTableName('UsageLogs');
        const usersTable = getTableName('Users');

        let query = '';
        let queryParams = [];

        // If the target is the requesting user themselves, apply role-based scope:
        if (targetUserId === requestingUserId) {
            if (isMaster || requestingRole === 'super_admin') {
                // Super Admin / Master: See ALL usage across the platform
                query = `
                    SELECT TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') as date, SUM(minutes_used) as total_minutes
                    FROM "${usageTable}"
                    WHERE created_at >= NOW() - INTERVAL '365 days'
                    GROUP BY TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
                    ORDER BY date ASC
                `;
            } else if (requestingRole === 'admin') {
                // Admin: See own usage + usage of any sub-users they created
                query = `
                    SELECT TO_CHAR(u_log.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') as date, SUM(u_log.minutes_used) as total_minutes
                    FROM "${usageTable}" u_log
                    LEFT JOIN "${usersTable}" u ON u_log.user_id = u.user_id
                    WHERE (u_log.user_id = $1 OR u.created_by = $1)
                      AND u_log.created_at >= NOW() - INTERVAL '365 days'
                    GROUP BY TO_CHAR(u_log.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
                    ORDER BY date ASC
                `;
                queryParams = [targetUserId];
            } else {
                // Regular User: See only own usage
                query = `
                    SELECT TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') as date, SUM(minutes_used) as total_minutes
                    FROM "${usageTable}"
                    WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '365 days'
                    GROUP BY TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
                    ORDER BY date ASC
                `;
                queryParams = [targetUserId];
            }
        } else {
            // When querying a specific DIFFERENT user's stats from the admin dropdown:
            query = `
                SELECT TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') as date, SUM(minutes_used) as total_minutes
                FROM "${usageTable}"
                WHERE user_id = $1 AND created_at >= NOW() - INTERVAL '365 days'
                GROUP BY TO_CHAR(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD')
                ORDER BY date ASC
            `;
            queryParams = [targetUserId];
        }

        const result = await pool.query(query, queryParams);

        // Convert to { "YYYY-MM-DD": minutesValue } map
        const heatmapData = {};
        for (const row of result.rows) {
            heatmapData[row.date] = parseFloat(parseFloat(row.total_minutes || 0).toFixed(2));
        }

        res.json({ success: true, data: heatmapData });
    } catch (error) {
        console.error('Error fetching heatmap:', error);
        res.status(500).json({ success: false, message: 'Failed to fetch heatmap data' });
    }
};
