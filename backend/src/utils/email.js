/**
 * Email Service
 * Handles sending emails for authentication and notifications
 */

const nodemailer = require('nodemailer');
const logger = require('./logger');

// Email configuration from environment variables
const EMAIL_HOST = process.env.EMAIL_HOST || 'smtp.gmail.com';
const EMAIL_PORT = process.env.EMAIL_PORT || 587;
const EMAIL_USER = process.env.EMAIL_USER;
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD;
const EMAIL_FROM = process.env.EMAIL_FROM || 'Sevak Dashboard <noreply@sevak.ai>';

// Create transporter
let transporter = null;

function initializeTransporter() {
    if (!EMAIL_USER || !EMAIL_PASSWORD) {
        logger.warn('Email configuration not set. Email sending will be disabled.');
        return null;
    }

    transporter = nodemailer.createTransport({
        host: EMAIL_HOST,
        port: EMAIL_PORT,
        secure: EMAIL_PORT === 465, // true for 465, false for other ports
        auth: {
            user: EMAIL_USER,
            pass: EMAIL_PASSWORD
        }
    });

    return transporter;
}

/**
 * Send welcome email to new user
 * @param {string} email - User email
 * @param {string} temporaryPassword - Generated password
 * @param {Array} agents - Assigned agents
 */
async function sendWelcomeEmail(email, temporaryPassword, agents = []) {
    if (!transporter) {
        transporter = initializeTransporter();
    }

    if (!transporter) {
        logger.warn('Email not sent: transporter not initialized');
        return { success: false, error: 'Email service not configured' };
    }

    const loginUrl = process.env.FRONTEND_URL || 'http://localhost:5173/login';

    const agentList = agents.length > 0
        ? agents.map(a => `  • ${a.name}`).join('\n')
        : '  (No agents assigned yet)';

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
                .credentials { background: white; padding: 20px; border-left: 4px solid #667eea; margin: 20px 0; }
                .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
                .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Welcome to Sevak Dashboard</h1>
                </div>
                <div class="content">
                    <p>Hi there,</p>
                    <p>An administrator has created an account for you on <strong>Sevak Dashboard</strong>.</p>
                    
                    <div class="credentials">
                        <h3>Your Login Credentials:</h3>
                        <p><strong>Email:</strong> ${email}</p>
                        <p><strong>Temporary Password:</strong> <code>${temporaryPassword}</code></p>
                    </div>
                    
                    <p><strong>⚠️ Important:</strong> For security reasons, you will be required to change your password on first login.</p>
                    
                    <a href="${loginUrl}" class="button">Login to Your Dashboard</a>
                    
                    <h3>Your Assigned Agents:</h3>
                    <pre>${agentList}</pre>
                    
                    <p>If you have any questions, please contact your administrator.</p>
                    
                    <div class="footer">
                        <p>Best regards,<br>Sevak Dashboard Team</p>
                        <p>This is an automated email. Please do not reply.</p>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;

    try {
        const info = await transporter.sendMail({
            from: EMAIL_FROM,
            to: email,
            subject: 'Welcome to Sevak Dashboard - Your Account Credentials',
            html: htmlContent
        });

        logger.info(`Welcome email sent to ${email}: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        logger.error(`Failed to send welcome email to ${email}:`, error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Send password reset email
 * @param {string} email - User email
 * @param {string} resetToken - Password reset token
 */
async function sendPasswordResetEmail(email, resetToken) {
    if (!transporter) {
        transporter = initializeTransporter();
    }

    if (!transporter) {
        logger.warn('Email not sent: transporter not initialized');
        return { success: false, error: 'Email service not configured' };
    }

    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

    const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; text-align: center; border-radius: 10px 10px 0 0; }
                .content { background: #f9f9f9; padding: 30px; border-radius: 0 0 10px 10px; }
                .button { display: inline-block; background: #667eea; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; }
                .warning { background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
                .footer { text-align: center; margin-top: 20px; color: #666; font-size: 12px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>Password Reset Request</h1>
                </div>
                <div class="content">
                    <p>Hi,</p>
                    <p>We received a request to reset your password for your Sevak Dashboard account.</p>
                    
                    <a href="${resetLink}" class="button">Reset Your Password</a>
                    
                    <div class="warning">
                        <p><strong>⏰ This link will expire in 1 hour.</strong></p>
                    </div>
                    
                    <p>If you didn't request this password reset, please ignore this email. Your password will remain unchanged.</p>
                    
                    <p style="color: #666; font-size: 12px;">If the button doesn't work, copy and paste this link into your browser:</p>
                    <p style="color: #666; font-size: 12px; word-break: break-all;">${resetLink}</p>
                    
                    <div class="footer">
                        <p>Best regards,<br>Sevak Dashboard Team</p>
                        <p>This is an automated email. Please do not reply.</p>
                    </div>
                </div>
            </div>
        </body>
        </html>
    `;

    try {
        const info = await transporter.sendMail({
            from: EMAIL_FROM,
            to: email,
            subject: 'Reset Your Sevak Dashboard Password',
            html: htmlContent
        });

        logger.info(`Password reset email sent to ${email}: ${info.messageId}`);
        return { success: true, messageId: info.messageId };
    } catch (error) {
        logger.error(`Failed to send password reset email to ${email}:`, error.message);
        return { success: false, error: error.message };
    }
}

module.exports = {
    sendWelcomeEmail,
    sendPasswordResetEmail
};
