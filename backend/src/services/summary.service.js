/**
 * OpenAI Summary Service
 * Generates conversation summaries using GPT-4o-mini
 */

const axios = require('axios');
const logger = require('../utils/logger');

// AI Configuration (Supports both OpenAI and Azure OpenAI)
const isAzure = !!process.env.AZURE_OPENAI_API_KEY;
const OPENAI_API_KEY = (process.env.AZURE_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '').trim();
const AZURE_ENDPOINT = (process.env.AZURE_OPENAI_ENDPOINT || '').trim();
const AZURE_DEPLOYMENT = (process.env.AZURE_OPENAI_DEPLOYMENT_ID || 'gpt-4o-mini').trim();
const AZURE_VERSION = (process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview').trim();

const getOpenAIUrl = () => {
    if (isAzure) {
        if (!AZURE_ENDPOINT) {
            logger.error('❌ AZURE_OPENAI_ENDPOINT is not defined in .env');
            return null;
        }
        const base = AZURE_ENDPOINT.endsWith('/') ? AZURE_ENDPOINT.slice(0, -1) : AZURE_ENDPOINT;
        const url = `${base}/openai/deployments/${AZURE_DEPLOYMENT}/chat/completions?api-version=${AZURE_VERSION}`;
        logger.debug(`🤖 AI Service URL: ${url}`);
        return url;
    }
    return 'https://api.openai.com/v1/chat/completions';
};

const getOpenAIHeaders = () => {
    if (isAzure) {
        return {
            'api-key': OPENAI_API_KEY,
            'Content-Type': 'application/json'
        };
    }
    return {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
    };
};

/**
 * Generates a ~50 word summary of a conversation.
 * @param {Array} turns - Array of conversation turn objects { user_message, assistant_message }
 * @returns {Promise<string|null>} The summary or null on failure.
 */
async function generateSummary(turns) {
    if (!turns || turns.length === 0) {
        return null;
    }

    const url = getOpenAIUrl();
    if (!OPENAI_API_KEY || !url) {
        logger.warn('AI Configuration Missing. Skipping summary generation.');
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
            getOpenAIUrl(),
            {
                ...(!isAzure && { model: 'gpt-4o-mini' }),
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: conversationText }
                ],
                max_tokens: 100,
                temperature: 0.3
            },
            {
                headers: getOpenAIHeaders(),
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
        if (error.response) {
            logger.error(`AI Service Error (${error.response.status}):`, error.response.data);
        } else {
            logger.error('AI summary generation failed:', error.message);
        }
        return null;
    }
}

module.exports = {
    generateSummary
};
