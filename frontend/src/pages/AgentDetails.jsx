import { useEffect, useState, useCallback } from 'react';
import axios from 'axios';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, Download, ChevronDown, ChevronLeft, ChevronRight, ArrowUpDown } from 'lucide-react';

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
            const res = await axios.get(`/api/sessions?${params}`);

            // Handle response safely
            if (res.data && res.data.data) {
                setSessions(res.data.data);
                setTotalPages(res.data.pagination?.totalPages || 1);
                setTotalSessions(res.data.pagination?.total || 0);
                if (res.data.data.length > 0) {
                    setAgentName(res.data.data[0].agent_name || 'Agent');
                }
            } else {
                setSessions([]);
                setTotalPages(1);
                setTotalSessions(0);
            }
        } catch (err) {
            console.error('Error fetching sessions:', err);
            setSessions([]);
            setTotalPages(1);
            setTotalSessions(0);
        } finally {
            setLoading(false);
        }
    }, [agentId, currentPage, sortBy, sortOrder, searchTerm]);

    useEffect(() => {
        setLoading(true);
        fetchSessions();
    }, [fetchSessions]);

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

    // Format seconds to HH:MM:SS
    const formatSecondsToTime = (seconds) => {
        if (!seconds && seconds !== 0) return '-';
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;
        if (hrs > 0) {
            return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
        }
        return `${mins}:${secs.toString().padStart(2, '0')}`;
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

    // Download session data
    const downloadSession = async (session, format) => {
        try {
            const convRes = await axios.get(`/api/conversation/${session.session_id}`);
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

    if (loading && sessions.length === 0) return <div className="loading">Loading sessions...</div>;

    return (
        <div className="page-container">
            <header className="page-header">
                <button className="btn-back" onClick={() => navigate('/')}>
                    <ArrowLeft size={20} /> Back
                </button>
                <div className="header-center">
                    <img src="/logo.png" alt="FarmVaidya" className="header-logo" />
                    <h1>Agent Sessions - {agentName}</h1>
                </div>
                <div className="header-spacer"></div>
            </header>

            {/* Search Bar */}
            <div className="search-container-full">
                <Search size={20} className="search-icon" />
                <input
                    type="text"
                    className="search-input"
                    placeholder="Search sessions by ID..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                />
            </div>

            {/* Sorting & Info */}
            <div className="section-header">
                <span className="section-count">{totalSessions} sessions</span>
                <div className="section-controls">
                    <button className="btn-sort" onClick={() => handleSort('started_at')}>
                        <ArrowUpDown size={16} />
                        Date {sortBy === 'started_at' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
                    </button>
                    <button className="btn-sort" onClick={() => handleSort('duration_seconds')}>
                        <ArrowUpDown size={16} />
                        Duration {sortBy === 'duration_seconds' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
                    </button>
                    <button className="btn-sort" onClick={() => handleSort('conversation_count')}>
                        <ArrowUpDown size={16} />
                        Turns {sortBy === 'conversation_count' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
                    </button>
                </div>
            </div>

            {/* Desktop Table View */}
            <div className="card desktop-only">
                <div className="table-container">
                    <table className="session-table">
                        <thead>
                            <tr>
                                <th>Session ID</th>
                                <th>Date</th>
                                <th>Time</th>
                                <th>Duration</th>
                                <th>Startup</th>
                                <th>Turns</th>
                                <th>Download</th>
                            </tr>
                        </thead>
                        <tbody>
                            {sessions.map(session => (
                                <tr key={session.session_id} className="session-row">
                                    <td className="font-mono clickable-cell session-id-cell" onClick={() => navigate(`/session/${session.session_id}`)}>
                                        {session.session_id}
                                    </td>
                                    <td className="clickable-cell" onClick={() => navigate(`/session/${session.session_id}`)}>
                                        {formatDate(session.started_at)}
                                    </td>
                                    <td className="clickable-cell" onClick={() => navigate(`/session/${session.session_id}`)}>
                                        {formatTime(session.started_at)} - {formatTime(session.ended_at)}
                                    </td>
                                    <td className="clickable-cell" onClick={() => navigate(`/session/${session.session_id}`)}>
                                        {formatSecondsToTime(session.duration_seconds)}
                                    </td>
                                    <td className="clickable-cell" onClick={() => navigate(`/session/${session.session_id}`)}>
                                        {formatSecondsToTime(session.bot_start_seconds)}
                                    </td>
                                    <td className="clickable-cell" onClick={() => navigate(`/session/${session.session_id}`)}>
                                        {session.conversation_count}
                                    </td>
                                    <td className="download-cell">
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
                            {sessions.length === 0 && !loading && <tr><td colSpan="7" className="text-center">No sessions found.</td></tr>}
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
                            <button
                                className="btn-download-small"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    setDownloadDropdown(downloadDropdown === session.session_id ? null : session.session_id);
                                }}
                            >
                                <Download size={14} />
                            </button>
                            {downloadDropdown === session.session_id && (
                                <div className="dropdown-menu">
                                    <button onClick={(e) => { e.stopPropagation(); downloadSession(session, 'json'); }}>JSON</button>
                                    <button onClick={(e) => { e.stopPropagation(); downloadSession(session, 'csv'); }}>CSV</button>
                                    <button onClick={(e) => { e.stopPropagation(); downloadSession(session, 'txt'); }}>TXT</button>
                                </div>
                            )}
                        </div>
                        <div className="session-card-body">
                            <div className="session-card-row">
                                <span className="session-card-label">Date:</span>
                                <span>{formatDate(session.started_at)}</span>
                            </div>
                            <div className="session-card-row">
                                <span className="session-card-label">Time:</span>
                                <span>{formatTime(session.started_at)} - {formatTime(session.ended_at)}</span>
                            </div>
                            <div className="session-card-row">
                                <span className="session-card-label">Duration:</span>
                                <span>{formatSecondsToTime(session.duration_seconds)}</span>
                            </div>
                            <div className="session-card-row">
                                <span className="session-card-label">Startup:</span>
                                <span>{formatSecondsToTime(session.bot_start_seconds)}</span>
                            </div>
                            <div className="session-card-row">
                                <span className="session-card-label">Turns:</span>
                                <span>{session.conversation_count}</span>
                            </div>
                        </div>
                    </div>
                ))}
                {sessions.length === 0 && !loading && <p className="text-center text-muted">No sessions found.</p>}
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
                <div className="pagination">
                    <button
                        className="pagination-btn"
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                    >
                        <ChevronLeft size={18} /> Prev
                    </button>
                    <div className="pagination-info">
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
    );
}
