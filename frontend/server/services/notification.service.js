/**
 * Notification Service
 * Central helper for creating in-app notifications and sending emails.
 * Imported by controllers and cron jobs throughout the server.
 */
import pg from 'pg';
import nodemailer from 'nodemailer';

const { Pool } = pg;
const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false
});

const getTableName = (base) =>
    process.env.APP_ENV === 'test' ? `test_${base.toLowerCase()}` : base;

// Strip surrounding quotes from SMTP_FROM (e.g. env value: "Sevak Dashboard" <x@y.com>)
const rawSmtpFrom = process.env.SMTP_FROM || 'noreply@sevak.ai';
const SMTP_FROM_CLEAN = rawSmtpFrom.replace(/^["']|["']$/g, '').trim();

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    tls: { rejectUnauthorized: false }  // allow self-signed / Azure relay certs
});

// Verify SMTP connection on startup
transporter.verify((err, success) => {
    if (err) {
        console.error('[Email] SMTP connection FAILED:', err.message, '\n  Host:', process.env.SMTP_HOST, 'Port:', process.env.SMTP_PORT, 'User:', process.env.SMTP_USER);
    } else {
        console.log('[Email] SMTP connection verified ✅  From:', SMTP_FROM_CLEAN);
    }
});

/**
 * Insert a notification row for a user.
 * @param {string} userId  - target user_id
 * @param {string} type    - e.g. 'billing', 'agent', 'system'
 * @param {string} title
 * @param {string} message
 */
export async function createNotification(userId, type, title, message) {
    try {
        await pool.query(
            `INSERT INTO "${getTableName('Notifications')}" (user_id, type, title, message, is_read, created_at)
             VALUES ($1, $2, $3, $4, FALSE, NOW())`,
            [userId, type, title, message]
        );
    } catch (e) {
        console.error('[Notification] Insert error:', e.message);
    }
}

/**
 * Send an email.
 * @param {string} to
 * @param {string} subject
 * @param {string} html    - HTML body
 */
export async function sendEmail(to, subject, html) {
    try {
        const info = await transporter.sendMail({
            from: SMTP_FROM_CLEAN,
            to,
            subject,
            html
        });
        console.log(`[Email] Sent to ${to}: "${subject}" — messageId: ${info.messageId}`);
    } catch (e) {
        console.error(`[Email] FAILED to send to ${to}: ${e.message}`);
        if (e.responseCode) console.error(`[Email] SMTP response: ${e.responseCode} ${e.response}`);
    }
}

/**
 * Create in-app notification + send email.
 * @param {string} plainMessage  - plain text for in-app notification (no HTML)
 * @param {string} [htmlMessage] - rich HTML for email body (defaults to wrapping plainMessage)
 */
export async function notify(userId, email, type, title, plainMessage, htmlMessage) {
    await createNotification(userId, type, title, plainMessage);
    const emailBody = htmlMessage || `<p style="color:#475569;line-height:1.6">${plainMessage}</p>`;
    await sendEmail(email, title, `
        <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
            <div style="background:#008F4B;padding:16px 24px;border-radius:8px 8px 0 0">
                <h2 style="color:white;margin:0;font-size:1.2rem">Sevak Platform</h2>
            </div>
            <div style="background:#f8fafc;padding:24px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px">
                <h3 style="color:#1e293b;margin:0 0 12px">${title}</h3>
                ${emailBody}
                <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:0.8rem;color:#94a3b8">
                    This is an automated message from Sevak Platform. Please do not reply.
                </div>
            </div>
        </div>
    `);
}

// ─── BILLING NOTIFICATION HELPERS ──────────────────────────────────────────

export async function notifyLowCredits(userId, email, currentBalance, requiredForRenewal) {
    const shortfall = (requiredForRenewal - currentBalance).toFixed(2);
    const plain = `Your credit balance is ${currentBalance.toFixed(2)} credits, below the ${requiredForRenewal} credits needed for platform renewal. Please recharge at least ${shortfall} more credits to avoid interruption.`;
    const html = `<p style="color:#475569;line-height:1.6">
        Your current credit balance is <strong>${currentBalance.toFixed(2)} credits</strong>, which is below the <strong>${requiredForRenewal} credits</strong> required for your next platform renewal.<br><br>
        Please recharge at least <strong>${shortfall} more credits</strong> to ensure uninterrupted platform access.
    </p>
    <p><a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/admin/billing" style="background:#008F4B;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Recharge Now</a></p>`;
    await notify(userId, email, 'billing', 'Low Credit Balance — Action Required', plain, html);
}

