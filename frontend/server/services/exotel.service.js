import axios from 'axios';
import fs from 'fs';
import FormData from 'form-data';
import path from 'path';

class ExotelService {
    constructor() {
        this.apiKey = process.env.EXOTEL_API_KEY;
        this.apiToken = process.env.EXOTEL_API_TOKEN;
        this.accountSid = process.env.EXOTEL_ACCOUNT_SID || 'farmvaidya1';
        this.subdomain = process.env.EXOTEL_SUBDOMAIN || 'api.exotel.com';

        if (!this.apiKey || !this.apiToken) {
            console.warn('⚠️ Exotel credentials not configured in exotel.service');
        }
    }

    async createList(name) {
        try {
            const auth = Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64');
            const url = `https://${this.subdomain}/v2/accounts/${this.accountSid}/lists`;

            const response = await axios.post(url, {
                lists: [{ name }]
            }, {
                headers: { 'Authorization': `Basic ${auth}` }
            });

            return response.data;
        } catch (error) {
            console.error(`Exotel createList error: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`);
            throw error;
        }
    }


    // Create new contacts or get existing SIDs if they exist
    async createContacts(contactsArray) {
        try {
            const auth = Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64');
            const url = `https://${this.subdomain}/v2/accounts/${this.accountSid}/contacts`;

            console.log(`📡 Creating/Finding ${contactsArray.length} contacts via JSON API...`);

            const response = await axios.post(url, { contacts: contactsArray }, {
                headers: { 'Authorization': `Basic ${auth}` }
            });

            return response.data;
        } catch (error) {
            console.error(`Exotel createContacts error: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`);
            throw error;
        }
    }

    // Add contact SIDs to a list
    async addContactsToList(listSid, contactSids) {
        try {
            const auth = Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64');
            const url = `https://${this.subdomain}/v2/accounts/${this.accountSid}/lists/${listSid}/contacts`;

            const contactReferences = contactSids.map(sid => ({ contact_sid: sid }));
            console.log(`🔗 Adding ${contactReferences.length} contacts to List ${listSid}...`);

            const response = await axios.post(url, { contact_references: contactReferences }, {
                headers: { 'Authorization': `Basic ${auth}` }
            });

            return response.data;
        } catch (error) {
            console.error(`Exotel addContactsToList error: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`);
            throw error;
        }
    }



    // Fetch all contacts with pagination
    async getAllContacts() {
        try {
            const auth = Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64');
            let allContacts = [];
            let offset = 0;
            const limit = 1000; // Max allowed by Exotel usually
            let more = true;

            console.log('🔄 Fetching all contacts from Exotel to resolve SIDs...');

            while (more) {
                const url = `https://${this.subdomain}/v2/accounts/${this.accountSid}/contacts?limit=${limit}&offset=${offset}`;
                const response = await axios.get(url, { headers: { 'Authorization': `Basic ${auth}` } });

                const contacts = response.data.response || []; // Adjust based on actual response structure
                if (contacts.length === 0) {
                    more = false;
                } else {
                    allContacts = allContacts.concat(contacts);
                    offset += limit;
                    if (contacts.length < limit) more = false;
                }
            }

            console.log(`✅ Fetched ${allContacts.length} existing contacts.`);
            return allContacts;
        } catch (error) {
            console.error(`Exotel getAllContacts error: ${error.message}`);
            // If 404/empty, return empty array
            return [];
        }
    }

    async addContactsFromCsv(listName, filePath) {
        try {
            const auth = Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64');
            const url = `https://${this.subdomain}/v2/accounts/${this.accountSid}/contacts/csv-upload`;

            // Read the file into a buffer so form-data can properly calculate Content-Length
            const fileBuffer = fs.readFileSync(filePath);
            const fileName = path.basename(filePath);

            const form = new FormData();
            form.append('list_name', listName);
            form.append('file_name', fileBuffer, { // Exotel V2 CSV upload expects file_name
                filename: fileName,
                contentType: 'text/csv'
            });

            console.log(`📤 Uploading CSV to Exotel: ${fileName} (${fileBuffer.length} bytes) to list "${listName}"`);

            const response = await axios.post(url, form, {
                headers: {
                    'Authorization': `Basic ${auth}`,
                    ...form.getHeaders()
                },
                maxContentLength: Infinity,
                maxBodyLength: Infinity
            });

            return response.data;
        } catch (error) {
            console.error(`Exotel addContactsFromCsv error: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`);
            throw error;
        }
    }

