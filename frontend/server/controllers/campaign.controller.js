import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import * as XLSX from 'xlsx';
import pg from 'pg';
import exotelService from '../services/exotel.service.js';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize pool with explicit config matching index.js
const pool = new Pool({
    host: process.env.POSTGRES_HOST,
    port: process.env.POSTGRES_PORT,
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false
});

const getAgentTelephonyConfig = async (agentId) => {
    try {
        const tableName = process.env.APP_ENV === 'test' ? 'test_agent_telephony_config' : 'Agent_Telephony_Config';
        const res = await pool.query(`SELECT exophone, app_id FROM "${tableName}" WHERE agent_id = $1`, [agentId]);
        if (res.rows.length > 0) return res.rows[0];
        return null;
    } catch (error) {
        console.error('Error fetching agent telephony config:', error);
        return null;
    }
};

export const initiateCampaign = async (req, res) => {
    let filePath = req.file?.path;
    const { campaignName, callerId, device_id, agentId, retries, schedule, flowUrl, message, throttle, flowType } = req.body;

    if (!filePath || !campaignName) {
        return res.status(400).json({ error: 'CSV file and Campaign Name are required' });
    }

    try {
        console.log(`🚀 Initiating campaign: ${campaignName} (Agent: ${agentId || 'None'})`);

        // --- 1. Normalize CSV (E.164 format) ---
        let fileContent = fs.readFileSync(filePath, 'utf8');
        let lines = fileContent.trim().split(/\r?\n/);

        if (req.file.originalname.match(/\.(xlsx|xls)$/i)) {
            try {
                const workbook = XLSX.readFile(filePath);
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                fileContent = XLSX.utils.sheet_to_csv(worksheet);
                lines = fileContent.trim().split(/\r?\n/);
            } catch (e) {
                throw new Error('Failed to convert Excel file: ' + e.message);
            }
        }

        const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
        const numberIdx = headers.findIndex(h => h.includes('number') || h.includes('phone') || h.includes('mobile'));
        const nameIdx = headers.findIndex(h => h.includes('name') || h.includes('fname') || h.includes('first'));

        if (numberIdx === -1) throw new Error('CSV must have a "number" column');

        const csvContacts = [];
        const uniqueNumbers = new Set();

        for (let i = 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map(c => c.trim());
            if (cols.length <= numberIdx) continue;

            let phone = cols[numberIdx].replace(/\D/g, '');
            let name = nameIdx !== -1 ? cols[nameIdx] : '';

            // Heuristic for Indian numbers
            if (phone.length === 10) phone = '+91' + phone;
            else if (phone.length === 12 && phone.startsWith('91')) phone = '+' + phone;
            else if (phone.length > 10 && !phone.startsWith('+')) phone = '+' + phone;

            if (phone && !uniqueNumbers.has(phone)) {
                uniqueNumbers.add(phone);
                csvContacts.push({ number: phone, first_name: name });
            }
        }

        if (csvContacts.length === 0) throw new Error('No valid contacts found in CSV');
        console.log(`📄 Parsed ${csvContacts.length} unique contacts from CSV.`);

        // --- 2. Resolve Contact SIDs ---
        console.log('🔄 Fetching all contacts from Exotel to resolve SIDs...');
        const existingContacts = await exotelService.getAllContacts();
        console.log(`✅ Fetched ${existingContacts.length} existing contacts.`);

        const existingMap = new Map(); // Last 10 Digits -> SID

        const getLast10 = (num) => {
            if (!num) return '';
            const digits = num.replace(/\D/g, '');
            return digits.length >= 10 ? digits.slice(-10) : digits;
        };

        // Enhanced: Log raw object to debug structure mismatch
        if (existingContacts.length > 0) {
            console.log('🔍 First Existing Contact Raw:', JSON.stringify(existingContacts[0]));
        }

        existingContacts.forEach(c => {
            // Handle potential API structure variations
            const num = c.number || c.Contact?.number || '';
            const sid = c.sid || c.Contact?.sid || c.Sid || c.Contact?.Sid;
            if (num && sid) {
                existingMap.set(getLast10(num), sid);
            }
        });

        // Debug Logging
        if (existingContacts.length > 0) {
            const sample = existingContacts.slice(0, 3).map(c => `${c.number || c.Contact?.number} (${c.sid || c.Contact?.sid})`).join(', ');
            console.log(`🔍 Sample Exotel: ${sample}`);
            console.log(`🔍 Test Key Gen: ${getLast10(existingContacts.length > 0 ? (existingContacts[0].number || existingContacts[0].Contact?.number) : '')}`);
        }

        const sidsToAdd = [];
        const contactsToCreate = [];

        csvContacts.forEach(c => {
            const key = getLast10(c.number);
            if (existingMap.has(key)) {
                console.log(`✅ Match: ${c.number} -> ${existingMap.get(key)}`);
                sidsToAdd.push(existingMap.get(key));
            } else {
                contactsToCreate.push(c);
            }
        });

        console.log(`🔍 Analysis: ${sidsToAdd.length} existing match, ${contactsToCreate.length} to create/fetch.`);

        // --- 3. Create New Contacts ---
        if (contactsToCreate.length > 0) {
            console.log(`📡 Creating ${contactsToCreate.length} contacts...`);
            const creationResponse = await exotelService.createContacts(contactsToCreate);
            const responseData = creationResponse.data || creationResponse;

            console.log('📦 Creation Response:', JSON.stringify(responseData));

            // CRITICAL FIX: Handle Exotel V2 response wrapper { response: [...] }
            let results = [];
            if (Array.isArray(responseData)) {
                results = responseData;
            } else if (responseData.response && Array.isArray(responseData.response)) {
                results = responseData.response;
            } else if (responseData.data && Array.isArray(responseData.data)) {
                // Fallback
                results = responseData.data;
            }

            if (results.length > 0) {
                results.forEach(r => {
                    // Check for success (200) OR Duplicate (409) - both return SID in 'data'
                    if ((r.code === 200 || r.code === 409) && r.data && r.data.sid) {
                        const prefix = r.code === 409 ? '♻️ Duplicate (Resolved)' : '✅ Created';
                        console.log(`${prefix}: ${r.data.sid}`);
                        sidsToAdd.push(r.data.sid);
                    } else if (r.sid) {
                        // Direct object fallback
                        sidsToAdd.push(r.sid);
                    } else {
                        console.warn('⚠️ Result entry failed:', JSON.stringify(r));
                    }
                });
            } else if (responseData && responseData.sid) {
                // Single object fallback
                sidsToAdd.push(responseData.sid);
            }
        }

        if (sidsToAdd.length === 0) {
            console.error('❌ FATAL: No SIDs resolved.');
            throw new Error('No valid contacts available for campaign (all failed or empty).');
        }

        // --- 4. Create List ---
        const sanitizedCampaignName = (campaignName || 'Camp').replace(/[^a-zA-Z0-9]/g, '').substring(0, 15);
        // Only use timestamp if we need to ensure uniqueness, but keep it shorter
        const ts = Date.now().toString().slice(-4);
        const listName = `L_${sanitizedCampaignName}_${ts}`;

        const listResponse = await exotelService.createList(listName);
        console.log('📋 List Creation Raw Response:', JSON.stringify(listResponse));

        let listSid = listResponse?.response?.[0]?.data?.sid;

        // Fallback checks
        if (!listSid) {
            listSid = listResponse?.data?.list?.sid || listResponse?.data?.sid || listResponse?.sid;
        }

        if (!listSid) {
            console.error('List Creation Response:', listResponse);
            throw new Error('Failed to create list');
        }
        console.log(`📋 Created List: ${listName} (${listSid})`);

        // --- 5. Add Contacts ---
        const chunkSize = 100;
        for (let i = 0; i < sidsToAdd.length; i += chunkSize) {
            const chunk = sidsToAdd.slice(i, i + chunkSize);
            await exotelService.addContactsToList(listSid, chunk);
        }
        console.log(`✅ Added ${sidsToAdd.length} contacts to list.`);


        // --- 6. Create Campaign ---
        let parsedRetries = undefined;
        let parsedSchedule = undefined;
        try {
            if (retries) parsedRetries = typeof retries === 'string' ? JSON.parse(retries) : retries;
            if (schedule) parsedSchedule = typeof schedule === 'string' ? JSON.parse(schedule) : schedule;
        } catch (e) { }

        let agentAppId = null;
        let agentExophone = null;
        if (agentId) {
            const agentConfig = await getAgentTelephonyConfig(agentId);
            if (agentConfig) {
                console.log(`📞 Agent Config: App ${agentConfig.app_id}, Exo ${agentConfig.exophone}`);
                agentAppId = agentConfig.app_id;
                agentExophone = agentConfig.exophone;
            }
        }

        let finalUrl = null;
        if (agentAppId) {
            finalUrl = `http://my.exotel.com/${exotelService.accountSid}/exoml/start_voice/${agentAppId}`;
        } else if (flowUrl) {
            finalUrl = flowUrl;
        }

        const campaignParams = {
            // Respect user provided name, only suffix Agent ID if present
            name: agentId ? `${campaignName}_AG${agentId.slice(-4)}` : campaignName,
            caller_id: callerId || agentExophone,
            campaign_type: 'static',
            url: finalUrl,
            lists: [listSid],
            retries: parsedRetries,
            schedule: parsedSchedule,
            ...(throttle ? { mode: 'custom', throttle: parseInt(throttle) } : { mode: 'auto' })
        };

        // Static method: Add delay to ensure list is propagated in Exotel backend
        // Direct (Static) campaigns typically need 3s for Exotel to index the list.
        const delayMs = 3000;
        console.log(`⏳ Waiting ${delayMs / 1000} seconds for Exotel list propagation...`);
        await new Promise(r => setTimeout(r, delayMs));

        console.log('🚀 Creating campaign with params:', JSON.stringify(campaignParams, null, 2));
        const campaignResponse = await exotelService.createCampaign(campaignParams);
        console.log('✅ Campaign Created Successfully:', JSON.stringify(campaignResponse));

        if (filePath && fs.existsSync(filePath)) fs.unlink(filePath, () => { });

        res.json({
            success: true,
            message: 'Campaign created successfully',
            data: campaignResponse
        });

    } catch (error) {
        console.error('❌ Campaign Init Error:', error);
        if (filePath && fs.existsSync(filePath)) fs.unlink(filePath, () => { });
        res.status(500).json({ error: error.message });
    }
};

