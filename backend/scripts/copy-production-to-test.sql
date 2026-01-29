-- ================================================
-- Copy Production Data to Test Tables
-- ================================================
-- This script copies all data from production tables
-- (Agents, Sessions, Conversations) to test tables
-- (test_Agents, test_Sessions, test_Conversations)
--
-- Run this on your Azure PostgreSQL database
-- ================================================

-- 1. Clear existing test data (if any)
TRUNCATE TABLE test_Conversations CASCADE;
TRUNCATE TABLE test_Sessions CASCADE;
TRUNCATE TABLE test_Agents CASCADE;

-- 2. Copy Agents
INSERT INTO test_Agents (
    agent_id,
    name,
    session_count,
    last_synced,
    created_at,
    updated_at,
    region,
    ready,
    active_deployment_id,
    active_deployment_ready,
    auto_scaling,
    deployment,
    agent_profile
)
SELECT 
    agent_id,
    name,
    session_count,
    last_synced,
    created_at,
    updated_at,
    region,
    ready,
    active_deployment_id,
    active_deployment_ready,
    auto_scaling,
    deployment,
    agent_profile
FROM "Agents";

-- 3. Copy Sessions
INSERT INTO test_Sessions (
    session_id,
    agent_id,
    agent_name,
    started_at,
    ended_at,
    status,
    bot_start_seconds,
    cold_start,
    duration_seconds,
    conversation_count,
    service_id,
    organization_id,
    deployment_id,
    completion_status,
    last_synced,
    created_at,
    updated_at
)
SELECT 
    session_id,
    agent_id,
    agent_name,
    started_at,
    ended_at,
    status,
    bot_start_seconds,
    cold_start,
    duration_seconds,
    conversation_count,
    service_id,
    organization_id,
    deployment_id,
    completion_status,
    last_synced,
    created_at,
    updated_at
FROM "Sessions";

-- 4. Copy Conversations
INSERT INTO test_Conversations (
    session_id,
    agent_id,
    agent_name,
    turns,
    total_turns,
    first_message_at,
    last_message_at,
    summary,
    last_synced,
    created_at,
    updated_at
)
SELECT 
    session_id,
    agent_id,
    agent_name,
    turns,
    total_turns,
    first_message_at,
    last_message_at,
    summary,
    last_synced,
    created_at,
    updated_at
FROM "Conversations";

-- 5. Verify the copy
SELECT 'Agents' as table_name, COUNT(*) as production_count FROM "Agents"
UNION ALL
SELECT 'test_Agents', COUNT(*) FROM test_Agents
UNION ALL
SELECT 'Sessions', COUNT(*) FROM "Sessions"
UNION ALL
SELECT 'test_Sessions', COUNT(*) FROM test_Sessions
UNION ALL
SELECT 'Conversations', COUNT(*) FROM "Conversations"
UNION ALL
SELECT 'test_Conversations', COUNT(*) FROM test_Conversations
ORDER BY table_name;
