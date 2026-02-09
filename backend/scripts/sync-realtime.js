/**
 * Realtime Dashboard Data Sync - OPTIMIZED & ROBUST (PostgreSQL Version)
 * 
 * Features:
 * 1. Syncs Agents, Sessions, and CLEAN Conversations (Q&A pairs only)
 * 2. Filters for data from January 1, 2026 onwards
 * 3. OPTIMIZED: Stops fetching logs once it hits data older than start date
 * 4. ROBUST CLEANING: Handles messy system prompts and escaped characters
 * 5. POSTGRESQL: Stores data in relational tables with JSONB support
 */

const path = require('path');
require('dotenv').config();
const { DataTypes } = require('sequelize');
const { sequelize, testConnection } = require(path.join(__dirname, '../src/config/database'));
const PipecatClient = require(path.join(__dirname, '../src/config/pipecat'));
const { getTableName, logEnvironmentInfo } = require(path.join(__dirname, '../src/config/tables'));
const logger = require(path.join(__dirname, '../src/utils/logger'));
const {
    extractSessionId,
    parseContextLog,
    parseTTSLog,
    normalizeLogs
} = require(path.join(__dirname, '../src/services/pipecat_normalization'));
const { generateSummary } = require(path.join(__dirname, '../src/services/summary.service'));

// ============ CONFIGURATION ============
const SYNC_START_DATE = new Date('2026-01-01T00:00:00Z');
const POLL_INTERVAL_MS = 2000; // Run every 2 seconds (faster sync for production)
const MAX_PARALLEL_AGENTS = 3; // Number of "Virtual Workers" for agent syncing

// Sessions that ENDED after this time will get auto-generated summaries
// Set to script start time so only new sessions get summaries, not historical ones
const SUMMARY_CUTOFF_TIME = new Date();

// ============ MODELS (Sequelize) ============

const Agent = sequelize.define('Agent', {
    agent_id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    name: {
        type: DataTypes.STRING,
        allowNull: false
    },
    session_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    last_synced: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    // Explicit timestamp fields (from Pipecat API)
    created_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    updated_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    // New Fields
    region: DataTypes.STRING,
    ready: DataTypes.BOOLEAN,
    active_deployment_id: DataTypes.STRING,
    active_deployment_ready: DataTypes.BOOLEAN,
    auto_scaling: DataTypes.JSONB,
    deployment: DataTypes.JSONB,
    agent_profile: DataTypes.STRING,
    is_hidden: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
}, {
    tableName: getTableName('Agents'),
    timestamps: false,  // Disable auto-management
    underscored: true
});

const Session = sequelize.define('Session', {
    session_id: {
        type: DataTypes.STRING,
        primaryKey: true,
        allowNull: false
    },
    agent_id: DataTypes.STRING,
    agent_name: DataTypes.STRING,
    started_at: DataTypes.DATE,
    ended_at: DataTypes.DATE,
    status: DataTypes.STRING,
    bot_start_seconds: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    cold_start: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    },
    duration_seconds: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    conversation_count: {
        type: DataTypes.INTEGER,
        defaultValue: 0
    },
    // New Fields
    service_id: DataTypes.STRING,
    organization_id: DataTypes.STRING,
    deployment_id: DataTypes.STRING,
    completion_status: DataTypes.STRING,
    metadata: {
        type: DataTypes.JSONB,
        defaultValue: {}
    },
    last_synced: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    },
    is_hidden: {
        type: DataTypes.BOOLEAN,
        defaultValue: false
    }
}, {
    tableName: getTableName('Sessions'),
    timestamps: true,
    underscored: true
});

const Conversation = sequelize.define('Conversation', {
    session_id: {
        type: DataTypes.STRING,
        primaryKey: true, // 1-to-1 mapping roughly for this sync logic
        allowNull: false
    },
    agent_id: DataTypes.STRING,
    agent_name: DataTypes.STRING,
    turns: {
        type: DataTypes.JSONB, // Stores the array of objects perfectly
        defaultValue: []
    },
    total_turns: DataTypes.INTEGER,
    first_message_at: DataTypes.DATE,
    last_message_at: DataTypes.DATE,
    summary: {
        type: DataTypes.TEXT,
        allowNull: true
    },
    review_status: {
        type: DataTypes.STRING,
        defaultValue: 'pending'  // 'pending' | 'needs_review' | 'completed'
    },
    reviewed_by: {
        type: DataTypes.STRING,
        allowNull: true
    },
    reviewed_at: {
        type: DataTypes.DATE,
        allowNull: true
    },
    last_synced: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: getTableName('Conversations'),
    timestamps: true,
    underscored: true
});

