const axios = require('axios');
const logger = require('../utils/logger');

class ExotelService {
    constructor() {
        this.apiKey = process.env.EXOTEL_API_KEY;
        this.apiToken = process.env.EXOTEL_API_TOKEN;
        this.accountSid = process.env.EXOTEL_ACCOUNT_SID || 'farmvaidya1';
        this.subdomain = process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com';
    }

    /**
     * Fetch recording URL for a given CallSid
     * @param {string} callSid 
     * @returns {Promise<string|null>}
     */
    async getRecordingUrl(callSid) {
        if (!this.apiKey || !this.apiToken) {
            logger.warn('Exotel API credentials not configured');
            return null;
        }

        try {
            const auth = Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64');
            const url = `https://${this.subdomain}/v1/Accounts/${this.accountSid}/Calls/${callSid}.json?RecordingUrlValidity=60`;

            logger.debug(`Fetching Exotel call details from: ${url}`);

            const response = await axios.get(url, {
                headers: {
                    'Authorization': `Basic ${auth}`
                }
            });

            if (response.data && response.data.Call) {
                let recordingUrl = response.data.Call.PreSignedRecordingUrl || response.data.Call.RecordingUrl;

                // Ensure HTTPS
                if (recordingUrl && recordingUrl.startsWith('http:')) {
                    recordingUrl = recordingUrl.replace('http:', 'https:');
                }

                return recordingUrl;
            }

            return null;
        } catch (error) {
            logger.error(`Failed to fetch Exotel recording for ${callSid}: ${error.message}`);
            return null;
        }
    }
}

module.exports = new ExotelService();