export async function notifyAutoRenewalSuccess(userId, email, creditsDeducted, creditsRemaining, newExpiry) {
    const expiryStr = new Date(newExpiry).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    const plain = `Platform access auto-renewed. ${creditsDeducted} credits deducted. New expiry: ${expiryStr}.`;
    const html = `<p style="color:#475569;line-height:1.6">
        Your platform access has been automatically renewed.<br><br>
        <strong>${creditsDeducted} credits</strong> were deducted from your balance.<br>
        Remaining balance: <strong>${creditsRemaining.toFixed(2)} credits</strong><br>
        New expiry date: <strong>${expiryStr}</strong>
    </p>`;
    // RICH message for in-app as well
    const richPlain = `Platform access auto-renewed. <strong>${creditsDeducted} credits</strong> deducted. New expiry: <strong>${expiryStr}</strong>.`;
    await notify(userId, email, 'billing', 'Platform Access Auto-Renewed', richPlain, html);
}

export async function notifyAutoRenewalFailed(userId, email, currentBalance, requiredCredits) {
    const plain = `Subscription renewal failed. Your balance is ${currentBalance.toFixed(2)} credits but ${requiredCredits} credits are required. Platform access is currently inactive. Please recharge immediately.`;
    const html = `<p style="color:#475569;line-height:1.6">
        Your subscription renewal failed — balance <strong>${currentBalance.toFixed(2)} credits</strong> is less than the <strong>${requiredCredits} credits</strong> required.<br><br>
        <strong style="color:#ef4444">Platform access is currently inactive.</strong> Please recharge immediately.
    </p>
    <p><a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/admin/billing" style="background:#ef4444;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Recharge Now</a></p>`;
    await notify(userId, email, 'billing', 'Platform Renewal Failed — Insufficient Credits', plain, html);
}

export async function notifyRechargeSuccess(userId, email, totalPaid, creditsAdded, platformDays) {
    const platformNotePlain = platformDays > 0 ? ` Platform access extended by ${platformDays} days.` : '';
    const platformNoteRich = platformDays > 0 ? `<br>Platform access extended by <strong>${platformDays} days</strong>.` : '';

    const plain = `Payment of ₹${totalPaid} successful. ${creditsAdded} credits added to your account.${platformNotePlain}`;
    const rich = `Your payment of <strong>₹${totalPaid}</strong> was successful.<br><strong>${creditsAdded} credits</strong> have been added to your account.${platformNoteRich}`;

    const html = `<p style="color:#475569;line-height:1.6">${rich}</p>`;
    await notify(userId, email, 'billing', 'Recharge Successful', rich, html);
}

// ─── USER / AGENT NOTIFICATION HELPERS ─────────────────────────────────────

export async function notifyAgentAssigned(userId, email, agentName) {
    const plain = `A new agent "${agentName}" has been assigned to your account and is now ready for use.`;
    await notify(userId, email, 'agent', 'New Agent Assigned to Your Account', plain);
}

export async function notifyAgentRemoved(userId, email, agentName) {
    const plain = `The agent "${agentName}" has been removed from your account.`;
    await notify(userId, email, 'agent', 'Agent Removed from Your Account', plain);
}

export async function notifyAccountCreated(userId, email, tempPassword) {
    const plain = `Your account has been created. Email: ${email}. Temporary Password: ${tempPassword}. Please log in and change your password immediately.`;
    const html = `<p style="color:#475569;line-height:1.6">
        Your account has been created successfully.<br><br>
        <strong>Email:</strong> ${email}<br>
        <strong>Temporary Password:</strong> <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">${tempPassword}</code><br><br>
        Please log in and change your password immediately.
    </p>
    <p><a href="${process.env.FRONTEND_URL || 'http://localhost:5173'}/login" style="background:#008F4B;color:white;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Login Now</a></p>`;
    await notify(userId, email, 'system', 'Welcome to Sevak Platform — Your Account is Ready', plain, html);
}

export async function notifyAccountDeactivated(userId, email) {
    const plain = 'Your Sevak Platform account has been deactivated. Please contact your administrator for more information.';
    await notify(userId, email, 'system', 'Your Account Has Been Deactivated', plain);
}

export async function notifyPasswordReset(userId, email, tempPassword) {
    const plain = `Your password has been reset by an administrator. New Temporary Password: ${tempPassword}. Please log in and change it immediately.`;
    const html = `<p style="color:#475569;line-height:1.6">
        Your password has been reset by an administrator.<br><br>
        <strong>New Temporary Password:</strong> <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">${tempPassword}</code><br><br>
        Please log in and change your password immediately.
    </p>`;
    await notify(userId, email, 'system', 'Your Password Has Been Reset', plain, html);
}

export default {
    createNotification, sendEmail, notify,
    notifyLowCredits, notifyAutoRenewalSuccess, notifyAutoRenewalFailed, notifyRechargeSuccess,
    notifyAgentAssigned, notifyAgentRemoved, notifyAccountCreated, notifyAccountDeactivated, notifyPasswordReset
};
