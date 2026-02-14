import React, { useState, useEffect, useCallback } from 'react';
import { campaignAPI } from '../services/api';
import toast from 'react-hot-toast';
import { Upload, FileText, CheckCircle, AlertCircle, RefreshCw, RotateCcw, X, Phone, Play, Pause, Clock, ChevronDown, ChevronRight, ExternalLink, Trash2, Copy } from 'lucide-react';

export default function CampaignTab({ agentId, agentName, onNavigateToSession, telephonyConfig }) {
    const [subTab, setSubTab] = useState('create'); // 'create' | 'inspect'
    const [campaigns, setCampaigns] = useState([]);
    const [loading, setLoading] = useState(false);
    const [selectedCampaign, setSelectedCampaign] = useState(null);
    const [callDetails, setCallDetails] = useState([]);
    const [detailsLoading, setDetailsLoading] = useState(false);
    const [callFilter, setCallFilter] = useState('all'); // 'all','successful','failed','pending'

    const [showAll, setShowAll] = useState(false);
    const [allCampaigns, setAllCampaigns] = useState([]);

    // Create Campaign State
    const [file, setFile] = useState(null);
    const [creating, setCreating] = useState(false);

    // Multi-select state
    const [selectedCampaignIds, setSelectedCampaignIds] = useState(new Set());

    const [formData, setFormData] = useState({
        campaignName: '',
        retries: 2,
        retryInterval: 10,
        scheduleTime: '',
        scheduleEndTime: '',
        throttle: 10 // seconds interval
    });

    const fetchCampaigns = useCallback(async () => {
        try {
            setLoading(true);
            const res = await campaignAPI.getAllCampaigns();
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

            // Filter campaigns for this agent
            // We match by the _AGsuffix which uses the last 4 digits of agentId
            const suffix = agentId && agentId.length > 4 ? `_ag${agentId.slice(-4)}` : `_ag${agentId}`;
            const agentCampaigns = normalizedData.filter(c => {
                const name = (c.friendly_name || c.name || '').toLowerCase();
                return name.includes(`_ag${agentId}`.toLowerCase()) || name.includes(suffix.toLowerCase());
            });
            setCampaigns(agentCampaigns);
        } catch (error) {
            console.error('Failed to fetch campaigns:', error);
        } finally {
            setLoading(false);
        }
    }, [agentId]);

    useEffect(() => {
        fetchCampaigns();
    }, [fetchCampaigns]);

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
        if (formData.scheduleEndTime) schedule.end_at = new Date(formData.scheduleEndTime).toISOString();

        if (Object.keys(schedule).length > 0) {
            data.append('schedule', JSON.stringify(schedule));
        }

        if (formData.throttle) {
            // Convert interval (seconds) to Calls Per Minute
            // e.g. 10s -> 60/10 = 6 calls/min
            // Ensure at least 1
            const cpm = Math.max(1, Math.floor(60 / parseInt(formData.throttle || 10)));
            data.append('throttle', cpm);
        }

        try {
            setCreating(true);
            await campaignAPI.createCampaign(data);
            toast.success('Campaign initiated! Contacts are being uploaded.');
            setFile(null);
            setFormData({ campaignName: '', retries: 2, retryInterval: 10, scheduleTime: '', scheduleEndTime: '', throttle: 10 });
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
        if (s === 'in-progress' || s === 'ringing' || s === 'initiated' || s === 'queued') return '#f59e0b';
        if (s === 'paused') return '#64748b';
        return '#94a3b8';
    };

    const getStatusBg = (status) => {
        const s = (status || '').toLowerCase();
        if (s === 'completed' || s === 'answered' || s === 'completed-success') return '#f0fdf4';
        if (s.includes('fail') || s === 'busy' || s === 'no-answer' || s === 'noanswer' || s === 'canceled') return '#fef2f2';
        if (s === 'in-progress' || s === 'ringing' || s === 'initiated' || s === 'queued') return '#fffbeb';
        if (s === 'paused') return '#f1f5f9';
        return '#f8fafc';
    };

    const filteredCalls = callDetails.filter(c => {
        if (callFilter === 'all') return true;
        const s = (c.status || c.Status || '').toLowerCase();
        if (callFilter === 'successful') return s === 'completed' || s === 'answered' || s === 'completed-success';
        if (callFilter === 'failed') return s.includes('fail') || s === 'busy' || s === 'no-answer' || s === 'noanswer' || s === 'canceled';
        if (callFilter === 'pending') return s === 'queued' || s === 'in-progress' || s === 'ringing' || s === 'initiated';
        return true;
    });

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
                                        <p style={{ color: '#94a3b8', margin: '4px 0 0', fontSize: '0.8rem' }}>Must contain a "phone_number" column</p>
                                    </div>
                                )}
                            </div>
                        </div>
                        {/* Schedule */}
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '0.9rem', color: '#374151' }}>Start Time (Optional)</label>
                                <input
                                    type="datetime-local"
                                    value={formData.scheduleTime}
                                    onChange={e => setFormData({ ...formData, scheduleTime: e.target.value })}
                                    min={new Date().toISOString().slice(0, 16)}
                                    style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '0.95rem', outline: 'none' }}
                                />
                            </div>
                            <div>
                                <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '0.9rem', color: '#374151' }}>End Time (Optional)</label>
                                <input
                                    type="datetime-local"
                                    value={formData.scheduleEndTime}
                                    onChange={e => setFormData({ ...formData, scheduleEndTime: e.target.value })}
                                    min={formData.scheduleTime || new Date().toISOString().slice(0, 16)}
                                    style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '2px solid #e5e7eb', fontSize: '0.95rem', outline: 'none' }}
                                />
                            </div>
                        </div>
                        <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginTop: '-10px' }}>Leave blank to start immediately. End time auto-stops the campaign.</p>



                        {/* Advanced Options */}
                        <div style={{ background: '#f9fafb', padding: '1.5rem', borderRadius: '12px', border: '1px solid #e5e7eb', marginTop: '0.5rem' }}>
                            <h4 style={{ margin: '0 0 1rem', fontSize: '0.85rem', fontWeight: '700', textTransform: 'uppercase', color: '#64748b', letterSpacing: '0.05em' }}>Advanced Options</h4>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '0.9rem', color: '#374151' }}>Retries</label>
                                    <input type="number" min="0" max="5" value={formData.retries}
                                        onChange={e => setFormData({ ...formData, retries: e.target.value })}
                                        style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '2px solid #edeff1', fontSize: '0.95rem', outline: 'none' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '0.9rem', color: '#374151' }}>Retry Interval (min)</label>
                                    <input type="number" min="1" value={formData.retryInterval}
                                        onChange={e => setFormData({ ...formData, retryInterval: e.target.value })}
                                        style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '2px solid #edeff1', fontSize: '0.95rem', outline: 'none' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '6px', fontWeight: '500', fontSize: '0.9rem', color: '#374151' }}>Call Interval (sec)</label>
                                    <input type="number" min="1" value={formData.throttle}
                                        onChange={e => setFormData({ ...formData, throttle: e.target.value })}
                                        placeholder="10"
                                        style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '2px solid #edeff1', fontSize: '0.95rem', outline: 'none' }}
                                    />
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
                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', cursor: 'pointer', color: '#374151' }}>
                                <input
                                    type="checkbox"
                                    checked={showAll}
                                    onChange={e => setShowAll(e.target.checked)}
                                    style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#008F4B' }}
                                />
                                Show All
                            </label>
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
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {(showAll ? allCampaigns : campaigns).map((camp, i) => {
                                const id = camp.sid || camp.id || camp.campaign_sid || camp.uuid || camp.Sid;
                                return (
                                    <div key={id || i}
                                        style={{
                                            background: 'white', borderRadius: '10px', padding: '1rem 1.25rem',
                                            border: '1px solid #e5e7eb',
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                            borderLeft: `4px solid ${camp.status?.toLowerCase() === 'completed' ? '#22c55e' : (camp.status?.toLowerCase() === 'failed' || camp.status?.toLowerCase() === 'canceled') ? '#ef4444' : camp.status?.toLowerCase() === 'paused' ? '#94a3b8' : '#f59e0b'}`,
                                            transition: 'all 0.2s', position: 'relative'
                                        }}
                                        onClick={(e) => {
                                            // Only navigate if not clicking checkbox or delete
                                            if (e.target.type !== 'checkbox' && !e.target.closest('button')) {
                                                if (id) {
                                                    setSelectedCampaign(camp);
                                                    fetchCallDetails(id);
                                                }
                                            }
                                        }}
                                        onMouseOver={e => { e.currentTarget.style.boxShadow = '0 4px 12px rgba(0,0,0,0.08)'; e.currentTarget.style.borderColor = '#008F4B'; }}
                                        onMouseOut={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = '#e5e7eb'; }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <input type="checkbox"
                                                checked={selectedCampaignIds.has(id)}
                                                onChange={e => toggleSelect(id, e.target.checked)}
                                                onClick={e => e.stopPropagation()}
                                                style={{ width: '18px', height: '18px', accentColor: '#008F4B', cursor: 'pointer' }}
                                            />
                                            <div>
                                                <h4 style={{ margin: '0 0 4px', fontSize: '1rem', fontWeight: '600', color: '#1f2937' }}>
                                                    {campaignDisplayName(camp)}
                                                </h4>
                                                <div style={{ display: 'flex', gap: '16px', fontSize: '0.8rem', color: '#94a3b8' }}>
                                                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}><Clock size={12} /> {formatCampaignDate(camp.date_created)}</span>
                                                    <span style={{
                                                        padding: '2px 8px', borderRadius: '4px', fontWeight: '600', fontSize: '0.75rem',
                                                        textTransform: 'uppercase', letterSpacing: '0.03em',
                                                        background: (camp.status === 'Created' && camp.schedule?.send_at) ? '#e0f2fe' : (getEffectiveStatus(camp) === 'Completed' ? '#dcfce7' : (getEffectiveStatus(camp) === 'Failed' || getEffectiveStatus(camp) === 'Canceled') ? '#fee2e2' : getEffectiveStatus(camp) === 'Paused' ? '#f1f5f9' : '#fef9c3'),
                                                        color: (camp.status === 'Created' && camp.schedule?.send_at) ? '#0369a1' : (getEffectiveStatus(camp) === 'Completed' ? '#166534' : (getEffectiveStatus(camp) === 'Failed' || getEffectiveStatus(camp) === 'Canceled') ? '#991b1b' : getEffectiveStatus(camp) === 'Paused' ? '#475569' : '#854d0e')
                                                    }}>
                                                        {(camp.status === 'Created' && camp.schedule?.send_at)
                                                            ? `Scheduled: ${new Date(camp.schedule.send_at).toLocaleString()}`
                                                            : getEffectiveStatus(camp)}
                                                    </span>
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <button
                                                    onClick={(e) => handleDeleteCampaign(id, e)}
                                                    style={{ padding: '6px', borderRadius: '6px', border: 'none', background: '#fee2e2', color: '#ef4444', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                                    title="Delete Campaign"
                                                >
                                                    <Trash2 size={16} />
                                                </button>
                                                <ChevronRight size={20} color="#94a3b8" />
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
            {/* CAMPAIGN DETAIL VIEW */}
            {subTab === 'inspect' && selectedCampaign && (
                <div>
                    <button onClick={() => { setSelectedCampaign(null); setCallDetails([]); setCallFilter('all'); }}
                        style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', cursor: 'pointer', color: '#008F4B', fontWeight: '600', fontSize: '0.9rem', marginBottom: '1rem', padding: '0' }}>
                        ← Back to Campaigns
                    </button>
                    <div className="card" style={{ background: 'white', borderRadius: '12px', padding: '1.5rem', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', marginBottom: '1rem' }}>
                        <h3 style={{ margin: '0 0 8px', fontSize: '1.1rem', color: '#1f2937' }}>
                            {campaignDisplayName(selectedCampaign)}
                        </h3>
                        <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', fontSize: '0.85rem', color: '#64748b' }}>
                            <span>Status: {
                                (selectedCampaign.status === 'Created' && selectedCampaign.schedule?.send_at) ? (
                                    <strong style={{ color: '#0369a1', background: '#e0f2fe', padding: '2px 8px', borderRadius: '4px' }}>
                                        Scheduled: {new Date(selectedCampaign.schedule.send_at).toLocaleString()}
                                    </strong>
                                ) : (
                                    <strong style={{ color: getStatusColor(getEffectiveStatus(selectedCampaign)) }}>{getEffectiveStatus(selectedCampaign)}</strong>
                                )
                            }</span>
                            <span>Created: {formatCampaignDate(selectedCampaign.date_created)}</span>
                            <span>Total Calls: {callDetails.length}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '10px' }}>
                            <button
                                onClick={(e) => handleDeleteCampaign(selectedCampaign.sid || selectedCampaign.id, e)}
                                style={{
                                    marginTop: '1rem', padding: '8px 16px', borderRadius: '6px',
                                    border: '1px solid #fee2e2', background: '#fff1f2', color: '#e11d48',
                                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: '600'
                                }}
                            >
                                <Trash2 size={14} /> Delete Campaign
                            </button>

                            {(selectedCampaign.status === 'InProgress' || selectedCampaign.status === 'Created' || selectedCampaign.status === 'Scheduled' || selectedCampaign.status === 'in-progress') && (
                                <button
                                    onClick={() => handleStopCampaign(selectedCampaign.sid || selectedCampaign.id)}
                                    style={{
                                        marginTop: '1rem', marginLeft: '1rem', padding: '8px 16px', borderRadius: '6px',
                                        border: '1px solid #94a3b8', background: '#f8fafc', color: '#475569',
                                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: '600'
                                    }}
                                >
                                    <Pause size={14} /> Pause Campaign
                                </button>
                            )}

                            {(selectedCampaign.status?.toLowerCase() === 'paused') && (
                                <button
                                    onClick={() => handleResumeCampaign(selectedCampaign.sid || selectedCampaign.id)}
                                    style={{
                                        marginTop: '1rem', marginLeft: '1rem', padding: '8px 16px', borderRadius: '6px',
                                        border: '1px solid #008F4B', background: '#f0fdf4', color: '#008F4B',
                                        cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', fontWeight: '600'
                                    }}
                                >
                                    <Play size={14} /> Resume Campaign
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Call Filter Buttons */}
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                        {['all', 'successful', 'failed', 'pending'].map(f => (
                            <button key={f} onClick={() => setCallFilter(f)}
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
                                {f !== 'all' && ` (${callDetails.filter(c => {
                                    const s = (c.status || c.Status || '').toLowerCase();
                                    if (f === 'successful') return s === 'completed' || s === 'answered' || s === 'completed-success';
                                    if (f === 'failed') return s.includes('fail') || s === 'busy' || s === 'no-answer' || s === 'noanswer' || s === 'canceled';
                                    if (f === 'pending') return s === 'queued' || s === 'in-progress' || s === 'ringing' || s === 'initiated';
                                    return false;
                                }).length
                                    })`}
                            </button>
                        ))}
                        <button onClick={handleResendFailed}
                            style={{
                                marginLeft: 'auto', padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.85rem',
                                fontWeight: '600', border: '1px solid #008F4B', background: '#f0fdf4', color: '#008F4B',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px'
                            }}>
                            <RotateCcw size={14} /> Resend to Failed
                        </button>
                        <button onClick={handleResendAll}
                            style={{
                                padding: '0.5rem 1rem', borderRadius: '6px', fontSize: '0.85rem',
                                fontWeight: '600', border: '1px solid #64748b', background: '#f8fafc', color: '#475569',
                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px'
                            }}>
                            <RefreshCw size={14} /> Resend to All
                        </button>
                    </div>

                    {/* Call Details Table */}
                    {detailsLoading ? (
                        <div style={{ textAlign: 'center', padding: '2rem', color: '#94a3b8' }}>
                            <RefreshCw size={20} className="spin" /> Loading calls...
                        </div>
                    ) : (
                        <div className="card" style={{ background: 'white', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                            <div className="table-container">
                                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                    <thead style={{ background: '#f8f9fa' }}>
                                        <tr>
                                            <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: '600', color: '#444', fontSize: '0.85rem' }}>Phone</th>
                                            <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: '600', color: '#444', fontSize: '0.85rem' }}>Name</th>
                                            <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: '600', color: '#444', fontSize: '0.85rem' }}>Status</th>
                                            <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: '600', color: '#444', fontSize: '0.85rem' }}>Duration</th>
                                            <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: '600', color: '#444', fontSize: '0.85rem' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredCalls.length === 0 ? (
                                            <tr><td colSpan={5} style={{ padding: '2rem', textAlign: 'center', color: '#94a3b8' }}>No calls found</td></tr>
                                        ) : filteredCalls.map((call, i) => {
                                            const status = (call.status || call.Status || 'unknown').toLowerCase();
                                            const isSuccess = status === 'completed' || status === 'answered' || status === 'completed-success';
                                            const isFailure = status.includes('fail') || status === 'busy' || status === 'no-answer' || status === 'noanswer' || status === 'canceled';

                                            return (
                                                <tr key={call.sid || call.id || i} style={{ borderBottom: '1px solid #f0f0f0', background: getStatusBg(status) }}>
                                                    <td style={{ padding: '0.75rem 1rem', fontFamily: 'monospace', fontSize: '0.9rem' }}>
                                                        {call.to || call.number || call.phone_number || '-'}
                                                    </td>
                                                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.9rem', color: '#1f2937' }}>
                                                        {call.Name || call.name || call.first_name || '-'}
                                                    </td>
                                                    <td style={{ padding: '0.75rem 1rem' }}>
                                                        <span style={{
                                                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                                                            padding: '3px 10px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: '600',
                                                            background: isSuccess ? '#dcfce7' : isFailure ? '#fee2e2' : '#fef9c3',
                                                            color: isSuccess ? '#166534' : isFailure ? '#991b1b' : '#854d0e'
                                                        }}>
                                                            {isSuccess ? <CheckCircle size={12} /> : <AlertCircle size={12} />}
                                                            {status}
                                                            {status === 'completed' && parseInt(call.duration || 0) < 5 && ' (Short term)'}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '0.75rem 1rem', fontSize: '0.85rem', color: '#64748b' }}>
                                                        {call.duration || call.conversation_duration || '-'}s
                                                    </td>
                                                    <td style={{ padding: '0.75rem 1rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                        {isSuccess && onNavigateToSession && (
                                                            <button onClick={() => onNavigateToSession(call)}
                                                                style={{
                                                                    display: 'flex', alignItems: 'center', gap: '4px',
                                                                    padding: '4px 10px', borderRadius: '6px', fontSize: '0.8rem',
                                                                    fontWeight: '500', border: '1px solid #008F4B', background: '#f0fdf4',
                                                                    color: '#008F4B', cursor: 'pointer', transition: 'all 0.2s'
                                                                }}>
                                                                <ExternalLink size={12} /> View Session
                                                            </button>
                                                        )}
                                                        <button title="Copy Number" onClick={() => { navigator.clipboard.writeText(call.to || call.number || ''); toast.success('Number copied!'); }}
                                                            style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#94a3b8', padding: '4px' }}>
                                                            <Copy size={16} />
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}

