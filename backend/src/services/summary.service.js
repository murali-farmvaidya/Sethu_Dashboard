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

    const systemPrompt = `You are an expert at summarizing customer service conversations.
Write a simple, easy-to-understand summary in 50 words or less.

IMPORTANT LANGUAGE INSTRUCTION:
- Analyze the language(s) used in the conversation below
- If the user speaks primarily in Telugu, write the summary in Telugu
- If the user speaks primarily in Hindi, write the summary in Hindi  
- If the user speaks primarily in English, write the summary in English
- If multiple languages are used, choose the language the USER spoke the most
- The summary MUST be in the same language as the user's primary language

Focus on: what the user asked about, what help was given, and how it ended.
Avoid technical words. Be clear and friendly.`;

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
