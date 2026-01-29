import { useEffect, useState, useCallback } from 'react';
import api from '../api/client';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, Download, ChevronDown, ChevronLeft, ChevronRight, ArrowUpDown, RefreshCw } from 'lucide-react';

const ITEMS_PER_PAGE = 10;

export default function AgentDetails() {
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
    const navigate = useNavigate();

    const fetchSessions = useCallback(async () => {
        try {
            const params = new URLSearchParams({
                agent_id: agentId,
                page: currentPage,
                limit: ITEMS_PER_PAGE,
                sortBy,
                sortOrder,
                search: searchTerm
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
    }, [agentId, currentPage, sortBy, sortOrder, searchTerm]);

    // Fetch agent details for creation date
    const fetchAgentDetails = useCallback(async () => {
        try {
            const res = await api.get(`/api/agents?limit=1000`);
            if (res.data && res.data.data) {
                const agent = res.data.data.find(a => a.agent_id === agentId);
                if (agent) {
                    if (agent.created_at) {
                        setAgentCreatedAt(agent.created_at);
                    }
                    if (agent.last_synced) {
                        setAgentLastSynced(agent.last_synced);
                    }
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

    if (loading && sessions.length === 0) return <div className="loading">Loading sessions...</div>;

    // Find earliest date in current view as a proxy for "Created At" if not available
    // Ideally this comes from Agent metadata
    const earliestSession = sessions.length > 0 ? sessions[sessions.length - 1].started_at : new Date().toISOString();


    return (
        <div className="dashboard-layout">
            {/* Left Sidebar - Agent Info */}
            <aside className="dashboard-sidebar">
                <div className="sidebar-header">
                    <img src="/logo.png" alt="FarmVaidya" className="sidebar-logo" style={{ cursor: 'pointer' }} onClick={() => navigate('/')} />
                </div>

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
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
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
                </div>
            </aside>

            {/* Main Content - Sessions List */}
            <main className="dashboard-main" style={{ padding: '0', background: '#f5f7fa', height: '100vh', overflowY: 'auto' }}>
                <div className="dashboard-header" style={{ padding: '2rem 2rem 0 2rem', background: '#f5f7fa', marginBottom: '1rem' }}>
                    <h1>Agent Sessions</h1>
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

                    {/* Sorting Controls */}
                    <div className="section-header" style={{ marginTop: '1.5rem', marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span className="section-count" style={{ color: '#666' }}>Showing {sessions.length} of {totalSessions} sessions</span>
                        <div className="section-controls">
                            <button className="btn-sort" onClick={() => handleSort('started_at')}>
                                <ArrowUpDown size={16} /> Date {sortBy === 'started_at' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
                            </button>
                            <button className="btn-sort" onClick={() => handleSort('duration_seconds')}>
                                <ArrowUpDown size={16} /> Duration {sortBy === 'duration_seconds' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
                            </button>
                        </div>
                    </div>

                    {/* Desktop Table View */}
                    <div className="card desktop-only" style={{ background: 'white', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                        <div className="table-container">
                            <table className="session-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead style={{ background: '#f8f9fa' }}>
                                    <tr>
                                        <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#444' }}>Session ID</th>
                                        <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#444' }}>Date</th>
                                        <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#444' }}>Time</th>
                                        <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#444', minWidth: '300px' }}>Summary</th>
                                        <th style={{ padding: '1rem', textAlign: 'left', fontWeight: '600', color: '#444' }}>Download</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sessions.map(session => (
                                        <tr key={session.session_id} className="session-row" style={{ borderBottom: '1px solid #f0f0f0' }}>
                                            <td className="font-mono clickable-cell session-id-cell" onClick={() => navigate(`/session/${session.session_id}`)} style={{ padding: '1rem', color: 'var(--primary)', cursor: 'pointer' }}>
                                                {session.session_id}
                                            </td>
                                            <td className="clickable-cell" onClick={() => navigate(`/session/${session.session_id}`)} style={{ padding: '1rem' }}>
                                                {formatDate(session.started_at)}
                                            </td>
                                            <td className="clickable-cell" onClick={() => navigate(`/session/${session.session_id}`)} style={{ padding: '1rem' }}>
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
                                            <td className="download-cell" style={{ padding: '1rem' }}>
                                                <div className="dropdown-container">
                                                    <button
                                                        className="btn-download"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setDownloadDropdown(downloadDropdown === session.session_id ? null : session.session_id);
                                                        }}
                                                    >
                                                        <Download size={16} />
                                                        <ChevronDown size={14} />
                                                    </button>
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
                                    {sessions.length === 0 && !loading && <tr><td colSpan="5" className="text-center" style={{ padding: '2rem' }}>No sessions found.</td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>

                    {/* Mobile Card View */}
                    <div className="mobile-only sessions-cards">
                        {sessions.map(session => (
                            <div key={session.session_id} className="session-card" onClick={() => navigate(`/session/${session.session_id}`)}>
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
    );
}
