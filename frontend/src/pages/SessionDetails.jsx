import React, { useEffect, useState, useRef } from 'react';
import api from '../services/api';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, User, Bot, Download, Copy, Check, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Tag, Edit2, Save, X, AlertCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../context/AuthContext';

export default function SessionDetails() {
    const { sessionId } = useParams();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [conversation, setConversation] = useState(null);
    const [session, setSession] = useState(null);
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);
    const [downloadOpen, setDownloadOpen] = useState(false);
    const navigate = useNavigate();
    const { isAdmin, user } = useAuth();
    const isMaster = user?.id === 'master_root_0';

    // Navigation state
    const [siblingIds, setSiblingIds] = useState([]);
    const [currentIndex, setCurrentIndex] = useState(-1);

    // Review status state
    const [reviewStatus, setReviewStatus] = useState('pending');
    const [updatingStatus, setUpdatingStatus] = useState(false);

    // Master edit state
    const [editingTurnIndex, setEditingTurnIndex] = useState(null);
    const [editTurnData, setEditTurnData] = useState({ user_message: '', assistant_message: '' });
    const [savingTurn, setSavingTurn] = useState(false);
    const [editSummaryMode, setEditSummaryMode] = useState(false);
    const [editSummaryText, setEditSummaryText] = useState('');
    const [savingSummary, setSavingSummary] = useState(false);
    const [activeTab, setActiveTab] = useState('conversation');
    const [editSessionMode, setEditSessionMode] = useState(false);
    const [editSessionData, setEditSessionData] = useState({});
    const [savingSession, setSavingSession] = useState(false);

    // Close dropdowns on outside click
    const downloadRef = useRef(null);

    useEffect(() => {
        const handleOutside = (e) => {
            if (downloadRef.current && !downloadRef.current.contains(e.target)) {
                setDownloadOpen(false);
            }
        };
        document.addEventListener('mousedown', handleOutside);
        return () => document.removeEventListener('mousedown', handleOutside);
    }, []);

    useEffect(() => {
        fetchData(true);
        fetchSiblings();
        const interval = setInterval(() => { fetchData(false); }, 5000);
        return () => clearInterval(interval);
    }, [sessionId]);

    const fetchSiblings = async () => {
        try {
            const sessRes = await api.get(`session/${sessionId}`);
            const agentId = sessRes.data?.agent_id;
            if (!agentId) return;
            const params = new URLSearchParams({ agent_id: agentId, page: 1, limit: 200, sortBy: 'started_at', sortOrder: 'desc' });
            const res = await api.get(`sessions?${params}`);
            if (res.data?.data) {
                const ids = res.data.data.map(s => s.session_id);
                setSiblingIds(ids);
                setCurrentIndex(ids.indexOf(sessionId));
            }
        } catch (err) { console.error('Failed to fetch siblings:', err); }
    };

    const fetchData = async (showLoading = true) => {
        if (showLoading) setLoading(true);
        try {
            try {
                const sessRes = await api.get(`session/${sessionId}`);
                setSession(prev => {
                    if (prev && prev.recordingUrl === sessRes.data.recordingUrl) {
                        return { ...sessRes.data, recordingUrl: prev.recordingUrl };
                    }
                    return sessRes.data;
                });
            } catch (sessErr) { console.error('Error fetching session:', sessErr); }

            try {
                const convRes = await api.get(`conversation/${sessionId}`);
                setConversation(convRes.data);
                setReviewStatus(convRes.data?.review_status || 'pending');
            } catch {
                setConversation(null);
            }
        } catch (err) {
            console.error('Unexpected error in fetchData:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleStatusChange = async (newStatus) => {
        setUpdatingStatus(true);
        try {
            await api.patch(`user/conversations/${sessionId}/review-status`, { status: newStatus });
            setReviewStatus(newStatus);
            toast.success(`Status updated`);
        } catch { toast.error('Failed to update status'); }
        finally { setUpdatingStatus(false); }
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
        return new Date(dateStr).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
    };
    const formatTime = (dateStr) => {
        if (!dateStr) return '';
        return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    };
    const formatDate = (dateStr) => {
        if (!dateStr) return '-';
        return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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
        const data = { session_id: sessionId, agent_name: conversation.agent_name || session?.agent_name, turns: conversation.turns };
        let content, filename, type;
        if (format === 'json') { content = JSON.stringify(data, null, 2); filename = `conversation_${sessionId}.json`; type = 'application/json'; }
        else if (format === 'csv') {
            const headers = 'Turn,Timestamp,User Message,Assistant Message\n';
            const rows = conversation.turns.map(t => `${t.turn_id},"${t.timestamp || ''}","${(t.user_message || '').replace(/"/g, '""')}","${(t.assistant_message || '').replace(/"/g, '""')}"`).join('\n');
            content = headers + rows; filename = `conversation_${sessionId}.csv`; type = 'text/csv';
        } else {
            let text = `Session ID: ${sessionId}\nAgent: ${conversation.agent_name || session?.agent_name || ''}\n\n--- Conversation ---\n\n`;
            conversation.turns.forEach(t => {
                if (t.timestamp) text += `[${formatTime(t.timestamp)}]\n`;
                text += `User: ${t.user_message || ''}\nAssistant: ${t.assistant_message || ''}\n\n`;
            });
            content = text; filename = `conversation_${sessionId}.txt`; type = 'text/plain';
        }
        const blob = new Blob([content], { type });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename; a.click();
        URL.revokeObjectURL(url);
        setDownloadOpen(false);
    };

    const getStatusStyle = (status) => {
        if (status === 'completed') return { bg: '#dcfce7', color: '#166534', border: '#86efac' };
        if (status === 'needs_review') return { bg: '#fef9c3', color: '#854d0e', border: '#fde047' };
        return { bg: '#f1f5f9', color: '#64748b', border: '#e2e8f0' };
    };

    // Master: start editing a turn
    const startEditTurn = (index) => {
        const turn = conversation.turns[index];
        setEditTurnData({ user_message: turn.user_message || '', assistant_message: turn.assistant_message || '' });
        setEditingTurnIndex(index);
    };

    const saveTurn = async (index) => {
        setSavingTurn(true);
        try {
            await api.patch(`master/conversations/${sessionId}/turn/${index}`, editTurnData);
            toast.success('Turn updated');
            setEditingTurnIndex(null);
            fetchData(false);
        } catch (e) {
            toast.error('Failed to save turn');
        } finally {
            setSavingTurn(false);
        }
    };

    const saveSummary = async () => {
        setSavingSummary(true);
        try {
            await api.patch(`data-admin/sessions/${sessionId}/summary`, { summary: editSummaryText });
            toast.success('Summary updated');
            setEditSummaryMode(false);
            fetchData(false);
        } catch {
            toast.error('Failed to save summary');
        } finally {
            setSavingSummary(false);
        }
    };

    const saveSessionMeta = async () => {
        setSavingSession(true);
        try {
            await api.patch(`master/sessions/${sessionId}`, editSessionData);
            toast.success('Session updated');
            setEditSessionMode(false);
            fetchData(false);
        } catch {
            toast.error('Failed to save session');
        } finally {
            setSavingSession(false);
        }
    };

    if (loading) return <div className="loading">Loading conversation...</div>;

    const statusStyle = getStatusStyle(reviewStatus);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', height: 'calc(100vh - 80px)', padding: '0 1.5rem' }}>
            {/* Compact Header */}
            <div style={{
                background: 'white',
                padding: '0.6rem 1rem',
                borderRadius: '16px',
                border: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                boxShadow: '0 2px 10px rgba(0,0,0,0.02)',
                flexWrap: 'wrap',
                gap: '0.5rem'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <button
                        onClick={() => navigate(-1)}
                        style={{
                            background: '#f1f5f9',
                            border: 'none',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#64748b',
                            width: '36px',
                            height: '36px',
                            borderRadius: '10px',
                            transition: 'all 0.2s'
                        }}
                    >
                        <ArrowLeft size={18} />
                    </button>
                    <div>
                        <h2 style={{ fontSize: '1.1rem', fontWeight: '800', color: 'var(--text)', margin: 0 }}>Session {sessionId?.slice(-6)}</h2>
                        <span style={{ fontSize: '0.7rem', color: '#94a3b8', fontFamily: 'monospace' }}>Full ID: {sessionId}</span>
                    </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flex: 1, justifyContent: 'flex-end', minWidth: '300px' }}>
                    {/* Audio Player */}
                    {session?.recordingUrl && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#f0fdf4', padding: '3px 10px', borderRadius: '10px', border: '1px solid #bbf7d0', flex: 1, maxWidth: '450px' }}>
                            <audio controls preload="auto" style={{ height: '26px', flex: 1 }} src={`/api/proxy-recording?url=${encodeURIComponent(session.recordingUrl)}`}>
                                Your browser does not support the audio element.
                            </audio>
                        </div>
                    )}

                    {/* Sibling Nav */}
                    {siblingIds.length > 1 && (
                        <div style={{ display: 'flex', alignItems: 'center', background: '#f8fafc', borderRadius: '10px', padding: '3px', border: '1px solid #e2e8f0' }}>
                            <button onClick={() => navigateToSession(-1)} disabled={currentIndex <= 0} style={{ padding: '4px', borderRadius: '6px', border: 'none', background: currentIndex <= 0 ? 'transparent' : 'white', cursor: currentIndex <= 0 ? 'not-allowed' : 'pointer', color: currentIndex <= 0 ? '#cbd5e1' : '#64748b' }}>
                                <ChevronLeft size={16} />
                            </button>
                            <span style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: '700', padding: '0 8px' }}>{currentIndex + 1} / {siblingIds.length}</span>
                            <button onClick={() => navigateToSession(1)} disabled={currentIndex >= siblingIds.length - 1} style={{ padding: '4px', borderRadius: '6px', border: 'none', background: currentIndex >= siblingIds.length - 1 ? 'transparent' : 'white', cursor: currentIndex >= siblingIds.length - 1 ? 'not-allowed' : 'pointer', color: currentIndex >= siblingIds.length - 1 ? '#cbd5e1' : '#64748b' }}>
                                <ChevronRight size={16} />
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Tab Navigation Row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 0.5rem' }}>
                <div style={{ display: 'flex', gap: '4px', background: 'white', padding: '3px', borderRadius: '12px', border: '1px solid var(--border)' }}>
                    <button
                        onClick={() => setActiveTab('conversation')}
                        style={{
                            padding: '5px 18px',
                            borderRadius: '8px',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: '700',
                            background: activeTab === 'conversation' ? 'var(--primary)' : 'transparent',
                            color: activeTab === 'conversation' ? 'white' : '#64748b',
                            transition: 'all 0.15s'
                        }}
                    >
                        Transcript
                    </button>
                    <button
                        onClick={() => setActiveTab('info')}
                        style={{
                            padding: '5px 18px',
                            borderRadius: '8px',
                            border: 'none',
                            cursor: 'pointer',
                            fontSize: '0.85rem',
                            fontWeight: '700',
                            background: activeTab === 'info' ? 'var(--primary)' : 'transparent',
                            color: activeTab === 'info' ? 'white' : '#64748b',
                            transition: 'all 0.15s'
                        }}
                    >
                        Details
                    </button>
                </div>

                {activeTab === 'conversation' && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button onClick={copyConversation} style={{ background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '5px 10px', fontSize: '0.8rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: '#64748b' }}>
                            {copied ? <Check size={14} color="#10b981" /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy'}
                        </button>
                    </div>
                )}
            </div>

            {/* Main Content Card Scroll Area */}
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
                {activeTab === 'info' ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(350px, 1fr))', gap: '1.5rem' }}>
                        {/* Summary & Review Section */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            {/* Summary Card */}
                            <div style={{ background: 'white', borderRadius: '16px', padding: '1.5rem', border: '1px solid var(--border)', boxShadow: '0 4px 15px rgba(0,0,0,0.03)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                                    <h3 style={{ color: 'var(--primary)', fontSize: '1rem', fontWeight: '800', margin: 0 }}>Call Summary</h3>
                                    {isMaster && !editSummaryMode && (
                                        <button onClick={() => { setEditSummaryText(conversation?.summary || ''); setEditSummaryMode(true); }}
                                            style={{ fontSize: '0.75rem', padding: '6px 12px', borderRadius: '8px', border: '1px solid #e2e8f0', background: 'white', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: '#64748b' }}>
                                            <Edit2 size={12} /> Edit
                                        </button>
                                    )}
                                </div>
                                {editSummaryMode ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        <textarea value={editSummaryText} onChange={e => setEditSummaryText(e.target.value)} rows={6} style={{ width: '100%', padding: '12px', border: '1px solid #e2e8f0', borderRadius: '12px', fontSize: '0.9rem', resize: 'vertical', lineHeight: 1.5 }} />
                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button onClick={saveSummary} disabled={savingSummary} style={{ flex: 1, padding: '10px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '0.9rem', fontWeight: '700' }}>{savingSummary ? 'Saving...' : 'Save Summary'}</button>
                                            <button onClick={() => setEditSummaryMode(false)} style={{ padding: '10px 16px', background: '#f1f5f9', border: 'none', borderRadius: '10px', cursor: 'pointer', fontSize: '0.9rem', color: '#64748b' }}>Cancel</button>
                                        </div>
                                    </div>
                                ) : (
                                    <p style={{ fontSize: '0.95rem', color: '#475569', lineHeight: 1.6, margin: 0 }}>
                                        {conversation?.summary || "No summary available for this session."}
                                    </p>
                                )}
                            </div>

                            {/* Status Card */}
                            <div style={{ background: 'white', borderRadius: '16px', padding: '1.5rem', border: '1px solid var(--border)', boxShadow: '0 4px 15px rgba(0,0,0,0.03)' }}>
                                <h3 style={{ color: 'var(--primary)', fontSize: '1rem', fontWeight: '800', margin: '0 0 1rem 0' }}>Review Status</h3>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '1rem' }}>
                                    {[
                                        { id: 'pending', label: 'Pending', icon: '📋' },
                                        { id: 'needs_review', label: 'Needs Review', icon: '⚠️' },
                                        { id: 'completed', label: 'Completed', icon: '✅' }
                                    ].map(opt => {
                                        const isSelected = reviewStatus === opt.id;
                                        return (
                                            <button
                                                key={opt.id}
                                                onClick={() => handleStatusChange(opt.id)}
                                                disabled={updatingStatus}
                                                style={{
                                                    padding: '8px 16px',
                                                    borderRadius: '10px',
                                                    border: isSelected ? 'none' : '1px solid #e2e8f0',
                                                    background: isSelected ? (opt.id === 'completed' ? '#10b981' : (opt.id === 'needs_review' ? '#f59e0b' : '#64748b')) : 'white',
                                                    color: isSelected ? 'white' : '#64748b',
                                                    fontWeight: '700',
                                                    fontSize: '0.85rem',
                                                    cursor: updatingStatus ? 'not-allowed' : 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    transition: 'all 0.2s',
                                                    boxShadow: isSelected ? '0 4px 12px rgba(0,0,0,0.1)' : 'none'
                                                }}
                                            >
                                                <span>{opt.icon}</span> {opt.label}
                                            </button>
                                        );
                                    })}
                                </div>
                                {conversation?.reviewed_by && (
                                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', background: '#f8fafc', padding: '10px', borderRadius: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <Check size={14} /> Review by {conversation.reviewer_email || conversation.reviewed_by} on {formatDate(conversation.reviewed_at)}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Session Metadata Sections */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                            {/* Detailed Info Card */}
                            <div style={{ background: 'white', borderRadius: '16px', padding: '1.5rem', border: '1px solid var(--border)', boxShadow: '0 4px 15px rgba(0,0,0,0.03)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.5rem' }}>
                                    <h3 style={{ color: 'var(--primary)', fontSize: '1rem', fontWeight: '800', margin: 0 }}>Information Details</h3>
                                    {isMaster && (
                                        <button
                                            onClick={() => {
                                                if (!editSessionMode) {
                                                    setEditSessionData({
                                                        agent_name: session?.agent_name || '',
                                                        started_at: session?.started_at ? new Date(session.started_at).toISOString().slice(0, 16) : '',
                                                        ended_at: session?.ended_at ? new Date(session.ended_at).toISOString().slice(0, 16) : '',
                                                        duration_seconds: session?.duration_seconds || 0,
                                                        status: session?.status || ''
                                                    });
                                                }
                                                setEditSessionMode(!editSessionMode);
                                            }}
                                            style={{ color: editSessionMode ? '#ef4444' : '#64748b', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '600', textDecoration: 'underline' }}
                                        >
                                            {editSessionMode ? 'Cancel Edit' : 'Edit Metadata'}
                                        </button>
                                    )}
                                </div>

                                {editSessionMode ? (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                        {[
                                            { label: 'Agent Name', key: 'agent_name', type: 'text' },
                                            { label: 'Started', key: 'started_at', type: 'datetime-local' },
                                            { label: 'Ended', key: 'ended_at', type: 'datetime-local' },
                                            { label: 'Duration (s)', key: 'duration_seconds', type: 'number' },
                                            { label: 'Status', key: 'status', type: 'text' },
                                        ].map(f => (
                                            <div key={f.key}>
                                                <label style={{ fontSize: '0.75rem', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px', display: 'block' }}>{f.label}</label>
                                                <input
                                                    type={f.type}
                                                    value={editSessionData[f.key] || ''}
                                                    onChange={e => setEditSessionData(p => ({ ...p, [f.key]: e.target.value }))}
                                                    style={{ width: '100%', padding: '10px', border: '1px solid #e2e8f0', borderRadius: '10px', fontSize: '0.9rem' }}
                                                />
                                            </div>
                                        ))}
                                        <button onClick={saveSessionMeta} disabled={savingSession} style={{ padding: '10px', background: 'var(--primary)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', marginTop: '8px' }}>
                                            {savingSession ? 'Saving...' : 'Save Meta Changes'}
                                        </button>
                                    </div>
                                ) : (
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.25rem' }}>
                                        {[
                                            { label: 'Agent', value: conversation?.agent_name || session?.agent_name || '-' },
                                            { label: 'Total Turns', value: conversation?.total_turns || conversation?.turns?.length || 0 },
                                            { label: 'Started', value: formatDateTime(session?.started_at || conversation?.first_message_at) },
                                            { label: 'Duration', value: formatSecondsToTime(session?.duration_seconds) },
                                            { label: 'Ended', value: formatDateTime(session?.ended_at || conversation?.last_message_at) },
                                            { label: 'Startup Time', value: formatSecondsToTime(session?.bot_start_seconds) },
                                            { label: 'Last Synced', value: formatDateTime(session?.last_synced), full: true }
                                        ].map((item, idx) => (
                                            <div key={idx} style={{ gridColumn: item.full ? '1 / -1' : 'auto' }}>
                                                <div style={{ fontSize: '0.7rem', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>{item.label}</div>
                                                <div style={{ fontSize: '0.95rem', fontWeight: '600', color: '#1e293b' }}>{item.value}</div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Conversation Logs Card */
                    <div style={{ background: 'white', borderRadius: '16px', flex: 1, display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', boxShadow: '0 4px 15px rgba(0,0,0,0.02)', overflow: 'hidden' }}>
                        <div style={{ padding: '0.75rem 1.5rem', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#10b981' }}></div>
                                <h3 style={{ fontSize: '0.85rem', color: '#475569', fontWeight: '800', margin: 0 }}>Conversation Transcript</h3>
                            </div>
                            <div className="dropdown-container" ref={downloadRef}>
                                <button
                                    onClick={() => setDownloadOpen(!downloadOpen)}
                                    style={{ padding: '4px 12px', borderRadius: '6px', border: 'none', background: 'var(--primary)', color: 'white', fontSize: '0.75rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}
                                >
                                    <Download size={14} /> Export <ChevronDown size={12} />
                                </button>
                                {downloadOpen && (
                                    <div className="dropdown-menu" style={{ top: 'calc(100% + 4px)', borderRadius: '8px' }}>
                                        <button onClick={() => downloadConversation('json')}>JSON</button>
                                        <button onClick={() => downloadConversation('csv')}>CSV</button>
                                        <button onClick={() => downloadConversation('txt')}>Text</button>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div style={{ flex: 1, overflowY: 'auto', padding: '1.5rem' }} className="chat-container">
                            {!conversation || !conversation.turns || conversation.turns.length === 0 ? (
                                <div style={{ height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', gap: '1rem' }}>
                                    <AlertCircle size={48} opacity={0.3} />
                                    <p style={{ fontWeight: '500' }}>No turns identified in this session.</p>
                                </div>
                            ) : (
                                conversation.turns.map((turn, index) => (
                                    <div key={turn.turn_id || index} style={{ marginBottom: '2rem', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {isMaster && editingTurnIndex === index ? (
                                            <div style={{ background: '#fffbeb', border: '2px solid #fcd34d', borderRadius: '20px', padding: '24px', boxShadow: '0 10px 20px rgba(217,119,6,0.05)' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1.5rem' }}>
                                                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#fef3c7', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#d97706' }}>
                                                        <Edit2 size={16} />
                                                    </div>
                                                    <span style={{ fontWeight: '800', color: '#92400e' }}>Editing Sequence #{index + 1}</span>
                                                </div>
                                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '1.5rem' }}>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: '800', color: '#92400e', textTransform: 'uppercase', marginBottom: '8px', display: 'block' }}>User Message</label>
                                                        <textarea value={editTurnData.user_message} onChange={e => setEditTurnData(p => ({ ...p, user_message: e.target.value }))} rows={4} style={{ width: '100%', padding: '12px', border: '1px solid #fcd34d', borderRadius: '12px', fontSize: '0.95rem' }} />
                                                    </div>
                                                    <div>
                                                        <label style={{ fontSize: '0.75rem', fontWeight: '800', color: '#92400e', textTransform: 'uppercase', marginBottom: '8px', display: 'block' }}>Assistant Response</label>
                                                        <textarea value={editTurnData.assistant_message} onChange={e => setEditTurnData(p => ({ ...p, assistant_message: e.target.value }))} rows={4} style={{ width: '100%', padding: '12px', border: '1px solid #fcd34d', borderRadius: '12px', fontSize: '0.95rem' }} />
                                                    </div>
                                                </div>
                                                <div style={{ display: 'flex', gap: '12px' }}>
                                                    <button onClick={() => saveTurn(index)} disabled={savingTurn} style={{ flex: 1, padding: '12px', background: '#d97706', color: 'white', border: 'none', borderRadius: '12px', fontWeight: '700', cursor: 'pointer' }}>{savingTurn ? 'Saving...' : 'Confirm Changes'}</button>
                                                    <button onClick={() => setEditingTurnIndex(null)} style={{ padding: '12px 24px', background: 'white', border: '1px solid #fcd34d', borderRadius: '12px', color: '#92400e', cursor: 'pointer' }}>Discard</button>
                                                </div>
                                            </div>
                                        ) : (
                                            <>
                                                {turn.user_message && (
                                                    <div style={{ display: 'flex', justifyContent: 'flex-start', maxWidth: '85%' }}>
                                                        <div style={{
                                                            background: 'white',
                                                            color: '#1e293b',
                                                            padding: '1.25rem 1.75rem',
                                                            borderRadius: '0 24px 24px 24px',
                                                            border: '1px solid #f1f5f9',
                                                            boxShadow: '0 4px 6px rgba(0,0,0,0.02)',
                                                            position: 'relative'
                                                        }}>
                                                            <div style={{ fontSize: '0.7rem', fontWeight: '800', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <User size={12} /> User Message
                                                            </div>
                                                            <div style={{ fontSize: '1rem', lineHeight: '1.6' }}>{turn.user_message}</div>
                                                        </div>
                                                    </div>
                                                )}
                                                {turn.assistant_message && (
                                                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginLeft: 'auto', maxWidth: '85%', marginTop: '4px' }}>
                                                        <div style={{
                                                            background: 'linear-gradient(135deg, #008F4B 0%, #006b38 100%)',
                                                            color: 'white',
                                                            padding: '1.25rem 1.75rem',
                                                            borderRadius: '24px 0 24px 24px',
                                                            boxShadow: '0 8px 20px rgba(0,143,75,0.15)',
                                                            position: 'relative'
                                                        }}>
                                                            <div style={{ fontSize: '0.7rem', fontWeight: '800', color: 'rgba(255,255,255,0.6)', textTransform: 'uppercase', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                <Bot size={12} /> FarmVaidya AI
                                                            </div>
                                                            <div style={{ fontSize: '1rem', lineHeight: '1.6' }}>{turn.assistant_message}</div>
                                                            {isMaster && (
                                                                <button
                                                                    onClick={() => startEditTurn(index)}
                                                                    style={{ position: 'absolute', right: '1rem', top: '1rem', background: 'rgba(255,255,255,0.1)', border: 'none', color: 'white', padding: '4px', borderRadius: '6px', cursor: 'pointer' }}
                                                                >
                                                                    <Edit2 size={12} />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                ))
                            )}
                        </div>
                    </div>
                )}
            </div>
        </div >
    );

}
