import { useEffect, useState } from 'react';
import api from '../api/client';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, User, Bot, Download, Copy, Check, ChevronDown } from 'lucide-react';
import Header from '../components/Header';

export default function SessionDetails() {
    const { sessionId } = useParams();
    const [conversation, setConversation] = useState(null);
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);
    const [downloadOpen, setDownloadOpen] = useState(false);
    const navigate = useNavigate();

    useEffect(() => {
        fetchData(true); // First load with spinner

        const interval = setInterval(() => {
            fetchData(false); // Background update
        }, 5000);

        return () => clearInterval(interval);
    }, [sessionId]);

    const fetchData = async (showLoading = true) => {
        if (showLoading) setLoading(true);
        try {
            // Fetch session details (should always exist)
            try {
                const sessRes = await api.get(`/api/session/${sessionId}`);
                setSession(prev => {
                    // Prevent audio reset: if we already have a recordingUrl, 
                    // and the new response has the same one, don't trigger a state update that resets the <audio> tag
                    if (prev && prev.recordingUrl === sessRes.data.recordingUrl) {
                        return { ...sessRes.data, recordingUrl: prev.recordingUrl };
                    }
                    return sessRes.data;
                });
            } catch (sessErr) {
                console.error("Error fetching session:", sessErr);
            }

            // Fetch conversation details (might return 404 if no turns)
            try {
                const convRes = await api.get(`/api/conversation/${sessionId}`);
                setConversation(convRes.data);
            } catch (convErr) {
                console.log("No conversation logs for this session (expected if turns = 0)");
                setConversation(null);
            }
        } catch (err) {
            console.error("Unexpected error in fetchData:", err);
        } finally {
            setLoading(false);
        }
    };

    const formatDateTime = (dateStr) => {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        return date.toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
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

    // Copy conversation to clipboard
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

    // Download conversation
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

    if (loading) return <div className="loading">Loading conversation...</div>;

    return (
        <>
            <Header />
            <div className="dashboard-layout">
                {/* Left Sidebar - Session Info */}
                <aside className="dashboard-sidebar">
                    <div className="sidebar-header">
                        <img src="/logo.png" alt="FarmVaidya" className="sidebar-logo" style={{ cursor: 'pointer' }} onClick={() => navigate('/')} />
                    </div>

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

                        {session?.recordingUrl && (
                            <div className="info-row" style={{ flexDirection: 'column', alignItems: 'flex-start', marginTop: '1.5rem', gap: '0.8rem' }}>
                                <span className="info-label" style={{ color: 'var(--primary)', fontWeight: 'bold' }}>Call Recording</span>
                                <audio
                                    controls
                                    preload="auto"
                                    style={{ width: '100%', height: '35px' }}
                                    src={`/api/proxy-recording?url=${encodeURIComponent(session.recordingUrl)}`}
                                >
                                    Your browser does not support the audio element.
                                </audio>
                                <a
                                    href={`/api/proxy-recording?url=${encodeURIComponent(session.recordingUrl)}`}
                                    download={`recording-${sessionId}.mp3`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="btn-download-recording"
                                    style={{
                                        fontSize: '0.8rem',
                                        color: 'var(--primary)',
                                        textDecoration: 'none',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '4px'
                                    }}
                                >
                                    <Download size={14} /> Download Recording
                                </a>
                            </div>
                        )}
                    </div>

                    <div className="sidebar-footer">
                        <button className="btn-logout" onClick={() => navigate(-1)}>
                            <ArrowLeft size={18} style={{ marginRight: '8px' }} /> Back to Dashboard
                        </button>
                    </div>
                </aside>

                {/* Main Content - Conversations */}
                <main className="dashboard-main" style={{
                    display: 'flex',
                    flexDirection: 'column',
                    height: '100vh',
                    overflowY: 'hidden',
                    padding: 0,
                    background: 'white'
                }}>
                    <div className="dashboard-header" style={{
                        padding: '2rem 2rem 0 2rem',
                        marginBottom: '1rem',
                        background: 'white'
                    }}>
                        <h1>Conversation Logs</h1>
                    </div>

                    <div className="conversation-panel" style={{
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        overflowY: 'auto',
                        border: 'none',
                        boxShadow: 'none',
                        borderRadius: 0,
                        padding: '0 2rem 2rem 2rem'
                    }}>
                        <div className="conversation-header">
                            <div className="conversation-actions" style={{ marginLeft: 'auto' }}>
                                <button className="btn-action" onClick={copyConversation} title="Copy conversation">
                                    {copied ? <Check size={18} /> : <Copy size={18} />}
                                    {copied ? 'Copied!' : 'Copy'}
                                </button>
                                <div className="dropdown-container">
                                    <button
                                        className="btn-action"
                                        onClick={() => setDownloadOpen(!downloadOpen)}
                                    >
                                        <Download size={18} />
                                        Download
                                        <ChevronDown size={14} />
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
                                        {/* User Message */}
                                        {turn.user_message && (
                                            <div className="message user-message">
                                                <div className="avatar user-avatar"><User size={20} /></div>
                                                <div className="content">
                                                    <div className="message-header">
                                                        <span className="role-label">User</span>
                                                        {/* Timestamp removed */}
                                                    </div>
                                                    <div className="bubble user-bubble">{turn.user_message}</div>
                                                </div>
                                            </div>
                                        )}
                                        {/* Bot Message */}
                                        {turn.assistant_message && (
                                            <div className="message bot-message">
                                                <div className="avatar bot-avatar"><Bot size={20} /></div>
                                                <div className="content">
                                                    <div className="message-header">
                                                        <span className="role-label">Assistant</span>
                                                        {/* Timestamp removed */}
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
                </main>
            </div>
        </>
    );
}
