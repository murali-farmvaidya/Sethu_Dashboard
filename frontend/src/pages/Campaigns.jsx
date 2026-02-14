import React, { useState, useEffect } from 'react';
import { campaignAPI, adminAPI } from '../services/api';
import toast from 'react-hot-toast';

import { Phone, Upload, Calendar, Play, FileText, CheckCircle, AlertCircle, RefreshCw, X, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function Campaigns() {
    const [campaigns, setCampaigns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [selectedCampaign, setSelectedCampaign] = useState(null); // For details view
    const [callDetails, setCallDetails] = useState([]);
    const [detailsLoading, setDetailsLoading] = useState(false);

    // Agent Selection
    const [viewMode, setViewMode] = useState('agent-selection'); // 'agent-selection', 'list', 'details'
    const [agents, setAgents] = useState([]);
    const [currentAgent, setCurrentAgent] = useState(null);
    const [showAllCampaigns, setShowAllCampaigns] = useState(false);

    // Form / Creation Mode
    const [creationMode, setCreationMode] = useState('upload'); // 'upload', 'manual', 'single'

    // Form State
    const [formData, setFormData] = useState({
        campaignName: '',
        callerId: '',
        message: '',
        flowUrl: '',
        scheduleTime: '',
        retries: 2,
        retryInterval: 10,
        // New fields
        manualNumbers: '', // For textarea
        singlePhone: '',
        singleName: ''
    });
    const [file, setFile] = useState(null);

    const navigate = useNavigate();

    useEffect(() => {
        fetchCampaigns();
        fetchAgents();
    }, []);

    const fetchAgents = async () => {
        try {
            const res = await adminAPI.getAllAgents({ limit: 100 });
            setAgents(res.data.data || []);
        } catch (error) {
            console.error('Failed to fetch agents', error);
        }
    };


    const fetchCampaigns = async () => {
        try {
            setLoading(true);
            const res = await campaignAPI.getAllCampaigns();
            // Exotel V2 returns { response: [...] } or { campaigns: [...] }
            let data = [];
            if (res.data && Array.isArray(res.data)) {
                data = res.data;
            } else if (res.data?.response && Array.isArray(res.data.response)) {
                data = res.data.response;
            } else if (res.data?.campaigns && Array.isArray(res.data.campaigns)) {
                data = res.data.campaigns;
            } else if (res.data?.data && Array.isArray(res.data.data)) {
                data = res.data.data;
            }

            // Filter logic:
            // Since API returns ALL campaigns for the account (no filter param supported by Exotel list API usually),
            // we filter client side. 
            // BUT we only set state. The viewMode 'list' handles the rendering filter. 
            // However, the user said "0 campaigns found". 
            // Let's debug what we got.
            console.log('Fetched Campaigns:', data.length);

            setCampaigns(data);
        } catch (error) {
            console.error(error);
            toast.error('Failed to fetch campaigns');
        } finally {
            setLoading(false);
        }
    };

    const fetchCallDetails = async (campaignId) => {
        try {
            setDetailsLoading(true);
            const res = await campaignAPI.getCampaignCallDetails(campaignId);
            const data = Array.isArray(res.data) ? res.data : res.data?.data || [];
            setCallDetails(data);
        } catch (error) {
            console.error(error);
            toast.error('Failed to fetch call details');
        } finally {
            setDetailsLoading(false);
        }
    };

    const handleCreate = async (e) => {
        e.preventDefault();

        const loadingToast = toast.loading('Creating Campaign...');
        try {
            const data = new FormData();

            // Handle different modes
            if (creationMode === 'upload') {
                if (!file) throw new Error('Please upload a CSV or Excel file');
                data.append('contactsFile', file);
            } else if (creationMode === 'manual') {
                if (!formData.manualNumbers.trim()) throw new Error('Please enter phone numbers');
                // Convert to CSV blob
                const lines = formData.manualNumbers.split('\n').filter(l => l.trim());
                const csvContent = "Phone,Name\n" + lines.map(l => {
                    const parts = l.split(',');
                    return `${parts[0].trim()},${parts[1] ? parts[1].trim() : ''}`;
                }).join('\n');
                const blob = new Blob([csvContent], { type: 'text/csv' });
                data.append('contactsFile', blob, 'manual_upload.csv');
            } else if (creationMode === 'single') {
                if (!formData.singlePhone.trim()) throw new Error('Please enter a phone number');
                const csvContent = "Phone,Name\n" + `${formData.singlePhone.trim()},${formData.singleName.trim()}`;
                const blob = new Blob([csvContent], { type: 'text/csv' });
                data.append('contactsFile', blob, 'single_call.csv');
            }

            data.append('campaignName', formData.campaignName || `Camp_${new Date().toISOString()}`); // Allow auto-name
            data.append('callerId', formData.callerId);
            if (formData.message) data.append('message', formData.message);
            if (formData.flowUrl) data.append('flowUrl', formData.flowUrl);

            // Always attach current agent
            if (currentAgent) data.append('agentId', currentAgent.agent_id);
            if (currentAgent) data.append('agentName', currentAgent.name);


            // Retries Config
            const retriesConfig = {
                number_of_retries: parseInt(formData.retries),
                interval_mins: parseInt(formData.retryInterval),
                on_status: ['busy', 'no-answer', 'failed']
            };
            data.append('retries', JSON.stringify(retriesConfig));

            // Schedule Config
            if (formData.scheduleTime) {
                const scheduleConfig = {
                    send_at: new Date(formData.scheduleTime).toISOString()
                };
                data.append('schedule', JSON.stringify(scheduleConfig));
            }

            await campaignAPI.createCampaign(data);
            toast.success('Campaign initiated successfully!', { id: loadingToast });
            setShowModal(false);

            // Reset common fields
            setFormData(prev => ({
                ...prev,
                campaignName: '',
                message: '',
                scheduleTime: '',
                manualNumbers: '',
                singlePhone: '',
                singleName: ''
            }));
            setFile(null);
            fetchCampaigns(); // Refresh list

        } catch (error) {
            console.error(error);
            toast.error('Failed: ' + (error.response?.data?.error || error.message), { id: loadingToast });
        }
    };

    const handleAgentSelect = (agent) => {
        setCurrentAgent(agent);
        setViewMode('list');
    };


    const handleViewDetails = (campaign) => {
        setSelectedCampaign(campaign);
        fetchCallDetails(campaign.response?.sid || campaign.sid || campaign.id);
    };

    const handleRecallFailed = () => {
        // Filter failed calls
        const failedCalls = callDetails.filter(call =>
            ['failed', 'busy', 'no-answer', 'canceled'].includes(call.Status || call.status)
        );

        if (failedCalls.length === 0) {
            return toast('No failed calls to recall.', { icon: 'ℹ️' });
        }

        // Logic to "Recall": 
        // ideally we generate a CSV of these numbers and open the Create Modal pre-filled.
        // For now, simpler approach: Download CSV.

        const csvContent = "data:text/csv;charset=utf-8,"
            + ["Phone", "Name"].join(",") + "\n"
            + failedCalls.map(c => `${c.To || c.to},Recall`).join("\n");

        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `recall_failed_${selectedCampaign.friendly_name || 'campaign'}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast.success(`Downloaded ${failedCalls.length} failed contacts. Upload this file to start a Recall campaign.`);
        setShowModal(true); // Open modal for them to upload immediately
    };

    if (selectedCampaign) {
        return (
            <div className="page-container">

                <div className="flex items-center justify-between mb-8">
                    <div className="flex items-center gap-3">
                        <button onClick={() => setSelectedCampaign(null)} className="p-2 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600 transition-colors">
                            <ArrowLeft size={18} />
                        </button>
                        <div>
                            <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
                                {selectedCampaign.friendly_name || 'Campaign Details'}
                                <span className={`px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider ${selectedCampaign.status === 'completed' ? 'bg-green-100 text-green-800' :
                                    selectedCampaign.status === 'failed' ? 'bg-red-100 text-red-800' : 'bg-blue-100 text-blue-800'
                                    }`}>
                                    {selectedCampaign.status}
                                </span>
                            </h1>
                            <div className="text-sm text-gray-500 mt-1 flex items-center gap-4">
                                <span>ID: <span className="font-mono">{selectedCampaign.sid || selectedCampaign.id}</span></span>
                                <span>created: {new Date(selectedCampaign.date_created || selectedCampaign.created_at).toLocaleString()}</span>
                            </div>
                        </div>
                    </div>
                </div>


                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                        <div className="text-gray-500 text-sm">Total Calls</div>
                        <div className="text-2xl font-bold">{callDetails.length}</div>
                    </div>
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                        <div className="text-gray-500 text-sm">Failed/Unanswered</div>
                        <div className="text-2xl font-bold text-red-600">
                            {callDetails.filter(c => ['failed', 'busy', 'no-answer', 'canceled'].includes(c.Status || c.status)).length}
                        </div>
                    </div>
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center justify-center">
                        <button
                            onClick={handleRecallFailed}
                            className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors"
                        >
                            <RefreshCw size={18} /> Recall Failed
                        </button>
                    </div>
                </div>

                <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                    <div className="p-4 border-b border-gray-100 font-semibold text-gray-700">Call Details</div>
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="bg-gray-50 text-gray-600 text-sm">
                                    <th className="p-3">To</th>
                                    <th className="p-3">From</th>
                                    <th className="p-3">Status</th>
                                    <th className="p-3">Duration</th>
                                    <th className="p-3">Start Time</th>
                                </tr>
                            </thead>
                            <tbody>
                                {detailsLoading ? (
                                    <tr><td colSpan="5" className="p-6 text-center">Loading details...</td></tr>
                                ) : callDetails.length === 0 ? (
                                    <tr><td colSpan="5" className="p-6 text-center text-gray-500">No calls found.</td></tr>
                                ) : (
                                    callDetails.map((call, idx) => (
                                        <tr key={idx} className="border-b border-gray-50 hover:bg-gray-50 text-sm">
                                            <td className="p-3 text-gray-800">{call.To || call.to}</td>
                                            <td className="p-3 text-gray-600">{call.From || call.from || selectedCampaign.caller_id}</td>
                                            <td className="p-3">
                                                <span className={`px-2 py-1 rounded text-xs ${(call.Status || call.status) === 'completed' ? 'bg-green-100 text-green-700' :
                                                    ['busy', 'no-answer', 'failed'].includes(call.Status || call.status) ? 'bg-red-100 text-red-700' :
                                                        'bg-gray-100 text-gray-700'
                                                    }`}>
                                                    {call.Status || call.status}
                                                </span>
                                            </td>
                                            <td className="p-3 text-gray-600">{call.Duration || call.duration}s</td>
                                            <td className="p-3 text-gray-500">{new Date(call.StartTime || call.date_created).toLocaleString()}</td>
                                        </tr>
                                    ))
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="page-container">
            <div className="page-header">
                <div>
                    <h1>Campaigns</h1>
                    <div className="text-sm text-gray-500 mt-1">Manage and track your outreach campaigns</div>
                </div>

                <div className="flex items-center gap-3">
                    <button
                        onClick={fetchCampaigns}
                        className="btn-action"
                        title="Refresh List"
                    >
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </button>
                    <button
                        onClick={() => setShowModal(true)}
                        className="flex items-center gap-2 bg-indigo-600 text-white px-4 py-2.5 rounded-lg hover:bg-indigo-700 transition-colors shadow-sm font-semibold text-sm"
                    >
                        <Upload size={18} /> New Campaign
                    </button>
                </div>
            </div>


            {loading ? (
                <div className="flex justify-center items-center h-64">
                    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
                </div>
            ) : (
                <div>
                    {viewMode === 'agent-selection' && (
                        <div>
                            <h2 className="text-xl font-semibold mb-6 flex items-center gap-2 text-gray-800">
                                <span className="bg-indigo-100 p-1.5 rounded-lg text-indigo-600"><Phone size={20} /></span>
                                Select an Agent
                            </h2>
                            {agents.length === 0 ? (
                                <div className="text-center py-12 text-gray-500 bg-gray-50 rounded-xl border border-dashed border-gray-200">
                                    <p>No agents found. Please create an agent first.</p>
                                    <button onClick={() => navigate('/create-agent')} className="text-indigo-600 font-medium hover:underline mt-2">Create New Agent</button>
                                </div>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                    {agents.map(agent => (
                                        <div
                                            key={agent.agent_id}
                                            onClick={() => handleAgentSelect(agent)}
                                            className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 hover:shadow-md hover:border-indigo-200 transition-all cursor-pointer group"
                                        >
                                            <div className="flex items-center gap-4 mb-4">
                                                <div className="w-12 h-12 bg-indigo-50 rounded-full flex items-center justify-center text-indigo-600 font-bold text-lg group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                                                    {(agent.name || agent.agent_id)?.charAt(0).toUpperCase()}
                                                </div>
                                                <div>
                                                    <h3 className="font-bold text-gray-900 group-hover:text-indigo-600 transition-colors">{agent.name || agent.agent_id}</h3>
                                                    <span className="text-xs text-gray-500 font-mono">{agent.agent_id}</span>
                                                </div>
                                            </div>
                                            <div className="flex items-center justify-between text-sm text-gray-500 mt-2 pt-4 border-t border-gray-50">
                                                <span className="flex items-center gap-1"><FileText size={14} /> {agent.session_count || 0} sessions</span>
                                                <span className="text-indigo-500 font-medium text-xs opacity-0 group-hover:opacity-100 transition-opacity">Select &rarr;</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}

                    {viewMode === 'list' && (
                        <div>
                            <div className="mb-6 flex items-center gap-3">
                                <button onClick={() => { setViewMode('agent-selection'); setCurrentAgent(null); }} className="hover:bg-gray-100 p-2 rounded-lg transition-colors text-gray-600">
                                    <ArrowLeft size={20} />
                                </button>
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-700 font-bold">
                                        {(currentAgent?.name || currentAgent?.agent_id)?.charAt(0)}
                                    </div>
                                    <div>
                                        <h2 className="text-xl font-bold text-gray-900">{currentAgent?.name || currentAgent?.agent_id}</h2>
                                        <p className="text-sm text-gray-500">Campaigns & Outreach</p>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center justify-end mb-4">
                                <label className="flex items-center cursor-pointer text-sm text-gray-600 hover:text-indigo-600 transition-colors">
                                    <input
                                        type="checkbox"
                                        checked={showAllCampaigns}
                                        onChange={e => setShowAllCampaigns(e.target.checked)}
                                        className="mr-2 w-4 h-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                                    />
                                    Show all campaigns (ignore agent filter)
                                </label>
                            </div>

                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                                {(() => {
                                    const filteredCampaigns = campaigns.filter(c => {
                                        if (!currentAgent || showAllCampaigns) return true;
                                        const name = c.friendly_name || c.name || '';
                                        // Case-insensitive check
                                        return name.toLowerCase().includes(`_ag${currentAgent.agent_id.toLowerCase()}`) ||
                                            name.toLowerCase().includes(currentAgent.agent_id.toLowerCase());
                                    });
                                    // console.log('Filtered Campaigns:', filteredCampaigns.length);

                                    return filteredCampaigns.length === 0 ? (
                                        <div className="col-span-full text-center py-12 text-gray-500 bg-white rounded-xl border border-dashed border-gray-300">
                                            <FileText className="mx-auto mb-3 text-gray-300" size={48} />
                                            <p>No campaigns found for {currentAgent?.name || currentAgent?.agent_id}.</p>
                                            <p className="text-xs text-gray-400 mt-2">
                                                (Showing 0 of {campaigns.length} total campaigns)
                                            </p>

                                            <div className="flex justify-center gap-4 mt-4">
                                                <button onClick={() => setShowAllCampaigns(true)} className="text-indigo-600 hover:text-indigo-800 text-sm font-medium underline">
                                                    Show All Instead
                                                </button>
                                                <button onClick={() => setShowModal(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
                                                    Create New Campaign
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        filteredCampaigns.map((camp) => (
                                            <div key={camp.sid || camp.id} className="card hover:shadow-md transition-all cursor-pointer border-l-4 border-l-transparent hover:border-l-indigo-500" onClick={() => handleViewDetails(camp)}>
                                                <div className="flex justify-between items-start mb-3">
                                                    <h3 className="font-semibold text-gray-800 text-lg truncate pr-2" title={camp.friendly_name}>
                                                        {(camp.friendly_name || camp.name || 'Unnamed Campaign').replace(`_AG${currentAgent.agent_id}`, '').replace(currentAgent.agent_id, '')}
                                                    </h3>
                                                    <span className={`px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider ${(camp.status || '').toLowerCase() === 'completed' ? 'bg-green-100 text-green-800' :
                                                        (camp.status || '').toLowerCase() === 'failed' ? 'bg-red-100 text-red-800' :
                                                            'bg-blue-100 text-blue-800'
                                                        }`}>
                                                        {camp.status || 'Unknown'}
                                                    </span>
                                                </div>
                                                <div className="text-sm text-gray-500 space-y-2 mb-4">
                                                    <div className="flex items-center gap-2">
                                                        <Calendar size={14} className="text-gray-400" />
                                                        <span>{new Date(camp.date_created || camp.created_at).toLocaleString()}</span>
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <FileText size={14} className="text-gray-400" />
                                                        <span>{camp.type || 'Static'} Campaign</span>
                                                    </div>
                                                </div>
                                                <div className="flex justify-between items-center pt-3 border-t border-gray-100 mt-auto">
                                                    <span className="text-xs text-gray-400 font-mono">ID: {(camp.sid || camp.id || '').substring(0, 8)}...</span>

                                                    <div className="text-indigo-600 text-sm font-semibold flex items-center gap-1 group">
                                                        <span>View Details</span> <Play size={12} className="group-hover:translate-x-1 transition-transform" />
                                                    </div>
                                                </div>
                                            </div>
                                        ))
                                    );
                                })()}
                            </div>
                        </div>
                    )}


                </div>
            )}

            {/* CREATE MODAL */}
            {showModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex justify-center items-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
                        <div className="bg-indigo-600 px-6 py-4 flex justify-between items-center text-white">
                            <h2 className="text-lg font-semibold flex items-center gap-2">
                                <Upload size={20} /> New Campaign {currentAgent ? `for ${currentAgent.name || currentAgent.agent_id}` : ''}
                            </h2>
                            <button onClick={() => setShowModal(false)} className="hover:bg-white/20 p-1 rounded-full transition-colors">
                                <X size={20} />
                            </button>
                        </div>

                        <form onSubmit={handleCreate} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">

                            {/* MODE SELECTION TABS */}
                            <div className="flex bg-gray-100 p-1 rounded-lg mb-4">
                                {['upload', 'manual', 'single'].map(mode => (
                                    <button
                                        key={mode}
                                        type="button"
                                        onClick={() => setCreationMode(mode)}
                                        className={`flex-1 py-1.5 text-sm font-medium rounded-md capitalize transition-all ${creationMode === mode ? 'bg-white text-indigo-600 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                                            }`}
                                    >
                                        {mode === 'upload' ? 'File Upload' : mode === 'single' ? 'Single Call' : 'Manual Entry'}
                                    </button>
                                ))}
                            </div>

                            {creationMode === 'upload' && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Upload Contacts (CSV/Excel)</label>
                                    <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:bg-gray-50 transition-colors relative cursor-pointer group">
                                        <input
                                            type="file"
                                            accept=".csv,.xlsx,.xls"
                                            onChange={e => setFile(e.target.files[0])}
                                            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                                        />

                                        <div className="text-gray-500 group-hover:text-indigo-600 transition-colors">
                                            {file ? (
                                                <div className="flex items-center justify-center gap-2 font-medium text-green-600">
                                                    <CheckCircle size={18} /> {file.name}
                                                </div>
                                            ) : (
                                                <>
                                                    <Upload className="mx-auto mb-2" size={24} />
                                                    <span className="text-sm">Click to upload CSV or Excel</span>
                                                </>

                                            )}
                                        </div>
                                    </div>
                                    <p className="text-xs text-gray-400 mt-1">Columns: Phone, Name (optional)</p>
                                </div>
                            )}

                            {creationMode === 'manual' && (
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Enter Contacts (Phone, Name)</label>
                                    <textarea
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-indigo-500 font-mono text-sm"
                                        rows="5"
                                        placeholder={`9876543210, John Doe\n9123456789, Jane Smith`}
                                        value={formData.manualNumbers}
                                        onChange={e => setFormData({ ...formData, manualNumbers: e.target.value })}
                                    />
                                    <p className="text-xs text-gray-400 mt-1">One per line. Name is optional.</p>
                                </div>
                            )}

                            {creationMode === 'single' && (
                                <div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
                                    <div className="space-y-3">
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Phone Number</label>
                                            <input
                                                type="tel"
                                                required
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-indigo-500"
                                                placeholder="9876543210"
                                                value={formData.singlePhone}
                                                onChange={e => setFormData({ ...formData, singlePhone: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-sm font-medium text-gray-700 mb-1">Name (Optional)</label>
                                            <input
                                                type="text"
                                                className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-indigo-500"
                                                placeholder="John Doe"
                                                value={formData.singleName}
                                                onChange={e => setFormData({ ...formData, singleName: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div>

                                <label className="block text-sm font-medium text-gray-700 mb-1">Campaign Name</label>
                                <input
                                    type="text"
                                    required
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all"
                                    placeholder="e.g. Diwali Promo"
                                    value={formData.campaignName}
                                    onChange={e => setFormData({ ...formData, campaignName: e.target.value })}
                                />
                            </div>



                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">Caller ID</label>
                                    <input
                                        type="text"
                                        required
                                        className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-indigo-500"
                                        placeholder="0xx..."
                                        value={formData.callerId}
                                        onChange={e => setFormData({ ...formData, callerId: e.target.value })}
                                    />
                                </div>
                            </div>
                            <div className="col-span-2">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Schedule Start Time (Optional)</label>
                                <input
                                    type="datetime-local"
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-indigo-500 text-sm"
                                    value={formData.scheduleTime}
                                    onChange={e => setFormData({ ...formData, scheduleTime: e.target.value })}
                                    min={new Date().toISOString().slice(0, 16)}
                                />
                                <p className="text-xs text-gray-400 mt-1">Leave blank to start immediately.</p>
                            </div>
                            <div className="mt-4">
                                <label className="block text-sm font-medium text-gray-700 mb-1">Message (Text-to-Speech)</label>
                                <textarea
                                    className="w-full px-3 py-2 border border-gray-300 rounded-lg outline-none focus:border-indigo-500 text-sm"
                                    placeholder="Hello, this is a call from FarmVaidya..."
                                    rows="2"
                                    value={formData.message}
                                    onChange={e => setFormData({ ...formData, message: e.target.value })}
                                />
                            </div>

                            <div className="bg-indigo-50 p-4 rounded-lg space-y-3 mt-4">
                                <h3 className="text-xs font-bold text-indigo-800 uppercase tracking-wide">Advance Options</h3>
                                <div>
                                    <label className="block text-xs font-semibold text-gray-600 mb-1">Retries</label>
                                    <div className="flex gap-2">
                                        <input
                                            type="number"
                                            min="0" max="5"
                                            className="w-16 px-2 py-1.5 border border-gray-300 rounded text-sm outline-none"
                                            title="Count"
                                            value={formData.retries}
                                            onChange={e => setFormData({ ...formData, retries: e.target.value })}
                                        />
                                        <input
                                            type="number"
                                            min="5"
                                            className="w-16 px-2 py-1.5 border border-gray-300 rounded text-sm outline-none"
                                            title="Interval (Mins)"
                                            placeholder="Mins"
                                            value={formData.retryInterval}
                                            onChange={e => setFormData({ ...formData, retryInterval: e.target.value })}
                                        />
                                    </div>
                                </div>
                            </div>

                            <button
                                type="submit"
                                className="w-full bg-indigo-600 text-white font-semibold py-2.5 rounded-lg hover:bg-indigo-700 transition-colors shadow-lg shadow-indigo-200 mt-2"
                            >
                                Launch Campaign
                            </button>
                        </form>
                    </div >
                </div >
            )
            }
        </div >
    );
}


