
export const getDynamicGreeting = (req, res) => {
    // Exotel sends query params like: CallSid, From, To, CustomField
    const customField = req.query.CustomField;
    let greetingText = "Hello, welcome to Farm Vaidya.";

    if (customField) {
        try {
            // Try parsing if it's JSON
            const data = JSON.parse(customField);
            if (data.greeting) greetingText = data.greeting;
        } catch (e) {
            // If not JSON, use as plain text
            greetingText = customField;
        }
    }

    // Exotel requires text/plain for TTS
    res.set('Content-Type', 'text/plain');
    res.send(greetingText);
};
