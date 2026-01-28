
const { parseContextLog, parseTTSLog, extractSessionId } = require('./src/services/pipecat_normalization');

// Simulated Logs from the file provided
const logs = [
    {
        timestamp: "2026-01-28T09:00:23.557Z",
        log: "2026-01-28 09:00:23.557 | DEBUG | pipecat.services.openai.base_llm:_stream_chat_completions_universal_context:331 | fa0489e4-b49c-4bc0-a116-4953c784ea6d - AzureOpenAILLMService#20: Generating chat from universal context [{'role': 'system', 'content': '...'}, {'role': 'user', 'content': 'Tell me about your company.'}, {'role': 'assistant', 'content': 'Farm Vaidya is a team of agriculture experts...'}, {'role': 'user', 'content': 'Who is the CEO?'}]"
    },
    {
        timestamp: "2026-01-28T09:00:25.127Z",
        log: "2026-01-28 09:00:25.127 | DEBUG | pipecat_murf_tts.tts:run_tts:487 | fa0489e4-b49c-4bc0-a116-4953c784ea6d - MurfTTSService#20: Generating TTS [The CEO of Farm Vaidya is Dr. Ramadugu Praveen.]"
    },
    {
        timestamp: "2026-01-28T09:00:25.129Z",
        log: "2026-01-28 09:00:25.129 | DEBUG | pipecat_murf_tts.tts:run_tts:487 | fa0489e4-b49c-4bc0-a116-4953c784ea6d - MurfTTSService#20: Generating TTS [He has extensive experience in horticulture and agricultural science.]"
    }
];

function runTest() {
    const sessionContexts = new Map();
    const sessionId = "fa0489e4-b49c-4bc0-a116-4953c784ea6d";

    sessionContexts.set(sessionId, { contextLog: null, contextTime: null, ttsLogs: [], isUniversal: false });
    const current = sessionContexts.get(sessionId);

    // 1. Process Logs
    for (const log of logs) {
        const logTime = new Date(log.timestamp);
        const msg = log.log;

        if (msg.includes('context [')) {
            current.contextLog = msg;
            current.contextTime = logTime;
            console.log("Set context time:", logTime.toISOString());
        }

        if (msg.includes('Generating TTS [')) {
            current.ttsLogs.push({ msg, time: logTime });
            console.log("Added TTS log time:", logTime.toISOString());
        }
    }

    // 2. Merge Logic (copied from sync-realtime.js)
    const turns = parseContextLog(current.contextLog);
    console.log("Initial final turn:", turns[turns.length - 1]);

    const recentTTS = (current.ttsLogs || [])
        .filter(t => t.time > current.contextTime)
        .sort((a, b) => a.time - b.time);

    console.log("Found recent TTS:", recentTTS.length);

    if (recentTTS.length > 0) {
        const lastTurn = turns[turns.length - 1];
        const messages = recentTTS.map(t => parseTTSLog(t.msg)).filter(m => m);

        console.log("Extracted messages:", messages);

        if (messages.length > 0 && lastTurn && !lastTurn.assistant_message) {
            const finalMessage = messages.join(' ');
            lastTurn.assistant_message = finalMessage;
            console.log("UPDATED final turn:", lastTurn);
        } else {
            console.log("Did NOT update. Lastturn assistant msg:", lastTurn?.assistant_message);
        }
    }
}

runTest();