// Relationships (Optional but good for future expansion)
Agent.hasMany(Session, { foreignKey: 'agent_id' });
Session.belongsTo(Agent, { foreignKey: 'agent_id' });
Conversation.belongsTo(Session, { foreignKey: 'session_id' });

// ============ PARSING HELPERS ============
// Moved to src/services/pipecat_normalization.js

// ============ SYNC FUNCTIONS (PostgreSQL) ============


async function syncAgents(client) {
    const agents = await client.getAllAgents();

    // Get excluded agents
    const excludedAgents = await sequelize.query(`
        SELECT item_id FROM "${getTableName('Excluded_Items')}"
        WHERE item_type = 'agent'
    `, { type: sequelize.QueryTypes.SELECT });

    const excludedAgentIds = new Set(excludedAgents.map(e => e.item_id));

    for (const agent of agents) {
        // Skip if agent is excluded
        if (excludedAgentIds.has(agent.id)) {
            logger.debug(`Skipping excluded agent: ${agent.name} (${agent.id})`);
            continue;
        }

        // Calculate session count based on what we have synced
        const sessionCount = await Session.count({ where: { agent_id: agent.id } });

        // Sequelize upsert with explicit timestamp mapping
        await Agent.upsert({
            agent_id: agent.id,
            name: agent.name,
            region: agent.region,
            ready: agent.ready,
            active_deployment_id: agent.activeDeploymentId,
            active_deployment_ready: agent.activeDeploymentReady,
            auto_scaling: agent.autoScaling,
            deployment: agent.deployment,
            agent_profile: agent.agentProfile,
            session_count: sessionCount,
            created_at: agent.createdAt ? new Date(agent.createdAt) : new Date(),
            updated_at: agent.updatedAt ? new Date(agent.updatedAt) : new Date(),
            last_synced: new Date()
        });
    }
    return agents.filter(a => !excludedAgentIds.has(a.id));
}


async function syncSessions(client, agents) {
    logger.info(`🚀 Starting parallel session sync for ${agents.length} agents...`);

    // Get excluded sessions once at the start
    const excludedSessions = await sequelize.query(`
        SELECT item_id FROM "${getTableName('Excluded_Items')}"
        WHERE item_type = 'session'
    `, { type: sequelize.QueryTypes.SELECT });

    const excludedSessionIds = new Set(excludedSessions.map(e => e.item_id));

    // Process agents in parallel with a limit
    const processAgent = async (agent) => {
        try {
            logger.info(` [Worker] Syncing sessions for Agent: ${agent.name}`);
            // INCREMENTAL: Get the most recent session start time we have for this agent
            const latestSession = await Session.findOne({
                where: { agent_id: agent.id },
                order: [['started_at', 'DESC']]
            });

            const stopThreshold = latestSession
                ? new Date(latestSession.started_at.getTime() - (60 * 60 * 1000))
                : SYNC_START_DATE;

            // FETCH PAGE 1 TO DETECT ORDER
            const initialResponse = await client.getAgentSessions(agent.name, 1, 100);
            const initialSessions = initialResponse.data || [];
            if (initialSessions.length === 0) return;

            // Detect Order: If first session is older than last session on page, it's Ascending (Oldest First)
            const isAscending = initialSessions.length > 1 &&
                new Date(initialSessions[0].createdAt) < new Date(initialSessions[initialSessions.length - 1].createdAt);

            const totalSessions = initialResponse.total || initialResponse.total_count || initialSessions.length;
            const totalPages = Math.ceil(totalSessions / 100);

            let page = isAscending ? totalPages : 1;
            let stopFetching = false;

            while (page >= 1 && !stopFetching) {
                const response = (page === 1) ? initialResponse : await client.getAgentSessions(agent.name, page, 100);
                const sessions = response.data || [];

                if (sessions.length === 0) break;

                // If Ascending, we process the page backwards (newest in page first)
                const sessionsToProcess = isAscending ? [...sessions].reverse() : sessions;

                for (const session of sessionsToProcess) {
                    // Skip if session is excluded
                    if (excludedSessionIds.has(session.sessionId)) {
                        logger.debug(`Skipping excluded session: ${session.sessionId}`);
                        continue;
                    }

                    const startedAt = session.createdAt ? new Date(session.createdAt) : new Date();

                    if (startedAt < stopThreshold) {
                        stopFetching = true;
                        break;
                    }

                    const endedAt = session.endedAt ? new Date(session.endedAt) : null;
                    let durationSeconds = 0;
                    if (endedAt && startedAt) {
                        durationSeconds = Math.round((endedAt - startedAt) / 1000);
                    }

                    await Session.upsert({
                        session_id: session.sessionId,
                        agent_id: agent.id,
                        agent_name: agent.name,
                        started_at: startedAt,
                        ended_at: endedAt,
                        status: session.completionStatus || 'unknown',
                        bot_start_seconds: session.botStartSeconds || 0,
                        cold_start: session.coldStart || false,
                        duration_seconds: durationSeconds,
                        service_id: session.serviceId,
                        organization_id: session.organizationId,
                        deployment_id: session.deploymentId,
                        completion_status: session.completionStatus,
                        last_synced: new Date()
                    });
                }

                if (isAscending) page--; else page++;
                if (page === 0) break;
                // For descending, if we processed all available pages
                if (!isAscending && sessions.length < 100) break;
                await client.delay(100);
            }
        } catch (err) {
            logger.error(` ❌ [Worker] Error syncing sessions for ${agent.name}: ${err.message}`);
        }
    };

    // Use a simple pooling mechanism for parallel execution
    for (let i = 0; i < agents.length; i += MAX_PARALLEL_AGENTS) {
        const chunk = agents.slice(i, i + MAX_PARALLEL_AGENTS);
        await Promise.all(chunk.map(agent => processAgent(agent)));
    }
}

