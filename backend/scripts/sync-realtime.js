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
const { syncAzurePostgresLogs } = require(path.join(__dirname, '../src/services/azure_postgres_sync'));
const exotelService = require(path.join(__dirname, '../src/services/exotel.service'));

// ============ CONFIGURATION ============
const SYNC_START_DATE = new Date('2026-01-01T00:00:00Z');
const POLL_INTERVAL_MS = 2000; // Run every 2 seconds (faster sync for production)
const MAX_PARALLEL_AGENTS = 3; // Number of "Virtual Workers" for agent syncing
const MAX_SESSIONS_PER_AGENT_PER_CYCLE = 10; // Fair distribution: no one agent hogs the queue
const MAX_SESSIONS_PER_CYCLE = 30; // Total cap to keep cycles short (~1-2 min)

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
    },
    customer_phone: {
        type: DataTypes.STRING,
        allowNull: true
    },
    caller_info: {
        type: DataTypes.JSONB,
        allowNull: true
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
    logger.info(`🚀 Starting PER-SESSION conversation sync for ${agents.length} agents...`);

    // ============ STEP 1: GATHER ALL SESSIONS NEEDING SYNC (across ALL agents at once) ============
    const allSessionsToSync = [];
    const agentMap = new Map(agents.map(a => [a.id, a]));

    // Query all agents in parallel to find sessions needing sync
    await Promise.all(agents.map(async (agent) => {
        try {
            const sessionsNeedingSync = await sequelize.query(`
                SELECT s.session_id, s.agent_id, s.agent_name, s.started_at, s.ended_at,
                       s.duration_seconds, s.status,
                       c.total_turns, c.last_synced AS conv_last_synced
                FROM "${getTableName('Sessions')}" s
                LEFT JOIN "${getTableName('Conversations')}" c ON s.session_id = c.session_id
                WHERE s.agent_id = :agentId
                AND s.started_at >= :startDate
                AND (
                    -- 1. No conversation data at all (first-time sync)
                    c.session_id IS NULL
                    -- 2. Session ended AFTER we last synced its conversation (one-time catch-up)
                    OR (s.ended_at IS NOT NULL AND c.last_synced < s.ended_at)
                    -- 3. Session still active — re-sync but only every 30 seconds
                    OR (s.ended_at IS NULL AND (c.last_synced IS NULL OR c.last_synced < NOW() - INTERVAL '30 seconds'))
                    -- 4. Low density (incomplete but has SOME turns) — only retry every 30 minutes
                    OR (c.total_turns > 0
                        AND s.duration_seconds > 60 
                        AND c.total_turns < GREATEST(s.duration_seconds / 60, 3) 
                        AND (c.last_synced IS NULL OR c.last_synced < NOW() - INTERVAL '30 minutes'))
                )
                ORDER BY 
                    CASE WHEN c.session_id IS NULL THEN 0 ELSE 1 END,  -- Never-synced first
                    CASE WHEN s.ended_at IS NULL THEN 0 ELSE 1 END,    -- Active sessions next
                    s.started_at DESC
                LIMIT :maxPerAgent
            `, {
                replacements: { agentId: agent.id, startDate: SYNC_START_DATE, maxPerAgent: MAX_SESSIONS_PER_AGENT_PER_CYCLE },
                type: sequelize.QueryTypes.SELECT
            });

            if (sessionsNeedingSync.length > 0) {
                logger.info(` [Queue] ${sessionsNeedingSync.length} sessions need sync for ${agent.name}`);
                allSessionsToSync.push(...sessionsNeedingSync);
            } else {
                logger.debug(` [Queue] No sessions need sync for ${agent.name}`);
            }
        } catch (err) {
            logger.error(` ❌ Error querying sessions for ${agent.name}: ${err.message}`);
        }
    }));

    if (allSessionsToSync.length === 0) {
        logger.debug('No sessions need conversation sync across any agent.');
        return;
    }

    // ============ FAIR DISTRIBUTION: Interleave sessions from different agents ============
    // Group by agent, then round-robin pick so no single agent dominates the queue
    const byAgent = new Map();
    for (const s of allSessionsToSync) {
        if (!byAgent.has(s.agent_name)) byAgent.set(s.agent_name, []);
        byAgent.get(s.agent_name).push(s);
    }
    const interleavedQueue = [];
    const agentQueues = [...byAgent.values()];
    let anyLeft = true;
    let roundIdx = 0;
    while (anyLeft && interleavedQueue.length < MAX_SESSIONS_PER_CYCLE) {
        anyLeft = false;
        for (const q of agentQueues) {
            if (roundIdx < q.length) {
                interleavedQueue.push(q[roundIdx]);
                anyLeft = true;
                if (interleavedQueue.length >= MAX_SESSIONS_PER_CYCLE) break;
            }
        }
        roundIdx++;
    }

    const agentBreakdown = [...byAgent.entries()].map(([name, sessions]) => `${name}(${sessions.length})`).join(', ');
    logger.info(`📋 Work queue: ${interleavedQueue.length}/${allSessionsToSync.length} sessions from ${byAgent.size} agents [${agentBreakdown}]`);

    // Replace allSessionsToSync with fair interleaved queue
    const workQueue = interleavedQueue;

    // ============ STEP 2: PROCESS SESSIONS WITH CONCURRENT WORKERS ============
    // Shared work queue — workers pull from it regardless of agent, so no single agent blocks others
    const CONCURRENT_WORKERS = MAX_PARALLEL_AGENTS; // 3 concurrent session processors
    let totalSyncedGlobal = 0;
    let queueIndex = 0;

    const processOneSession = async (session) => {
        const sessionId = session.session_id;
        const agentName = session.agent_name;
        const agent = agentMap.get(session.agent_id);
        if (!agent) return false;

        try {
            // Fetch ALL logs for this specific session using query param
            const allSessionLogs = await client.getAllLogsForSessionById(agentName, sessionId);

            if (!allSessionLogs || allSessionLogs.length === 0) {
                logger.debug(` No logs found for session ${sessionId}`);
                // Mark as synced to prevent infinite retry
                const existingConv = await Conversation.findByPk(sessionId);
                if (!existingConv) {
                    await Conversation.upsert({
                        session_id: sessionId,
                        agent_id: agent.id,
                        agent_name: agentName,
                        turns: [],
                        total_turns: 0,
                        last_synced: new Date()
                    });
                } else {
                    await Conversation.update({ last_synced: new Date() }, { where: { session_id: sessionId } });
                }
                return false;
            }

            // Extract telephony metadata from logs
            for (const log of allSessionLogs) {
                const msg = log.log || '';
                const telephony = require('../src/services/pipecat_normalization').extractTelephonyMetadata(msg);
                if (telephony) {
                    try {
                        const currentSession = await Session.findByPk(sessionId);
                        if (currentSession) {
                            let newMetadata = { ...(currentSession.metadata || {}), telephony };

                            // If phone is missing, try to fetch it from Exotel using the newly extracted call_id
                            if (telephony.call_id && !currentSession.phone && !currentSession.customer_phone) {
                                try {
                                    const callDetails = await exotelService.getCallDetails(telephony.call_id);
                                    if (callDetails && callDetails.From) {
                                        newMetadata.phone = callDetails.From;
                                        // Also store in custom_data as a redundant fallback
                                        const customData = { ...(currentSession.custom_data || {}), phone: callDetails.From };
                                        await Session.update({
                                            metadata: newMetadata,
                                            custom_data: customData
                                        }, { where: { session_id: sessionId } });
                                        logger.info(` 📞 Fetched missing phone ${callDetails.From} from Exotel for ${sessionId}`);
                                    } else {
                                        await Session.update({ metadata: newMetadata }, { where: { session_id: sessionId } });
                                    }
                                } catch (err) {
                                    await Session.update({ metadata: newMetadata }, { where: { session_id: sessionId } });
                                }
                            } else {
                                await Session.update({ metadata: newMetadata }, { where: { session_id: sessionId } });
                            }
                        }
                    } catch (e) { }
                    break; // Only need first telephony metadata
                }
            }

            // Normalize logs into conversation turns (pass sessionId for proper attribution)
            const logEntries = allSessionLogs.map(l => ({ log: l.log || '', timestamp: l.timestamp }));
            const turns = normalizeLogs(logEntries, sessionId);

            // ============ ENHANCED ERROR DETECTION ============
            if (!turns || turns.length === 0) {
                logger.warn(`⚠️ No turns extracted for session ${sessionId} (${agentName}). Log count: ${allSessionLogs.length}`);
                // Still mark as synced so it doesn't retry every cycle
                const existingConv = await Conversation.findByPk(sessionId);
                if (!existingConv) {
                    await Conversation.upsert({
                        session_id: sessionId,
                        agent_id: agentMap.get(session.agent_id)?.id || session.agent_id,
                        agent_name: agentName,
                        turns: [],
                        total_turns: 0,
                        last_synced: new Date()
                    });
                } else {
                    await Conversation.update({ last_synced: new Date() }, { where: { session_id: sessionId } });
                }
                return false;
            }

            // Check if turns have assistant messages
            const hasAssistantMessages = turns.some(t => t.assistant_message);
            if (!hasAssistantMessages && turns.length > 0) {
                logger.warn(`⚠️ Session ${sessionId} (${agentName}) has ${turns.length} turns but NO assistant messages!`);
            }

            const time = turns[turns.length - 1].timestamp || new Date();
            const existing = await Conversation.findByPk(sessionId);

            // ============ DATA PROTECTION LAYER ============
            // 1. Safety Check: Don't overwrite good data with truncated data
            if (existing && existing.turns && turns.length < existing.turns.length) {
                const existingBotCount = existing.turns.filter(t => t.assistant_message).length;
                const newBotCount = turns.filter(t => t.assistant_message).length;
                if (newBotCount <= existingBotCount) {
                    logger.warn(`📉 Turn count shrinkage for ${sessionId} (${existing.turns.length} -> ${turns.length}). Skipping.`);
                    return false;
                }
                logger.info(`📊 Replacing ${sessionId}: fewer turns (${existing.turns.length}→${turns.length}) but better quality`);
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
                        // Protect User Message - Missing or Truncated
                        if (!newTurn.user_message && oldTurn.user_message) {
                            newTurn.user_message = oldTurn.user_message;
                            preservedCount++;
                        } else if (newTurn.user_message && oldTurn.user_message) {
                            // Anti-Truncation Protection:
                            // If old message is significantly longer than new message, it means we probably have a truncation bug in the new parse.
                            // "Okay I" (6 chars) vs "Okay I'm a student..." (20+ chars)
                            if (oldTurn.user_message.length > newTurn.user_message.length + 5) {
                                newTurn.user_message = oldTurn.user_message;
                                preservedCount++;
                                logger.info(`🛡️ Protected truncated user message for turn ${newTurn.turn_id} in ${sessionId}. Kept ${oldTurn.user_message.length} chars vs new ${newTurn.user_message.length}`);
                            }
                        }
                    }
                });

                if (preservedCount > 0) {
                    if (agent.name.toLowerCase().includes('ngo')) {
                        logger.info(`🛡️ Protected ${preservedCount} messages for ${sessionId} (NGO Agent)`);
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
                if (lastTurn.assistant_message && (!existingLastTurn || !existingLastTurn.assistant_message)) {
                    isContentMissing = true;
                }
            }

            const needsSummary = existing && !existing.summary && parentSession?.ended_at;
            if (existing && existing.turns.length === turns.length && existing.last_message_at >= time && !isContentMissing && !needsSummary) {
                // Still update last_synced to prevent re-queuing
                await Conversation.update({ last_synced: new Date() }, { where: { session_id: sessionId } });
                return false;
            }

            if (!parentSession) {
                // Update last_synced even when parentSession is missing
                if (existing) {
                    await Conversation.update({ last_synced: new Date() }, { where: { session_id: sessionId } });
                }
                return false;
            }

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
                agent_name: agentName,
                turns: turns,
                total_turns: turns.length,
                first_message_at: turns[0]?.timestamp || time,
                last_message_at: time,
                summary: summary,
                last_synced: new Date()
            });

            await Session.update({ conversation_count: turns.length }, { where: { session_id: sessionId } });
            logger.info(` ✅ Synced ${sessionId} (${agentName}): ${turns.length} turns from ${allSessionLogs.length} logs`);
            return true;

        } catch (e) {
            if (e.response?.status === 429) {
                logger.warn(`⏳ Rate limited on ${sessionId}, waiting 5s...`);
                await client.delay(5000);
            } else {
                logger.error(`❌ Error processing session ${sessionId} (${agentName}): ${e.message}`);
            }
            return false;
        }
    };

    // Worker function: pulls sessions from shared queue until empty
    const worker = async (workerId) => {
        let workerSynced = 0;
        while (queueIndex < workQueue.length) {
            const idx = queueIndex++;
            if (idx >= workQueue.length) break;
            const session = workQueue[idx];
            const success = await processOneSession(session);
            if (success) workerSynced++;
            // Small delay between sessions to avoid rate limiting
            await client.delay(200);
        }
        return workerSynced;
    };

    // Launch concurrent workers
    const workerPromises = [];
    for (let i = 0; i < CONCURRENT_WORKERS; i++) {
        workerPromises.push(worker(i));
    }
    const results = await Promise.all(workerPromises);
    totalSyncedGlobal = results.reduce((sum, c) => sum + c, 0);

    if (totalSyncedGlobal > 0) {
        logger.info(`✅ Total Synced across all agents: ${totalSyncedGlobal}`);
    }
}

