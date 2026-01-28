/**
 * Pipecat Log Normalization Layer
 *
 * This module is responsible for converting raw Pipecat logs into
 * the internal application format. Centralizing this logic here ensures
 * that if Pipecat's log format changes, we only need to update this file.
 */

/**
 * Extracts the Session ID from a log message.
 * @param {string} logMessage 
 * @returns {string|null} UUID or null
 */
function extractSessionId(logMessage) {
    const match = logMessage.match(/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
    return match ? match[1] : null;
}

/**
 * Cleans the user message by removing context, JSON blocks, and other noise.
 * @param {string} msg 
 * @returns {string} Cleaned message
 */
function cleanUserMessage(msg) {
    if (!msg) return msg;
    if (msg.includes('[KNOWLEDGE BASE CONTEXT]')) {
        let cleaned = msg.replace(/\[KNOWLEDGE BASE CONTEXT\][\s\S]*?```json[\s\S]*?```\s*/, '');
        if (cleaned.includes('[KNOWLEDGE BASE CONTEXT]')) {
            cleaned = cleaned.replace(/\[KNOWLEDGE BASE CONTEXT\][\s\S]*?\\`\\`\\`json[\s\S]*?\\`\\`\\`\s*/, '');
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
 * Parses a "context [...]" log message into a structured list of conversation turns.
 * @param {string} logMessage 
 * @returns {Array<Object>} Array of turn objects
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
 * Parses a "Generating TTS [...]" log to extract the assistant's message.
 * @param {string} logMessage 
 * @returns {string|null}Extracted message or null
 */
function parseTTSLog(logMessage) {
    const match = logMessage.match(/Generating TTS \[(.+)\]/);
    return match ? match[1] : null;
}

module.exports = {
    extractSessionId,
    cleanUserMessage,
    parseContextLog,
    parseTTSLog
};