async function syncConversations(client, agents) {
    logger.info(`🚀 Starting parallel conversation sync for ${agents.length} agents...`);
    let totalSyncedGlobal = 0;

    const processAgentConversations = async (agent) => {
        let agentSyncedCount = 0;
        try {
            logger.info(` [Worker] Fetching logs for Agent: ${agent.name}`);
            const latestConversation = await Conversation.findOne({
                where: { agent_id: agent.id },
                order: [['last_message_at', 'DESC']]
            });

            // If we have synced data, look back 5 mins to catch overlapping messages
            const stopThreshold = latestConversation
                ? new Date(latestConversation.last_message_at.getTime() - (5 * 60 * 1000))
                : SYNC_START_DATE;

            const initialResponse = await client.getAgentLogs(agent.name, null, 1, 100);
            const initialLogs = initialResponse.data || [];
            if (initialLogs.length === 0) return 0;

            const isAscending = initialLogs.length > 1 &&
                new Date(initialLogs[0].timestamp) < new Date(initialLogs[initialLogs.length - 1].timestamp);

            const totalLogs = initialResponse.total || initialLogs.length;
            const totalPages = Math.ceil(totalLogs / 100);

            let page = isAscending ? totalPages : 1;
            let stopFetchingForAgent = false;
            const sessionLogs = new Map();

            while (page >= 1 && !stopFetchingForAgent) {
                try {
                    const response = (page === 1) ? initialResponse : await client.getAgentLogs(agent.name, null, page, 100);
                    const logs = response.data || [];
                    if (logs.length === 0) break;

                    const logsToProcess = isAscending ? [...logs].reverse() : logs;
                    for (const log of logsToProcess) {
                        const logTime = new Date(log.timestamp);
                        if (logTime < stopThreshold) {
                            stopFetchingForAgent = true;
                            break;
                        }
                        const msg = log.log || '';
                        const sessionId = extractSessionId(msg);
                        if (!sessionId) continue;
                        if (!sessionLogs.has(sessionId)) sessionLogs.set(sessionId, []);
                        sessionLogs.get(sessionId).push({ log: msg, timestamp: log.timestamp });

                        // Telephony metadata extraction
                        const telephony = require('../src/services/pipecat_normalization').extractTelephonyMetadata(msg);
                        if (telephony) {
                            try {
                                const currentSession = await Session.findByPk(sessionId);
                                if (currentSession) {
                                    const newMetadata = { ...(currentSession.metadata || {}), telephony };
                                    await Session.update({ metadata: newMetadata }, { where: { session_id: sessionId } });
                                }
                            } catch (e) { }
                        }
                    }

                    if (isAscending) page--; else page++;
                    if (page === 0) break;
                    if (!isAscending && logs.length < 100) break;
                    await client.delay(50);
                } catch (fetchError) {
                    logger.error(`⚠️ Stopping log fetch for ${agent.name} at page ${page}: ${fetchError.message}`);
                    break;
                }
            }

            // Process collected sessions
            for (const [sessionId, logs] of sessionLogs.entries()) {
                try {
                    const turns = normalizeLogs(logs);

                    // ============ ENHANCED ERROR DETECTION ============
                    if (!turns || turns.length === 0) {
                        // Log this for debugging - especially for specific agents
                        logger.warn(`⚠️ No turns extracted for session ${sessionId} (${agent.name}). Log count: ${logs.length}`);

                        // Sample the first few logs to debug parsing issues
                        if (logs.length > 0 && agent.name.toLowerCase().includes('ngo')) {
                            const sample = logs.slice(0, 3).map(l => {
                                const msg = typeof l === 'string' ? l : (l.log || l.message || '');
                                return msg.substring(0, 200); // First 200 chars
                            });
                            logger.warn(`📋 Sample logs for ${agent.name}: ${JSON.stringify(sample)}`);
                        }
                        continue;
                    }

                    // Check if turns have assistant messages
                    const hasAssistantMessages = turns.some(t => t.assistant_message);
                    if (!hasAssistantMessages && turns.length > 0) {
                        logger.warn(`⚠️ Session ${sessionId} (${agent.name}) has ${turns.length} turns but NO assistant messages!`);
                    }

                    const time = turns[turns.length - 1].timestamp || new Date();
                    const existing = await Conversation.findByPk(sessionId);

                    // ============ DATA PROTECTION LAYER (Fixes Flickering) ============
                    // 1. Safety Check: If we fetched FEWER turns than we already have, something is wrong.
                    // Don't overwrite good data with truncated data.
                    if (existing && existing.turns && turns.length < existing.turns.length) {
                        logger.warn(`📉 Turn count shrinkage detected for ${sessionId} (${existing.turns.length} -> ${turns.length}). Skipping update to protect data.`);
                        continue;
                    }

                    // 2. Intelligent Merge: If new data has "holes" (missing text) that we already have, fill them.
                    if (existing && existing.turns && turns.length > 0) {
                        let preservedCount = 0;
                        turns.forEach((newTurn, index) => {
                            if (index < existing.turns.length) {
                                const oldTurn = existing.turns[index];

                                // Protect Assistant Message (The main issue)
                                if (!newTurn.assistant_message && oldTurn.assistant_message) {
                                    newTurn.assistant_message = oldTurn.assistant_message;
                                    preservedCount++;
                                }
                                // Protect User Message
                                if (!newTurn.user_message && oldTurn.user_message) {
                                    newTurn.user_message = oldTurn.user_message;
                                }
                            }
                        });

                        if (preservedCount > 0) {
                            if (agent.name.toLowerCase().includes('ngo')) {
                                logger.info(`🛡️ Protected ${preservedCount} assistant messages for ${sessionId} (NGO Agent)`);
                            } else {
                                logger.debug(`🛡️ Protected ${preservedCount} messages for ${sessionId}`);
                            }
                        }
                    }
                    // ============ END PROTECTION ============

                    const parentSession = await Session.findByPk(sessionId);

                    let isContentMissing = false;
                    if (existing && existing.turns.length === turns.length) {
                        const lastTurn = turns[turns.length - 1];
                        const existingLastTurn = existing.turns[existing.turns.length - 1];
                        // Logic updated: Only flag missing if NEW has it and OLD doesn't
                        if (lastTurn.assistant_message && (!existingLastTurn || !existingLastTurn.assistant_message)) {
                            isContentMissing = true;
                            logger.info(`🔄 Updating session ${sessionId} - new content found`);
                        }
                    }

                    const needsSummary = existing && !existing.summary && parentSession?.ended_at;
                    if (existing && existing.turns.length === turns.length && existing.last_message_at >= time && !isContentMissing && !needsSummary) {
                        continue;
                    }

                    if (!parentSession) continue;

                    let summary = null;
                    const isRecentSession = new Date(parentSession.started_at) >= new Date('2026-01-28T00:00:00Z');
                    if (parentSession.ended_at && turns.length > 0 && !existing?.summary && isRecentSession) {
                        summary = await generateSummary(turns);
                    } else if (existing?.summary) {
                        summary = existing.summary;
                    }

                    await Conversation.upsert({
                        session_id: sessionId,
                        agent_id: agent.id,
                        agent_name: agent.name,
                        turns: turns,
                        total_turns: turns.length,
                        first_message_at: turns[0]?.timestamp || time,
                        last_message_at: time,
                        summary: summary,
                        last_synced: new Date()
                    });

                    await Session.update({ conversation_count: turns.length }, { where: { session_id: sessionId } });
                    agentSyncedCount++;
                } catch (e) {
                    logger.error(`❌ Error processing session ${sessionId} (${agent.name}): ${e.message}`);
                    logger.error(`Stack: ${e.stack}`);
                }
            }
        } catch (err) {
            logger.error(` ❌ [Worker] Error syncing conversations for ${agent.name}: ${err.message}`);
        }
        return agentSyncedCount;
    };

    // Use pooling for parallel conversation sync
    for (let i = 0; i < agents.length; i += MAX_PARALLEL_AGENTS) {
        const chunk = agents.slice(i, i + MAX_PARALLEL_AGENTS);
        const results = await Promise.all(chunk.map(agent => processAgentConversations(agent)));
        totalSyncedGlobal += results.reduce((a, b) => a + b, 0);
    }

    if (totalSyncedGlobal > 0) {
        logger.info(`✅ [Multi-Worker] Total Synced across all agents: ${totalSyncedGlobal}`);
    }
}

