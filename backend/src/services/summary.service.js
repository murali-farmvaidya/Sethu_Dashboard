/**
 * OpenAI Summary Service
 * Generates conversation summaries using GPT-4o-mini
 */

const axios = require('axios');
const logger = require('../utils/logger');

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/**
 * Generates a ~50 word summary of a conversation.
 * @param {Array} turns - Array of conversation turn objects { user_message, assistant_message }
 * @returns {Promise<string|null>} The summary or null on failure.
 */
async function generateSummary(turns) {
    if (!turns || turns.length === 0) {
        return null;
    }

    if (!OPENAI_API_KEY) {
        logger.warn('OPENAI_API_KEY not set. Skipping summary generation.');
        return null;
    }

    // Format conversation for the prompt
    const conversationText = turns.map((t, i) => {
        let text = `User: ${t.user_message || '(empty)'}`;
        if (t.assistant_message) {
            text += `\nAssistant: ${t.assistant_message}`;
        }
        return text;
    }).join('\n---\n');

    const systemPrompt = `You are an expert conversation summarizer for a multilingual agricultural bot.

TASK:
Generate a concise summary (under 50 words) of the conversation below.

STRICT LANGUAGE RULES (Mandatory):
1. First, ENABLE "Language Detection Mode". Scan the "Assistant" and "User" messages to identify the Primary Language.
   - If the majority of the text script (especially the Assistant's responses) is in Telugu script -> The Primary Language is TELUGU.
   - If the majority is in Hindi script -> The Primary Language is HINDI.
   - If the majority is in English text -> The Primary Language is ENGLISH.

2. The Output Summary MUST be written exclusively in that **Primary Language**.
   - **Conversation in English** => **Summary in English**
   - **Conversation in Telugu** => **Summary in Telugu** (Use Telugu Script)
   - **Conversation in Hindi** => **Summary in Hindi** (Use Devanagari Script)

3. Do NOT translate. If the conversation is in English, do NOT output Telugu. If the conversation is in Telugu, do NOT output English.

CONTENT STRUCTURE:
- Briefly state the User's main query.
- Briefly state the advice given.
- Keep it under 50 words.`;

    try {
        const response = await axios.post(
            OPENAI_API_URL,
            {
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: conversationText }
                ],
                max_tokens: 100,
                temperature: 0.3
            },
            {
                headers: {
                    'Authorization': `Bearer ${OPENAI_API_KEY}`,
                    'Content-Type': 'application/json'
                },
                timeout: 30000
            }
        );

        const summary = response.data?.choices?.[0]?.message?.content?.trim();
        if (summary) {
            logger.debug(`Generated summary: ${summary.substring(0, 50)}...`);
            return summary;
        }
        return null;
    } catch (error) {
        logger.error('OpenAI summary generation failed:', error.message);
        return null;
    }
}

module.exports = {
    generateSummary
};
