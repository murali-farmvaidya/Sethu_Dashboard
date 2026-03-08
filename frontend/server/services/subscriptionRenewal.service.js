/**
 * Subscription Auto-Renewal Cron Service
 *
 * Logic:
 * - Runs every hour (checks if any subscription has expired within the last 24h)
 * - On expiry: tries to deduct 6500 credits from the user's balance
 *   - Success → extend subscription by 30 days, notify user
 *   - Failure → notify user with urgent email + in-app alert
 * - 3 days before expiry: sends a low-credit warning if balance < 6500
 */
import pg from 'pg';
import crypto from 'crypto';
import {
    notifyAutoRenewalSuccess,
    notifyAutoRenewalFailed,
    notifyLowCredits
} from './notification.service.js';

const { Pool } = pg;

// Force node-postgres to treat TIMESTAMP WITHOUT TIME ZONE as UTC instead of local
pg.types.setTypeParser(1114, str => new Date(str.endsWith('Z') ? str : str + 'Z'));

const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: 5,
    connectionTimeoutMillis: 20000,
    idleTimeoutMillis: 30000,
    keepAlive: true
});

const getTableName = (baseTableName) => {
    if (process.env.APP_ENV === 'test') {
        return `test_${baseTableName.toLowerCase()}`;
    }
    return baseTableName;
};

const PLATFORM_COST_CREDITS = 6500; // credits deducted for monthly renewal
const LOW_CREDIT_WARNING_DAYS = 3;  // warn this many days before expiry

export async function runSubscriptionRenewalCheck() {
    console.log('[AutoRenewal] Running subscription renewal check...');
    try {
        const usersTable = getTableName('Users');
        const paymentsTable = getTableName('Payments');

        const now = new Date();

        // ── 1. Warn users whose subscription expires in ≤ 3 days AND have < 6500 credits ──
        const soonExpiring = await pool.query(`
            SELECT user_id, email, subscription_expiry, minutes_balance, last_low_credit_alert
            FROM "${usersTable}"
            WHERE
                subscription_expiry IS NOT NULL
                AND subscription_expiry > NOW()
                AND subscription_expiry <= NOW() + INTERVAL '${LOW_CREDIT_WARNING_DAYS} days'
                AND minutes_balance < $1
                AND is_active = TRUE
        `, [PLATFORM_COST_CREDITS]);

        for (const user of soonExpiring.rows) {
            // throttle: only send once per 24 hours
            const lastAlert = user.last_low_credit_alert ? new Date(user.last_low_credit_alert) : null;
            const hoursSinceAlert = lastAlert ? (now - lastAlert) / (1000 * 60 * 60) : 999;
            if (hoursSinceAlert < 24) continue;

            const daysLeft = Math.ceil((new Date(user.subscription_expiry) - now) / (1000 * 60 * 60 * 24));
            await notifyLowCredits(
                user.user_id,
                user.email,
                parseFloat(user.minutes_balance || 0),
                PLATFORM_COST_CREDITS
            );
            await pool.query(
                `UPDATE "${usersTable}" SET last_low_credit_alert = NOW() WHERE user_id = $1`,
                [user.user_id]
            );
            console.log(`[AutoRenewal] Low-credit warning sent to ${user.email} (${daysLeft} days left)`);
        }

        // ── 2. Auto-renew expired subscriptions ──
        // Find ALL users whose subscription has expired and are still active
        const expired = await pool.query(`
            SELECT user_id, email, subscription_expiry, minutes_balance
            FROM "${usersTable}"
            WHERE
                subscription_expiry IS NOT NULL
                AND subscription_expiry <= NOW()
                AND is_active = TRUE
        `);

        console.log(`[AutoRenewal] Found ${expired.rows.length} expired users`);
        if (expired.rows.length > 0) {
            console.log(`[AutoRenewal] Expired users:`, expired.rows.map(u => ({ email: u.email, expiry: u.subscription_expiry, balance: u.minutes_balance })));
        }

        for (const user of expired.rows) {
            try {
                const currentBalance = parseFloat(user.minutes_balance || 0);

                if (currentBalance >= PLATFORM_COST_CREDITS) {
                    // ✅ Sufficient credits — auto-renew
                    const newBalance = currentBalance - PLATFORM_COST_CREDITS;

                    // If already expired, renew from NOW. If renewing on time, add to existing expiry.
                    const baseDate = new Date() > new Date(user.subscription_expiry)
                        ? new Date()
                        : new Date(user.subscription_expiry);

                    const newExpiry = new Date(baseDate);
                    newExpiry.setDate(newExpiry.getDate() + 30);

                    // Start transaction for consistency
                    await pool.query('BEGIN');
                    try {
                        await pool.query(`
                            UPDATE "${usersTable}"
                            SET minutes_balance = $1, subscription_expiry = $2, updated_at = NOW()
                            WHERE user_id = $3
                        `, [newBalance, newExpiry, user.user_id]);

                        // Record as a payment transaction for audit trail
                        const transactionId = crypto.randomUUID();
                        const orderId = `auto_renew_${user.user_id.slice(0, 8)}_${Date.now()}`;
                        await pool.query(`
                            INSERT INTO "${paymentsTable}" (id, user_id, amount, currency, status, order_id, type, minutes_added, created_at, updated_at)
                            VALUES ($1, $2, 650000, 'INR', 'captured', $3, 'auto_renewal', $4, NOW(), NOW())
                        `, [transactionId, user.user_id, orderId, -PLATFORM_COST_CREDITS]);

                        await pool.query('COMMIT');

                        await notifyAutoRenewalSuccess(
                            user.user_id, user.email,
                            PLATFORM_COST_CREDITS,
                            newBalance,
                            newExpiry
                        );
                        console.log(`[AutoRenewal] ✅ Auto-renewed ${user.email}, balance: ${currentBalance} → ${newBalance}`);
                    } catch (innerErr) {
                        await pool.query('ROLLBACK');
                        throw innerErr;
                    }
                } else {
                    // ❌ Insufficient credits — notify & deduct whatever is available
                    await notifyAutoRenewalFailed(
                        user.user_id, user.email,
                        currentBalance,
                        PLATFORM_COST_CREDITS
                    );
                    // Set last_low_credit_alert so we don't flood notifications
                    await pool.query(
                        `UPDATE "${usersTable}" SET last_low_credit_alert = NOW() WHERE user_id = $1`,
                        [user.user_id]
                    );
                    console.log(`[AutoRenewal] ❌ Renewal failed for ${user.email}, balance ${currentBalance} < ${PLATFORM_COST_CREDITS}`);
                }
            } catch (userErr) {
                console.error(`[AutoRenewal] Error processing user ${user.email}:`, userErr.message);
                // Continue to next user
            }
        }

        console.log(`[AutoRenewal] Done. Warned: ${soonExpiring.rows.length}, Processed: ${expired.rows.length}`);
    } catch (err) {
        console.error('[AutoRenewal] Error:', err.message);
    }
}

/**
 * Start the auto-renewal cron — runs every hour.
 */
export function startAutoRenewalCron() {
    console.log('[AutoRenewal] Cron started — checking every hour');
    runSubscriptionRenewalCheck(); // run immediately on startup
    setInterval(runSubscriptionRenewalCheck, 60 * 60 * 1000); // then every hour
}

export default { startAutoRenewalCron, runSubscriptionRenewalCheck };