async function runSyncCycle() {
    logger.info(`🔄 Sync Cycle Started at ${new Date().toISOString()}`);

    // ============ DISTRIBUTED LOCK (Prevents multiple instances from conflicting) ============
    // Use PostgreSQL advisory lock to ensure only ONE sync instance runs at a time
    const LOCK_ID = 987654321; // Unique lock ID for this sync process
    let lockAcquired = false;

    try {
        // Try to acquire advisory lock (non-blocking)
        const lockResult = await sequelize.query(
            `SELECT pg_try_advisory_lock(${LOCK_ID}) as acquired`,
            { type: sequelize.QueryTypes.SELECT }
        );

        lockAcquired = lockResult[0]?.acquired;

        if (!lockAcquired) {
            logger.warn('⏭️ Skipping sync cycle - another instance is already running');
            return; // Exit early, let the other instance handle it
        }

        logger.info('🔒 Lock acquired (v2.1 Protected) - starting sync...');

        const client = new PipecatClient();
        const agents = await syncAgents(client);
        // Start incremental sync
        await syncSessions(client, agents);
        await syncConversations(client, agents);

    } catch (e) {
        logger.error('Sync Cycle Failed:', e);
    } finally {
        // Always release the lock
        if (lockAcquired) {
            try {
                await sequelize.query(`SELECT pg_advisory_unlock(${LOCK_ID})`);
                logger.info('🔓 Lock released');
            } catch (unlockErr) {
                logger.error('Failed to release lock:', unlockErr.message);
            }
        }
    }

    logger.info(`🏁 Sync Cycle Finished. Next run in ${POLL_INTERVAL_MS / 1000}s`);
    logger.info('💤 Sleeping... (I am still alive!)');
}