export const getCampaigns = async (req, res) => {
    try {
        const response = await exotelService.getAllCampaigns();
        let campaigns = response?.response || response?.campaigns || [];

        // Filter out excluded campaigns
        try {
            const table = process.env.APP_ENV === 'test' ? 'test_excluded_items' : 'Excluded_Items';
            const excludedRes = await pool.query(`SELECT item_id FROM "${table}" WHERE item_type = 'campaign'`);
            const excludedIds = new Set(excludedRes.rows.map(r => r.item_id));

            campaigns = campaigns.filter(c => {
                // Handle wrapped data (c.data.id) or direct properties
                const id = c.sid || c.id || (c.data && c.data.id);
                return !excludedIds.has(id);
            });
        } catch (dbErr) {
            console.error('Error filtering excluded campaigns:', dbErr);
            // Continue without filtering if DB fails
        }

        res.json({ success: true, data: campaigns });
    } catch (error) {
        console.error('Error fetching campaigns:', error);
        res.status(500).json({ error: error.message });
    }
};

export const deleteCampaign = async (req, res) => {
    const { campaignId } = req.params;
    try {
        // First, attempt to stop the campaign in Exotel to prevent further calls
        try {
            await exotelService.stopCampaign(campaignId);
        } catch (stopErr) {
            console.warn(`Could not stop campaign ${campaignId} during deletion:`, stopErr.message);
            // Non-blocking: proceed to delete record even if stop fails (e.g. already stopped)
        }

        const table = process.env.APP_ENV === 'test' ? 'test_excluded_items' : 'Excluded_Items';
        // 'user' is placeholder for excluded_by column until authentication context is fully passed
        await pool.query(
            `INSERT INTO "${table}" (item_type, item_id, excluded_by, reason) VALUES ($1, $2, $3, $4) ON CONFLICT (item_type, item_id) DO NOTHING`,
            ['campaign', campaignId, 'admin', 'deleted_via_dashboard']
        );
        res.json({ success: true, message: 'Campaign deleted via exclusion' });
    } catch (error) {
        console.error('Error deleting campaign:', error);
        res.status(500).json({ error: error.message });
    }
};

export const getCampaignCallDetails = async (req, res) => {
    try {
        const { campaignId } = req.params;
        const response = await exotelService.getCampaignCallDetails(campaignId);
        res.json({ success: true, data: response });
    } catch (error) {
        if (error.response && error.response.status === 404) {
            console.warn(`Campaign ${req.params.campaignId} not found or no calls (Exotel 404). Returning empty list.`);
            return res.json({ success: true, data: [] });
        }
        console.error(`Error fetching call details for ${req.params.campaignId}:`, error);
        res.status(500).json({ error: error.message });
    }
};

export const stopCampaign = async (req, res) => {
    const { campaignId } = req.params;
    try {
        await exotelService.stopCampaign(campaignId);
        res.json({ success: true, message: 'Campaign paused successfully' });
    } catch (error) {
        console.error('Pause campaign error:', error);
        res.status(500).json({ error: error.message });
    }
};

export const resumeCampaign = async (req, res) => {
    const { campaignId } = req.params;
    try {
        await exotelService.resumeCampaign(campaignId);
        res.json({ success: true, message: 'Campaign resumed successfully' });
    } catch (error) {
        console.error('Resume campaign error:', error);
        res.status(500).json({ error: error.message });
    }
};