    async createCampaign(campaignData) {
        try {
            const auth = Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64');
            const url = `https://${this.subdomain}/v2/accounts/${this.accountSid}/campaigns`;

            const response = await axios.post(url, {
                campaigns: [campaignData]
            }, {
                headers: { 'Authorization': `Basic ${auth}` }
            });

            return response.data;
        } catch (error) {
            console.error(`Exotel createCampaign error: ${error.response?.data ? JSON.stringify(error.response.data) : error.message}`);
            throw error;
        }
    }

    async getUploadStatus(uploadId) {
        try {
            const auth = Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64');
            const url = `https://${this.subdomain}/v2/accounts/${this.accountSid}/csv-status/${uploadId}`;
            const response = await axios.get(url, { headers: { 'Authorization': `Basic ${auth}` } });
            return response.data;
        } catch (error) {
            console.error(`Exotel getUploadStatus error: ${error.message}`);
            throw error;
        }
    }

    async getCampaignDetails(campaignId) {
        try {
            const auth = Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64');
            const url = `https://${this.subdomain}/v2/accounts/${this.accountSid}/campaigns/${campaignId}`;
            const response = await axios.get(url, { headers: { 'Authorization': `Basic ${auth}` } });
            return response.data;
        } catch (error) {
            console.error(`Exotel getCampaignDetails error: ${error.message}`);
            throw error;
        }
    }
    async getAllCampaigns() {
        try {
            const auth = Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64');
            const url = `https://${this.subdomain}/v2/accounts/${this.accountSid}/campaigns`;
            const response = await axios.get(url, { headers: { 'Authorization': `Basic ${auth}` } });
            return response.data;
        } catch (error) {
            console.error(`Exotel getAllCampaigns error: ${error.message}`);
            throw error;
        }
    }

    async getCampaignCallDetails(campaignId) {
        try {
            const auth = Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64');
            const url = `https://${this.subdomain}/v2/accounts/${this.accountSid}/campaigns/${campaignId}/call-details`;
            const response = await axios.get(url, { headers: { 'Authorization': `Basic ${auth}` } });
            return response.data;
        } catch (error) {
            if (error.response && error.response.status === 404) {
                // Suppress 404 for new campaigns with no calls yet
                return { response: [] };
            }
            console.error(`Exotel getCampaignCallDetails error: ${error.message}`);
            throw error;
        }
    }

    async stopCampaign(campaignId) {
        try {
            const auth = Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64');
            const url = `https://${this.subdomain}/v2/accounts/${this.accountSid}/campaigns/${campaignId}`;
            // Exotel V2 requires 'campaigns' array wrapper even for single resource update if error says 'Campaigns is mandatory'
            const response = await axios.put(url, {
                campaigns: [{ action: 'pause' }]
            }, {
                headers: { 'Authorization': `Basic ${auth}` }
            });
            return response.data;
        } catch (error) {
            console.error('Stop Campaign Error:', error.response?.data || error.message);
            throw error;
        }
    }

    async resumeCampaign(campaignId) {
        try {
            const auth = Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64');
            const url = `https://${this.subdomain}/v2/accounts/${this.accountSid}/campaigns/${campaignId}`;
            const response = await axios.put(url, {
                campaigns: [{ action: 'resume' }]
            }, {
                headers: { 'Authorization': `Basic ${auth}` }
            });
            return response.data;
        } catch (error) {
            console.error('Resume Campaign Error:', error.response?.data || error.message);
            throw error;
        }
    }

    async completeCampaign(campaignId) {
        try {
            const auth = Buffer.from(`${this.apiKey}:${this.apiToken}`).toString('base64');
            const url = `https://${this.subdomain}/v2/accounts/${this.accountSid}/campaigns/${campaignId}`;
            const response = await axios.put(url, {
                campaigns: [{ action: 'complete' }]
            }, {
                headers: { 'Authorization': `Basic ${auth}` }
            });
            return response.data;
        } catch (error) {
            console.error(`Exotel completeCampaign error: ${error.message}`);
            if (error.response?.data) {
                const exotelData = error.response.data;
                const messages = exotelData.response?.map(r => r.message).join(', ') || 'No message';
                console.error(`❌ Exotel API Error: ${messages}`);
                console.error('Exotel Error Details:', JSON.stringify(exotelData, null, 2));
            }
            throw error;
        }
    }
}


export default new ExotelService();
