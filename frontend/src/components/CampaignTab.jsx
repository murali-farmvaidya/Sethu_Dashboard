import React, { useState, useEffect, useCallback } from 'react';
import { campaignAPI, settingsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import toast from 'react-hot-toast';
import { Upload, FileText, CheckCircle, AlertCircle, RefreshCw, RotateCcw, X, Phone, Play, Pause, Clock, ChevronDown, ChevronRight, ExternalLink, Trash2, Copy } from 'lucide-react';

export default function CampaignTab({ agentId, agentName, onNavigateToSession, telephonyConfig }) {
    const { user } = useAuth();
    const isSuperAdmin = user?.role === 'super_admin' || user?.userId === 'master_root_0';

    const [subTab, setSubTab] = useState('create'); // 'create' | 'inspect'
    const [campaigns, setCampaigns] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedCampaign, setSelectedCampaign] = useState(null);
    const [callDetails, setCallDetails] = useState([]);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [callFilter, setCallFilter] = useState('all'); // 'all','successful','failed','pending'
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;

    const [showAll, setShowAll] = useState(false);
    const [allCampaigns, setAllCampaigns] = useState([]);

    // Create Campaign State
    const [file, setFile] = useState(null);
    const [creating, setCreating] = useState(false);

    // Multi-select state
    const [selectedCampaignIds, setSelectedCampaignIds] = useState(new Set());

    // Line limits from system settings
    const [lineLimits, setLineLimits] = useState({ total: 4, campaign: 2, calls: 2 });

    const [formData, setFormData] = useState({
        campaignName: '',
        retries: 2,
        retryInterval: 10,
        scheduleTime: '',       // full datetime: when campaign first starts
        dailyEndTime: '',       // HH:MM: daily cutoff time
        dailyStartTime: '09:00', // HH:MM: daily resume time for subsequent days
        callInterval: 10 // seconds between calls
    });

    // Fetch line settings on mount
    useEffect(() => {
        const fetchLineSettings = async () => {
            try {
                const res = await settingsAPI.getThrottleSettings();
                if (res.data?.throttle) {
                    setLineLimits(res.data.throttle);
                }
            } catch (err) {
                console.warn('Could not fetch line settings, using defaults');
            }
        };
        fetchLineSettings();
    }, []);

    const fetchCampaigns = useCallback(async () => {
        try {
            setLoading(true);
            // If super_admin and showAll is checked, fetch EVERYTHING (don't pass agentId)
            // Otherwise, fetch filtered by agentId
            const res = await campaignAPI.getAllCampaigns((isSuperAdmin && showAll) ? null : agentId);
            // Handle various response structures
            let data = [];
            if (res.data && Array.isArray(res.data)) {
                data = res.data;
            } else if (res.data?.data && Array.isArray(res.data.data)) {
                data = res.data.data;
            } else if (res.data?.response && Array.isArray(res.data.response)) {
                data = res.data.response;
            }

            // Normalize data (Handle wrappers like { code: 200, data: { ... } })
            const normalizedData = data.map(camp => {
                if (camp.data && camp.data.id) {
                    return {
                        ...camp.data,
                        sid: camp.data.id, // Ensure common ID fields exist
                        campaign_sid: camp.data.id,
                        status: camp.data.status, // Ensure status is top-level
                        date_created: camp.data.date_created,
                        ...camp.summary // Merge summary fields if any
                    };
                }
                return camp;
            });

            setAllCampaigns(normalizedData);

            // If we are strictly filtering for an agent (either naturally or as non-superadmin)
            // ensure the client-side name match is also satisfied just to be safe
            if (agentId && !(isSuperAdmin && showAll)) {
                const suffix = agentId && agentId.length > 4 ? `_ag${agentId.slice(-4)}` : `_ag${agentId}`;
                const agentCampaigns = normalizedData.filter(c => {
                    const name = (c.friendly_name || c.name || '').toLowerCase();
                    return name.includes(`_ag${agentId}`.toLowerCase()) || name.includes(suffix.toLowerCase());
                });
                setCampaigns(agentCampaigns);
            } else {
                setCampaigns(normalizedData);
            }
        } catch (error) {
            console.error('Failed to fetch campaigns:', error);
        } finally {
            setLoading(false);
        }
    }, [agentId]);

    useEffect(() => {
        fetchCampaigns();
    }, [fetchCampaigns, showAll]);

    const fetchCallDetails = async (campaignId) => {
        if (!campaignId) {
            console.error('fetchCallDetails called with undefined ID');
            return;
        }
        try {
            setDetailsLoading(true);
            setDetailsLoading(true);
            const res = await campaignAPI.getCampaignCallDetails(campaignId);

            let data = [];
            // Handle various levels of nesting from Exotel wrappers
            if (Array.isArray(res.data)) {
                data = res.data;
            } else if (Array.isArray(res.data.data)) {
                data = res.data.data;
            } else if (res.data.data && typeof res.data.data === 'object') {
                // Deep dive e.g. { data: { data: { response: [...] } } }
                if (Array.isArray(res.data.data.response)) data = res.data.data.response;
                else if (Array.isArray(res.data.data.Call)) data = res.data.data.Call;
                else if (res.data.data.data) {
                    if (Array.isArray(res.data.data.data)) data = res.data.data.data;
                    else if (Array.isArray(res.data.data.data.response)) data = res.data.data.data.response;
                }
            }

            setCallDetails(data.map(item => {
                // Flatten data if wrapped in 'data' dictionary
                // CRITICAL FIX: Prioritize item.data.status (actual call status) over item.status (API wrapper success)
                if (item.data && typeof item.data === 'object' && !item.number && !item.to) {
                    return { ...item, ...item.data };
                }
                return item;
            }) || []);
        } catch (error) {
            console.error(error);
            toast.error('Failed to fetch call details');
            setCallDetails([]);
        } finally {
            setDetailsLoading(false);
        }
    };

    const handleStopCampaign = async (campaignId) => {
        if (!confirm('Pause this campaign? No new calls will be initiated until resumed.')) return;
        try {
            await campaignAPI.stopCampaign(campaignId);
            toast.success('Campaign paused successfully');
            // Optimistic update
            const updatedStatus = 'Paused';
            setSelectedCampaign(prev => ({ ...prev, status: updatedStatus }));
            setCampaigns(prev => prev.map(c => ((c.sid || c.id || c.campaign_sid) === campaignId ? { ...c, status: updatedStatus } : c)));
            setAllCampaigns(prev => prev.map(c => ((c.sid || c.id || c.campaign_sid) === campaignId ? { ...c, status: updatedStatus } : c)));
        } catch (error) {
            console.error('Pause failed:', error);
            toast.error('Failed to pause campaign');
        }
    };

    const handleResumeCampaign = async (campaignId) => {
        try {
            await campaignAPI.resumeCampaign(campaignId);
            toast.success('Campaign resumed successfully');
            // Optimistic update
            const updatedStatus = 'InProgress';
            setSelectedCampaign(prev => ({ ...prev, status: updatedStatus }));
            setCampaigns(prev => prev.map(c => ((c.sid || c.id || c.campaign_sid) === campaignId ? { ...c, status: updatedStatus } : c)));
            setAllCampaigns(prev => prev.map(c => ((c.sid || c.id || c.campaign_sid) === campaignId ? { ...c, status: updatedStatus } : c)));
        } catch (error) {
            console.error('Resume failed:', error);
            toast.error('Failed to resume campaign');
        }
    };

    const handleDeleteCampaign = async (campaignId, e) => {
        if (e) e.stopPropagation();
        if (!confirm('Are you sure you want to delete this campaign? This will remove it from view.')) return;
        try {
            await campaignAPI.deleteCampaign(campaignId);
            toast.success('Campaign deleted successfully');
            // Optimistic update
            setCampaigns(prev => prev.filter(c => (c.sid || c.id || c.campaign_sid) !== campaignId));
            setAllCampaigns(prev => prev.filter(c => (c.sid || c.id || c.campaign_sid) !== campaignId));
            if (selectedCampaign && (selectedCampaign.sid === campaignId || selectedCampaign.id === campaignId)) {
                setSelectedCampaign(null);
            }
            setSelectedCampaignIds(prev => {
                const newSet = new Set(prev);
                newSet.delete(campaignId);
                return newSet;
            });
        } catch (error) {
            console.error('Delete failed:', error);
            toast.error('Failed to delete campaign');
        }
    };

    const handleBulkDelete = async () => {
        if (selectedCampaignIds.size === 0) return;
        if (!confirm(`Are you sure you want to delete ${selectedCampaignIds.size} campaigns?`)) return;

        const ids = Array.from(selectedCampaignIds);
        let successCount = 0;

        try {
            await Promise.all(ids.map(async (id) => {
                try {
                    await campaignAPI.deleteCampaign(id);
                    successCount++;
                } catch (e) {
                    console.error(`Failed to delete ${id}`, e);
                }
            }));

            toast.success(`Deleted ${successCount} campaigns.`);
            fetchCampaigns();
            setSelectedCampaignIds(new Set());
            setSelectedCampaign(null);
        } catch (error) {
            toast.error('Bulk delete encounterd errors');
        }
    };

    const toggleSelectAll = (checked) => {
        if (checked) {
            const list = showAll ? allCampaigns : campaigns;
            const ids = list.map(c => c.sid || c.id || c.campaign_sid).filter(Boolean);
            setSelectedCampaignIds(new Set(ids));
        } else {
            setSelectedCampaignIds(new Set());
        }
    };

    const toggleSelect = (id, checked) => {
        setSelectedCampaignIds(prev => {
            const newSet = new Set(prev);
            if (checked) newSet.add(id);
            else newSet.delete(id);
            return newSet;
        });
    };

    const handleCreate = async (e) => {
        e.preventDefault();
        if (!file) {
            toast.error('Please upload a CSV or Excel file');
            return;
        }
        if (!telephonyConfig?.exophone) {
            toast.error('Telephony not configured for this agent. Please configure Exophone first in the sidebar.');
            return;
        }

        const data = new FormData();
        data.append('contactsFile', file);
        const name = formData.campaignName || `Campaign_${new Date().toISOString().slice(0, 10)}`;
        data.append('campaignName', name);
        data.append('callerId', telephonyConfig.exophone); // Auto-use configured exophone
        data.append('agentId', agentId);
        data.append('flowType', 'direct'); // Always direct connect now

        if (formData.retries) {
            data.append('retries', JSON.stringify({
                number_of_retries: parseInt(formData.retries),
                interval_mins: parseInt(formData.retryInterval) || 10
            }));
        }

        const schedule = {};
        if (formData.scheduleTime) schedule.send_at = new Date(formData.scheduleTime).toISOString();
        if (formData.dailyEndTime) schedule.daily_end_time = formData.dailyEndTime;   // "HH:MM"
        if (formData.dailyStartTime) schedule.daily_start_time = formData.dailyStartTime; // "HH:MM"

        if (Object.keys(schedule).length > 0) {
            data.append('schedule', JSON.stringify(schedule));
        }

        if (formData.callInterval) {
            // Convert call interval (seconds) to CPM, cap by campaign line limit
            const intervalSec = Math.max(1, parseInt(formData.callInterval) || 10);
            const cpm = Math.max(1, Math.min(Math.floor(60 / intervalSec), lineLimits.campaign));
            data.append('throttle', cpm);
        }

        try {
            setCreating(true);
            await campaignAPI.createCampaign(data);
            toast.success('Campaign initiated! Contacts are being uploaded.');
            setFile(null);
            setFormData({ campaignName: '', retries: 2, retryInterval: 10, scheduleTime: '', dailyEndTime: '', dailyStartTime: '09:00', callInterval: 10 });
            fetchCampaigns();
            setSubTab('inspect');
        } catch (error) {
            toast.error('Failed: ' + (error.response?.data?.error || error.message));
        } finally {
            setCreating(false);
        }
    };

    const prepareResend = (calls, suffix) => {
        if (!calls || calls.length === 0) {
            toast.error('No contacts to resend');
            return;
        }

        // Build CSV content
        const csvHeader = 'phone_number,name\n';
        const csvRows = calls.map(c => `${c.to || c.number || c.phone_number || ''},${c.Name || c.name || c.first_name || ''}`).join('\n');
        const blob = new Blob([csvHeader + csvRows], { type: 'text/csv' });

        // Create a File object
        const retryFile = new File([blob], `resend_${suffix.toLowerCase()}_${selectedCampaign?.sid || 'campaign'}.csv`, { type: 'text/csv' });

        // Switch to Create Tab and populate
        const originalName = (selectedCampaign?.friendly_name || selectedCampaign?.name || 'Campaign').replace(new RegExp(`_AG${agentId.slice(-4)}`, 'i'), '');

        setFile(retryFile);
        setFormData(prev => ({
            ...prev,
            campaignName: `${originalName}_${suffix}`,
            retries: 2,
            retryInterval: 10,
            scheduleTime: ''
        }));
        setSubTab('create');
        toast.success(`Prepared ${calls.length} contacts for ${suffix}. Settings migrated. Click 'Create Campaign' to launch.`);
    };

    const handleResendFailed = () => {
        const failedCalls = callDetails.filter(c => {
            const s = (c.status || c.Status || '').toLowerCase();
            return s.includes('fail') || s === 'busy' || s === 'no-answer' || s === 'noanswer' || s === 'canceled';
        });
        prepareResend(failedCalls, 'Retry_Failed');
    };

    const handleResendAll = () => {
        prepareResend(callDetails, 'Resend_All');
    };



    const getStatusColor = (status) => {
        const s = (status || '').toLowerCase();
        if (s === 'completed' || s === 'answered' || s === 'completed-success') return '#22c55e';
        if (s.includes('fail') || s === 'busy' || s === 'no-answer' || s === 'noanswer' || s === 'canceled') return '#ef4444';
        if (s === 'retrying') return '#f97316';
        if (s === 'in-progress' || s === 'ringing' || s === 'initiated' || s === 'queued') return '#f59e0b';
        if (s === 'pending') return '#64748b';
        if (s === 'paused') return '#64748b';
        return '#94a3b8';
    };

    const getStatusBg = (status) => {
        const s = (status || '').toLowerCase();
        if (s === 'completed' || s === 'answered' || s === 'completed-success') return '#f0fdf4';
        if (s.includes('fail') || s === 'busy' || s === 'no-answer' || s === 'noanswer' || s === 'canceled') return '#fef2f2';
        if (s === 'retrying') return '#fff7ed';
        if (s === 'in-progress' || s === 'ringing' || s === 'initiated' || s === 'queued') return '#fffbeb';
        if (s === 'pending') return '#f1f5f9';
        if (s === 'paused') return '#f1f5f9';
        return '#f8fafc';
    };

    const filteredCalls = callDetails.filter(c => {
        if (callFilter === 'all') return true;
        const s = (c.status || c.Status || '').toLowerCase();
        if (callFilter === 'successful') return s === 'completed' || s === 'answered' || s === 'completed-success';
        if (callFilter === 'failed') return s.includes('fail') || s === 'busy' || s === 'no-answer' || s === 'noanswer' || s === 'canceled';
        if (callFilter === 'pending') return s === 'pending' || s === 'retrying' || s === 'queued' || s === 'in-progress' || s === 'ringing' || s === 'initiated';
        return true;
    });

    const totalPages = Math.ceil(filteredCalls.length / itemsPerPage);
    const currentItems = filteredCalls.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

    const stats = {
        total: callDetails.length,
        success: callDetails.filter(c => {
            const s = (c.status || c.Status || '').toLowerCase();
            return s === 'completed' || s === 'answered' || s === 'completed-success';
        }).length,
        failed: callDetails.filter(c => {
            const s = (c.status || c.Status || '').toLowerCase();
            return s.includes('fail') || s === 'busy' || s === 'no-answer' || s === 'noanswer' || s === 'canceled';
        }).length
    };

    const campaignDisplayName = (camp) => {
        const name = camp.friendly_name || camp.name || 'Unnamed';
        // Strips _AG followed by any alphanumeric (for both full and sliced IDs)
        return name.replace(/_AG[a-zA-Z0-9_\-]+/i, '');
    };

    const formatCampaignDate = (dateString) => {
        if (!dateString) return '-';
        const date = new Date(dateString);
        return date.toLocaleString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true
        }).replace(',', ''); // Feb 13 2026 12:06 PM
    };

    const getEffectiveStatus = (camp) => {
        if (!camp) return 'Unknown';
        const s = (camp.status || '').toLowerCase();
        if (s === 'completed' || s === 'stopped') return 'Completed';
        if (s === 'failed' || s === 'canceled') return 'Failed';
        if (s === 'paused') return 'Paused';
        if (s === 'in-progress' || s === 'inprogress' || s === 'running') return 'Running';

        // Derive from stats if available
        const stats = camp.stats || {};
        const pending = (stats.pending || 0) + (stats['in-progress'] || 0) + (stats.retry || 0) + (stats.retrying || 0) + (stats.queued || 0);
        const total = (stats.completed || 0) + (stats.failed || 0) + pending;

        // If we have stats and nothing is pending, consider it completed (unless failed count is high? User wants Completed if success)
        if (total > 0 && pending === 0) return 'Completed';

        return camp.status || 'Unknown';
    };

    return (
        <div>
            {/* Sub-tabs */}
            <div style={{ display: 'flex', gap: '0', marginBottom: '1.5rem', borderBottom: '2px solid #e5e7eb' }}>
                <button
                    onClick={() => { setSubTab('create'); setSelectedCampaign(null); }}
                    style={{
                        padding: '0.75rem 1.5rem', border: 'none', cursor: 'pointer',
                        fontWeight: subTab === 'create' ? '600' : '400', fontSize: '0.95rem',
                        color: subTab === 'create' ? '#008F4B' : '#64748b',
                        background: 'transparent',
                        borderBottom: subTab === 'create' ? '2px solid #008F4B' : '2px solid transparent',
                        marginBottom: '-2px', transition: 'all 0.2s',
                        display: 'flex', alignItems: 'center', gap: '8px'
                    }}
                >
                    <Upload size={16} /> Create Campaign
                </button>
                <button
                    onClick={() => { setSubTab('inspect'); setSelectedCampaign(null); fetchCampaigns(); }}
                    style={{
                        padding: '0.75rem 1.5rem', border: 'none', cursor: 'pointer',
                        fontWeight: subTab === 'inspect' ? '600' : '400', fontSize: '0.95rem',
                        color: subTab === 'inspect' ? '#008F4B' : '#64748b',
                        background: 'transparent',
                        borderBottom: subTab === 'inspect' ? '2px solid #008F4B' : '2px solid transparent',
                        marginBottom: '-2px', transition: 'all 0.2s',
                        display: 'flex', alignItems: 'center', gap: '8px'
                    }}
                >
                    <FileText size={16} /> Inspect Campaigns
                </button>
            </div>

            {/* CREATE CAMPAIGN TAB */}
            {subTab === 'create' && (
                <div className="card" style={{ background: 'white', borderRadius: '12px', padding: '2rem', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
                    <h3 style={{ marginBottom: '1.5rem', color: '#1f2937', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span style={{ background: 'rgba(0,143,75,0.1)', padding: '8px', borderRadius: '8px', display: 'flex' }}>
                            <Upload size={20} color="#008F4B" />
                        </span>
                        New Campaign for {agentName || agentId}
                    </h3>

                    {/* Telephony Config Status */}
                    <div style={{
                        padding: '12px 16px', borderRadius: '8px', marginBottom: '0.5rem',
                        background: telephonyConfig?.exophone ? '#f0fdf4' : '#fef2f2',
                        border: `1px solid ${telephonyConfig?.exophone ? '#86efac' : '#fca5a5'}`,
                        display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.9rem'
                    }}>
                        <Phone size={16} color={telephonyConfig?.exophone ? '#16a34a' : '#ef4444'} />
                        {telephonyConfig?.exophone ? (
                            <span style={{ color: '#166534' }}>
                                Using virtual number: <strong>{telephonyConfig.exophone}</strong>
                            </span>
                        ) : (
                            <span style={{ color: '#991b1b' }}>
                                Telephony not configured. Please set up Exophone in the sidebar first.
                            </span>
                        )}
                    </div>

                    {/* Campaign Creation Instructions */}
                    <div style={{ background: '#f0f9ff', borderRadius: '10px', border: '1px solid #bae6fd', padding: '1.25rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '0.75rem' }}>
                            <FileText size={16} color="#0284c7" />
                            <span style={{ fontWeight: '700', fontSize: '0.9rem', color: '#0c4a6e' }}>How to create a campaign</span>
                        </div>
                        <ol style={{ margin: 0, padding: '0 0 0 1.2rem', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            <li style={{ color: '#0369a1', fontSize: '0.85rem', lineHeight: '1.5' }}><strong>Telephony setup</strong> – Ensure the Exophone (virtual number) is configured in the agent sidebar before launching a campaign.</li>
                            <li style={{ color: '#0369a1', fontSize: '0.85rem', lineHeight: '1.5' }}><strong>Campaign Name</strong> – Give a descriptive name (e.g., <em>July Outreach</em>). Leave blank for an auto-generated name.</li>
                            <li style={{ color: '#0369a1', fontSize: '0.85rem', lineHeight: '1.5' }}><strong>Upload contacts</strong> – Prepare a CSV/Excel file with a <code style={{ background: '#e0f2fe', padding: '1px 4px', borderRadius: '3px' }}>number</code> column (10-digit mobile) and an optional <code style={{ background: '#e0f2fe', padding: '1px 4px', borderRadius: '3px' }}>Name</code> column. Download the sample file for reference.</li>
                            <li style={{ color: '#0369a1', fontSize: '0.85rem', lineHeight: '1.5' }}><strong>Daily Schedule (optional)</strong> – Set a <em>Start Time</em> (date &amp; time) for when the campaign first begins. Set a <em>Daily End Time</em> (e.g., <code style={{ background: '#e0f2fe', padding: '1px 4px', borderRadius: '3px' }}>18:00</code>) to stop calls each evening. Set a <em>Next Day Start</em> time (e.g., <code style={{ background: '#e0f2fe', padding: '1px 4px', borderRadius: '3px' }}>09:00</code>) — if contacts remain when the day ends, the campaign automatically pauses and resumes at that time the next morning, continuing day-by-day until every contact is called.</li>
                            <li style={{ color: '#0369a1', fontSize: '0.85rem', lineHeight: '1.5' }}><strong>No. of Tries</strong> – Number of retry attempts for unanswered or failed calls (0 = no retry, max 5). Set the retry interval (in minutes) between attempts.</li>
                            <li style={{ color: '#0369a1', fontSize: '0.85rem', lineHeight: '1.5' }}><strong>Launch</strong> – Click <strong>Launch Campaign</strong>. Track progress in the <em>Inspect Campaigns</em> tab.</li>
                        </ol>
                    </div>

                    <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '0.9rem', color: '#374151' }}>Campaign Name</label>
                            <input type="text" value={formData.campaignName}
                                onChange={e => setFormData({ ...formData, campaignName: e.target.value })}
                                placeholder="Auto-generated if empty"
                                style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '0.95rem', transition: 'border 0.2s', outline: 'none' }}
                                onFocus={e => e.target.style.borderColor = '#008F4B'}
                                onBlur={e => e.target.style.borderColor = '#e5e7eb'}
                            />
                        </div>
                        <div>
                            <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '0.9rem', color: '#374151' }}>
                                Upload Contacts (CSV / Excel) <span style={{ color: '#ef4444' }}>*</span>
                            </label>
                            <div
                                onClick={() => document.getElementById('campaign-file-input').click()}
                                style={{
                                    border: '2px dashed #d1d5db', borderRadius: '12px', padding: '2rem',
                                    textAlign: 'center', cursor: 'pointer', transition: 'all 0.2s',
                                    background: file ? '#f0fdf4' : '#fafafa',
                                    borderColor: file ? '#008F4B' : '#d1d5db'
                                }}
                                onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = '#008F4B'; }}
                                onDragLeave={e => { e.currentTarget.style.borderColor = file ? '#008F4B' : '#d1d5db'; }}
                                onDrop={e => { e.preventDefault(); if (e.dataTransfer.files[0]) setFile(e.dataTransfer.files[0]); }}
                            >
                                <input id="campaign-file-input" type="file" accept=".csv,.xlsx,.xls" hidden
                                    onChange={e => setFile(e.target.files[0])}
                                />
                                {file ? (
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                                        <CheckCircle size={24} color="#008F4B" />
                                        <span style={{ fontWeight: '500', color: '#008F4B' }}>{file.name}</span>
                                        <button type="button" onClick={e => { e.stopPropagation(); setFile(null); }}
                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}>
                                            <X size={18} />
                                        </button>
                                    </div>
                                ) : (
                                    <div>
                                        <Upload size={32} color="#94a3b8" style={{ marginBottom: '8px' }} />
                                        <p style={{ color: '#64748b', margin: '0', fontSize: '0.9rem' }}>Click or drag to upload CSV/Excel</p>
                                        <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: '0.8rem' }}>Columns: number, Name (see format below)</p>
                                    </div>
                                )}
                            </div>

                            {/* Required CSV Format Guide */}
                            <div style={{
                                marginTop: '12px', padding: '14px 16px', borderRadius: '10px',
                                background: '#f0f9ff', border: '1px solid #bae6fd',
                                fontSize: '0.82rem', color: '#0c4a6e'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                                    <span style={{ fontWeight: '600', fontSize: '0.85rem' }}>
                                        Required File Format
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const csv = 'number,Name\n7382700894,Praveen\n9154708539,Kowshik\n';
                                            const blob = new Blob([csv], { type: 'text/csv' });
                                            const url = URL.createObjectURL(blob);
                                            const a = document.createElement('a');
                                            a.href = url; a.download = 'Sample_Contacts.csv'; a.click();
                                            URL.revokeObjectURL(url);
                                        }}
                                        style={{
                                            padding: '4px 10px', borderRadius: '6px', fontSize: '0.75rem',
                                            fontWeight: '600', border: '1px solid #7dd3fc', background: '#e0f2fe',
                                            color: '#0369a1', cursor: 'pointer', transition: 'all 0.2s'
                                        }}
                                        onMouseOver={e => e.currentTarget.style.background = '#bae6fd'}
                                        onMouseOut={e => e.currentTarget.style.background = '#e0f2fe'}
                                    >
                                        Download Sample
                                    </button>
                                </div>
                                <table style={{
                                    width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem',
                                    background: 'white', borderRadius: '6px', overflow: 'hidden'
                                }}>
                                    <thead>
                                        <tr style={{ background: '#e0f2fe' }}>
                                            <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: '700', color: '#0c4a6e', borderBottom: '1px solid #bae6fd' }}>number</th>
                                            <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: '700', color: '#0c4a6e', borderBottom: '1px solid #bae6fd' }}>Name</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        <tr>
                                            <td style={{ padding: '5px 12px', fontFamily: 'monospace', color: '#334155', borderBottom: '1px solid #e0f2fe' }}>7382700894</td>
                                            <td style={{ padding: '5px 12px', color: '#334155', borderBottom: '1px solid #e0f2fe' }}>Praveen</td>
                                        </tr>
                                        <tr>
                                            <td style={{ padding: '5px 12px', fontFamily: 'monospace', color: '#334155' }}>9154708539</td>
                                            <td style={{ padding: '5px 12px', color: '#334155' }}>Kowshik</td>
                                        </tr>
                                    </tbody>
                                </table>
                                <p style={{ margin: '8px 0 0', color: '#0369a1', fontSize: '0.78rem', lineHeight: '1.4' }}>
                                    Column <b>number</b> is required (10-digit mobile). Column <b>Name</b> is optional. Save as <b>.csv</b> or <b>.xlsx</b>.
                                </p>
                            </div>
                        </div>
                        {/* Schedule */}
                        <div style={{ background: '#f0fdf4', padding: '1.25rem', borderRadius: '12px', border: '1px solid #bbf7d0' }}>
                            <h4 style={{ margin: '0 0 1rem', fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', color: '#166534', letterSpacing: '0.05em' }}>Daily Schedule (Optional)</h4>
                            <div className="campaign-grid-3">
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '0.9rem', color: '#374151' }}>Start Time</label>
                                    <input
                                        type="datetime-local"
                                        value={formData.scheduleTime}
                                        onChange={e => setFormData({ ...formData, scheduleTime: e.target.value })}
                                        min={new Date().toISOString().slice(0, 16)}
                                        style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '0.9rem', outline: 'none' }}
                                    />
                                    <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#6b7280' }}>When the campaign first begins</p>
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '0.9rem', color: '#374151' }}>Daily End Time</label>
                                    <input
                                        type="time"
                                        value={formData.dailyEndTime}
                                        onChange={e => setFormData({ ...formData, dailyEndTime: e.target.value })}
                                        style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '0.9rem', outline: 'none' }}
                                    />
                                    <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#6b7280' }}>Calls stop at this time each day</p>
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '0.9rem', color: '#374151' }}>Next Day Start</label>
                                    <input
                                        type="time"
                                        value={formData.dailyStartTime}
                                        onChange={e => setFormData({ ...formData, dailyStartTime: e.target.value })}
                                        style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '0.9rem', outline: 'none' }}
                                    />
                                    <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#6b7280' }}>Remaining calls resume here the next day</p>
                                </div>
                            </div>
                            <p style={{ margin: '0.75rem 0 0', fontSize: '0.8rem', color: '#166534' }}>If all contacts are not reached before Daily End Time, the campaign auto-pauses and resumes at Next Day Start the following morning — repeating until every contact is called.</p>
                        </div>



                        {/* Advanced Options */}
                        <div style={{ background: '#f9fafb', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e5e7eb', marginTop: '0.5rem' }}>
                            <h4 style={{ margin: '0 0 1rem', fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>Advanced Options</h4>
                            <div className="campaign-grid-2">
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '0.9rem', color: '#374151' }}>No. of Tries</label>
                                    <input type="number" min="0" max="5" value={formData.retries}
                                        onChange={e => setFormData({ ...formData, retries: e.target.value })}
                                        style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '2px solid #edeff1', fontSize: '0.95rem', outline: 'none' }}
                                    />
                                    <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>0 = single attempt, up to 5 retries on failure</p>
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '0.9rem', color: '#374151' }}>Retry Interval (min)</label>
                                    <input type="number" min="1" value={formData.retryInterval}
                                        onChange={e => setFormData({ ...formData, retryInterval: e.target.value })}
                                        style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '2px solid #edeff1', fontSize: '0.95rem', outline: 'none' }}
                                    />
                                    <p style={{ margin: '4px 0 0', fontSize: '0.75rem', color: '#94a3b8' }}>Minutes to wait before retrying a failed call</p>
                                </div>
                            </div>
                        </div>
                        <button type="submit" disabled={creating}
                            style={{
                                padding: '12px 24px', background: creating ? '#94a3b8' : '#008F4B',
                                color: 'white', border: 'none', borderRadius: '8px', fontWeight: '600',
                                fontSize: '1rem', cursor: creating ? 'not-allowed' : 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                                transition: 'background 0.2s'
                            }}
                        >
                            {creating ? <><RefreshCw size={18} className="spin" /> Creating...</> : <><Play size={18} /> Launch Campaign</>}
                        </button>
                    </form>
                </div>
            )}

            {/* INSPECT CAMPAIGNS TAB */}
            {subTab === 'inspect' && !selectedCampaign && (
                <div>


                    {/* Bulk Actions */}
                    {(selectedCampaignIds.size > 0) && (
                        <div style={{ marginBottom: '1rem', padding: '0.75rem', background: '#ffe4e6', borderRadius: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: '#be123c', border: '1px solid #fda4af' }}>
                            <span style={{ fontWeight: '500', fontSize: '0.9rem' }}>{selectedCampaignIds.size} campaigns selected</span>
                            <button onClick={handleBulkDelete}
                                style={{ padding: '6px 12px', background: '#e11d48', color: 'white', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                            >
                                <Trash2 size={16} /> Delete Selected
                            </button>
                        </div>
                    )}

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '500', fontSize: '0.9rem', cursor: 'pointer' }}>
                                <input type="checkbox"
                                    checked={((showAll ? allCampaigns : campaigns).length > 0) && (selectedCampaignIds.size === (showAll ? allCampaigns : campaigns).length)}
                                    onChange={e => toggleSelectAll(e.target.checked)}
                                    style={{ width: '16px', height: '16px', accentColor: '#008F4B', cursor: 'pointer' }}
                                />
                                Select All
                            </label>
                            <span style={{ color: '#e5e7eb' }}>|</span>
                            <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>
                                {showAll ? allCampaigns.length : campaigns.length} campaign{(showAll ? allCampaigns.length : campaigns.length) !== 1 ? 's' : ''} found
                            </span>
                        </div>

                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                            {isSuperAdmin && (
                                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer', color: '#374151' }}>
                                    <input
                                        type="checkbox"
                                        checked={showAll}
                                        onChange={e => setShowAll(e.target.checked)}
                                        style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#008F4B' }}
                                    />
                                    Show All
                                </label>
                            )}
                            <button onClick={fetchCampaigns}
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '6px 12px', borderRadius: '6px', border: '1px solid #e5e7eb', background: 'white', cursor: 'pointer', fontSize: '0.85rem', color: '#64748b' }}>
                                <RefreshCw size={14} /> Refresh
                            </button>
                        </div>
                    </div>
                    {loading && (
                        <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                            <RefreshCw size={24} className="spin" style={{ marginBottom: '8px' }} />
                            <p>Loading campaigns...</p>
                        </div>
                    )}

                    {!loading && (showAll ? allCampaigns : campaigns).length === 0 && (
                        <div style={{ textAlign: 'center', padding: '3rem', background: 'white', borderRadius: '12px', border: '2px dashed #e5e7eb' }}>
                            <FileText size={48} color="#d1d5db" style={{ marginBottom: '12px' }} />
                            <p style={{ color: '#64748b', marginBottom: '8px' }}>No campaigns found.</p>
                            {!showAll && campaigns.length === 0 && allCampaigns.length > 0 && (
                                <p style={{ fontSize: '0.85rem', color: '#94a3b8' }}>
                                    (Hidden {allCampaigns.length} campaigns for other agents. <button onClick={() => setShowAll(true)} style={{ color: '#008F4B', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline' }}>Show them</button>)
                                </p>
                            )}
                            <button onClick={() => setSubTab('create')} style={{ color: '#008F4B', fontWeight: '600', border: 'none', background: 'none', cursor: 'pointer', marginTop: '1rem' }}>
                                Create your first campaign →
                            </button>
                        </div>
                    )}

                    {!loading && (showAll ? allCampaigns : campaigns).length > 0 && (
                        <div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
                                {(showAll ? allCampaigns : campaigns)
                                    .slice((currentPage - 1) * 9, currentPage * 9)
                                    .map((camp, i) => {
                                        const id = camp.sid || camp.id || camp.campaign_sid || camp.uuid || camp.Sid;
                                        const status = getEffectiveStatus(camp);

                                        // Robust Color Logic
                                        const isFailed = status === 'Failed' || status === 'Canceled';
                                        const isCompleted = status === 'Completed';
                                        const isPaused = status === 'Paused';
                                        const isRunning = status === 'Running';

                                        const cardBorderColor = isFailed ? '#ef4444' : isCompleted ? '#22c55e' : isPaused ? '#94a3b8' : isRunning ? '#3b82f6' : '#e5e7eb';
                                        const cardBg = isFailed ? '#fef2f2' : isCompleted ? '#f0fdf4' : isRunning ? '#eff6ff' : 'white';
                                        const badgeBg = isFailed ? '#fee2e2' : isCompleted ? '#dcfce7' : isPaused ? '#f1f5f9' : isRunning ? '#dbeafe' : '#fef9c3';
                                        const badgeColor = isFailed ? '#991b1b' : isCompleted ? '#166534' : isPaused ? '#475569' : isRunning ? '#1d4ed8' : '#854d0e';

                                        // Mock stats if not present (since list API often omits them)
                                        // In a real scenario, we'd need to fetch these or have the backend aggregate them.
                                        // For now, we render what's available or placeholders.
                                        const stats = camp.stats || {};
                                        const totalCalls = stats.total || (status === 'Completed' ? 'Done' : '-');
                                        const successCalls = stats.connected || stats.completed || '-'; // Exotel field might be 'connected'
                                        const failedCalls = stats.failed || '-';

                                        return (
                                            <div key={id || i}
                                                style={{
                                                    background: 'white',
                                                    borderRadius: '12px',
                                                    overflow: 'hidden',
                                                    border: `1px solid ${cardBorderColor}`,
                                                    // Stronger visual queue for status
                                                    borderLeft: `6px solid ${cardBorderColor}`,
                                                    boxShadow: '0 2px 5px rgba(0,0,0,0.05)',
                                                    transition: 'all 0.2s',
                                                    position: 'relative',
                                                    cursor: 'pointer',
                                                    display: 'flex', flexDirection: 'column', justifyContent: 'space-between'
                                                }}
                                                onClick={(e) => {
                                                    if (e.target.type !== 'checkbox' && !e.target.closest('button')) {
                                                        if (id) {
                                                            setSelectedCampaign(camp);
                                                            fetchCallDetails(id);
                                                            setCurrentPage(1);
                                                        }
                                                    }
                                                }}
                                                onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 12px 20px -8px rgba(0, 0, 0, 0.15)'; }}
                                                onMouseOut={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 5px rgba(0,0,0,0.05)'; }}
                                            >
                                                <div style={{ padding: '1.25rem' }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.75rem' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                                            <input type="checkbox"
                                                                checked={selectedCampaignIds.has(id)}
                                                                onChange={e => toggleSelect(id, e.target.checked)}
                                                                onClick={e => e.stopPropagation()}
                                                                style={{ width: '18px', height: '18px', accentColor: '#008F4B', cursor: 'pointer' }}
                                                            />
                                                            <span style={{
                                                                padding: '4px 10px', borderRadius: '6px', fontWeight: '700', fontSize: '0.7rem',
                                                                textTransform: 'uppercase', letterSpacing: '0.05em',
                                                                background: badgeBg, color: badgeColor
                                                            }}>
                                                                {status}
                                                            </span>
                                                        </div>
                                                        <button
                                                            onClick={(e) => handleDeleteCampaign(id, e)}
                                                            className="delete-btn"
                                                            style={{
                                                                padding: '6px', borderRadius: '6px', border: 'none', background: 'transparent', color: '#9ca3af',
                                                                cursor: 'pointer', transition: 'all 0.2s', display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                            }}
                                                            onMouseEnter={e => { e.currentTarget.style.background = '#fee2e2'; e.currentTarget.style.color = '#ef4444'; }}
                                                            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#9ca3af'; }}
                                                            title="Delete Campaign"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>

                                                    <h4 style={{
                                                        margin: '0 0 12px', fontSize: '1.1rem', fontWeight: '700', color: '#1f2937',
                                                        lineHeight: '1.4', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
                                                    }} title={campaignDisplayName(camp)}>
                                                        {campaignDisplayName(camp)}
                                                    </h4>

                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.8rem', color: '#6b7280', marginBottom: '1.25rem' }}>
                                                        <Clock size={14} />
                                                        <span>{formatCampaignDate(camp.date_created)}</span>
                                                    </div>

                                                    {/* Stats Row */}
                                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px', background: '#f8fafc', padding: '10px', borderRadius: '8px', border: '1px solid #f1f5f9' }}>
                                                        <div style={{ textAlign: 'center' }}>
                                                            <div style={{ fontSize: '0.7rem', color: '#64748b', fontWeight: '600', textTransform: 'uppercase' }}>Calls</div>
                                                            <div style={{ fontSize: '0.95rem', fontWeight: '700', color: '#334155' }}>{totalCalls}</div>
                                                        </div>
                                                        <div style={{ textAlign: 'center', borderLeft: '1px solid #e2e8f0', borderRight: '1px solid #e2e8f0' }}>
                                                            <div style={{ fontSize: '0.7rem', color: '#166534', fontWeight: '600', textTransform: 'uppercase' }}>Success</div>
                                                            <div style={{ fontSize: '0.95rem', fontWeight: '700', color: '#16a34a' }}>{successCalls}</div>
                                                        </div>
                                                        <div style={{ textAlign: 'center' }}>
                                                            <div style={{ fontSize: '0.7rem', color: '#991b1b', fontWeight: '600', textTransform: 'uppercase' }}>Failed</div>
                                                            <div style={{ fontSize: '0.95rem', fontWeight: '700', color: '#ef4444' }}>{failedCalls}</div>
                                                        </div>
                                                    </div>
                                                </div>

                                                <div style={{
                                                    borderTop: '1px solid #f3f4f6', padding: '0.75rem 1.25rem', display: 'flex',
                                                    justifyContent: 'space-between', alignItems: 'center', background: '#fafafa'
                                                }}>
                                                    <span style={{ fontSize: '0.75rem', color: '#9ca3af', fontFamily: 'monospace' }}>ID: {(id || '').substring(0, 8)}</span>
                                                    <span style={{ color: '#008F4B', fontWeight: '600', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        View Details <ChevronRight size={14} />
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                            </div>

                            {/* Pagination Controls */}
                            {Math.ceil((showAll ? allCampaigns : campaigns).length / 9) > 1 && (
                                <div style={{ display: 'flex', justifySelf: 'center', alignItems: 'center', gap: '1rem', marginTop: '1rem', paddingBottom: '2rem' }}>
                                    <button
                                        onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                        disabled={currentPage === 1}
                                        style={{
                                            padding: '8px 16px', borderRadius: '8px', border: '1px solid #e5e7eb',
                                            background: currentPage === 1 ? '#f3f4f6' : 'white',
                                            color: currentPage === 1 ? '#9ca3af' : '#374151',
                                            cursor: currentPage === 1 ? 'not-allowed' : 'pointer'
                                        }}
                                    >
                                        Previous
                                    </button>
                                    <span style={{ fontSize: '0.9rem', color: '#4b5563', fontWeight: '500' }}>
                                        Page {currentPage} of {Math.ceil((showAll ? allCampaigns : campaigns).length / 9)}
                                    </span>
                                    <button
                                        onClick={() => setCurrentPage(prev => Math.min(prev + 1, Math.ceil((showAll ? allCampaigns : campaigns).length / 9)))}
                                        disabled={currentPage === Math.ceil((showAll ? allCampaigns : campaigns).length / 9)}
                                        style={{
                                            padding: '8px 16px', borderRadius: '8px', border: '1px solid #e5e7eb',
                                            background: currentPage === Math.ceil((showAll ? allCampaigns : campaigns).length / 9) ? '#f3f4f6' : 'white',
                                            color: currentPage === Math.ceil((showAll ? allCampaigns : campaigns).length / 9) ? '#9ca3af' : '#374151',
                                            cursor: currentPage === Math.ceil((showAll ? allCampaigns : campaigns).length / 9) ? 'not-allowed' : 'pointer'
                                        }}
                                    >
                                        Next
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
            {/* CAMPAIGN DETAIL VIEW */}
            {subTab === 'inspect' && selectedCampaign && (
                <div>
                    <button onClick={() => { setSelectedCampaign(null); setCallDetails([]); setCallFilter('all'); }}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', color: '#008F4B', fontWeight: '600', fontSize: '0.9rem', marginBottom: '1rem', padding: '0' }}>
                        <ChevronRight size={16} style={{ transform: 'rotate(180deg)' }} /> Back to Campaigns
                    </button>

                    {/* New Header Design: Stats Grid */}
                    <div className="card" style={{ background: 'white', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', marginBottom: '1.5rem' }}>
                        <div className="campaign-header-row">
                            <div>
                                <h3 style={{ margin: '0 0 8px', fontSize: '1.25rem', color: '#1f2937', fontWeight: '700' }}>
                                    {campaignDisplayName(selectedCampaign)}
                                </h3>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <span style={{
                                        padding: '4px 10px', borderRadius: '6px', fontWeight: '600', fontSize: '0.8rem',
                                        background: getStatusBg(getEffectiveStatus(selectedCampaign)),
                                        color: (getEffectiveStatus(selectedCampaign) === 'Completed' ? '#166534' : (getEffectiveStatus(selectedCampaign) === 'Failed' || getEffectiveStatus(selectedCampaign) === 'Canceled') ? '#991b1b' : getEffectiveStatus(selectedCampaign) === 'Paused' ? '#475569' : '#854d0e')
                                    }}>
                                        {getEffectiveStatus(selectedCampaign)}
                                    </span>
                                    <span className="campaign-id-text">ID: {selectedCampaign.sid || selectedCampaign.id}</span>
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '10px' }}>
                                {(selectedCampaign.status === 'InProgress' || selectedCampaign.status === 'Created' || selectedCampaign.status === 'Scheduled' || selectedCampaign.status === 'in-progress') && (
                                    <button onClick={() => handleStopCampaign(selectedCampaign.sid || selectedCampaign.id)}
                                        style={{ padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e1', background: 'white', color: '#475569', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: '600' }}>
                                        <Pause size={16} /> Pause
                                    </button>
                                )}
                                {(selectedCampaign.status?.toLowerCase() === 'paused') && (
                                    <button onClick={() => handleResumeCampaign(selectedCampaign.sid || selectedCampaign.id)}
                                        style={{ padding: '8px 16px', borderRadius: '6px', border: 'none', background: '#008F4B', color: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: '600' }}>
                                        <Play size={16} /> Resume
                                    </button>
                                )}
                                <button onClick={(e) => handleDeleteCampaign(selectedCampaign.sid || selectedCampaign.id, e)}
                                    style={{ padding: '8px', borderRadius: '6px', border: 'none', background: '#fee2e2', color: '#ef4444', cursor: 'pointer' }} title="Delete Campaign">
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>

                        {/* Stats Cards Grid */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1rem' }}>
                            {/* Total Calls */}
                            <div style={{ background: '#f8fafc', padding: '1rem', borderRadius: '10px', border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0284c7' }}>
                                    <Phone size={20} />
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: '500' }}>Total Calls</div>
                                    <div style={{ fontSize: '1.25rem', fontWeight: '700', color: '#0f172a' }}>{stats.total}</div>
                                </div>
                            </div>

                            {/* Successful */}
                            <div style={{ background: '#f0fdf4', padding: '1rem', borderRadius: '10px', border: '1px solid #bbf7d0', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#dcfce7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#16a34a' }}>
                                    <CheckCircle size={20} />
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.8rem', color: '#166534', fontWeight: '500' }}>Successful</div>
                                    <div style={{ fontSize: '1.25rem', fontWeight: '700', color: '#14532d' }}>{stats.success}</div>
                                </div>
                            </div>

                            {/* Failed */}
                            <div style={{ background: '#fef2f2', padding: '1rem', borderRadius: '10px', border: '1px solid #fecaca', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#fee2e2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#dc2626' }}>
                                    <AlertCircle size={20} />
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.8rem', color: '#991b1b', fontWeight: '500' }}>Failed</div>
                                    <div style={{ fontSize: '1.25rem', fontWeight: '700', color: '#7f1d1d' }}>{stats.failed}</div>
                                </div>
                            </div>

                            {/* Created At */}
                            <div style={{ background: '#fffbeb', padding: '1rem', borderRadius: '10px', border: '1px solid #fde68a', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                                <div style={{ width: '40px', height: '40px', borderRadius: '8px', background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d97706' }}>
                                    <Clock size={20} />
                                </div>
                                <div>
                                    <div style={{ fontSize: '0.8rem', color: '#92400e', fontWeight: '500' }}>Created On</div>
                                    <div style={{ fontSize: '0.9rem', fontWeight: '600', color: '#78350f' }}>{new Date(selectedCampaign.date_created).toLocaleDateString()}</div>
                                    <div style={{ fontSize: '0.75rem', color: '#92400e' }}>{new Date(selectedCampaign.date_created).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                                </div>
                            </div>

                        </div>
                    </div>

                    {/* Filter & Actions Bar */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '1rem' }}>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            {['all', 'successful', 'failed', 'pending'].map(f => (
                                <button key={f} onClick={() => { setCallFilter(f); setCurrentPage(1); }}
                                    style={{
                                        padding: '0.5rem 1rem', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem',
                                        fontWeight: callFilter === f ? '600' : '400',
                                        border: callFilter === f ? '2px solid #008F4B' : '1px solid #e5e7eb',
                                        background: callFilter === f ? '#008F4B' : 'white',
                                        color: callFilter === f ? 'white' : '#374151',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    {f.charAt(0).toUpperCase() + f.slice(1)}
                                </button>
                            ))}
                        </div>
                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                            <button onClick={handleResendFailed}
                                style={{
                                    padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.85rem',
                                    fontWeight: '600', border: '1px solid #008F4B', background: '#f0fdf4', color: '#008F4B',
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px'
                                }}>
                                <RotateCcw size={14} /> Retry Failed
                            </button>
                            <button onClick={handleResendAll}
                                style={{
                                    padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.85rem',
                                    fontWeight: '600', border: '1px solid #cbd5e1', background: 'white', color: '#475569',
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px'
                                }}>
                                <RefreshCw size={14} /> Resend All
                            </button>
                        </div>
                    </div>

                    {/* Validated Table */}
                    {detailsLoading ? (
                        <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                            <RefreshCw size={24} className="spin" style={{ marginBottom: '12px' }} />
                            <p>Loading call details...</p>
                        </div>
                    ) : (
                        <div className="card" style={{ background: 'white', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                            <div className="table-container">
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead style={{ background: '#f8f9fa', borderBottom: '1px solid #e5e7eb' }}>
                                        <tr>
                                            <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#4b5563', fontSize: '0.85rem' }}>Phone Number</th>
                                            <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#4b5563', fontSize: '0.85rem' }}>Contact Name</th>
                                            <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#4b5563', fontSize: '0.85rem' }}>Status</th>
                                            <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#4b5563', fontSize: '0.85rem' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {currentItems.length === 0 ? (
                                            <tr><td colSpan={4} style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>No calls match the filter.</td></tr>
                                        ) : currentItems.map((call, i) => {
                                            const status = (call.status || call.Status || 'unknown').toLowerCase();
                                            const isSuccess = status === 'completed' || status === 'answered' || status === 'completed-success';
                                            const isFailure = status.includes('fail') || status === 'busy' || status === 'no-answer' || status === 'noanswer' || status === 'canceled';
                                            const isRetrying = status === 'retrying';
                                            const isPending = status === 'pending';
                                            const attemptsDone = call.attempts_done || 0;
                                            const retriesLeft = call.retries_left;
                                            const totalRetries = (retriesLeft !== null && retriesLeft !== undefined) ? attemptsDone + retriesLeft : null;
                                            const campaignStatus = (selectedCampaign?.status || '').toLowerCase();

                                            return (
                                                <tr key={call.sid || call.id || i} style={{ borderBottom: '1px solid #f1f5f9', background: 'white' }}>
                                                    <td style={{ padding: '1rem', fontFamily: 'monospace', fontSize: '0.9rem', color: '#334155' }}>
                                                        {call.to || call.number || call.phone_number || '-'}
                                                    </td>
                                                    <td style={{ padding: '1rem', fontSize: '0.9rem', color: '#334155' }}>
                                                        {call.Name || call.name || call.first_name || '-'}
                                                    </td>
                                                    <td style={{ padding: '1rem' }}>
                                                        {(() => {
                                                            let badgeText, badgeColor, badgeBg, badgeBorder, icon;
                                                            if (isSuccess) {
                                                                badgeText = 'COMPLETED'; badgeColor = '#166534'; badgeBg = '#dcfce7'; badgeBorder = '#bbf7d0';
                                                                icon = <CheckCircle size={12} />;
                                                            } else if (isFailure) {
                                                                badgeText = attemptsDone > 1 ? `FAILED (${attemptsDone}× tried)` : 'FAILED';
                                                                badgeColor = '#991b1b'; badgeBg = '#fee2e2'; badgeBorder = '#fecaca';
                                                                icon = <AlertCircle size={12} />;
                                                            } else if (isRetrying) {
                                                                const retryLabel = totalRetries ? `RETRY ${attemptsDone}/${totalRetries}` : 'RETRYING';
                                                                let timeHint = '';
                                                                if (call.retry_after) {
                                                                    const minsLeft = Math.max(0, Math.round((new Date(call.retry_after) - Date.now()) / 60000));
                                                                    timeHint = minsLeft > 0 ? ` • ${minsLeft}m` : ' • soon';
                                                                }
                                                                badgeText = retryLabel + timeHint;
                                                                badgeColor = '#c2410c'; badgeBg = '#fff7ed'; badgeBorder = '#fed7aa';
                                                                icon = <RefreshCw size={12} />;
                                                            } else if (isPending) {
                                                                const isCampaignRunning = campaignStatus === 'in-progress' || campaignStatus === 'inprogress' || campaignStatus === 'created' || campaignStatus === 'scheduled';
                                                                const isCampaignPaused = campaignStatus === 'paused';
                                                                const isCampaignDone = campaignStatus === 'completed' || campaignStatus === 'failed';
                                                                if (isCampaignRunning) {
                                                                    badgeText = 'WAITING'; badgeColor = '#475569'; badgeBg = '#f1f5f9'; badgeBorder = '#cbd5e1';
                                                                    icon = <Clock size={12} />;
                                                                } else if (isCampaignPaused) {
                                                                    badgeText = 'ON HOLD'; badgeColor = '#92400e'; badgeBg = '#fffbeb'; badgeBorder = '#fde68a';
                                                                    icon = <Pause size={12} />;
                                                                } else if (isCampaignDone) {
                                                                    badgeText = 'NOT REACHED'; badgeColor = '#991b1b'; badgeBg = '#fef2f2'; badgeBorder = '#fecaca';
                                                                    icon = <AlertCircle size={12} />;
                                                                } else {
                                                                    badgeText = 'QUEUED'; badgeColor = '#475569'; badgeBg = '#f1f5f9'; badgeBorder = '#cbd5e1';
                                                                    icon = <Clock size={12} />;
                                                                }
                                                            } else {
                                                                badgeText = status.toUpperCase(); badgeColor = '#854d0e'; badgeBg = '#fef9c3'; badgeBorder = '#fde68a';
                                                                icon = <AlertCircle size={12} />;
                                                            }
                                                            return (
                                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                                                    <span style={{
                                                                        display: 'inline-flex', alignItems: 'center', gap: '6px',
                                                                        padding: '4px 10px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: '600',
                                                                        background: badgeBg, color: badgeColor, border: `1px solid ${badgeBorder}`, width: 'fit-content'
                                                                    }}>{icon}{badgeText}</span>
                                                                    {(isRetrying || (isFailure && attemptsDone > 0)) && (
                                                                        <span style={{ fontSize: '0.7rem', color: '#94a3b8', paddingLeft: '2px' }}>
                                                                            {attemptsDone} attempt{attemptsDone !== 1 ? 's' : ''} made
                                                                        </span>
                                                                    )}
                                                                    {isPending && (() => {
                                                                        const isCampaignRunning = campaignStatus === 'in-progress' || campaignStatus === 'inprogress' || campaignStatus === 'created' || campaignStatus === 'scheduled';
                                                                        const isCampaignPaused = campaignStatus === 'paused';
                                                                        const isCampaignDone = campaignStatus === 'completed' || campaignStatus === 'failed';
                                                                        const hint = isCampaignRunning ? 'In queue — will be called shortly'
                                                                            : isCampaignPaused ? 'Campaign paused before this call'
                                                                                : isCampaignDone ? 'Campaign ended before this call'
                                                                                    : null;
                                                                        return hint ? <span style={{ fontSize: '0.7rem', color: '#94a3b8', paddingLeft: '2px' }}>{hint}</span> : null;
                                                                    })()}
                                                                </div>
                                                            );
                                                        })()}
                                                    </td>
                                                    <td style={{ padding: '1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        {isSuccess && onNavigateToSession && (
                                                            <button onClick={() => onNavigateToSession(call)}
                                                                style={{
                                                                    display: 'flex', alignItems: 'center', gap: '4px',
                                                                    padding: '6px 10px', borderRadius: '6px', fontSize: '0.8rem',
                                                                    fontWeight: '500', border: '1px solid #bbf7d0', background: '#f0fdf4',
                                                                    color: '#166534', cursor: 'pointer', transition: 'all 0.2s'
                                                                }}
                                                                onMouseOver={e => e.currentTarget.style.background = '#dcfce7'}
                                                                onMouseOut={e => e.currentTarget.style.background = '#f0fdf4'}
                                                            >
                                                                <ExternalLink size={14} /> View Session
                                                            </button>
                                                        )}
                                                        <button title="Copy Number" onClick={() => { navigator.clipboard.writeText(call.to || call.number || ''); toast.success('Number copied!'); }}
                                                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: '4px' }}>
                                                            <Copy size={16} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>

                            {/* Pagination Controls */}
                            {totalPages > 1 && (
                                <div className="pagination-controls">
                                    <button
                                        onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                                        disabled={currentPage === 1}
                                        style={{
                                            padding: '6px 12px', borderRadius: '6px', border: '1px solid #d1d5db',
                                            background: currentPage === 1 ? '#f3f4f6' : 'white',
                                            color: currentPage === 1 ? '#9ca3af' : '#374151',
                                            cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                                            display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem'
                                        }}
                                    >
                                        &larr; Prev
                                    </button>
                                    <span style={{ fontSize: '0.9rem', color: '#4b5563', fontWeight: '500' }}>
                                        Page {currentPage} of {totalPages}
                                    </span>
                                    <button
                                        onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                                        disabled={currentPage === totalPages}
                                        style={{
                                            padding: '6px 12px', borderRadius: '6px', border: '1px solid #d1d5db',
                                            background: currentPage === totalPages ? '#f3f4f6' : 'white',
                                            color: currentPage === totalPages ? '#9ca3af' : '#374151',
                                            cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                                            display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem'
                                        }}
                                    >
                                        Next &rarr;
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}
            <style>{`
                .campaign-grid-2 {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 1rem;
                }
                .campaign-grid-3 {
                    display: grid;
                    grid-template-columns: 1fr 1fr 1fr;
                    gap: 1rem;
                }
                
                .campaign-header-row {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-bottom: 1.5rem;
                    gap: 1rem;
                }
                
                .campaign-id-text {
                    color: #94a3b8;
                    font-size: 0.85rem;
                    word-break: break-all;
                }

                .pagination-controls {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    padding: 1rem;
                    gap: 1rem;
                    border-top: 1px solid #e5e7eb;
                    background: #f9fafb;
                }
                
                @media (max-width: 768px) {
                    .campaign-grid-2, .campaign-grid-3 {
                        grid-template-columns: 1fr;
                    }
                    .modal-content-campaign {
                        width: 95% !important;
                        height: 95vh !important;
                    }
                    .table-container {
                        overflow-x: auto;
                    }
                    
                    .campaign-header-row {
                        flex-direction: column;
                        align-items: stretch;
                    }
                    
                    .campaign-id-text {
                        display: block;
                        margin-top: 4px;
                    }
                    
                    .pagination-controls {
                        flex-wrap: wrap;
                        gap: 0.5rem;
                        padding: 0.5rem;
                    }
                }
            `}</style>
        </div>
    );
}

