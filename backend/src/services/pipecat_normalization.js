/**
 * Enhanced Pipecat Log Normalization Layer
 * 
 * Supports both turn-based and event-based log formats:
 * - Turn-based: Full conversation context in single log (webagent style)
 * - Event-based: Multiple events per turn requiring assembly (biolmin style)
 * 
 * @module pipecat_normalization
 */

/**
 * Extract session ID from log message using UUID pattern
 */
function extractSessionId(logMessage) {
    const match = logMessage.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    return match ? match[1] : null;
}

/**
 * Extract timestamp from log message
 */
function extractTimestamp(logMessage) {
    // Match format: Jan 29 10:36:53.714 2026-01-29 05:06:53.714
    const match = logMessage.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d{3})/);
    if (match) {
        return new Date(match[1]);
    }
    return new Date();
}

/**
 * Clean user message by removing knowledge base context and other noise
 */
function cleanUserMessage(msg) {
    if (!msg) return msg;

    // Remove knowledge base context block
    if (msg.includes('[KNOWLEDGE BASE CONTEXT]')) {
        let cleaned = msg.replace(/\[KNOWLEDGE BASE CONTEXT\][\s\S]*?```json[\s\S]*?```\s*/, '');
        if (cleaned.includes('[KNOWLEDGE BASE CONTEXT]')) {
            cleaned = cleaned.replace(/\[KNOWLEDGE BASE CONTEXT\][\s\S]*?`\\`\\`\\`json[\s\S]*?`\\`\\`\\`\s*/, '');
        }
        if (cleaned.includes('[KNOWLEDGE BASE CONTEXT]')) {
            const parts = cleaned.split('\n');
            for (let i = parts.length - 1; i >= 0; i--) {
                const line = parts[i].trim();
                if (line.length > 0 && !line.includes('```') && !line.includes('---')) {
                    return line;
                }
            }
        }
        return cleaned.trim();
    }

    return msg;
}

/**
 * Parse turn-based log format (webagent style)
 * Extracts conversation turns from context [...] structure
 */
