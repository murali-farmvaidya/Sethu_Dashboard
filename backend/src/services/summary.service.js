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

    const systemPrompt = `You are a professional conversation summarizer.

TASK:
Summarize the conversation below in 50 words or less.

LANGUAGE RULES (STRICT):
1. Detect the language used in the conversation.
2. The summary MUST be written in the SAME language as the conversation.
   - Conversation in English -> Summary in English.
   - Conversation in Telugu -> Summary in Telugu (Telugu script).
   - Conversation in Hindi -> Summary in Hindi (Devanagari script).
3. DEFAULT: If you are unsure or if the conversation is in English, you MUST write the summary in English.
4. Do NOT translate from one language to another. If the text is English, do NOT output Telugu.

CONTENT:
- Briefly state the user's intent or problem.
- Briefly state the response or solution provided.
- Keep it concise and under 50 words.`;

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
