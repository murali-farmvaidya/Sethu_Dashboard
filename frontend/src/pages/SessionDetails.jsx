import { useEffect, useState } from 'react';
import api from '../api/client';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, User, Bot, Download, Copy, Check, ChevronDown, ChevronLeft, ChevronRight, Tag } from 'lucide-react';
import Header from '../components/Header';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

export default function SessionDetails() {
    const { sessionId } = useParams();
    const [conversation, setConversation] = useState(null);
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);
    const [downloadOpen, setDownloadOpen] = useState(false);
    const navigate = useNavigate();
    const { isAdmin } = useAuth();

    // Navigation state
    const [siblingIds, setSiblingIds] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(-1);

    // Review status state
    const [reviewStatus, setReviewStatus] = useState('pending');
    const [updatingStatus, setUpdatingStatus] = useState(false);

    useEffect(() => {
        fetchData(true);
        fetchSiblings();

        const interval = setInterval(() => {
            fetchData(false);
        }, 5000);

        return () => clearInterval(interval);
    }, [sessionId]);

    const fetchSiblings = async () => {
        try {
            // Get this session's agent_id first
            const sessRes = await api.get(`/api/session/${sessionId}`);
            const agentId = sessRes.data?.agent_id;
            if (!agentId) return;

            // Fetch all session IDs for this agent (up to 200)
            const params = new URLSearchParams({
                agent_id: agentId, page: 1, limit: 200,
                sortBy: 'started_at', sortOrder: 'desc'
            });
            const res = await api.get(`/api/sessions?${params}`);
            if (res.data?.data) {
                const ids = res.data.data.map(s => s.session_id);
                setSiblingIds(ids);
                const idx = ids.indexOf(sessionId);
                setCurrentIndex(idx);
            }
        } catch (err) {
            console.error('Failed to fetch siblings:', err);
        }
    };

    const fetchData = async (showLoading = true) => {
        if (showLoading) setLoading(true);
        try {
            try {
                const sessRes = await api.get(`/api/session/${sessionId}`);
                setSession(prev => {
                    if (prev && prev.recordingUrl === sessRes.data.recordingUrl) {
                        return { ...sessRes.data, recordingUrl: prev.recordingUrl };
                    }
                    return sessRes.data;
                });
            } catch (sessErr) {
                console.error("Error fetching session:", sessErr);
            }

            try {
                const convRes = await api.get(`/api/conversation/${sessionId}`);
                setConversation(convRes.data);
                setReviewStatus(convRes.data?.review_status || 'pending');
            } catch (convErr) {
                console.log("No conversation logs for this session");
                setConversation(null);
            }
        } catch (err) {
            console.error("Unexpected error in fetchData:", err);
        } finally {
            setLoading(false);
        }
    };

    const handleStatusChange = async (newStatus) => {
        setUpdatingStatus(true);
        try {
            await api.patch(`/api/user/conversations/${sessionId}/review-status`, { status: newStatus });
            setReviewStatus(newStatus);
            toast.success(`Status updated to ${newStatus.replace('_', ' ')}`);
        } catch (err) {
            toast.error('Failed to update status');
            console.error(err);
        } finally {
            setUpdatingStatus(false);
        }
    };

    const navigateToSession = (direction) => {
        const newIndex = currentIndex + direction;
        if (newIndex >= 0 && newIndex < siblingIds.length) {
            const newId = siblingIds[newIndex];
            navigate(isAdmin ? `/admin/session/${newId}` : `/user/session/${newId}`, { replace: true });
        }
    };

    const formatDateTime = (dateStr) => {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        return date.toLocaleString('en-US', {
            month: 'short', day: 'numeric', year: 'numeric',
            hour: 'numeric', minute: '2-digit', hour12: true
        });
    };

    const formatTime = (dateStr) => {
        if (!dateStr) return '';
        const date = new Date(dateStr);
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    };

    const formatSecondsToTime = (seconds) => {
        if (!seconds && seconds !== 0) return '-';
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);
        if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
        if (mins > 0) return `${mins}m ${secs}s`;
        return `${secs}s`;
    };

    const copyConversation = () => {
        if (!conversation?.turns) return;
        let text = '';
        conversation.turns.forEach(t => {
            text += `User: ${t.user_message || ''}\n`;
            text += `Assistant: ${t.assistant_message || ''}\n\n`;
        });
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const downloadConversation = (format) => {
        if (!conversation?.turns) return;
        const data = {
            session_id: sessionId,
            agent_name: conversation.agent_name || session?.agent_name,
            turns: conversation.turns
        };

        let content, filename, type;
        if (format === 'json') {
            content = JSON.stringify(data, null, 2);
            filename = `conversation_${sessionId}.json`;
            type = 'application/json';
        } else if (format === 'csv') {
            const headers = 'Turn,Timestamp,User Message,Assistant Message\n';
            const rows = conversation.turns.map(t =>
                `${t.turn_id},"${t.timestamp || ''}","${(t.user_message || '').replace(/"/g, '""')}","${(t.assistant_message || '').replace(/"/g, '""')}"`
            ).join('\n');
            content = headers + rows;
            filename = `conversation_${sessionId}.csv`;
            type = 'text/csv';
        } else {
            let text = `Session ID: ${sessionId}\n`;
            text += `Agent: ${conversation.agent_name || session?.agent_name || ''}\n\n`;
            text += `--- Conversation ---\n\n`;
            conversation.turns.forEach(t => {
                if (t.timestamp) text += `[${formatTime(t.timestamp)}]\n`;
                text += `User: ${t.user_message || ''}\n`;
                text += `Assistant: ${t.assistant_message || ''}\n\n`;
            });
            content = text;
            filename = `conversation_${sessionId}.txt`;
            type = 'text/plain';
        }

        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
        setDownloadOpen(false);
    };

    const getStatusStyle = (status) => {
        if (status === 'completed') return { bg: '#dcfce7', color: '#166534', border: '#86efac' };
        if (status === 'needs_review') return { bg: '#fef9c3', color: '#854d0e', border: '#fde047' };
        return { bg: '#f1f5f9', color: '#64748b', border: '#e2e8f0' };
    };

    if (loading) return <div className="loading">Loading conversation...</div>;

    const statusStyle = getStatusStyle(reviewStatus);

    return (
        <>
            <Header />
            <div className="dashboard-layout">
                {/* Left Sidebar - Session Info */}
                <aside className="dashboard-sidebar">
                    <div className="session-info-sidebar" style={{ flex: 1, overflowY: 'auto' }}>
                        <h3 style={{ marginBottom: '1rem', color: 'var(--primary)', fontSize: '1.1rem' }}>Session Details</h3>

                        <div className="info-row">
                            <span className="info-label">Agent Name</span>
                            <span className="info-value">{conversation?.agent_name || session?.agent_name || '-'}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">Session ID</span>
                            <span className="info-value font-mono" style={{ fontSize: '0.8rem' }}>{sessionId}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">Started</span>
                            <span className="info-value">{formatDateTime(session?.started_at || conversation?.first_message_at)}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">Ended</span>
                            <span className="info-value">{formatDateTime(session?.ended_at || conversation?.last_message_at)}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">Duration</span>
                            <span className="info-value">{formatSecondsToTime(session?.duration_seconds)}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">Startup Time</span>
                            <span className="info-value">{formatSecondsToTime(session?.bot_start_seconds)}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">Total Turns</span>
                            <span className="info-value">{conversation?.total_turns || conversation?.turns?.length || 0}</span>
                        </div>
                        <div className="info-row">
                            <span className="info-label">Last Synced</span>
                            <span className="info-value">{formatDateTime(session?.last_synced)}</span>
                        </div>

                        {/* Review Status Section */}
                        <div style={{ marginTop: '1.5rem', paddingTop: '1rem', borderTop: '1px solid #eee' }}>
                            <h4 style={{ marginBottom: '0.8rem', color: 'var(--primary)', fontSize: '0.95rem', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <Tag size={16} /> Review Status
                            </h4>
                            <select
                                value={reviewStatus}
                                onChange={(e) => handleStatusChange(e.target.value)}
                                disabled={updatingStatus}
                                style={{
                                    width: '100%', padding: '8px 12px', borderRadius: '8px', fontSize: '0.9rem',
                                    border: `2px solid ${statusStyle.border}`,
                                    background: statusStyle.bg, color: statusStyle.color,
                                    fontWeight: '600', cursor: updatingStatus ? 'not-allowed' : 'pointer',
                                    outline: 'none', transition: 'all 0.2s'
                                }}
                            >
                                <option value="pending">📋 Pending</option>
                                <option value="needs_review">⚠️ Needs Review</option>
                                <option value="completed">✅ Completed</option>
                            </select>
                            {conversation?.reviewed_by && (
                                <div style={{ marginTop: '8px', fontSize: '0.8rem', color: '#94a3b8' }}>
                                    Reviewed by {conversation.reviewer_email || conversation.reviewed_by}
                                    {conversation.reviewed_at && ` on ${formatDate(conversation.reviewed_at)}`}
                                </div>
                            )}
                        </div>

                        {session?.recordingUrl && (
                            <div className="info-row" style={{ flexDirection: 'column', alignItems: 'flex-start', marginTop: '1.5rem', gap: '0.8rem' }}>
                                <span className="info-label" style={{ color: 'var(--primary)', fontWeight: 'bold' }}>Call Recording</span>
                                <audio controls preload="auto" style={{ width: '100%', height: '35px' }}
                                    src={`/api/proxy-recording?url=${encodeURIComponent(session.recordingUrl)}`}>
                                    Your browser does not support the audio element.
                                </audio>
                                <a href={`/api/proxy-recording?url=${encodeURIComponent(session.recordingUrl)}`}
                                    download={`recording-${sessionId}.mp3`} target="_blank" rel="noopener noreferrer"
                                    style={{ fontSize: '0.8rem', color: 'var(--primary)', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <Download size={14} /> Download Recording
                                </a>
                            </div>
                        )}
                    </div>

                    <div className="sidebar-footer">
                        <button className="btn-logout" onClick={() => navigate(-1)}>
                            <ArrowLeft size={18} style={{ marginRight: '8px' }} /> Back
                        </button>
                    </div>
                </aside>

                {/* Main Content - Conversations */}
                <main className="dashboard-main" style={{
                    display: 'flex', flexDirection: 'column', height: '100vh',
                    overflowY: 'hidden', padding: 0, background: 'white'
                }}>
                    <div style={{
                        padding: '2rem 2rem 0 2rem', background: 'white',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                            <button
                                onClick={() => navigate(-1)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#64748b', padding: '5px', borderRadius: '50%', transition: 'background 0.2s' }}
                                onMouseOver={(e) => e.currentTarget.style.background = '#e2e8f0'}
                                onMouseOut={(e) => e.currentTarget.style.background = 'none'}
                            >
                                <ArrowLeft size={24} />
                            </button>
                            <h1 style={{ color: 'var(--primary)', fontSize: '1.5rem' }}>Conversation Logs</h1>
                        </div>

                        {/* Navigation Buttons */}
                        {siblingIds.length > 1 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <button
                                    onClick={() => navigateToSession(-1)}
                                    disabled={currentIndex <= 0}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '4px',
                                        padding: '6px 14px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: '500',
                                        border: '1px solid #e5e7eb', cursor: currentIndex <= 0 ? 'not-allowed' : 'pointer',
                                        background: currentIndex <= 0 ? '#f8fafc' : 'white',
                                        color: currentIndex <= 0 ? '#cbd5e1' : '#374151',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    <ChevronLeft size={16} /> Newer
                                </button>
                                <span style={{ fontSize: '0.8rem', color: '#94a3b8', minWidth: '60px', textAlign: 'center' }}>
                                    {currentIndex + 1} / {siblingIds.length}
                                </span>
                                <button
                                    onClick={() => navigateToSession(1)}
                                    disabled={currentIndex >= siblingIds.length - 1}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '4px',
                                        padding: '6px 14px', borderRadius: '6px', fontSize: '0.85rem', fontWeight: '500',
                                        border: '1px solid #e5e7eb', cursor: currentIndex >= siblingIds.length - 1 ? 'not-allowed' : 'pointer',
                                        background: currentIndex >= siblingIds.length - 1 ? '#f8fafc' : 'white',
                                        color: currentIndex >= siblingIds.length - 1 ? '#cbd5e1' : '#374151',
                                        transition: 'all 0.2s'
                                    }}
                                >
                                    Older <ChevronRight size={16} />
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="conversation-panel" style={{
                        flex: 1, display: 'flex', flexDirection: 'column', overflowY: 'auto',
                        border: 'none', boxShadow: 'none', borderRadius: 0, padding: '0 2rem 2rem 2rem'
                    }}>
                        <div className="conversation-header">
                            <div className="conversation-actions" style={{ marginLeft: 'auto' }}>
                                <button className="btn-action" onClick={copyConversation} title="Copy conversation">
                                    {copied ? <Check size={18} /> : <Copy size={18} />}
                                    {copied ? 'Copied!' : 'Copy'}
                                </button>
                                <div className="dropdown-container">
                                    <button className="btn-action" onClick={() => setDownloadOpen(!downloadOpen)}>
                                        <Download size={18} /> Download <ChevronDown size={14} />
                                    </button>
                                    {downloadOpen && (
                                        <div className="dropdown-menu">
                                            <button onClick={() => downloadConversation('json')}>JSON</button>
                                            <button onClick={() => downloadConversation('csv')}>CSV</button>
                                            <button onClick={() => downloadConversation('txt')}>TXT</button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                        {!conversation || !conversation.turns || conversation.turns.length === 0 ? (
                            <div className="no-conversation">
                                <p>No conversation logs found for this session.</p>
                            </div>
                        ) : (
                            <div className="chat-container">
                                {conversation.turns.map((turn, index) => (
                                    <div key={turn.turn_id || index} className="turn-block">
                                        {turn.user_message && (
                                            <div className="message user-message">
                                                <div className="avatar user-avatar"><User size={20} /></div>
                                                <div className="content">
                                                    <div className="message-header">
                                                        <span className="role-label">User</span>
                                                    </div>
                                                    <div className="bubble user-bubble">{turn.user_message}</div>
                                                </div>
                                            </div>
                                        )}
                                        {turn.assistant_message && (
                                            <div className="message bot-message">
                                                <div className="avatar bot-avatar"><Bot size={20} /></div>
                                                <div className="content">
                                                    <div className="message-header">
                                                        <span className="role-label">Assistant</span>
                                                    </div>
                                                    <div className="bubble bot-bubble">{turn.assistant_message}</div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Bottom Nav Bar */}
                    {siblingIds.length > 1 && (
                        <div style={{
                            padding: '12px 2rem', borderTop: '1px solid #e5e7eb', background: '#f8fafc',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                        }}>
                            <button
                                onClick={() => navigateToSession(-1)}
                                disabled={currentIndex <= 0}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                    padding: '8px 16px', borderRadius: '8px', fontWeight: '600', fontSize: '0.9rem',
                                    border: 'none', cursor: currentIndex <= 0 ? 'not-allowed' : 'pointer',
                                    background: currentIndex <= 0 ? '#e2e8f0' : '#008F4B',
                                    color: currentIndex <= 0 ? '#94a3b8' : 'white',
                                    transition: 'all 0.2s'
                                }}
                            >
                                <ChevronLeft size={18} /> Previous Session
                            </button>
                            <span style={{ fontSize: '0.85rem', color: '#64748b' }}>
                                Session {currentIndex + 1} of {siblingIds.length}
                            </span>
                            <button
                                onClick={() => navigateToSession(1)}
                                disabled={currentIndex >= siblingIds.length - 1}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                    padding: '8px 16px', borderRadius: '8px', fontWeight: '600', fontSize: '0.9rem',
                                    border: 'none', cursor: currentIndex >= siblingIds.length - 1 ? 'not-allowed' : 'pointer',
                                    background: currentIndex >= siblingIds.length - 1 ? '#e2e8f0' : '#008F4B',
                                    color: currentIndex >= siblingIds.length - 1 ? '#94a3b8' : 'white',
                                    transition: 'all 0.2s'
                                }}
                            >
                                Next Session <ChevronRight size={18} />
                            </button>
                        </div>
                    )}
                </main>
            </div>
        </>
    );
}
