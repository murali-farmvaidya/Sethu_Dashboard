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
const logger = require(path.join(__dirname, '../src/utils/logger'));
const {
    extractSessionId,
    parseContextLog,
    parseTTSLog
} = require(path.join(__dirname, '../src/services/pipecat_normalization'));
const { generateSummary } = require(path.join(__dirname, '../src/services/summary.service'));

// ============ CONFIGURATION ============
const SYNC_START_DATE = new Date('2026-01-01T00:00:00Z');
const POLL_INTERVAL_MS = 5000; // Run every 5 seconds

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
    agent_profile: DataTypes.STRING
}, {
    tableName: 'Agents',
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
    last_synced: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'Sessions',
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
    last_synced: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW
    }
}, {
    tableName: 'Conversations',
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
    for (const agent of agents) {
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
    return agents;
}

async function syncSessions(client, agents) {
    for (const agent of agents) {
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
        if (initialSessions.length === 0) continue;

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

            // If Ascending, we process the page backwards (newest in page first)
            const sessionsToProcess = isAscending ? [...sessions].reverse() : sessions;

            for (const session of sessionsToProcess) {
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
            await client.delay(100);
        }
    }
}

async function syncConversations(client, agents) {
    let totalSynced = 0;

    for (const agent of agents) {
        const latestConversation = await Conversation.findOne({
            where: { agent_id: agent.id },
            order: [['last_message_at', 'DESC']]
        });

        const stopThreshold = latestConversation
            ? new Date(latestConversation.last_message_at.getTime() - (5 * 60 * 1000))
            : SYNC_START_DATE;

        // FETCH PAGE 1 TO DETECT ORDER
        const initialResponse = await client.getAgentLogs(agent.name, null, 1, 100, 'Generating chat');
        const initialLogs = initialResponse.data || [];
        if (initialLogs.length === 0) continue;

        // Detect Order
        const isAscending = initialLogs.length > 1 &&
            new Date(initialLogs[0].timestamp) < new Date(initialLogs[initialLogs.length - 1].timestamp);

        const totalLogs = initialResponse.total || initialLogs.length;
        const totalPages = Math.ceil(totalLogs / 100);

        let page = isAscending ? totalPages : 1;
        let stopFetchingForAgent = false;
        const sessionContexts = new Map();

        while (page >= 1 && !stopFetchingForAgent) {
            const response = (page === 1) ? initialResponse : await client.getAgentLogs(agent.name, null, page, 100, 'Generating chat');
            const logs = response.data || [];

            // If Ascending, we process the page backwards (newest in page first)
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

                if (!sessionContexts.has(sessionId)) {
                    // ttsLogs will be an array of { msg, time }
                    sessionContexts.set(sessionId, { contextLog: null, contextTime: null, ttsLogs: [], isUniversal: false });
                }
                const current = sessionContexts.get(sessionId);

                // Handle Context Log
                if (msg.includes('context [')) {
                    const isUniversal = msg.includes('universal context');

                    if (!current.contextLog || (isUniversal && !current.isUniversal) || (isUniversal === current.isUniversal && logTime > current.contextTime)) {
                        current.contextLog = msg;
                        current.contextTime = logTime;
                        current.isUniversal = isUniversal;
                    }
                }

                // Handle TTS Log (capture potential final responses)
                if (msg.includes('Generating TTS [')) {
                    current.ttsLogs.push({ msg, time: logTime });
                }
            }

            if (isAscending) page--; else page++;
            if (page === 0) break;
            await client.delay(100);
        }

        for (const [sessionId, { contextLog, contextTime, ttsLogs }] of sessionContexts) {
            try {
                if (!contextLog) continue;

                const turns = parseContextLog(contextLog);

                // Get all TTS logs that happened AFTER the last context log
                // Sort by time to ensure correct order of speech
                const recentTTS = (ttsLogs || [])
                    .filter(t => t.time > contextTime)
                    .sort((a, b) => a.time - b.time);

                if (recentTTS.length > 0) {
                    const lastTurn = turns[turns.length - 1];
                    const messages = recentTTS.map(t => parseTTSLog(t.msg)).filter(m => m);

                    if (messages.length > 0 && lastTurn && !lastTurn.assistant_message) {
                        const finalMessage = messages.join(' ');
                        logger.info(`Found missing final response(s) for ${sessionId}, appending: "${finalMessage}"`);
                        lastTurn.assistant_message = finalMessage;
                    }
                }

                if (turns.length === 0) continue;

                const time = contextTime; // Use context time as main reference
                const parentSession = await Session.findOne({ where: { session_id: sessionId } });
                if (!parentSession) continue;

                const existing = await Conversation.findOne({ where: { session_id: sessionId } });

                // Check if we have new content to save (specifically missing assistant response)
                let isContentMissing = false;
                if (existing && existing.turns.length === turns.length) {
                    const lastTurn = turns[turns.length - 1];
                    const existingLastTurn = existing.turns[existing.turns.length - 1];
                    if (lastTurn.assistant_message && (!existingLastTurn || !existingLastTurn.assistant_message)) {
                        isContentMissing = true;
                    }
                }

                // Check if we need to generate a summary (Session ended, but no summary in DB)
                const needsSummary = existing && !existing.summary && parentSession.ended_at;

                // Skip ONLY if:
                // 1. Data matches (turns & time)
                // 2. No missing content identified
                // 3. No summary generation needed
                if (existing && existing.turns.length === turns.length && existing.last_message_at >= time && !isContentMissing && !needsSummary) {
                    continue;
                }
                if (!parentSession) continue;

                // Generate summary for sessions that:
                // 1. Have ended
                // 2. Have conversation turns
                // 3. Are RECENT (started today or later) - prevents backfilling old history
                // 4. Don't have a summary yet (handle retry if synced before end)
                let summary = null;
                const sessionEnded = parentSession.ended_at;
                const hasTurns = turns.length > 0;
                const noSummaryYet = !existing?.summary;

                // Static cutoff (Today) ensures we cover all "current" testing sessions, persisting across restarts
                const RECENT_CUTOFF = new Date('2026-01-28T00:00:00Z');
                const isRecentSession = new Date(parentSession.started_at) >= RECENT_CUTOFF;

                if (sessionEnded && hasTurns && noSummaryYet && isRecentSession) {
                    logger.info(`Generating summary for ended session: ${sessionId}`);
                    summary = await generateSummary(turns);
                } else if (existing?.summary) {
                    // Keep existing summary if we already have one
                    summary = existing.summary;
                }
                // Old sessions or not ended yet -> summary stays null/unchanged

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

                await Session.update(
                    { conversation_count: turns.length },
                    { where: { session_id: sessionId } }
                );

                totalSynced++;
            } catch (e) {
                logger.error(`Error syncing session ${sessionId}: ${e.message}`);
            }
        }
    }

    if (totalSynced > 0) {
        logger.info(`✅ Synced ${totalSynced} updated conversations`);
    }
}

async function runSyncCycle() {
    logger.info(`🔄 Sync Cycle Started at ${new Date().toISOString()}`);
    try {
        const client = new PipecatClient();
        const agents = await syncAgents(client);
        // Start incremental sync
        await syncSessions(client, agents);
        await syncConversations(client, agents);
    } catch (e) {
        logger.error('Sync Cycle Failed:', e);
    }
    logger.info(`🏁 Sync Cycle Finished. Next run in ${POLL_INTERVAL_MS / 1000}s`);
    logger.info('💤 Sleeping... (I am still alive!)');
}

async function main() {
    logger.info('🚀 Starting Realtime Dashboard Sync Service (PostgreSQL)');
    logger.info(`📅 Filtering data from: ${SYNC_START_DATE.toISOString()}`);

    try {
        await testConnection();
        // Sync Models (Create Tables if not exist)
        logger.info('🏗️  Verifying database creation (Auto-Sync)...');
        await sequelize.sync({ alter: true }); // uses ALTER TABLE to match model
        logger.info('✅ Database structure is ready.');

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

process.on('SIGINT', async () => {
    logger.info('🛑 Stopping sync service...');
    await sequelize.close();
    process.exit(0);
});

main();