// JS-level flag to prevent re-entry (single Node.js process, sequential loop)
let isSyncRunning = false;

async function runSyncCycle() {
    if (isSyncRunning) {
        logger.info('⏭️ Previous cycle still running, skipping');
        return;
    }
    isSyncRunning = true;

    logger.info(`🔄 Sync Cycle Started at ${new Date().toISOString()}`);

    try {
        const client = new PipecatClient();
        const agents = await syncAgents(client);
        // Start incremental sync
        await syncSessions(client, agents);
        await syncConversations(client, agents);

        // Sync Azure Postgres logs after the main pipecat sync runs
        await syncAzurePostgresLogs(Agent, Session, Conversation);

    } catch (e) {
        logger.error('Sync Cycle Failed:', e);
    } finally {
        isSyncRunning = false;
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
        try {
            // 'alter: true' tries to match the DB schema to the model.
            // In production, this can sometimes fail due to constraint naming mismatches.
            await sequelize.sync({ alter: true }); 
        } catch (syncError) {
            if (syncError.name === 'SequelizeUnknownConstraintError' || syncError.message.includes('constraint') || syncError.message.includes('does not exist')) {
                logger.warn(`⚠️  Database Alter Sync partially failed (Constraint Issue): ${syncError.message}`);
                logger.info('🔄 Falling back to standard sync (only creates missing tables)...');
                await sequelize.sync(); // Fallback: just ensure tables exist
            } else {
                // If it's a different error, we still want to know
                throw syncError;
            }
        }

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
                is_purged BOOLEAN DEFAULT FALSE,
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

// Cleanup handlers
async function cleanup() {
    logger.info('🛑 Stopping sync service...');
    try {
        await sequelize.close();
        logger.info('🔓 Database connections closed');
    } catch (e) {
        logger.error('Cleanup error:', e.message);
    }
    process.exit(0);
}

process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup); // Add SIGTERM for Docker/Kubernetes graceful shutdown

main();
