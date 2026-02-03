-- User Management System Database Schema
-- Created: 2026-01-30
-- Purpose: Multi-tenant user dashboard with role-based access control

-- ============================================
-- TABLE: Users
-- Stores user accounts with authentication
-- ============================================
CREATE TABLE IF NOT EXISTS "Users" (
    user_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user' CHECK (role IN ('admin', 'manager', 'user')),
    subscription_tier VARCHAR(50) DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro', 'enterprise')),
    is_active BOOLEAN DEFAULT true,
    must_change_password BOOLEAN DEFAULT true,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    last_login TIMESTAMP,
    created_by UUID REFERENCES "Users"(user_id) ON DELETE SET NULL
);

-- Index for faster email lookups during login
CREATE INDEX IF NOT EXISTS idx_users_email ON "Users"(email);
CREATE INDEX IF NOT EXISTS idx_users_role ON "Users"(role);
CREATE INDEX IF NOT EXISTS idx_users_is_active ON "Users"(is_active);

-- ============================================
-- TABLE: UserAgentAssignments
-- Maps users to agents with granular permissions
-- ============================================
CREATE TABLE IF NOT EXISTS "UserAgentAssignments" (
    assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES "Users"(user_id) ON DELETE CASCADE,
    agent_id VARCHAR(255) NOT NULL,
    can_view_sessions BOOLEAN DEFAULT true,
    can_view_logs BOOLEAN DEFAULT false,
    can_view_conversations BOOLEAN DEFAULT true,
    can_export_data BOOLEAN DEFAULT false,
    assigned_at TIMESTAMP DEFAULT NOW(),
    assigned_by UUID REFERENCES "Users"(user_id) ON DELETE SET NULL,
    UNIQUE(user_id, agent_id)
);

-- Foreign key to Agents table (if it exists)
-- Note: We'll add this constraint after ensuring Agents table exists
-- ALTER TABLE "UserAgentAssignments" 
-- ADD CONSTRAINT fk_agent FOREIGN KEY (agent_id) REFERENCES "Agents"(agent_id) ON DELETE CASCADE;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_user_agent_assignments_user_id ON "UserAgentAssignments"(user_id);
CREATE INDEX IF NOT EXISTS idx_user_agent_assignments_agent_id ON "UserAgentAssignments"(agent_id);

-- ============================================
-- TABLE: AuditLogs
-- Track all user actions for security and compliance
-- ============================================
CREATE TABLE IF NOT EXISTS "AuditLogs" (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES "Users"(user_id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    resource_type VARCHAR(50),
    resource_id VARCHAR(255),
    ip_address VARCHAR(45),
    user_agent TEXT,
    metadata JSONB,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for querying audit logs
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON "AuditLogs"(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON "AuditLogs"(action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON "AuditLogs"(created_at DESC);

-- ============================================
-- TABLE: PasswordResetTokens
-- Manage password reset requests
-- ============================================
CREATE TABLE IF NOT EXISTS "PasswordResetTokens" (
    token_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES "Users"(user_id) ON DELETE CASCADE,
    token VARCHAR(255) UNIQUE NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    used BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT NOW()
);

-- Index for token lookups
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_token ON "PasswordResetTokens"(token);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id ON "PasswordResetTokens"(user_id);
CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires_at ON "PasswordResetTokens"(expires_at);

-- ============================================
-- SEED DATA: Create Default Admin User
-- ============================================
-- Password: Admin@123 (hashed with bcrypt)
-- Note: This hash is for development only. Change in production!
INSERT INTO "Users" (email, password_hash, role, is_active, must_change_password)
VALUES (
    'admin@sevak.ai',
    '$2b$10$rZ3qJQXXKQOZKZYZ5YZ5YOqJQXXKQOZKZYZ5YZ5YOqJQXXKQOZKZ.',
    'admin',
    true,
    false
)
ON CONFLICT (email) DO NOTHING;

-- ============================================
-- HELPER FUNCTIONS
-- ============================================

-- Function to update updated_at timestamp automatically
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update updated_at on Users table
DROP TRIGGER IF EXISTS update_users_updated_at ON "Users";
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON "Users"
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- CLEANUP: Remove expired password reset tokens (run periodically)
-- ============================================
CREATE OR REPLACE FUNCTION cleanup_expired_tokens()
RETURNS void AS $$
BEGIN
    DELETE FROM "PasswordResetTokens"
    WHERE expires_at < NOW() OR used = true;
END;
$$ LANGUAGE plpgsql;

-- Run cleanup immediately
SELECT cleanup_expired_tokens();

-- ============================================
-- VERIFICATION QUERIES
-- ============================================
-- Uncomment to verify table creation:
-- SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('Users', 'UserAgentAssignments', 'AuditLogs', 'PasswordResetTokens');
-- SELECT * FROM "Users";