function parseContextLog(logMessage) {
    const turns = [];
    const arrayMatch = logMessage.match(/context \[(.+)\]$/s);
    if (!arrayMatch) return [];

    const arrayContent = arrayMatch[1];
    const messages = [];
    let pos = 0;

    while (pos < arrayContent.length) {
        const userMatch = arrayContent.indexOf("'role': 'user'", pos);
        const assistantMatch = arrayContent.indexOf("'role': 'assistant'", pos);

        let nextMsgPos = -1;
        let type = '';

        if (userMatch !== -1 && (assistantMatch === -1 || userMatch < assistantMatch)) {
            nextMsgPos = userMatch;
            type = 'user';
        } else if (assistantMatch !== -1) {
            nextMsgPos = assistantMatch;
            type = 'assistant';
        }

        if (nextMsgPos === -1) break;

        let contentStart = arrayContent.indexOf("'content': '", nextMsgPos);
        let quoteChar = "'";

        const doubleQuoteStart = arrayContent.indexOf("'content': \"", nextMsgPos);

        if (contentStart === -1 || (doubleQuoteStart !== -1 && doubleQuoteStart < contentStart)) {
            contentStart = doubleQuoteStart;
            quoteChar = '"';
        }

        if (contentStart === -1) {
            pos = nextMsgPos + 10;
            continue;
        }

        const contentValueStart = contentStart + ` 'content': ${quoteChar}`.length - 1;

        let contentEnd = contentValueStart;
        let escaped = false;

        while (contentEnd < arrayContent.length) {
            const char = arrayContent[contentEnd];
            if (escaped) {
                escaped = false;
            } else if (char === '\\') {
                escaped = true;
            } else if (char === quoteChar) {
                const after = arrayContent.substring(contentEnd + 1, contentEnd + 3);
                if (after.startsWith('}') || after.startsWith(', ') || after.startsWith('}\n') || after.startsWith('},')) {
                    break;
                }
            }
            contentEnd++;
        }

        const content = arrayContent.substring(contentValueStart, contentEnd)
            .replace(/\\'/g, "'")
            .replace(/\\"/g, '"')
            .replace(/\\n/g, "\n");

        messages.push({ role: type, content });
        pos = contentEnd + 1;
    }

    let turnId = 0;
    for (let i = 0; i < messages.length; i++) {
        if (messages[i].role === 'user') {
            turnId++;
            const userMsg = cleanUserMessage(messages[i].content);

            const turn = {
                turn_id: turnId,
                user_message: userMsg,
                assistant_message: null,
                timestamp: new Date()
            };

            if (i + 1 < messages.length && messages[i + 1].role === 'assistant') {
                turn.assistant_message = messages[i + 1].content;
                i++;
            }

            if (turn.user_message && turn.user_message.trim().length > 0) {
                turns.push(turn);
            }
        }
    }

    return turns;
}

/**
 * Extract TTS text from Generating TTS log
 */
function parseTTSLog(logMessage) {
    // Match both formats:
    // MurfTTSService#20: Generating TTS [text]
    // Generating TTS: [text]
    const match1 = logMessage.match(/Generating TTS \[(.+)\]/);
    if (match1) return match1[1];

    const match2 = logMessage.match(/Generating TTS:\s*\[(.+)\]/);
    if (match2) return match2[1];

    return null;
}

/**
 * Detect log format based on patterns in log entries
 */
function detectLogFormat(logs) {
    if (!logs || logs.length === 0) return 'unknown';

    // Helper to get log message from various formats
    const getLogMessage = (log) => {
        if (typeof log === 'string') return log;
        if (log.log) return log.log;
        if (log.message) return log.message;
        return '';
    };

    // Check for turn-based indicators - look for conversation context logs
    // Pattern: "context [{'role': 'user'..." or "context [{"role": "user"..."
    const hasContextLogs = logs.some(log => {
        const msg = getLogMessage(log);
        if (!msg) return false;

        // Must have "context [" followed by role-based conversation structure
        if (msg.includes('context [')) {
            // Check if it's actual conversation context (contains 'role')
            return msg.includes("'role'") || msg.includes('"role"');
        }
        return false;
    });

    // Check for event-based indicators
    const hasUserSpeaking = logs.some(log => {
        const msg = getLogMessage(log);
        return msg && (msg.includes('User started speaking') || msg.includes('User stopped speaking'));
    });

    const hasTTSEvents = logs.some(log => {
        const msg = getLogMessage(log);
        return msg && msg.includes('Generating TTS');
    });

    // Prioritize event-based because it captures real-time events and final responses better than context snapshots
    if (hasUserSpeaking || hasTTSEvents) {
        return 'event-based';
    } else if (hasContextLogs) {
        return 'turn-based';
    }

    return 'unknown';
}

/**
 * Parse event-based logs (biolmin style)
 * Assembles conversation turns from individual speech and TTS events
 */
function parseEventBasedLogs(logs) {
    const turns = [];
    const sessionEvents = new Map(); // Group events by session

    // Helper to get log message
    const getLogMessage = (log) => {
        if (typeof log === 'string') return log;
        if (log.log) return log.log;
        if (log.message) return log.message;
        return '';
    };

    // Helper to get timestamp
    const getTimestamp = (log) => {
        if (log.timestamp) return new Date(log.timestamp);
        return new Date();
    };

    // Group all events by session
    for (const log of logs) {
        const logMsg = getLogMessage(log);
        const sessionId = extractSessionId(logMsg);
        if (!sessionId) continue;

        if (!sessionEvents.has(sessionId)) {
            sessionEvents.set(sessionId, []);
        }

        sessionEvents.get(sessionId).push({
            message: logMsg,
            timestamp: getTimestamp(log)
        });
    }

    // Process each session's events
    for (const [sessionId, events] of sessionEvents) {
        // Sort by timestamp
        events.sort((a, b) => a.timestamp - b.timestamp);

        let turnId = 0;
        let currentTurn = null;
        let userSpeakingStart = null;


        for (const event of events) {
            const msg = event.message;

            // Extract user message from RAG retrieval logs
            let userTranscription = null;
            if (msg.includes('chars for:')) {
                const match = msg.match(/chars for:\s*['"](.+?)['"]/);
                if (match) {
                    userTranscription = match[1].trim().replace(/\.+$/, '');
                }
            }

            // Backup detection from "Query preprocessed" logs
            if (!userTranscription && msg.includes('Query preprocessed:')) {
                const match = msg.match(/Query preprocessed:.*→\s*['"](.+?)['"]/);
                if (match) {
                    userTranscription = match[1].trim();
                }
            }

            // Backup detection from Context logs (for agents like webagent)
            if (msg.includes('Generating chat from universal context') || msg.includes('context [')) {
                let lastMatch = null;

                // Python style (single quotes) - Most common in Python logs
                const singleQuoteRegex = /'role':\s*'user',\s*'content':\s*'((?:[^'\\]|\\.)*?)'/g;
                let match;
                while ((match = singleQuoteRegex.exec(msg)) !== null) {
                    lastMatch = match;
                }

                // JSON style (double quotes) - Fallback
                if (!lastMatch) {
                    const doubleQuoteRegex = /"role":\s*"user",\s*"content":\s*"((?:[^"\\]|\\.)*?)"/g;
                    while ((match = doubleQuoteRegex.exec(msg)) !== null) {
                        lastMatch = match;
                    }
                }

                if (lastMatch) {
                    // match[1] is the content capture group
                    userTranscription = lastMatch[1].trim();
                }
            }

            // Detect user speaking events - Start of NEW turn
            if (msg.includes('User started speaking') || msg.includes('Emulating user started speaking')) {
                // If we have an existing turn, it's now complete - PUSH IT
                if (currentTurn) {
                    // Use fallback if user message wasn't captured, but skip for first turn (Greeting)
                    if (!currentTurn.user_message && currentTurn.assistant_message && currentTurn.turn_id > 1) {
                        currentTurn.user_message = '[Audio input]';
                    }
                    if (currentTurn.user_message || currentTurn.assistant_message) {
                        turns.push(currentTurn);
                    }
                    currentTurn = null;
                }

                // Start tracking new turn
                userSpeakingStart = event.timestamp;
            }

            // Detect user stopped speaking (mark timestamp for current turn)
            if (msg.includes('User stopped speaking') || msg.includes('Emulating user stopped speaking')) {
                // Initialize turn if not exists (handling race conditions)
                if (!currentTurn) {
                    turnId++;
                    currentTurn = {
                        turn_id: turnId,
                        user_message: null,
                        assistant_message: null,
                        timestamp: userSpeakingStart || event.timestamp
                    };
                }
                userSpeakingStart = null;
            }

            // Capture user message from RAG retrieval (happens AFTER user stops speaking)
            // Can happen efficiently anytime
            if (userTranscription) {
                if (!currentTurn) {
                    // Out of order log? Create turn.
                    turnId++;
                    currentTurn = {
                        turn_id: turnId,
                        user_message: null,
                        assistant_message: null,
                        timestamp: event.timestamp
                    };
                }
                // Only update if not already set (keep first/best transcription)
                if (!currentTurn.user_message) {
                    currentTurn.user_message = userTranscription;
                }
            }

            // Detect assistant TTS generation
            if (msg.includes('Generating TTS')) {
                const ttsText = parseTTSLog(msg);
                if (ttsText) {
                    if (!currentTurn) {
                        // TTS without user input (e.g. welcome message)
                        turnId++;
                        currentTurn = {
                            turn_id: turnId,
                            user_message: null,
                            assistant_message: null,
                            timestamp: event.timestamp
                        };
                    }

                    if (!currentTurn.assistant_message) {
                        currentTurn.assistant_message = ttsText;
                    } else {
                        currentTurn.assistant_message += ' ' + ttsText;
                    }
                }
            }
        }

        // Push final turn
        if (currentTurn) {
            if (!currentTurn.user_message && currentTurn.assistant_message && currentTurn.turn_id > 1) {
                currentTurn.user_message = '[Audio input]';
            }
            if (currentTurn.user_message || currentTurn.assistant_message) {
                turns.push(currentTurn);
            }
        }
    }

    return turns;
}

/**
 * Main normalization function - dynamically handles different log formats
 */
function normalizeLogs(logs) {
    const format = detectLogFormat(logs);

    if (format === 'turn-based') {
        // Process turn-based logs (webagent style)
        for (const log of logs) {
            const msg = typeof log === 'string' ? log : (log.log || log.message || '');
            if (msg.includes('context [')) {
                return parseContextLog(msg);
            }
        }
    } else if (format === 'event-based') {
        // Process event-based logs (biolmin style)
        return parseEventBasedLogs(logs);
    }

    // Fallback: try both methods
    // Fallback: try both methods
    for (const log of logs) {
        const msg = typeof log === 'string' ? log : (log.log || log.message || '');
        if (msg.includes('context [')) {
            return parseContextLog(msg);
        }
    }

    // If no context logs found, try event-based parsing
    return parseEventBasedLogs(logs);
}

module.exports = {
    extractSessionId,
    extractTimestamp,
    cleanUserMessage,
    parseContextLog,
    parseTTSLog,
    detectLogFormat,
    parseEventBasedLogs,
    normalizeLogs
};
