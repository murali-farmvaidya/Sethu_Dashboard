import { useEffect, useState, useCallback } from 'react';
import api, { adminAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, Download, ChevronDown, ChevronLeft, ChevronRight, ArrowUpDown, RefreshCw, Trash2, RotateCcw, ShieldAlert, Eye, EyeOff, X, CheckSquare, Square, MinusSquare } from 'lucide-react';
import Header from '../components/Header';

const ITEMS_PER_PAGE = 10;

export default function AgentDetails() {
    const { user, isAdmin } = useAuth();
    const { agentId } = useParams();
    const [sessions, setSessions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [agentName, setAgentName] = useState('');
    const [downloadDropdown, setDownloadDropdown] = useState(null);
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalSessions, setTotalSessions] = useState(0);
    const [sortBy, setSortBy] = useState('started_at');
    const [sortOrder, setSortOrder] = useState('desc');
    const [successRate, setSuccessRate] = useState(0);
    const [totalDuration, setTotalDuration] = useState(0);
    const [zeroTurnsCount, setZeroTurnsCount] = useState(0);
    const [agentCreatedAt, setAgentCreatedAt] = useState(null);
    const [agentLastSynced, setAgentLastSynced] = useState(null);
    const [generatingSummary, setGeneratingSummary] = useState({});
    const [reviewFilter, setReviewFilter] = useState('all');
    const [updatingStatus, setUpdatingStatus] = useState({});

    // Recycle Bin State
    const [recycleBinOpen, setRecycleBinOpen] = useState(false);
    const [excludedSessions, setExcludedSessions] = useState([]);
    const [hiddenSessionsList, setHiddenSessionsList] = useState([]);
    const [selectedBinItems, setSelectedBinItems] = useState(new Set());

    const navigate = useNavigate();

    const [showHiddenSessions, setShowHiddenSessions] = useState(false);

    // Multi-select state (persists across pagination)
    const [selectedSessions, setSelectedSessions] = useState(new Set());

    const toggleSelect = (sessionId) => {
        setSelectedSessions(prev => {
            const next = new Set(prev);
            if (next.has(sessionId)) {
                next.delete(sessionId);
            } else {
                next.add(sessionId);
            }
            return next;
        });
    };

    const toggleSelectAll = () => {
        const currentPageIds = sessions.map(s => s.session_id);
        const allSelected = currentPageIds.every(id => selectedSessions.has(id));
        setSelectedSessions(prev => {
            const next = new Set(prev);
            if (allSelected) {
                currentPageIds.forEach(id => next.delete(id));
            } else {
                currentPageIds.forEach(id => next.add(id));
            }
            return next;
        });
    };

    const clearSelection = () => setSelectedSessions(new Set());

    const handleBulkAction = async (permanent) => {
        const count = selectedSessions.size;
        const action = permanent ? 'PERMANENTLY DELETE' : 'HIDE';
        if (!window.confirm(`Are you sure you want to ${action} ${count} session(s)?`)) return;

        let successCount = 0;
        for (const sessionId of selectedSessions) {
            try {
                await adminAPI.deleteSession(sessionId, permanent);
                successCount++;
            } catch (err) {
                console.error(`Failed to ${action} session ${sessionId}:`, err);
            }
        }
        alert(`${successCount} of ${count} sessions ${permanent ? 'permanently deleted' : 'hidden'}.`);
        clearSelection();
        fetchSessions();
    };

    const fetchSessions = useCallback(async () => {
        try {
            const params = new URLSearchParams({
                agent_id: agentId,
                page: currentPage,
                limit: ITEMS_PER_PAGE,
                sortBy,
                sortOrder,
                search: searchTerm,
                show_hidden: showHiddenSessions
            });
            const res = await api.get(`/api/sessions?${params}`);

            // Handle response safely
            if (res.data && res.data.data) {
                setSessions(res.data.data);
                setTotalPages(res.data.pagination?.totalPages || 1);
                setTotalSessions(res.data.pagination?.total || 0);
                if (res.data.data.length > 0) {
                    setAgentName(res.data.data[0].agent_name || agentId);
                }
                // Use server-provided stats if available
                if (res.data.stats) {
                    setSuccessRate(res.data.stats.successRate);
                    setTotalDuration(res.data.stats.totalDuration || 0);
                    setZeroTurnsCount(res.data.stats.zeroTurns || 0);
                }
            } else {
                setSessions([]);
                setTotalPages(1);
                setTotalSessions(0);
                setSuccessRate(0);
                setTotalDuration(0);
                setZeroTurnsCount(0);
            }
        } catch (err) {
            console.error('Error fetching sessions:', err);
            setSessions([]);
            setTotalPages(1);
            setTotalSessions(0);
            setSuccessRate(0);
            setZeroTurnsCount(0);
        } finally {
            setLoading(false);
        }
    }, [agentId, currentPage, sortBy, sortOrder, searchTerm, showHiddenSessions]);

    // Fetch agent details for creation date
    const fetchAgentDetails = useCallback(async () => {
        try {
            const res = await api.get(`/api/agents/${agentId}`);
            if (res.data) {
                const agent = res.data;
                if (agent.created_at) {
                    setAgentCreatedAt(agent.created_at);
                }
                if (agent.last_synced) {
                    setAgentLastSynced(agent.last_synced);
                }
                if (agent.name) {
                    setAgentName(agent.name);
                }
            }
        } catch (err) {
            console.error('Error fetching agent details:', err);
        }
    }, [agentId]);


    useEffect(() => {
        if (sessions.length === 0) setLoading(true);
        fetchSessions();
        fetchAgentDetails();

        // Polling every 30 seconds
        const interval = setInterval(() => {
            fetchSessions();
            fetchAgentDetails();
        }, 5000);

        return () => clearInterval(interval);
    }, [fetchSessions, fetchAgentDetails]);

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            setCurrentPage(1);
        }, 300);
        return () => clearTimeout(timer);
    }, [searchTerm]);

    const handleSort = (field) => {
        if (sortBy === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(field);
            setSortOrder('desc');
        }
        setCurrentPage(1);
    };

    const handleSessionClick = (sessionId) => {
        navigate(isAdmin ? `/admin/session/${sessionId}` : `/user/session/${sessionId}`);
    };

    // Format seconds to readable time with units
    const formatSecondsToTime = (seconds) => {
        if (!seconds && seconds !== 0) return '-';
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hrs > 0) {
            return `${hrs}h ${mins}m ${secs}s`;
        } else if (mins > 0) {
            return `${mins}m ${secs}s`;
        } else {
            return `${secs}s`;
        }
    };

    // Get row background color based on review status
    const getRowBackgroundColor = (reviewStatus) => {
        switch (reviewStatus) {
            case 'needs_review': return '#FFF3CD'; // Yellow
            case 'completed': return '#D4EDDA';    // Green
            default: return 'white';                // Pending = white
        }
    };

    // Handle review status change
    const handleStatusChange = async (sessionId, newStatus) => {
        setUpdatingStatus(prev => ({ ...prev, [sessionId]: true }));
        try {
            await api.patch(`/api/user/conversations/${sessionId}/review-status`, { status: newStatus });
            // Refresh sessions to show updated status
            fetchSessions();
        } catch (err) {
            console.error('Failed to update review status:', err);
            const errorMessage = err.response?.data?.error || 'Failed to update status. Please try again.';
            alert(errorMessage);
            // Refresh to revert the UI if needed
            fetchSessions();
        } finally {
            setUpdatingStatus(prev => ({ ...prev, [sessionId]: false }));
        }
    };

    const formatTime = (dateStr) => {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const formatDateTime = (dateStr) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
    };

    // Download session data
    const downloadSession = async (session, format) => {
        try {
            const convRes = await api.get(`/api/conversation/${session.session_id}`);
            const conversation = convRes.data;

            const data = {
                session_id: session.session_id,
                agent_name: session.agent_name,
                started_at: session.started_at,
                ended_at: session.ended_at,
                duration_seconds: session.duration_seconds,
                bot_start_seconds: session.bot_start_seconds,
                status: session.status,
                turns: conversation?.turns || []
            };

            let content, filename, type;

            if (format === 'json') {
                content = JSON.stringify(data, null, 2);
                filename = `session_${session.session_id}.json`;
                type = 'application/json';
            } else if (format === 'csv') {
                const headers = 'Turn,User Message,Assistant Message,Timestamp\n';
                const rows = (conversation?.turns || []).map(t =>
                    `${t.turn_id},"${(t.user_message || '').replace(/"/g, '""')}","${(t.assistant_message || '').replace(/"/g, '""')}",${t.timestamp || ''}`
                ).join('\n');
                content = headers + rows;
                filename = `session_${session.session_id}.csv`;
                type = 'text/csv';
            } else {
                let text = `Session ID: ${session.session_id}\n`;
                text += `Agent: ${session.agent_name}\n`;
                text += `Started: ${session.started_at}\n`;
                text += `Ended: ${session.ended_at}\n`;
                text += `Duration: ${formatSecondsToTime(session.duration_seconds)}\n`;
                text += `Startup Time: ${formatSecondsToTime(session.bot_start_seconds)}\n\n`;
                text += `--- Conversation ---\n\n`;
                (conversation?.turns || []).forEach(t => {
                    text += `User: ${t.user_message || ''}\n`;
                    text += `Assistant: ${t.assistant_message || ''}\n\n`;
                });
                content = text;
                filename = `session_${session.session_id}.txt`;
                type = 'text/plain';
            }

            const blob = new Blob([content], { type });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('Download failed:', err);
            alert('Failed to download session data');
        }
        setDownloadDropdown(null);
    };

    // Generate summary on demand
    const handleGenerateSummary = async (sessionId) => {
        setGeneratingSummary(prev => ({ ...prev, [sessionId]: true }));
        try {
            const res = await api.post(`/api/conversation/${sessionId}/generate-summary`);
            if (res.data?.summary) {
                // Update sessions state with the new summary
                setSessions(prev => prev.map(s =>
                    s.session_id === sessionId ? { ...s, summary: res.data.summary } : s
                ));
            }
        } catch (err) {
            console.error('Failed to generate summary:', err);
            alert('Failed to generate summary. Please try again.');
        } finally {
            setGeneratingSummary(prev => ({ ...prev, [sessionId]: false }));
        }
    };

    const handleDeleteAgent = async (permanent = false) => {
        const msg = permanent
            ? 'Are you sure you want to PERMANENTLY DELETE this agent? This cannot be undone.'
            : 'Are you sure you want to HIDE this agent?';
        if (!window.confirm(msg)) return;

        try {
            await adminAPI.deleteAgent(agentId, permanent);

            alert(permanent ? 'Agent permanently deleted' : 'Agent hidden');
            navigate('/admin');
        } catch (err) {
            console.error('Failed to delete agent:', err);
            alert('Failed: ' + (err.response?.data?.error || err.message));
        }
    };

    const handleDeleteSession = async (sessionId, e, permanent = false) => {
        if (e) e.stopPropagation();
        const msg = permanent ? 'Permanently delete this session?' : 'Hide this session?';
        if (!window.confirm(msg)) return;

        try {
            await adminAPI.deleteSession(sessionId, permanent);
            // Remove locally
            setSessions(prev => prev.filter(s => s.session_id !== sessionId));
            setTotalSessions(prev => prev - 1);
        } catch (err) {
            console.error('Failed to delete session:', err);
            alert('Failed: ' + (err.response?.data?.error || err.message));
        }
    };

    const handleRestoreSession = async (sessionId, e) => {
        if (e) e.stopPropagation();
        try {
            await api.post(`/api/sessions/${sessionId}/restore`);
            fetchSessions(); // Refresh
        } catch (err) {
            alert('Restore failed');
        }
    };

    const fetchRecycleBin = async () => {
        try {
            const res = await api.get('/api/data-admin/excluded');
            setExcludedSessions(res.data.excluded.filter(e => e.item_type === 'session'));

            // Also fetch hidden sessions for this agent
            const params = new URLSearchParams({ agent_id: agentId, page: 1, limit: 100, show_hidden: true });
            const hiddenRes = await api.get(`/api/sessions?${params}`);
            if (hiddenRes.data?.data) {
                setHiddenSessionsList(hiddenRes.data.data.filter(s => s.is_hidden));
            }
        } catch (e) {
            console.error("Fetch Recycle Bin Error:", e);
        }
    };

    useEffect(() => {
        if (recycleBinOpen) {
            fetchRecycleBin();
            setSelectedBinItems(new Set());
        }
    }, [recycleBinOpen]);

    const getDaysRemaining = (excludedAt) => {
        const excluded = new Date(excludedAt);
        const expiry = new Date(excluded.getTime() + 30 * 24 * 60 * 60 * 1000);
        const now = new Date();
        const daysLeft = Math.ceil((expiry - now) / (24 * 60 * 60 * 1000));
        return Math.max(0, daysLeft);
    };

    const handleRestoreExcluded = async (id) => {
        try {
            await api.delete(`/api/data-admin/excluded/session/${id}`);
            alert('Session restored from blocklist. It will be re-fetched in the next sync cycle.');
            fetchRecycleBin();
        } catch (e) {
            console.error("Restore failed:", e);
            alert('Restore failed: ' + (e.response?.data?.error || e.message));
        }
    };

    const handlePermanentDeleteFromBin = async (id, itemType) => {
        if (!window.confirm('Are you sure you want to PERMANENTLY remove this session? It will NOT be re-synced ever.')) return;
        try {
            await api.delete(`/api/data-admin/excluded-permanent/${itemType}/${id}`);
            fetchRecycleBin();
        } catch (e) {
            alert('Permanent delete failed: ' + (e.response?.data?.error || e.message));
        }
    };

    const toggleBinSelect = (key) => {
        setSelectedBinItems(prev => {
            const next = new Set(prev);
            if (next.has(key)) next.delete(key); else next.add(key);
            return next;
        });
    };

    const toggleBinSelectAll = (items) => {
        const keys = items.map(i => i._binKey);
        const allSelected = keys.every(k => selectedBinItems.has(k));
        setSelectedBinItems(prev => {
            const next = new Set(prev);
            if (allSelected) keys.forEach(k => next.delete(k)); else keys.forEach(k => next.add(k));
            return next;
        });
    };

    const handleBulkBinAction = async (action) => {
        const count = selectedBinItems.size;
        let label = action === 'restore' ? 'RESTORE' : action === 'resync' ? 'RE-SYNC' : 'PERMANENTLY DELETE';
        if (!window.confirm(`Are you sure you want to ${label} ${count} item(s)?`)) return;

        let successCount = 0;
        for (const key of selectedBinItems) {
            try {
                const [type, id] = key.split('::');
                if (action === 'restore') {
                    await api.post(`/api/sessions/${id}/restore`);
                } else if (action === 'resync') {
                    await api.delete(`/api/data-admin/excluded/session/${id}`);
                } else {
                    await api.delete(`/api/data-admin/excluded-permanent/session/${id}`);
                }
                successCount++;
            } catch (err) {
                console.error(`Bulk action failed for ${key}:`, err);
            }
        }
        alert(`${successCount} of ${count} items processed.`);
        setSelectedBinItems(new Set());
        fetchRecycleBin();
        fetchSessions();
    };

    if (loading && sessions.length === 0) return <div className="loading">Loading sessions...</div>;

    // Find earliest date in current view as a proxy for "Created At" if not available
    const earliestSession = sessions.length > 0 ? sessions[sessions.length - 1].started_at : new Date().toISOString();


    return (
        <>
            <Header />
            <div className="dashboard-layout">
                {/* Left Sidebar - Agent Info */}
                <aside className="dashboard-sidebar">
                    <div className="session-info-sidebar" style={{ flex: 1, overflowY: 'auto' }}>
                        <h3 style={{ marginBottom: '1rem', color: 'var(--primary)', fontSize: '1.2rem' }}>About Agent</h3>

                        <div className="info-row">
                            <span className="info-label">Agent Name</span>
                            <span className="info-value" style={{ fontWeight: 600 }}>{agentName || agentId}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">Agent ID</span>
                            <span className="info-value font-mono" style={{ fontSize: '0.8rem', wordBreak: 'break-all' }}>{agentId}</span>
                        </div>

                        <div className="info-row">
                            <span className="info-label">Created At</span>
                            <span className="info-value">{formatDate(agentCreatedAt)}</span>
                        </div>


                        <div className="info-row">
                            <span className="info-label">Total Sessions</span>
                            <span className="info-value" style={{ fontSize: '1.2rem', color: '#1a1a1a' }}>{totalSessions}</span>
                        </div>

                        <div className="info-row">
                            <span className="info-label">Total Duration</span>
                            {/* Note: Server-provided stats */}
                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
                                <span className="info-value">{Math.floor(totalDuration / 60)} min</span>
                                <span style={{ fontSize: '0.7rem', color: '#666', marginTop: '2px' }}>
                                    Jan 1, 2026 - {new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </span>
                            </div>
                        </div>

                        <div className="info-row">
                            <span className="info-label">Last Synced</span>
                            <span className="info-value">{formatDateTime(agentLastSynced)}</span>
                        </div>

                    </div>

                    <div className="sidebar-footer">
                        <button className="btn-logout" onClick={() => navigate('/')}>
                            <ArrowLeft size={18} style={{ marginRight: '8px' }} /> Back to Dashboard
                        </button>
                        {user?.id === 'master_root_0' && (
                            <div style={{ marginTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '5px' }}>
                                <div style={{ display: 'flex', gap: '5px' }}>
                                    <button
                                        className="btn-logout"
                                        style={{ flex: 1, borderColor: '#cbd5e1', color: '#64748b', background: '#fff', fontSize: '0.8rem', padding: '8px' }}
                                        onClick={() => handleDeleteAgent(false)}
                                    >
                                        <EyeOff size={16} style={{ marginRight: '4px' }} /> Hide
                                    </button>
                                    <button
                                        className="btn-logout"
                                        style={{ flex: 1, borderColor: '#ef4444', color: '#ef4444', background: '#fff', fontSize: '0.8rem', padding: '8px' }}
                                        onClick={() => handleDeleteAgent(true)}
                                    >
                                        <Trash2 size={16} style={{ marginRight: '4px' }} /> Destroy
                                    </button>
                                </div>
                                <button
                                    className="btn-logout"
                                    onClick={() => setRecycleBinOpen(true)}
                                    style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', border: '2px solid #e2e8f0', background: 'white', color: '#64748b' }}
                                >
                                    <RotateCcw size={16} /> Recycle Bin
                                </button>
                            </div>
                        )}
                    </div>
                </aside>

                {/* Main Content - Sessions List */}
                <main className="dashboard-main" style={{ padding: '0', background: '#f5f7fa', height: '100vh', overflowY: 'auto' }}>
                    <div className="dashboard-header-title" style={{ padding: '2rem 2rem 0 2rem', background: '#f5f7fa', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h1>Agent Sessions</h1>
                        {user?.id === 'master_root_0' && (
                            <button
                                onClick={() => setShowHiddenSessions(!showHiddenSessions)}
                                style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 12px', borderRadius: '6px', border: '1px solid #cbd5e1', background: showHiddenSessions ? '#e2e8f0' : 'white', cursor: 'pointer', fontSize: '0.9rem' }}
                            >
                                {showHiddenSessions ? <EyeOff size={16} /> : <Eye size={16} />}
                                {showHiddenSessions ? 'Hide Deleted' : 'Show Deleted'}
                            </button>
                        )}
                    </div>

                    <div className="page-container" style={{ padding: '0 2rem 2rem 2rem', maxWidth: '100%' }}>
                        {/* Search Bar */}
                        <div className="search-container-full" style={{ background: 'white', borderRadius: '8px', padding: '0.5rem 1rem', boxShadow: '0 2px 5px rgba(0,0,0,0.05)' }}>
                            <Search size={20} className="search-icon" style={{ color: '#888' }} />
                            <input
                                type="text"
                                className="search-input"
                                placeholder="Search sessions by ID..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                style={{ border: 'none', fontSize: '0.95rem', width: '100%', outline: 'none' }}
                            />
                        </div>

                        {/* Review Status Filters */}
                        <div style={{ marginTop: '1rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                            <button
                                onClick={() => setReviewFilter('all')}
                                style={{
                                    padding: '0.5rem 1rem',
                                    border: reviewFilter === 'all' ? '2px solid var(--primary)' : '1px solid #ddd',
                                    background: reviewFilter === 'all' ? 'var(--primary)' : 'white',
                                    color: reviewFilter === 'all' ? 'white' : '#333',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: reviewFilter === 'all' ? '600' : '400'
                                }}
                            >
                                All
                            </button>
                            <button
                                onClick={() => setReviewFilter('pending')}
                                style={{
                                    padding: '0.5rem 1rem',
                                    border: reviewFilter === 'pending' ? '2px solid var(--primary)' : '1px solid #ddd',
                                    background: reviewFilter === 'pending' ? 'var(--primary)' : 'white',
                                    color: reviewFilter === 'pending' ? 'white' : '#333',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: reviewFilter === 'pending' ? '600' : '400'
                                }}
                            >
                                Pending
                            </button>
                            <button
                                onClick={() => setReviewFilter('needs_review')}
                                style={{
                                    padding: '0.5rem 1rem',
                                    border: reviewFilter === 'needs_review' ? '2px solid var(--primary)' : '1px solid #ddd',
                                    background: reviewFilter === 'needs_review' ? 'var(--primary)' : 'white',
                                    color: reviewFilter === 'needs_review' ? 'white' : '#333',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: reviewFilter === 'needs_review' ? '600' : '400'
                                }}
                            >
                                Needs Review
                            </button>
                            <button
                                onClick={() => setReviewFilter('completed')}
                                style={{
                                    padding: '0.5rem 1rem',
                                    border: reviewFilter === 'completed' ? '2px solid var(--primary)' : '1px solid #ddd',
                                    background: reviewFilter === 'completed' ? 'var(--primary)' : 'white',
                                    color: reviewFilter === 'completed' ? 'white' : '#333',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                    fontSize: '0.9rem',
                                    fontWeight: reviewFilter === 'completed' ? '600' : '400'
                                }}
                            >
                                Completed
                            </button>
                        </div>

                        {/* Sorting Controls */}
                        <div className="section-header" style={{ marginTop: '1.5rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span className="section-count" style={{ color: '#666' }}>
                                Showing {sessions.length} of {totalSessions} sessions
                                {selectedSessions.size > 0 && (
                                    <span style={{ marginLeft: '10px', background: '#1e293b', color: 'white', padding: '2px 10px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: '600' }}>
                                        {selectedSessions.size} selected
                                    </span>
                                )}
                            </span>
                            <div className="section-controls">
                                <button className="btn-sort" onClick={() => handleSort('started_at')}>
                                    <ArrowUpDown size={16} /> Date {sortBy === 'started_at' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
                                </button>
                                <button className="btn-sort" onClick={() => handleSort('duration_seconds')}>
                                    <ArrowUpDown size={16} /> Duration {sortBy === 'duration_seconds' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
                                </button>
                            </div>
                        </div>

                        {/* Bulk Action Bar */}
                        {selectedSessions.size > 0 && user?.id === 'master_root_0' && (
                            <div style={{
                                position: 'sticky', top: '73px', zIndex: 50,
                                background: 'linear-gradient(135deg, #008F4B, #00753e)', color: 'white',
                                padding: '12px 20px', borderRadius: '10px', marginBottom: '12px',
                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                boxShadow: '0 4px 20px rgba(0,143,75,0.3)'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <CheckSquare size={18} />
                                    <span style={{ fontWeight: '600' }}>{selectedSessions.size} session{selectedSessions.size > 1 ? 's' : ''} selected</span>
                                    <button onClick={clearSelection} style={{
                                        background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white',
                                        padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem'
                                    }}>Clear</button>
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <button
                                        onClick={() => handleBulkAction(false)}
                                        style={{
                                            padding: '8px 16px', background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)',
                                            color: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem',
                                            fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px'
                                        }}
                                    >
                                        <EyeOff size={14} /> Hide All
                                    </button>
                                    <button
                                        onClick={() => handleBulkAction(true)}
                                        style={{
                                            padding: '8px 16px', background: '#ef4444', border: 'none',
                                            color: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem',
                                            fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px'
                                        }}
                                    >
                                        <Trash2 size={14} /> Delete All
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Desktop Table View */}
                        <div className="card desktop-only" style={{ background: 'white', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                            <div className="table-container">
                                <table className="session-table" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                                    <thead style={{ background: '#f8f9fa' }}>
                                        <tr>
                                            {user?.id === 'master_root_0' && (
                                                <th style={{ padding: '1rem 0.5rem', textAlign: 'center', fontWeight: '600', color: '#444', width: '45px' }}>
                                                    <button onClick={toggleSelectAll} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                                                        {sessions.length > 0 && sessions.every(s => selectedSessions.has(s.session_id))
                                                            ? <CheckSquare size={18} color="#008F4B" />
                                                            : sessions.some(s => selectedSessions.has(s.session_id))
                                                                ? <MinusSquare size={18} color="#f59e0b" />
                                                                : <Square size={18} color="#94a3b8" />}
                                                    </button>
                                                </th>
                                            )}
                                            <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#444', width: '22%' }}>Session ID</th>
                                            <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#444', width: '10%' }}>Date</th>
                                            <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#444', width: '14%' }}>Time</th>
                                            <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#444', width: '25%' }}>Summary</th>
                                            <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#444', width: '12%' }}>Review Status</th>
                                            <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#444', width: user?.id === 'master_root_0' ? '17%' : '12%' }}>Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {sessions
                                            .filter(session => {
                                                if (reviewFilter === 'all') return true;
                                                return session.review_status === reviewFilter;
                                            })
                                            .map(session => (
                                                <tr
                                                    key={session.session_id}
                                                    className="session-row"
                                                    style={{
                                                        borderBottom: '1px solid #f0f0f0',
                                                        background: getRowBackgroundColor(session.review_status)
                                                    }}
                                                >
                                                    {user?.id === 'master_root_0' && (
                                                        <td style={{ padding: '0.5rem', textAlign: 'center', width: '45px' }}>
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); toggleSelect(session.session_id); }}
                                                                style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}
                                                            >
                                                                {selectedSessions.has(session.session_id)
                                                                    ? <CheckSquare size={18} color="#008F4B" />
                                                                    : <Square size={18} color="#cbd5e1" />}
                                                            </button>
                                                        </td>
                                                    )}
                                                    <td className="font-mono clickable-cell session-id-cell" onClick={() => handleSessionClick(session.session_id)} style={{ padding: '1rem', color: 'var(--primary)', cursor: 'pointer', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center' }}>
                                                            {session.is_hidden && (
                                                                <EyeOff size={14} style={{ color: '#ef4444', marginRight: '6px', flexShrink: 0 }} />
                                                            )}
                                                            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.session_id}</span>
                                                        </div>
                                                    </td>
                                                    <td className="clickable-cell" onClick={() => handleSessionClick(session.session_id)} style={{ padding: '1rem' }}>
                                                        {formatDate(session.started_at)}
                                                    </td>
                                                    <td className="clickable-cell" onClick={() => handleSessionClick(session.session_id)} style={{ padding: '1rem' }}>
                                                        {formatTime(session.started_at)} - {formatTime(session.ended_at)} ({formatSecondsToTime(session.duration_seconds)})
                                                    </td>
                                                    <td style={{ padding: '1rem', maxWidth: '350px' }}>
                                                        {/* If session has a summary, show it */}
                                                        {session.summary ? (
                                                            <span style={{ fontSize: '0.85rem', color: '#555', lineHeight: '1.4' }}>
                                                                {session.summary}
                                                            </span>
                                                        ) : session.conversation_count === 0 || !session.conversation_count ? (
                                                            /* No turns - user didn't speak */
                                                            <span style={{ fontSize: '0.85rem', color: '#888', fontStyle: 'italic' }}>
                                                                User did not speak anything
                                                            </span>
                                                        ) : !session.ended_at ? (
                                                            /* Session still active */
                                                            <span style={{ fontSize: '0.85rem', color: '#f59e0b', fontStyle: 'italic' }}>
                                                                ⏳ Waiting for user to end session...
                                                            </span>
                                                        ) : (
                                                            /* Session ended but no summary - show generate button */
                                                            <button
                                                                className="btn-generate-summary"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleGenerateSummary(session.session_id);
                                                                }}
                                                                disabled={generatingSummary[session.session_id]}
                                                                style={{
                                                                    padding: '0.4rem 0.8rem',
                                                                    fontSize: '0.8rem',
                                                                    background: generatingSummary[session.session_id] ? '#ccc' : 'var(--primary)',
                                                                    color: 'white',
                                                                    border: 'none',
                                                                    borderRadius: '4px',
                                                                    cursor: generatingSummary[session.session_id] ? 'not-allowed' : 'pointer',
                                                                    display: 'flex',
                                                                    alignItems: 'center',
                                                                    gap: '0.3rem'
                                                                }}
                                                            >
                                                                <RefreshCw size={14} className={generatingSummary[session.session_id] ? 'spin' : ''} />
                                                                {generatingSummary[session.session_id] ? 'Generating...' : 'Generate Summary'}
                                                            </button>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: '1rem' }}>
                                                        <select
                                                            value={session.review_status || 'pending'}
                                                            onChange={(e) => {
                                                                e.stopPropagation();
                                                                handleStatusChange(session.session_id, e.target.value);
                                                            }}
                                                            disabled={updatingStatus[session.session_id]}
                                                            style={{
                                                                padding: '0.4rem 0.6rem',
                                                                fontSize: '0.85rem',
                                                                border: '1px solid #ddd',
                                                                borderRadius: '4px',
                                                                cursor: updatingStatus[session.session_id] ? 'not-allowed' : 'pointer',
                                                                background: updatingStatus[session.session_id] ? '#f0f0f0' : 'white'
                                                            }}
                                                        >
                                                            <option value="pending">Pending</option>
                                                            <option value="needs_review">Needs Review</option>
                                                            <option value="completed">Completed</option>
                                                        </select>
                                                    </td>
                                                    <td className="download-cell" style={{ padding: '0.75rem', whiteSpace: 'nowrap' }}>
                                                        <div className="dropdown-container" style={{ display: 'flex', gap: '4px', flexWrap: 'nowrap' }}>
                                                            <button
                                                                className="btn-download"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setDownloadDropdown(downloadDropdown === session.session_id ? null : session.session_id);
                                                                }}
                                                                title="Download"
                                                            >
                                                                <Download size={16} />
                                                                <ChevronDown size={14} />
                                                            </button>
                                                            {user?.id === 'master_root_0' && (
                                                                <>
                                                                    {session.is_hidden ? (
                                                                        <button
                                                                            className="btn-download"
                                                                            style={{ background: 'white', border: '1px solid #3b82f6', color: '#3b82f6' }}
                                                                            onClick={(e) => handleRestoreSession(session.session_id, e)}
                                                                            title="Restore Session"
                                                                        >
                                                                            <RotateCcw size={16} />
                                                                        </button>
                                                                    ) : (
                                                                        <button
                                                                            className="btn-download"
                                                                            style={{ background: 'white', border: '1px solid #cbd5e1', color: '#64748b' }}
                                                                            onClick={(e) => handleDeleteSession(session.session_id, e, false)}
                                                                            title="Hide Session"
                                                                        >
                                                                            <EyeOff size={16} />
                                                                        </button>
                                                                    )}
                                                                    <button
                                                                        className="btn-download"
                                                                        style={{ background: 'white', border: '1px solid #ef4444', color: '#ef4444' }}
                                                                        onClick={(e) => handleDeleteSession(session.session_id, e, true)}
                                                                        title="Permanently Delete"
                                                                    >
                                                                        <Trash2 size={16} />
                                                                    </button>
                                                                </>
                                                            )}
                                                            {downloadDropdown === session.session_id && (
                                                                <div className="dropdown-menu">
                                                                    <button onClick={() => downloadSession(session, 'json')}>JSON</button>
                                                                    <button onClick={() => downloadSession(session, 'csv')}>CSV</button>
                                                                    <button onClick={() => downloadSession(session, 'txt')}>TXT</button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                        {sessions.length === 0 && !loading && <tr><td colSpan={user?.id === 'master_root_0' ? 7 : 6} className="text-center" style={{ padding: '2rem' }}>No sessions found.</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                        </div>

                        {/* Mobile Card View */}
                        <div className="mobile-only sessions-cards">
                            {sessions.map(session => (
                                <div key={session.session_id} className="session-card" onClick={() => handleSessionClick(session.session_id)}>
                                    <div className="session-card-header">
                                        <span className="session-card-id">{session.session_id}</span>
                                        {/* ... Mobile card content ... */}
                                    </div>
                                    <div className="session-card-body">
                                        <p>Date: {formatDate(session.started_at)}</p>
                                        <p>Duration: {formatSecondsToTime(session.duration_seconds)}</p>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="pagination" style={{ marginTop: '2rem', display: 'flex', justifyContent: 'center', gap: '1rem' }}>
                                <button
                                    className="pagination-btn"
                                    onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                                    disabled={currentPage === 1}
                                >
                                    <ChevronLeft size={18} /> Prev
                                </button>
                                <div className="pagination-info" style={{ display: 'flex', alignItems: 'center' }}>
                                    Page {currentPage} of {totalPages}
                                </div>
                                <button
                                    className="pagination-btn"
                                    onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                                    disabled={currentPage === totalPages}
                                >
                                    Next <ChevronRight size={18} />
                                </button>
                            </div>
                        )}
                    </div>
                </main>
            </div>

            {/* Recycle Bin Modal */}
            {recycleBinOpen && (() => {
                const hiddenItems = hiddenSessionsList.map(s => ({ ...s, _binKey: `hidden::${s.session_id}`, _binType: 'hidden' }));
                const excludedItems = excludedSessions.map(e => ({ ...e, _binKey: `excluded::${e.item_id}`, _binType: 'excluded' }));
                const allBinItems = [...hiddenItems, ...excludedItems];
                return (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                        <div style={{ background: 'white', padding: '24px', borderRadius: '12px', width: '700px', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                                <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <RotateCcw size={20} /> Recycle Bin (Sessions)
                                </h2>
                                <button onClick={() => setRecycleBinOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
                            </div>

                            {/* Bulk action bar for recycle bin */}
                            {selectedBinItems.size > 0 && (
                                <div style={{
                                    background: '#008F4B', color: 'white', padding: '10px 16px', borderRadius: '8px', marginBottom: '16px',
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                }}>
                                    <span style={{ fontWeight: '600', fontSize: '0.9rem' }}>{selectedBinItems.size} item{selectedBinItems.size > 1 ? 's' : ''} selected</span>
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                        {[...selectedBinItems].some(k => k.startsWith('hidden::')) && (
                                            <button onClick={() => handleBulkBinAction('restore')} style={{ padding: '5px 12px', background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)', color: 'white', borderRadius: '5px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500' }}>
                                                <RotateCcw size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Restore
                                            </button>
                                        )}
                                        {[...selectedBinItems].some(k => k.startsWith('excluded::')) && (
                                            <>
                                                <button onClick={() => handleBulkBinAction('resync')} style={{ padding: '5px 12px', background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)', color: 'white', borderRadius: '5px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500' }}>
                                                    Re-Sync
                                                </button>
                                                <button onClick={() => handleBulkBinAction('delete')} style={{ padding: '5px 12px', background: '#ef4444', border: 'none', color: 'white', borderRadius: '5px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500' }}>
                                                    <Trash2 size={12} style={{ marginRight: '3px', verticalAlign: 'middle' }} /> Delete Forever
                                                </button>
                                            </>
                                        )}
                                        <button onClick={() => setSelectedBinItems(new Set())} style={{ padding: '5px 10px', background: 'rgba(255,255,255,0.15)', border: 'none', color: 'white', borderRadius: '5px', cursor: 'pointer', fontSize: '0.8rem' }}>Clear</button>
                                    </div>
                                </div>
                            )}

                            {/* Hidden Sessions Section */}
                            <div style={{ marginBottom: '24px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                                    <h3 style={{ fontSize: '1rem', fontWeight: '600', color: '#64748b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <EyeOff size={16} /> Hidden Sessions (Soft Deleted)
                                    </h3>
                                    {hiddenItems.length > 0 && (
                                        <button onClick={() => toggleBinSelectAll(hiddenItems)} style={{ background: 'none', border: '1px solid #e2e8f0', padding: '3px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', color: '#64748b' }}>
                                            {hiddenItems.every(i => selectedBinItems.has(i._binKey)) ? 'Deselect All' : 'Select All'}
                                        </button>
                                    )}
                                </div>
                                <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '10px' }}>These sessions are hidden. All data is intact. Restore to make them visible again.</p>
                                {hiddenItems.length === 0 ? <p style={{ fontSize: '0.9rem', color: '#94a3b8', fontStyle: 'italic' }}>No hidden sessions.</p> : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {hiddenItems.map(s => (
                                            <div key={s._binKey} style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', background: '#f8fafc', borderRadius: '8px', border: selectedBinItems.has(s._binKey) ? '2px solid #008F4B' : '1px solid #e2e8f0', gap: '10px' }}>
                                                <button onClick={() => toggleBinSelect(s._binKey)} style={{ background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
                                                    {selectedBinItems.has(s._binKey) ? <CheckSquare size={18} color="#008F4B" /> : <Square size={18} color="#94a3b8" />}
                                                </button>
                                                <div style={{ flex: 1, overflow: 'hidden' }}>
                                                    <span style={{ fontWeight: '500', fontSize: '0.85rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.session_id}</span>
                                                </div>
                                                <button onClick={() => handleRestoreSession(s.session_id)} style={{ padding: '5px 12px', background: '#e6f4ed', border: '1px solid #008F4B', color: '#008F4B', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500', whiteSpace: 'nowrap' }}>
                                                    <RotateCcw size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Restore
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            {/* Permanently Blocked Section */}
                            <div>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                                    <h3 style={{ fontSize: '1rem', fontWeight: '600', color: '#ef4444', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <ShieldAlert size={16} /> Permanently Blocked Sessions
                                    </h3>
                                    {excludedItems.length > 0 && (
                                        <button onClick={() => toggleBinSelectAll(excludedItems)} style={{ background: 'none', border: '1px solid #e2e8f0', padding: '3px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', color: '#64748b' }}>
                                            {excludedItems.every(i => selectedBinItems.has(i._binKey)) ? 'Deselect All' : 'Select All'}
                                        </button>
                                    )}
                                </div>
                                <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '10px' }}>These sessions are deleted and blocked from re-syncing. They auto-expire after 30 days.</p>
                                {excludedItems.length === 0 ? <p style={{ fontSize: '0.9rem', color: '#94a3b8', fontStyle: 'italic' }}>No blocked sessions.</p> : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {excludedItems.map(e => {
                                            const daysLeft = getDaysRemaining(e.excluded_at);
                                            return (
                                                <div key={e._binKey} style={{ display: 'flex', alignItems: 'center', padding: '10px 12px', background: '#fef2f2', borderRadius: '8px', border: selectedBinItems.has(e._binKey) ? '2px solid #008F4B' : '1px solid #fecaca', gap: '10px' }}>
                                                    <button onClick={() => toggleBinSelect(e._binKey)} style={{ background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
                                                        {selectedBinItems.has(e._binKey) ? <CheckSquare size={18} color="#008F4B" /> : <Square size={18} color="#94a3b8" />}
                                                    </button>
                                                    <div style={{ flex: 1 }}>
                                                        <span style={{ fontWeight: '500', fontSize: '0.85rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.item_id}</span>
                                                        <small style={{ color: '#94a3b8' }}>by {e.excluded_by} • {new Date(e.excluded_at).toLocaleDateString()}</small>
                                                        <div style={{ fontSize: '0.7rem', color: daysLeft <= 7 ? '#ef4444' : '#f59e0b', marginTop: '3px', fontWeight: '500' }}>
                                                            ⏱ Auto-expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''}{daysLeft <= 7 && ' ⚠️'}
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '5px', flexShrink: 0 }}>
                                                        <button onClick={() => handleRestoreExcluded(e.item_id)} style={{ padding: '5px 10px', background: '#fff', border: '1px solid #008F4B', color: '#008F4B', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500' }}>
                                                            Re-Sync
                                                        </button>
                                                        <button onClick={() => handlePermanentDeleteFromBin(e.item_id, e.item_type)} style={{ padding: '5px 10px', background: '#ef4444', border: 'none', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500' }}>
                                                            <Trash2 size={12} style={{ marginRight: '3px', verticalAlign: 'middle' }} /> Delete
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}
        </>
    );
}
