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
 * Parse raw messages from context array content string
 * Handles unescaped quotes by checking for delimiters
 */
function parseRawMessages(arrayContent) {
    const messages = [];
    let pos = 0;

    while (pos < arrayContent.length) {
        // Find next role definition (user or assistant)
        // Support both single and double quotes
        // We look for the start of a role definition
        const patterns = [
            { type: 'user', str: "'role': 'user'" },
            { type: 'assistant', str: "'role': 'assistant'" },
            { type: 'user', str: '"role": "user"' },
            { type: 'assistant', str: '"role": "assistant"' }
        ];

        let nextMsgPos = -1;
        let type = '';
        let matchedPatternLength = 0;

        for (const p of patterns) {
            const idx = arrayContent.indexOf(p.str, pos);
            if (idx !== -1) {
                if (nextMsgPos === -1 || idx < nextMsgPos) {
                    nextMsgPos = idx;
                    type = p.type;
                    matchedPatternLength = p.str.length;
                }
            }
        }

        if (nextMsgPos === -1) break;

        // Find content field
        // Search for 'content': ' or 'content': " or "content": "
        let contentStart = -1;
        let quoteChar = "'";
        let prefix = "";

        // Try single quote key
        const sqContent1 = arrayContent.indexOf("'content': '", nextMsgPos);
        const sqContent2 = arrayContent.indexOf("'content': \"", nextMsgPos);

        // Try double quote key
        const dqContent = arrayContent.indexOf('"content": "', nextMsgPos);
        const dqContent2 = arrayContent.indexOf('"content": \'', nextMsgPos); // "content": '

        // Find the earliest content field after the role
        const candidates = [];
        // Ensure candidate is AFTER the role definition
        if (sqContent1 !== -1 && sqContent1 > nextMsgPos) candidates.push({ pos: sqContent1, q: "'", pre: "'content': '" });
        if (sqContent2 !== -1 && sqContent2 > nextMsgPos) candidates.push({ pos: sqContent2, q: '"', pre: "'content': \"" });
        if (dqContent !== -1 && dqContent > nextMsgPos) candidates.push({ pos: dqContent, q: '"', pre: '"content": "' });
        if (dqContent2 !== -1 && dqContent2 > nextMsgPos) candidates.push({ pos: dqContent2, q: "'", pre: '"content": \'' });

        candidates.sort((a, b) => a.pos - b.pos);

        const best = candidates[0];

        if (!best) {
            pos = nextMsgPos + matchedPatternLength;
            continue;
        }

        contentStart = best.pos;
        quoteChar = best.q;
        prefix = best.pre;

        const contentValueStart = contentStart + prefix.length;
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
                // Check for delimiters indicating end of value: }, , } (followed by newline), },
                // Also handle JSON style "}," or "}\n"
                const afterTrimmed = after.trim();
                // We check the raw 'after' string first for strict matches usually found in python repr
                if (after.startsWith('}') || after.startsWith(',') || after.startsWith('}\n') || after.startsWith('},')) {
                    break;
                }
                // Fallback for JSON or loose spacing
                if (afterTrimmed.startsWith('}') || afterTrimmed.startsWith(',')) {
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

    return messages;
}

/**
 * Parse turn-based log format (webagent style)
 * Extracts conversation turns from context [...] structure
 */
function parseContextLog(logMessage) {
    const turns = [];
    const arrayMatch = logMessage.match(/context \[(.+)\]$/s);
    if (!arrayMatch) return [];

    const messages = parseRawMessages(arrayMatch[1]);

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

    // Match BakBak TTS format:
    // BakBak TTS: Generating speech for text: [text]
    const match3 = logMessage.match(/Generating speech for text:\s*\[(.+)\]/);
    if (match3) return match3[1];

    // Additional Patterns for consistency
    // "TTS input: [text]"
    const match4 = logMessage.match(/TTS input:\s*\[(.+)\]/);
    if (match4) return match4[1];

    // "Generating response: [text]"
    const match5 = logMessage.match(/Generating response:\s*\[(.+)\]/);
    if (match5) return match5[1];

    // "Speaking: [text]"
    const match6 = logMessage.match(/Speaking:\s*\[(.+)\]/);
    if (match6) return match6[1];

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
        return msg && (msg.includes('Generating TTS') || msg.includes('Generating speech for text'));
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
 * @param {Array} logs - Log entries
 * @param {string} [targetSessionId] - If provided, assign all logs to this session
 *   (used when logs are already pre-filtered by session at the API level)
 */
function parseEventBasedLogs(logs, targetSessionId = null) {
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
        // If targetSessionId is provided, attribute ALL logs to that session
        // (they were already filtered by session at the API level via query param)
        const sessionId = targetSessionId || extractSessionId(logMsg);
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
                // Use robust parser instead of regex
                const contextMatch = msg.match(/context \[(.+)\]/s);
                if (contextMatch) {
                    const extractedMsgs = parseRawMessages(contextMatch[1]);
                    // Get the last user message
                    for (let i = extractedMsgs.length - 1; i >= 0; i--) {
                        if (extractedMsgs[i].role === 'user') {
                            userTranscription = extractedMsgs[i].content.trim();
                            break;
                        }
                    }
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
            if (msg.includes('Generating TTS') || msg.includes('Generating speech for text')) {
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
 * Extract telephony metadata (CallSid, transport, etc.) from log line
 */
function extractTelephonyMetadata(logMessage) {
    // Standard patterns
    const patterns = [
        /Call ID:\s*([a-zA-Z0-9_-]+)/i,
        /CallSid:\s*([a-zA-Z0-9_-]+)/i,
        /sid:\s*([a-zA-Z0-9_-]+)/i,
        /exotel_call_id:\s*([a-zA-Z0-9_-]+)/i,
        /Conversation ID:\s*([a-zA-Z0-9_-]+)/i,
        /'sid':\s*['"]([a-zA-Z0-9_-]+)['"]/,
        /"sid":\s*"([a-zA-Z0-9_-]+)"/,
        /'call_id':\s*['"]([a-zA-Z0-9_-]+)['"]/,
        /"call_id":\s*"([a-zA-Z0-9_-]+)"/,
        /'exid':\s*['"]([a-zA-Z0-9_-]+)['"]/,
        /"exid":\s*"([a-zA-Z0-9_-]+)"/
    ];

    const metadata = {};
    for (const pattern of patterns) {
        const match = logMessage.match(pattern);
        if (match && match[1]) {
            // Basic validation for length to avoid false positives (most IDs are 20+ chars)
            if (match[1].length > 10) {
                metadata.call_id = match[1];
                break;
            }
        }
    }

    // Transport detection
    const transportMatch = logMessage.match(/Auto-detected transport:\s*(\w+)/i);
    if (transportMatch) metadata.transport = transportMatch[1].toLowerCase();

    // Account SID
    const accountSidMatch = logMessage.match(/'account_sid':\s*['"]([^'"]+)['"]/);
    if (accountSidMatch) metadata.account_sid = accountSidMatch[1];

    return Object.keys(metadata).length > 0 ? metadata : null;
}

/**
 * Main normalization function - dynamically handles different log formats.
 * Tries BOTH context-based and event-based parsing, then merges for best quality.
 * 
 * Context-based: Extracts user/assistant pairs from LLM context snapshots.
 *   - PRO: Has full conversation history including older assistant responses.
 *   - CON: The LAST turn's assistant response is ALWAYS missing (context is
 *     what was sent TO the LLM, not the LLM's response).
 * 
 * Event-based: Assembles turns from speech events + TTS generation events.
 *   - PRO: Captures ALL assistant responses via TTS (including the latest one).
 *   - CON: May miss turns if speech events were not logged or paginated out.
 * 
 * Strategy: Try both, pick the one with more COMPLETE turns (both user + assistant),
 * then fill any remaining holes from the other method.
 * 
 * @param {Array} logs - Log entries
 * @param {string} [targetSessionId] - If provided, attribute all logs to this session
 *   (used when logs are pre-filtered by session at API level)
 */
function normalizeLogs(logs, targetSessionId = null) {
    // ===== 1. Try context-based parsing (from LLM context snapshots) =====
    let contextTurns = [];
    for (const log of logs) {
        const msg = typeof log === 'string' ? log : (log.log || log.message || '');
        if (msg.includes('context [')) {
            const turns = parseContextLog(msg);
            if (turns.length > contextTurns.length) {
                contextTurns = turns;
            }
        }
    }

    // ===== 2. Try event-based parsing (from speech/TTS/RAG events) =====
    const eventTurns = parseEventBasedLogs(logs, targetSessionId);

    // ===== 3. No data from either → return empty =====
    if (contextTurns.length === 0 && eventTurns.length === 0) {
        return [];
    }

    // ===== 4. Only one method produced results → use that =====
    if (contextTurns.length === 0) return eventTurns;
    if (eventTurns.length === 0) return contextTurns;

    // ===== 5. Both produced results → pick best, then merge gaps =====
    const contextCompleteCount = contextTurns.filter(t => t.user_message && t.assistant_message).length;
    const eventCompleteCount = eventTurns.filter(t => t.user_message && t.assistant_message).length;
    const contextBotCount = contextTurns.filter(t => t.assistant_message).length;
    const eventBotCount = eventTurns.filter(t => t.assistant_message).length;

    let primary, secondary;

    // Pick whichever has more COMPLETE turns (both user + assistant)
    if (eventCompleteCount > contextCompleteCount) {
        primary = eventTurns;
        secondary = contextTurns;
    } else if (contextCompleteCount > eventCompleteCount) {
        primary = contextTurns;
        secondary = eventTurns;
    } else if (eventBotCount > contextBotCount) {
        // Tied on complete count: prefer more bot responses (event-based captures TTS)
        primary = eventTurns;
        secondary = contextTurns;
    } else if (contextBotCount > eventBotCount) {
        primary = contextTurns;
        secondary = eventTurns;
    } else if (eventTurns.length > contextTurns.length) {
        // Tied on everything quality-wise: prefer more total turns
        primary = eventTurns;
        secondary = contextTurns;
    } else if (contextTurns.length > eventTurns.length) {
        primary = contextTurns;
        secondary = eventTurns;
    } else {
        // Complete tie: prefer event-based (captures latest TTS response)
        primary = eventTurns;
        secondary = contextTurns;
    }

    // ===== 6. Merge: fill missing fields in primary from secondary =====
    for (let i = 0; i < primary.length && i < secondary.length; i++) {
        if (!primary[i].assistant_message && secondary[i].assistant_message) {
            primary[i].assistant_message = secondary[i].assistant_message;
        }
        if (!primary[i].user_message && secondary[i].user_message) {
            primary[i].user_message = secondary[i].user_message;
        }
    }

    return primary;
}

module.exports = {
    extractSessionId,
    extractTimestamp,
    cleanUserMessage,
    parseContextLog,
    parseTTSLog,
    detectLogFormat,
    parseEventBasedLogs,
    normalizeLogs,
    extractTelephonyMetadata
};