async function main() {
    logger.info('🚀 Starting Realtime Dashboard Sync Service v2.1 (Protected)');
    logEnvironmentInfo(); // Show which tables we're using
    logger.info(`📅 Filtering data from: ${SYNC_START_DATE.toISOString()}`);

    try {
        await testConnection();
        // Sync Models (Create Tables if not exist)
        logger.info('🏗️  Verifying database creation (Auto-Sync)...');
        await sequelize.sync({ alter: true }); // uses ALTER TABLE to match model

        // Ensure Excluded_Items table exists for this environment
        await sequelize.query(`
            CREATE TABLE IF NOT EXISTS "${getTableName('Excluded_Items')}" (
                id SERIAL PRIMARY KEY,
                item_type TEXT NOT NULL,
                item_id TEXT NOT NULL,
                item_name TEXT,
                excluded_by TEXT NOT NULL,
                excluded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                reason TEXT,
                UNIQUE(item_type, item_id)
            );
        `);
        logger.info('✅ Database structure and Excluded_Items table ready.');

        await runSyncCycle();
        // Use recursive setTimeout loop to prevent overlap, cleaner than interval
        const loop = async () => {
            setTimeout(async () => {
                await runSyncCycle();
                loop();
            }, POLL_INTERVAL_MS);
        }
        loop();

    } catch (e) {
        logger.error('Fatal Startup Error:', e);
        // Do not exit, try to restart loop after delay to keep service alive
        setTimeout(main, 30000);
    }
}

// Cleanup handlers to release locks on exit
const LOCK_ID = 987654321; // Same lock ID used in runSyncCycle

async function cleanup() {
    logger.info('🛑 Stopping sync service...');
    try {
        // Release any held advisory locks
        await sequelize.query(`SELECT pg_advisory_unlock_all()`);
        logger.info('🔓 All locks released');
    } catch (e) {
        logger.error('Lock cleanup error:', e.message);
    }
    await sequelize.close();
    process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup); // Add SIGTERM for Docker/Kubernetes graceful shutdown

main();
