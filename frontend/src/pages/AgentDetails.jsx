import { useEffect, useState, useCallback } from 'react';
import toast from 'react-hot-toast';
import api, { adminAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Phone, Settings, Send, ArrowLeft, Search, Download, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, ArrowUpDown, RefreshCw, Trash2, RotateCcw, ShieldAlert, Eye, EyeOff, X, CheckSquare, Square, MinusSquare, Megaphone, Info, PhoneOff } from 'lucide-react';
import CampaignTab from '../components/CampaignTab';

const ITEMS_PER_PAGE = 10;

// Global caches - persist across all component mounts within a page session
const phoneMetadataCache = {};   // cleanPhone -> Numbers metadata
const callDetailsCache = {};     // callId -> FROM phone number
const callDetailsPending = {};   // callId -> Promise (deduplicates in-flight requests)
const numberMetaPending = {};    // cleanPhone -> Promise

const CallerDetails = ({ session }) => {
    const [displayPhone, setDisplayPhone] = useState('');
    const [metadata, setMetadata] = useState(null);
    const [loading, setLoading] = useState(false);

    // --- Determine initial phone from all possible session fields ---
    const cachedInfo = session.caller_info; // from DB (JSONB column)
    let cData = session.metadata?.custom_data || session.custom_data;
    if (typeof cData === 'string' && cData.startsWith('{')) {
        try { cData = JSON.parse(cData); } catch (e) { }
    }
    const initialPhone = session.customer_phone || session.phone
        || (typeof cData === 'object' ? (cData?.phone || cData?.customer_number || cData?.telephony?.from || cData?.number) : '')
        || cachedInfo?.phone || '';

    useEffect(() => {
        // If DB already has full caller info cached, use it immediately — no API calls
        if (cachedInfo?.CircleName || cachedInfo?.Circle || cachedInfo?.phone) {
            if (cachedInfo.phone) setDisplayPhone(cachedInfo.phone);
            setMetadata(cachedInfo);
            return;
        }

        let cancelled = false;

        const resolvePhone = async () => {
            // Step 1: Get the phone number (from session fields or call-details API)
            let phone = initialPhone;

            if (!phone) {
                const callId = session.metadata?.telephony?.call_id;
                if (!callId) return;

                // Serve from cache ONLY if we have a real phone number OR it explicitly failed before (cached as '')
                if (callId in callDetailsCache) {
                    phone = callDetailsCache[callId];
                } else {
                    if (!callDetailsPending[callId]) {
                        callDetailsPending[callId] = api.get(`telephony/call-details/${callId}`)
                            .then(res => {
                                const from = res.data?.Call?.From || '';
                                callDetailsCache[callId] = from; // Cache success OR failure to prevent spam
                                return from;
                            })
                            .catch(() => {
                                callDetailsCache[callId] = ''; // Cache failures as empty to stop retrying
                                return '';
                            })
                            .finally(() => { delete callDetailsPending[callId]; });
                    }
                    setLoading(true);
                    phone = await callDetailsPending[callId];
                    if (!cancelled) setLoading(false);
                }
            }

            if (cancelled || !phone) return;

            const cleanPhone = phone.replace(/\D/g, '').slice(-10);
            if (!cancelled) setDisplayPhone(cleanPhone || phone);
            if (!cleanPhone || cleanPhone.length < 10) return;

            // Step 2: Get number metadata (circle, operator, etc.)
            if (cleanPhone in phoneMetadataCache) {
                if (!cancelled) setMetadata(phoneMetadataCache[cleanPhone]);
                return;
            }

            // Deduplicate in-flight requests for the same phone
            if (!numberMetaPending[cleanPhone]) {
                numberMetaPending[cleanPhone] = api.get(`telephony/number-metadata/${cleanPhone}`)
                    .then(res => {
                        const data = res.data?.Numbers || null;
                        phoneMetadataCache[cleanPhone] = data; // cache both success and failure
                        return data;
                    })
                    .catch(() => {
                        phoneMetadataCache[cleanPhone] = null; // cache failures to prevent infinite retries
                        return null;
                    })
                    .finally(() => { delete numberMetaPending[cleanPhone]; });
            }

            setLoading(true);
            const numData = await numberMetaPending[cleanPhone];
            if (cancelled) return;
            setLoading(false);

            if (numData) {
                setMetadata(numData);
                // Save to DB — so next page load skips all API calls
                const info = { ...numData, phone: cleanPhone };
                api.patch(`sessions/${session.session_id}/caller-info`, {
                    caller_info: info,
                    customer_phone: cleanPhone
                }).catch(() => { });
            }
        };

        resolvePhone();
        return () => { cancelled = true; };
        // Re-run if DB polling brings in new caller_info or customer_phone data
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session.session_id, session.customer_phone, !!session.caller_info]);

    const displayMeta = metadata || (cachedInfo?.CircleName ? cachedInfo : null);
    const phone = displayPhone || initialPhone;

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', alignItems: 'center' }}>
            <div style={{ fontWeight: '700', color: '#1e293b', fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Phone size={12} color="var(--primary)" />
                <span style={{ wordBreak: 'break-all' }}>{phone || '-'}</span>
            </div>
            {displayMeta ? (
                <div style={{ color: '#64748b', fontSize: '0.73rem', fontWeight: '500', lineHeight: '1.3', textAlign: 'center' }}>
                    {displayMeta.CircleName
                        ? <>{displayMeta.CircleName} <span style={{ color: '#94a3b8' }}>({displayMeta.Circle})</span></>
                        : displayMeta.Circle || ''}
                </div>
            ) : loading ? (
                <div style={{ color: '#94a3b8', fontSize: '0.7rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <RefreshCw size={10} className="spin" /> Fetching...
                </div>
            ) : null}
        </div>
    );
};

const confirmToast = (message, onConfirm) => {
    toast((t) => (
        <div style={{ width: '100%', minWidth: '280px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <p style={{ margin: 0, fontSize: '14px', color: '#1f2937', lineHeight: '1.4', wordBreak: 'break-word' }}>
                {message}
            </p>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end', marginTop: '4px' }}>
                <button
                    onClick={() => toast.dismiss(t.id)}
                    style={{ padding: '6px 14px', border: '1px solid #d1d5db', borderRadius: '6px', background: 'white', cursor: 'pointer', fontSize: '13px', color: '#374151', fontWeight: '500' }}
                >
                    Cancel
                </button>
                <button
                    onClick={() => {
                        toast.dismiss(t.id);
                        onConfirm();
                    }}
                    style={{ padding: '6px 14px', border: 'none', borderRadius: '6px', background: '#ef4444', color: 'white', cursor: 'pointer', fontSize: '13px', fontWeight: '600', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}
                >
                    Confirm
                </button>
            </div>
        </div>
    ), {
        duration: 8000,
        position: 'top-center',
        style: {
            borderLeft: '4px solid #ef4444',
            maxWidth: '400px',
            padding: '16px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)'
        }
    });
};

// --- MISSED CALLS TAB COMPONENT ---
const MissedCallsTab = ({ agentId }) => {
    const [missedCalls, setMissedCalls] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [sortBy, setSortBy] = useState('timestamp');
    const [sortOrder, setSortOrder] = useState('desc');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage] = useState(10);

    useEffect(() => {
        const fetchMissedCalls = async () => {
            setLoading(true);
            try {
                const response = await adminAPI.getAgentMissedCalls(agentId);
                if (response.data && response.data.missedCalls) {
                    setMissedCalls(response.data.missedCalls);
                    // Mark calls as read after fetching them to reset dashboard counter
                    if (response.data.missedCalls.some(c => !c.is_read)) {
                        await adminAPI.markAgentMissedCallsRead(agentId);
                    }
                }
            } catch (err) {
                console.error('Failed to fetch missed calls:', err);
                // Notification already shown in parent or silent failure
            } finally {
                setLoading(false);
            }
        };
        if (agentId) fetchMissedCalls();
    }, [agentId]);

    const handleSort = (key) => {
        if (sortBy === key) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortBy(key);
            setSortOrder('desc');
        }
    };

    const sortedCalls = [...missedCalls]
        .filter(call => 
            (call.from_number?.includes(searchTerm)) || 
            (call.call_sid?.includes(searchTerm)) ||
            (call.status?.toLowerCase().includes(searchTerm.toLowerCase()))
        )
        .sort((a, b) => {
            const valA = a[sortBy];
            const valB = b[sortBy];
            if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
            if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
            return 0;
        });

    const totalPages = Math.ceil(sortedCalls.length / itemsPerPage);
    const paginatedCalls = sortedCalls.slice(
        (currentPage - 1) * itemsPerPage,
        currentPage * itemsPerPage
    );

    if (loading) {
        return (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '3rem' }}>
                <RefreshCw className="spin" size={32} color="var(--primary)" />
            </div>
        );
    }

    return (
        <div style={{ animation: 'fadeIn 0.3s ease' }}>
            {/* Filter Toolbar */}
            <div style={{ background: 'white', borderRadius: '12px', padding: '1.25rem 1.5rem', boxShadow: '0 2px 12px rgba(0,0,0,0.05)', marginBottom: '1.25rem', border: '1px solid #f1f5f9' }}>
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                    <div style={{ flex: '1 1 280px', display: 'flex', alignItems: 'center', gap: '8px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '0 0.875rem' }}>
                        <Search size={16} style={{ color: '#94a3b8', flexShrink: 0 }} />
                        <input
                            type="text"
                            placeholder="Search by Number, SID or Status..."
                            value={searchTerm}
                            onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                            style={{ border: 'none', background: 'transparent', padding: '0.625rem 0', fontSize: '0.875rem', width: '100%', outline: 'none', color: '#1e293b' }}
                        />
                        {searchTerm && (
                            <button onClick={() => setSearchTerm('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex', padding: 0 }}><X size={14} /></button>
                        )}
                    </div>
                </div>
            </div>

            <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                <div className="table-container">
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead style={{ background: '#f8f9fa' }}>
                            <tr>
                                <th onClick={() => handleSort('timestamp')} style={{ padding: '1rem', textAlign: 'left', cursor: 'pointer', fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase' }}>
                                    Time {sortBy === 'timestamp' && (sortOrder === 'asc' ? '↑' : '↓')}
                                </th>
                                <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase' }}>From Number</th>
                                <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase' }}>Status</th>
                                <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase' }}>Disconnected By</th>
                                <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase' }}>Reason</th>
                                <th style={{ padding: '1rem', textAlign: 'left', fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase' }}>Call SID</th>
                            </tr>
                        </thead>
                        <tbody>
                            {paginatedCalls.map(call => (
                                <tr key={call.id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                                    <td style={{ padding: '1rem', fontSize: '0.9rem' }}>
                                        {new Date(call.timestamp).toLocaleString()}
                                    </td>
                                    <td style={{ padding: '1rem', fontSize: '0.9rem', fontWeight: '600' }}>
                                        {call.from_number}
                                    </td>
                                    <td style={{ padding: '1rem' }}>
                                        <span style={{ 
                                            padding: '4px 10px', 
                                            borderRadius: '20px', 
                                            fontSize: '0.75rem', 
                                            fontWeight: '700',
                                            background: call.status === 'failed' ? '#fee2e2' : '#fef3c7',
                                            color: call.status === 'failed' ? '#991b1b' : '#92400e'
                                        }}>
                                            {call.status?.toUpperCase()}
                                        </span>
                                    </td>
                                    <td style={{ padding: '1rem', fontSize: '0.85rem', color: '#475569' }}>
                                        <span style={{ 
                                            padding: '2px 8px', 
                                            borderRadius: '4px', 
                                            fontSize: '0.75rem', 
                                            background: '#f1f5f9',
                                            color: '#475569',
                                            fontWeight: '600',
                                            textTransform: 'capitalize'
                                        }}>
                                            {call.disconnected_by || 'Unknown'}
                                        </span>
                                    </td>
                                    <td style={{ padding: '1rem', fontSize: '0.85rem', color: '#475569' }}>
                                        {call.detailed_status || call.error_message || (call.disconnected_by === 'user' ? 'User Hung Up' : 'No Details')}
                                    </td>
                                    <td style={{ padding: '1rem', fontSize: '0.8rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                                        {call.call_sid}
                                    </td>
                                </tr>
                            ))}
                            {paginatedCalls.length === 0 && (
                                <tr>
                                    <td colSpan="6" style={{ padding: '3rem', textAlign: 'center', color: '#94a3b8' }}>
                                        No missed calls found for this agent.
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Pagination Controls */}
            {totalPages > 1 && (
                <div style={{ 
                    display: 'flex', 
                    justifyContent: 'center', 
                    alignItems: 'center', 
                    gap: '1rem', 
                    marginTop: '1.5rem',
                    padding: '1rem',
                    background: 'white',
                    borderRadius: '12px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.05)'
                }}>
                    <button
                        className="btn-secondary"
                        onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                        disabled={currentPage === 1}
                        style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                        <ChevronLeft size={16} /> Prev
                    </button>
                    <span style={{ fontSize: '0.875rem', fontWeight: '600', color: '#64748b' }}>
                        Page {currentPage} of {totalPages}
                    </span>
                    <button
                        className="btn-secondary"
                        onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                        disabled={currentPage === totalPages}
                        style={{ padding: '6px 12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                    >
                        Next <ChevronRight size={16} />
                    </button>
                </div>
            )}
        </div>
    );
};

export default function AgentDetails() {
    const { user, isAdmin } = useAuth();
    const { agentId } = useParams();
    const [sessions, setSessions] = useState([]);
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [loading, setLoading] = useState(true);
    const [searchParams, setSearchParams] = useSearchParams();
    const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');
    const [agentName, setAgentName] = useState('');
    const [downloadDropdown, setDownloadDropdown] = useState(null);
    const [currentPage, setCurrentPage] = useState(parseInt(searchParams.get('page')) || 1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalSessions, setTotalSessions] = useState(0);
    const [sortBy, setSortBy] = useState(searchParams.get('sortBy') || 'started_at');
    const [sortOrder, setSortOrder] = useState(searchParams.get('sortOrder') || 'desc');
    const [successRate, setSuccessRate] = useState(0);
    const [totalDuration, setTotalDuration] = useState(0);
    const [zeroTurnsCount, setZeroTurnsCount] = useState(0);
    const [agentCreatedAt, setAgentCreatedAt] = useState(null);
    const [agentLastSynced, setAgentLastSynced] = useState(null);
    const [generatingSummary, setGeneratingSummary] = useState({});
    const [reviewFilter, setReviewFilter] = useState('all');
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [updatingStatus, setUpdatingStatus] = useState({});

    // Recycle Bin State
    const [recycleBinOpen, setRecycleBinOpen] = useState(false);
    const [excludedSessions, setExcludedSessions] = useState([]);
    const [hiddenSessionsList, setHiddenSessionsList] = useState([]);
    const [selectedBinItems, setSelectedBinItems] = useState(new Set());

    const navigate = useNavigate();
    const activeTab = searchParams.get('tab') || 'sessions';

    const updateSearchParams = useCallback((updates) => {
        const nextParams = new URLSearchParams(searchParams);
        Object.entries(updates).forEach(([key, value]) => {
            if (value === null || value === undefined || value === '') {
                nextParams.delete(key);
            } else {
                nextParams.set(key, value);
            }
        });
        setSearchParams(nextParams, { replace: true });
    }, [searchParams, setSearchParams]);

    const [showHiddenSessions, setShowHiddenSessions] = useState(false);

    // Multi-select state (persists across pagination)
    const [selectedSessions, setSelectedSessions] = useState(new Set());

    // Telephony State (Added)
    const [telephonyConfig, setTelephonyConfig] = useState(null);
    const [showConfigModal, setShowConfigModal] = useState(false);
    const [showCallModal, setShowCallModal] = useState(false);
    const [configForm, setConfigForm] = useState({ exophone: '', app_id: '' });
    const [callForm, setCallForm] = useState({ receiverNumber: '', receiverName: '' });

    // Close dropdowns when clicking outside
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (!e.target.closest('[data-dropdown]')) {
                setDownloadDropdown(null);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // Fetch Telephony Config
    const fetchTelephonyConfig = useCallback(async () => {
        try {
            const res = await api.get(`telephony/config/${agentId}`);
            if (res.data && res.data.exophone) {
                setTelephonyConfig(res.data);
                setConfigForm({ exophone: res.data.exophone, app_id: res.data.app_id });
            }
        } catch (err) {
            console.error('Failed to fetch telephony config:', err);
        }
    }, [agentId]);

    useEffect(() => {
        if (agentId) {
            fetchTelephonyConfig();
        }
    }, [fetchTelephonyConfig, agentId]);

    const handleSaveConfig = async () => {
        try {
            await api.post('telephony/config', {
                agentId,
                exophone: configForm.exophone,
                appId: configForm.app_id
            });
            toast.success('Telephony configuration saved.');
            setShowConfigModal(false);
            fetchTelephonyConfig();
        } catch (err) {
            toast.error('Failed to save config: ' + (err.response?.data?.error || err.message));
        }
    };

    const handleCallSession = (session) => {
        const isExempt = user?.role === 'super_admin' || user?.id === 'master_root_0';
        if (!telephonyConfig) {
            toast.error('Telephony not configured for this agent.');
            return;
        }
        if (!isExempt && (user?.minutes_balance || 0) <= 0) {
            toast.error('Insufficient credits!');
            return;
        }

        let cData = session.custom_data;
        if (typeof cData === 'string' && cData.startsWith('{')) {
            try { cData = JSON.parse(cData); } catch (e) { }
        }
        const phone = session.phone || session.customer_phone || (typeof cData === 'object' ? (cData?.phone || cData?.customer_number || cData?.number) : '');

        setCallForm({ receiverNumber: phone || '', receiverName: '' });
        setShowCallModal(true);
    };

    const handleSendCall = async () => {
        try {
            // Support multiple numbers separated by newline or comma
            const numbers = callForm.receiverNumber.split(/[\n,]+/).map(n => n.trim()).filter(n => n);

            if (numbers.length === 0) {
                toast.error('Please enter at least one phone number.');
                return;
            }

            const res = await api.post('telephony/call', {
                agentId,
                receiverNumber: numbers, // Send as Array
                receiverName: [] // Name field removed from UI
            });

            if (res.data.bulk) {
                const s = res.data.summary;
                toast.success(`Bulk Call Initiated!\nTotal: ${s.total}\nSuccess: ${s.success}\nFailed: ${s.failed}`);
            } else {
                toast.success('Call initiated successfully!');
            }

            setShowCallModal(false);
            setCallForm({ receiverNumber: '', receiverName: '' });
        } catch (err) {
            toast.error('Failed to initiate call: ' + (err.response?.data?.error || err.message));
        }
    };

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

    const handleBulkAction = (permanent) => {
        const count = selectedSessions.size;
        const action = permanent ? 'PERMANENTLY DELETE' : 'HIDE';

        confirmToast(`Are you sure you want to ${action} ${count} session(s)?`, async () => {
            let successCount = 0;
            for (const sessionId of selectedSessions) {
                try {
                    await adminAPI.deleteSession(sessionId, permanent);
                    successCount++;
                } catch (err) {
                    console.error(`Failed to ${action} session ${sessionId}:`, err);
                }
            }
            toast.success(`${successCount} of ${count} sessions ${permanent ? 'permanently deleted' : 'hidden'}.`);
            clearSelection();
            fetchSessions();
        });
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
                show_hidden: showHiddenSessions,
                ...(reviewFilter !== 'all' && { review_status: reviewFilter }),
                ...(startDate && { startDate }),
                ...(endDate && { endDate }),
            });
            const res = await api.get(`sessions?${params}`);

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
    }, [agentId, currentPage, sortBy, sortOrder, searchTerm, showHiddenSessions, reviewFilter, startDate, endDate]);

    // Fetch agent details for creation date
    const fetchAgentDetails = useCallback(async () => {
        try {
            const res = await api.get(`agents/${agentId}`);
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
        }, 30000);

        return () => clearInterval(interval);
    }, [fetchSessions, fetchAgentDetails]);

    // Debounce search
    useEffect(() => {
        const timer = setTimeout(() => {
            const urlSearch = searchParams.get('search') || '';
            if (searchTerm !== urlSearch) {
                updateSearchParams({ search: searchTerm, page: 1 });
                setCurrentPage(1);
            }
        }, 300);
        return () => clearTimeout(timer);
    }, [searchTerm, updateSearchParams, searchParams]);

    // Sync other params with URL
    const updatePage = (page) => {
        setCurrentPage(page);
        updateSearchParams({ page });
    };

    const handleSort = (field) => {
        const newOrder = sortBy === field ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'desc';
        setSortBy(field);
        setSortOrder(newOrder);
        setCurrentPage(1);
        updateSearchParams({ sortBy: field, sortOrder: newOrder, page: 1 });
    };

    const handleSessionClick = (sessionId) => {
        const siblingIds = sessions.map(s => s.session_id);
        navigate(isAdmin ? `/admin/session/${sessionId}` : `/user/session/${sessionId}`, { state: { siblingIds } });
    };

    // Format seconds to readable time with units
    const formatSecondsToTime = (seconds) => {
        if (!seconds && seconds !== 0) return '-';
        const hrs = Math.floor(seconds / 3600);
        const mins = Math.floor((seconds % 3600) / 60);
        const secs = Math.floor(seconds % 60);

        if (hrs > 0) {
            return `${hrs}h ${mins}m ${secs}s`;
        } else {
            // Always show minutes even if 0 (e.g. "0m 59s" not just "59s")
            return `${mins}m ${secs}s`;
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
            await api.patch(`user/conversations/${sessionId}/review-status`, { status: newStatus });
            // Refresh sessions to show updated status
            fetchSessions();
        } catch (err) {
            console.error('Failed to update review status:', err);
            const errorMessage = err.response?.data?.error || 'Failed to update status. Please try again.';
            toast.error(errorMessage);
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
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        return `${day}-${month}-${year}`;
    };

    const formatDateTime = (dateStr) => {
        if (!dateStr) return '-';
        const date = new Date(dateStr);
        const day = date.getDate().toString().padStart(2, '0');
        const month = (date.getMonth() + 1).toString().padStart(2, '0');
        const year = date.getFullYear();
        const time = date.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true
        });
        return `${day}-${month}-${year} ${time}`;
    };

    // Download session data
    const downloadSession = async (session, format) => {
        try {
            const convRes = await api.get(`conversation/${session.session_id}`);
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
            toast.error('Failed to download session data');
        }
        setDownloadDropdown(null);
    };

    // Generate summary on demand
    const handleGenerateSummary = async (sessionId) => {
        setGeneratingSummary(prev => ({ ...prev, [sessionId]: true }));
        try {
            const res = await api.post(`conversation/${sessionId}/generate-summary`);
            if (res.data?.summary) {
                // Update sessions state with the new summary
                setSessions(prev => prev.map(s =>
                    s.session_id === sessionId ? { ...s, summary: res.data.summary } : s
                ));
            }
        } catch (err) {
            console.error('Failed to generate summary:', err);
            toast.error('Failed to generate summary. Please try again.');
        } finally {
            setGeneratingSummary(prev => ({ ...prev, [sessionId]: false }));
        }
    };

    const handleDeleteAgent = (permanent = false) => {
        const msg = permanent
            ? 'Are you sure you want to PERMANENTLY DELETE this agent? This cannot be undone.'
            : 'Are you sure you want to HIDE this agent?';

        confirmToast(msg, async () => {
            try {
                await adminAPI.deleteAgent(agentId, permanent);

                toast.success(permanent ? 'Agent permanently deleted' : 'Agent hidden');
                navigate('/admin');
            } catch (err) {
                console.error('Failed to delete agent:', err);
                toast.error('Failed: ' + (err.response?.data?.error || err.message));
            }
        });
    };

    const handleDeleteSession = (sessionId, e, permanent = false) => {
        if (e) e.stopPropagation();
        const msg = permanent ? 'Permanently delete this session?' : 'Hide this session?';

        confirmToast(msg, async () => {
            try {
                await adminAPI.deleteSession(sessionId, permanent);
                // Remove locally
                setSessions(prev => prev.filter(s => s.session_id !== sessionId));
                setTotalSessions(prev => prev - 1);
                toast.success(permanent ? 'Session permanently deleted' : 'Session hidden');
            } catch (err) {
                console.error('Failed to delete session:', err);
                toast.error('Failed: ' + (err.response?.data?.error || err.message));
            }
        });
    };

    const handleRestoreSession = async (sessionId, e) => {
        if (e) e.stopPropagation();
        try {
            await api.post(`sessions/${sessionId}/restore`);
            fetchSessions(); // Refresh
        } catch (err) {
            toast.error('Restore failed');
        }
    };

    const fetchRecycleBin = async () => {
        try {
            const res = await api.get('data-admin/excluded');
            setExcludedSessions(res.data.excluded.filter(e => e.item_type === 'session'));

            // Also fetch hidden sessions for this agent
            const params = new URLSearchParams({ agent_id: agentId, page: 1, limit: 100, show_hidden: true });
            const hiddenRes = await api.get(`sessions?${params}`);
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
            await api.delete(`data-admin/excluded/session/${id}`);
            toast.success('Session restored from blocklist. It will be re-fetched in the next sync cycle.');
            fetchRecycleBin();
        } catch (e) {
            console.error("Restore failed:", e);
            toast.error('Restore failed: ' + (e.response?.data?.error || e.message));
        }
    };

    const handlePermanentDeleteFromBin = (id, itemType) => {
        confirmToast('Are you sure you want to PERMANENTLY remove this session? It will NOT be re-synced ever.', async () => {
            try {
                await api.delete(`/api/data-admin/excluded-permanent/${itemType}/${id}`);
                fetchRecycleBin();
                toast.success('Permanently deleted from bin');
            } catch (e) {
                toast.error('Permanent delete failed: ' + (e.response?.data?.error || e.message));
            }
        });
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

    const handleBulkBinAction = (action) => {
        const count = selectedBinItems.size;
        let label = action === 'restore' ? 'RESTORE' : action === 'resync' ? 'RE-SYNC' : 'PERMANENTLY DELETE';

        confirmToast(`Are you sure you want to ${label} ${count} item(s)?`, async () => {
            let successCount = 0;
            for (const key of selectedBinItems) {
                try {
                    const [type, id] = key.split('::');
                    if (action === 'restore') {
                        await api.post(`sessions/${id}/restore`);
                    } else if (action === 'resync') {
                        await api.delete(`data-admin/excluded/session/${id}`);
                    } else {
                        await api.delete(`data-admin/excluded-permanent/session/${id}`);
                    }
                    successCount++;
                } catch (err) {
                    console.error(`Bulk action failed for ${key}:`, err);
                }
            }
            toast.success(`${successCount} of ${count} items processed.`);
            setSelectedBinItems(new Set());
            fetchRecycleBin();
            fetchSessions();
        });
    };

    if (loading && sessions.length === 0) return <div className="loading">Loading sessions...</div>;

    // Find earliest date in current view as a proxy for "Created At" if not available
    const earliestSession = sessions.length > 0 ? sessions[sessions.length - 1].started_at : new Date().toISOString();


    return (
        <>
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: '#f5f7fa', minHeight: '100vh', width: '100%' }}>
                <main style={{ flex: 1, padding: '0', background: '#f5f7fa', overflowY: 'auto' }}>
                    <div style={{ padding: '2rem 2rem 0 2rem', background: '#f5f7fa' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                                <button
                                    onClick={() => navigate(-1)}
                                    style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', color: '#64748b', padding: '5px', borderRadius: '50%', transition: 'background 0.2s' }}
                                    onMouseOver={(e) => e.currentTarget.style.background = '#e2e8f0'}
                                    onMouseOut={(e) => e.currentTarget.style.background = 'none'}
                                    title="Go Back"
                                >
                                    <ArrowLeft size={24} />
                                </button>
                                <h1 style={{ color: 'var(--primary)', fontSize: '1.75rem', margin: 0 }}>{agentName || agentId}</h1>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                {isAdmin && (
                                    <button
                                        style={{
                                            padding: '8px 16px', borderRadius: '8px', border: telephonyConfig ? 'none' : '1px solid #cbd5e1',
                                            background: telephonyConfig ? 'linear-gradient(135deg, #22c55e, #16a34a)' : '#f8fafc',
                                            color: telephonyConfig ? 'white' : '#64748b', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', cursor: (telephonyConfig && ((user?.minutes_balance > 0) || (user?.role === 'super_admin' || user?.id === 'master_root_0'))) ? 'pointer' : 'not-allowed',
                                            opacity: (telephonyConfig && ((user?.minutes_balance > 0) || (user?.role === 'super_admin' || user?.id === 'master_root_0'))) ? 1 : 0.6,
                                            fontSize: '0.9rem', boxShadow: telephonyConfig ? '0 4px 6px -1px rgba(0,0,0,0.1)' : 'none'
                                        }}
                                        onClick={() => {
                                            const isExempt = user?.role === 'super_admin' || user?.id === 'master_root_0';
                                            if (!telephonyConfig) toast.error('Telephony not configured for this agent.');
                                            else if (!isExempt && (user?.minutes_balance || 0) <= 0) toast.error('Insufficient credits!');
                                            else {
                                                setCallForm({ receiverNumber: '', receiverName: '' });
                                                setShowCallModal(true);
                                            }
                                        }}
                                    >
                                        <Phone size={18} /> Send Call
                                    </button>
                                )}
                                {(user?.role === 'super_admin' || user?.id === 'master_root_0') && (
                                    <button
                                        style={{ padding: '8px 16px', borderRadius: '8px', border: '1px solid #cbd5e1', background: 'white', color: '#475569', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}
                                        onClick={() => setShowConfigModal(true)}
                                    >
                                        <Settings size={18} /> Configure
                                    </button>
                                )}
                                {activeTab === 'sessions' && user?.id === 'master_root_0' && (
                                    <button
                                        onClick={() => setShowHiddenSessions(!showHiddenSessions)}
                                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', borderRadius: '8px', border: '1px solid #cbd5e1', background: showHiddenSessions ? '#e2e8f0' : 'white', cursor: 'pointer', fontSize: '0.9rem' }}
                                    >
                                        {showHiddenSessions ? <EyeOff size={16} /> : <Eye size={16} />}
                                        {showHiddenSessions ? 'Hide Deleted' : 'Show Deleted'}
                                    </button>
                                )}
                            </div>
                        </div>
                        {/* Tab Navigation */}
                        <div style={{ display: 'flex', gap: '0', borderBottom: '2px solid #e5e7eb', marginBottom: '0', overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
                            <button
                                onClick={() => updateSearchParams({ tab: 'about' })}
                                style={{
                                    padding: '0.7rem 1.25rem', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                                    fontWeight: activeTab === 'about' ? '600' : '400', fontSize: '0.95rem',
                                    color: activeTab === 'about' ? '#008F4B' : '#64748b',
                                    background: 'transparent',
                                    borderBottom: activeTab === 'about' ? '2px solid #008F4B' : '2px solid transparent',
                                    marginBottom: '-2px', transition: 'all 0.2s',
                                    display: 'flex', alignItems: 'center', gap: '8px'
                                }}
                            >
                                <Info size={16} /> About Agent
                            </button>
                            <button
                                onClick={() => updateSearchParams({ tab: 'sessions' })}
                                style={{
                                    padding: '0.7rem 1.25rem', border: 'none', cursor: 'pointer',
                                    fontWeight: activeTab === 'sessions' ? '600' : '400', fontSize: '0.95rem',
                                    color: activeTab === 'sessions' ? '#008F4B' : '#64748b',
                                    background: 'transparent',
                                    borderBottom: activeTab === 'sessions' ? '2px solid #008F4B' : '2px solid transparent',
                                    marginBottom: '-2px', transition: 'all 0.2s',
                                    display: 'flex', alignItems: 'center', gap: '8px'
                                }}
                            >
                                <Search size={16} /> Sessions
                            </button>
                            <button
                                onClick={() => updateSearchParams({ tab: 'missed-calls' })}
                                style={{
                                    padding: '0.7rem 1.25rem', border: 'none', cursor: 'pointer',
                                    fontWeight: activeTab === 'missed-calls' ? '600' : '400', fontSize: '0.95rem',
                                    color: activeTab === 'missed-calls' ? '#008F4B' : '#64748b',
                                    background: 'transparent',
                                    borderBottom: activeTab === 'missed-calls' ? '2px solid #008F4B' : '2px solid transparent',
                                    marginBottom: '-2px', transition: 'all 0.2s',
                                    display: 'flex', alignItems: 'center', gap: '8px'
                                }}
                            >
                                <PhoneOff size={16} /> Missed Calls
                            </button>
                            {isAdmin && (
                                <button
                                    onClick={() => updateSearchParams({ tab: 'campaigns' })}
                                    style={{
                                        padding: '0.7rem 1.25rem', border: 'none', cursor: 'pointer',
                                        fontWeight: activeTab === 'campaigns' ? '600' : '400', fontSize: '0.95rem',
                                        color: activeTab === 'campaigns' ? '#008F4B' : '#64748b',
                                        background: 'transparent',
                                        borderBottom: activeTab === 'campaigns' ? '2px solid #008F4B' : '2px solid transparent',
                                        marginBottom: '-2px', transition: 'all 0.2s',
                                        display: 'flex', alignItems: 'center', gap: '8px'
                                    }}
                                >
                                    <Megaphone size={16} /> Campaigns
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="page-container" style={{ padding: '1.5rem 2rem 2rem 2rem', maxWidth: '100%', display: 'flex', flexDirection: 'column' }}>
                        {activeTab === 'about' && (
                            <div style={{ background: 'white', borderRadius: '16px', padding: '2rem', border: '1px solid var(--border)', boxShadow: '0 4px 15px rgba(0,0,0,0.03)', maxWidth: '900px', margin: '0 auto', width: '100%' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '2rem', paddingBottom: '1rem', borderBottom: '1px solid #f1f5f9' }}>
                                    <div style={{ width: 44, height: 44, borderRadius: '12px', background: 'rgba(0,143,75,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--primary)' }}>
                                        <Info size={24} />
                                    </div>
                                    <div>
                                        <h2 style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--text)', margin: 0 }}>Agent Information</h2>
                                        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', margin: '4px 0 0 0' }}>Configuration and overall statistics</p>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '2rem', marginBottom: '2rem' }}>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                        <div>
                                            <div style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Agent Name</div>
                                            <div style={{ fontSize: '1.05rem', fontWeight: '600', color: 'var(--text)' }}>{agentName || agentId}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Agent ID</div>
                                            <div style={{ fontSize: '0.9rem', color: 'var(--text)', fontFamily: 'monospace', background: '#f8fafc', padding: '6px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', wordBreak: 'break-all' }}>{agentId}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Created At</div>
                                            <div style={{ fontSize: '1.05rem', fontWeight: '600', color: 'var(--text)' }}>{formatDate(agentCreatedAt)}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Status</div>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem', fontWeight: '600', color: '#059669', background: '#ecfdf5', padding: '4px 12px', borderRadius: '100px' }}>
                                                <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#10b981' }} /> Active
                                            </span>
                                        </div>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                                        <div>
                                            <div style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Lifetime Sessions</div>
                                            <div style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--text)' }}>{totalSessions.toLocaleString()}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Total Call Duration</div>
                                            <div style={{ fontSize: '1.1rem', fontWeight: '600', color: 'var(--text)' }}>{Math.floor(totalDuration / 60)} min</div>
                                            <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '4px' }}>Jan 1, 2026 - {new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                                        </div>
                                        <div>
                                            <div style={{ fontSize: '0.75rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>Last Synced</div>
                                            <div style={{ fontSize: '1.05rem', fontWeight: '600', color: 'var(--text)' }}>{formatDateTime(agentLastSynced)}</div>
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', paddingTop: '1.5rem', borderTop: '1px solid #f1f5f9' }}>
                                    {user?.id === 'master_root_0' && (
                                        <>
                                            <button style={{ padding: '10px 24px', borderRadius: '8px', border: '1px solid #fed7d7', background: '#fff5f5', color: '#e53e3e', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', marginLeft: 'auto', cursor: 'pointer' }} onClick={() => handleDeleteAgent(false)}>
                                                <EyeOff size={18} /> Hide
                                            </button>
                                            <button style={{ padding: '10px 24px', borderRadius: '8px', border: '1px solid #fed7d7', background: '#e53e3e', color: 'white', fontWeight: '600', display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }} onClick={() => handleDeleteAgent(true)}>
                                                <Trash2 size={18} /> Destroy
                                            </button>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        {activeTab === 'sessions' && (<>

                            {/* Unified Filter Toolbar */}
                            <div style={{ background: 'white', borderRadius: '12px', padding: '1.25rem 1.5rem', boxShadow: '0 2px 12px rgba(0,0,0,0.05)', marginBottom: '1.25rem', display: 'flex', flexDirection: 'column', gap: '1rem', border: '1px solid #f1f5f9' }}>
                                {/* Row 1: Search + Date Range + Clear */}
                                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                    {/* Search */}
                                    <div style={{ flex: '1 1 280px', display: 'flex', alignItems: 'center', gap: '8px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '0 0.875rem' }}>
                                        <Search size={16} style={{ color: '#94a3b8', flexShrink: 0 }} />
                                        <input
                                            type="text"
                                            placeholder="Search by Phone Number or Session ID..."
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                            style={{ border: 'none', background: 'transparent', padding: '0.625rem 0', fontSize: '0.875rem', width: '100%', outline: 'none', color: '#1e293b' }}
                                        />
                                        {searchTerm && (
                                            <button onClick={() => setSearchTerm('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', display: 'flex', padding: 0 }}><X size={14} /></button>
                                        )}
                                    </div>
                                    {/* From Date */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '0 0.875rem' }}>
                                        <span style={{ fontSize: '0.7rem', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>From</span>
                                        <input
                                            type="date"
                                            value={startDate}
                                            onChange={(e) => { setStartDate(e.target.value); setCurrentPage(1); }}
                                            style={{ border: 'none', background: 'transparent', padding: '0.625rem 0', fontSize: '0.8rem', outline: 'none', color: '#475569', cursor: 'pointer', fontFamily: 'inherit' }}
                                        />
                                    </div>
                                    {/* To Date */}
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', background: '#f8fafc', borderRadius: '8px', border: '1px solid #e2e8f0', padding: '0 0.875rem' }}>
                                        <span style={{ fontSize: '0.7rem', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>To</span>
                                        <input
                                            type="date"
                                            value={endDate}
                                            onChange={(e) => { setEndDate(e.target.value); setCurrentPage(1); }}
                                            style={{ border: 'none', background: 'transparent', padding: '0.625rem 0', fontSize: '0.8rem', outline: 'none', color: '#475569', cursor: 'pointer', fontFamily: 'inherit' }}
                                        />
                                    </div>
                                    {(searchTerm || startDate || endDate || reviewFilter !== 'all') && (
                                        <button
                                            onClick={() => { setSearchTerm(''); setStartDate(''); setEndDate(''); setReviewFilter('all'); setCurrentPage(1); }}
                                            style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '0.5rem 0.875rem', background: '#fff1f2', border: '1px solid #fecaca', borderRadius: '8px', color: '#e11d48', fontSize: '0.8rem', fontWeight: '600', cursor: 'pointer', whiteSpace: 'nowrap' }}
                                        >
                                            <X size={13} /> Clear All
                                        </button>
                                    )}
                                </div>
                                {/* Row 2: Status Filters + Sort + Count */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
                                    <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', alignItems: 'center' }}>
                                        <span style={{ fontSize: '0.75rem', color: '#94a3b8', fontWeight: '600', marginRight: '4px' }}>Status:</span>
                                        {[{ key: 'all', label: 'All' }, { key: 'pending', label: 'Pending' }, { key: 'needs_review', label: 'Needs Review' }, { key: 'completed', label: 'Completed' }].map(({ key, label }) => (
                                            <button
                                                key={key}
                                                onClick={() => { setReviewFilter(key); setCurrentPage(1); }}
                                                style={{
                                                    padding: '4px 12px',
                                                    border: `1px solid ${reviewFilter === key ? 'var(--primary)' : '#e2e8f0'}`,
                                                    background: reviewFilter === key ? 'var(--primary)' : 'white',
                                                    color: reviewFilter === key ? 'white' : '#475569',
                                                    borderRadius: '20px',
                                                    cursor: 'pointer',
                                                    fontSize: '0.78rem',
                                                    fontWeight: reviewFilter === key ? '700' : '500',
                                                    transition: 'all 0.15s',
                                                }}
                                            >{label}</button>
                                        ))}
                                    </div>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                        <span style={{ fontSize: '0.8rem', color: '#94a3b8' }}>
                                            {sessions.length} of {totalSessions.toLocaleString()} sessions
                                        </span>
                                        <button onClick={() => handleSort('started_at')} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', background: 'white', color: '#475569', fontSize: '0.78rem', fontWeight: '600', cursor: 'pointer' }}>
                                            <ArrowUpDown size={13} /> Date {sortBy === 'started_at' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
                                        </button>
                                        <button onClick={() => handleSort('duration_seconds')} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '4px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', background: 'white', color: '#475569', fontSize: '0.78rem', fontWeight: '600', cursor: 'pointer' }}>
                                            <ArrowUpDown size={13} /> Duration {sortBy === 'duration_seconds' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
                                        </button>
                                    </div>
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
                                        <button onClick={() => handleBulkAction(false)} style={{ padding: '8px 16px', background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)', color: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <EyeOff size={14} /> Hide All
                                        </button>
                                        <button onClick={() => handleBulkAction(true)} style={{ padding: '8px 16px', background: '#ef4444', border: 'none', color: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <Trash2 size={14} /> Delete All
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Desktop Table View */}
                            <div className="card desktop-only" style={{ background: 'white', borderRadius: '12px', boxShadow: '0 4px 12px rgba(0,0,0,0.05)', overflow: 'hidden' }}>
                                <div className="table-container">
                                    <table className="session-table" style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                                        <thead style={{ background: '#f8f9fa', position: 'sticky', top: 0, zIndex: 10 }}>
                                            <tr>
                                                {user?.id === 'master_root_0' && (
                                                    <th style={{ padding: '0.75rem 0.5rem', textAlign: 'center', fontWeight: '600', color: '#64748b', width: '45px', fontSize: '0.8rem' }}>
                                                        <button onClick={toggleSelectAll} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                                                            {sessions.length > 0 && sessions.every(s => selectedSessions.has(s.session_id))
                                                                ? <CheckSquare size={18} color="#008F4B" />
                                                                : sessions.some(s => selectedSessions.has(s.session_id))
                                                                    ? <MinusSquare size={18} color="#f59e0b" />
                                                                    : <Square size={18} color="#94a3b8" />}
                                                        </button>
                                                    </th>
                                                )}
                                                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: '600', color: '#64748b', width: '11%', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Date</th>
                                                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: '600', color: '#64748b', width: '16%', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Time / Duration</th>
                                                <th style={{ padding: '0.75rem 1rem', textAlign: 'center', fontWeight: '600', color: '#64748b', width: '17%', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Caller</th>
                                                <th style={{ padding: '0.75rem 1rem', textAlign: 'center', fontWeight: '600', color: '#64748b', width: '35%', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Summary</th>
                                                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: '600', color: '#64748b', width: '9%', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Status</th>
                                                <th style={{ padding: '0.75rem 1rem', textAlign: 'left', fontWeight: '600', color: '#64748b', width: '12%', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {sessions.map(session => (
                                                <tr
                                                    key={session.session_id}
                                                    className="session-row"
                                                    style={{
                                                        borderBottom: '1px solid #f1f5f9',
                                                        background: getRowBackgroundColor(session.review_status),
                                                        verticalAlign: 'middle'
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

                                                    <td className="clickable-cell" onClick={() => handleSessionClick(session.session_id)} style={{ padding: '0.875rem 1rem', verticalAlign: 'middle' }}>
                                                        {formatDate(session.started_at)}
                                                    </td>
                                                    <td className="clickable-cell" onClick={() => handleSessionClick(session.session_id)} style={{ padding: '0.875rem 1rem', verticalAlign: 'middle' }}>
                                                        <div style={{ fontSize: '0.82rem', color: '#374151' }}>{formatTime(session.started_at)} – {formatTime(session.ended_at)}</div>
                                                        <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>{formatSecondsToTime(session.duration_seconds)}</div>
                                                    </td>
                                                    <td className="clickable-cell" onClick={() => handleSessionClick(session.session_id)} style={{ padding: '0.875rem 1rem', verticalAlign: 'middle', textAlign: 'center' }}>
                                                        <CallerDetails session={session} />
                                                    </td>
                                                    <td style={{ padding: '0.875rem 1rem', verticalAlign: 'middle', textAlign: 'left' }}>
                                                        {session.summary ? (
                                                            <span style={{ fontSize: '0.85rem', color: '#374151', lineHeight: '1.5' }}>
                                                                {session.summary}
                                                            </span>
                                                        ) : session.conversation_count === 0 || !session.conversation_count ? (
                                                            <span style={{ fontSize: '0.82rem', color: '#94a3b8', fontStyle: 'italic' }}>
                                                                No conversation
                                                            </span>
                                                        ) : !session.ended_at ? (
                                                            <span style={{ fontSize: '0.82rem', color: '#f59e0b', fontStyle: 'italic' }}>
                                                                ⏳ In progress...
                                                            </span>
                                                        ) : (
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
                                                    <td style={{ padding: '0.875rem 1rem', verticalAlign: 'middle' }}>
                                                        <select
                                                            value={session.review_status || 'pending'}
                                                            onChange={(e) => {
                                                                e.stopPropagation();
                                                                handleStatusChange(session.session_id, e.target.value);
                                                            }}
                                                            disabled={updatingStatus[session.session_id]}
                                                            style={{
                                                                padding: '0.25rem 0.4rem',
                                                                fontSize: '0.73rem',
                                                                border: '1px solid #e2e8f0',
                                                                borderRadius: '6px',
                                                                cursor: updatingStatus[session.session_id] ? 'not-allowed' : 'pointer',
                                                                background: updatingStatus[session.session_id] ? '#f0f0f0' : 'white',
                                                                width: '100%'
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
                                                                <div className="dropdown-menu" data-dropdown="true">
                                                                    <button onClick={() => downloadSession(session, 'json')}>JSON</button>
                                                                    <button onClick={() => downloadSession(session, 'csv')}>CSV</button>
                                                                    <button onClick={() => downloadSession(session, 'txt')}>TXT</button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))}
                                            {sessions.length === 0 && !loading && <tr><td colSpan={user?.id === 'master_root_0' ? 7 : 6} className="text-center" style={{ padding: '3rem', color: '#94a3b8', fontSize: '0.9rem' }}>No sessions found.</td></tr>}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Mobile Card View */}
                            <div className="mobile-only sessions-cards">
                                {
                                    sessions.map(session => (
                                        <div key={session.session_id} className="session-card" onClick={() => handleSessionClick(session.session_id)} style={{ background: getRowBackgroundColor(session.review_status), border: '1px solid #e5e7eb' }}>
                                            <div className="session-card-header">

                                                {/* ... Mobile card content ... */}
                                            </div>
                                            <div className="session-card-body">
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                                    <div>
                                                        <p>Date: {formatDate(session.started_at)}</p>
                                                        <p>Duration: {formatSecondsToTime(session.duration_seconds)}</p>
                                                        <div style={{ marginTop: '4px' }}>
                                                            <CallerDetails session={session} />
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end', marginLeft: '10px' }}>
                                                        <select
                                                            value={session.review_status || 'pending'}
                                                            onChange={(e) => { e.stopPropagation(); handleStatusChange(session.session_id, e.target.value); }}
                                                            onClick={(e) => e.stopPropagation()}
                                                            style={{ padding: '4px', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid #ccc', background: 'white', maxWidth: '120px' }}
                                                        >
                                                            <option value="pending">Pending</option>
                                                            <option value="needs_review">Review</option>
                                                            <option value="completed">Completed</option>
                                                        </select>
                                                        <div style={{ position: 'relative', display: 'flex', gap: '8px' }} data-dropdown="true">

                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setDownloadDropdown(downloadDropdown === session.session_id ? null : session.session_id); }}
                                                                style={{ padding: '4px 8px', background: 'white', border: '1px solid #ccc', borderRadius: '4px', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem', cursor: 'pointer' }}
                                                            >
                                                                <Download size={14} /> Download
                                                            </button>
                                                            {downloadDropdown === session.session_id && (
                                                                <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: '4px', background: 'white', border: '1px solid #ddd', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 100, minWidth: '80px', display: 'flex', flexDirection: 'column' }} data-dropdown="true">
                                                                    <button onClick={(e) => { e.stopPropagation(); downloadSession(session, 'json'); }} style={{ padding: '8px', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid #eee', fontSize: '0.8rem', cursor: 'pointer' }}>JSON</button>
                                                                    <button onClick={(e) => { e.stopPropagation(); downloadSession(session, 'csv'); }} style={{ padding: '8px', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid #eee', fontSize: '0.8rem', cursor: 'pointer' }}>CSV</button>
                                                                    <button onClick={(e) => { e.stopPropagation(); downloadSession(session, 'txt'); }} style={{ padding: '8px', textAlign: 'left', background: 'transparent', border: 'none', fontSize: '0.8rem', cursor: 'pointer' }}>TXT</button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>

                                                <div className="session-card-summary" style={{ marginTop: '0.75rem', borderTop: '1px solid #f0f0f0', paddingTop: '0.5rem' }}>
                                                    {session.summary ? (
                                                        <p style={{ fontSize: '0.85rem', color: '#444', margin: 0, lineHeight: '1.4' }}>{session.summary}</p>
                                                    ) : session.conversation_count === 0 ? (
                                                        <p style={{ fontSize: '0.85rem', color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>User did not speak anything</p>
                                                    ) : !session.ended_at ? (
                                                        <p style={{ fontSize: '0.85rem', color: '#f59e0b', margin: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            <span className="spin">⏳</span> Session in progress...
                                                        </p>
                                                    ) : (
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleGenerateSummary(session.session_id);
                                                            }}
                                                            disabled={generatingSummary[session.session_id]}
                                                            style={{
                                                                padding: '8px 12px',
                                                                fontSize: '0.85rem',
                                                                background: generatingSummary[session.session_id] ? '#f1f5f9' : 'rgba(0, 143, 75, 0.1)',
                                                                color: generatingSummary[session.session_id] ? '#94a3b8' : '#008F4B',
                                                                border: '1px solid transparent',
                                                                borderRadius: '6px',
                                                                width: '100%',
                                                                cursor: generatingSummary[session.session_id] ? 'not-allowed' : 'pointer',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                justifyContent: 'center',
                                                                gap: '6px',
                                                                fontWeight: '600',
                                                                marginTop: '4px'
                                                            }}
                                                        >
                                                            <RefreshCw size={14} className={generatingSummary[session.session_id] ? 'spin' : ''} />
                                                            {generatingSummary[session.session_id] ? 'Generating...' : 'Generate Summary'}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))
                                }
                            </div >

                            {/* Pagination */}
                            {
                                totalPages > 1 && (
                                    <div className="pagination" style={{ margin: '30px 0', background: 'white', padding: '12px 20px', borderRadius: '12px', border: '1px solid #e2e8f0', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '20px' }}>
                                        <button
                                            className="btn-secondary"
                                            onClick={() => updatePage(currentPage - 1)}
                                            disabled={currentPage === 1}
                                            style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}
                                        >
                                            <ChevronLeft size={18} /> Prev
                                        </button>
                                        <div style={{ fontSize: '0.9rem', color: '#64748b', fontWeight: '600' }}>
                                            Page {currentPage} of {totalPages}
                                        </div>
                                        <button
                                            className="btn-secondary"
                                            onClick={() => updatePage(currentPage + 1)}
                                            disabled={currentPage === totalPages}
                                            style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '8px' }}
                                        >
                                            Next <ChevronRight size={18} />
                                        </button>
                                    </div>
                                )
                            }
                        </>)
                        }

                        {
                            activeTab === 'missed-calls' && (
                                <MissedCallsTab agentId={agentId} />
                            )
                        }

                        {
                            activeTab === 'campaigns' && isAdmin && (
                                <CampaignTab
                                    agentId={agentId}
                                    agentName={agentName}
                                    telephonyConfig={telephonyConfig}
                                    onNavigateToSession={(call) => {
                                        // 1. Try direct session ID if present
                                        if (call.session_id) {
                                            navigate(isAdmin ? `/admin/session/${call.session_id}` : `/user/session/${call.session_id}`);
                                            return;
                                        }

                                        // 3. Fallback: Search by Phone Number
                                        const searchByPhone = () => {
                                            const rawPhone = (call.to || call.number || call.phone_number || '').replace(/[^0-9]/g, '');

                                            const findSessionInList = (phoneLast10, sessionList) => {
                                                return sessionList.find(s => {
                                                    let cData = s.custom_data;
                                                    if (typeof cData === 'string' && cData.startsWith('{')) {
                                                        try { cData = JSON.parse(cData); } catch (e) { /* ignore */ }
                                                    }
                                                    const sPhone = String(
                                                        s.phone ||
                                                        s.customer_phone ||
                                                        (cData?.phone) ||
                                                        (cData?.customer_number) ||
                                                        (cData?.number) ||
                                                        ''
                                                    ).replace(/[^0-9]/g, '');
                                                    return sPhone.endsWith(phoneLast10);
                                                });
                                            };

                                            if (rawPhone && rawPhone.length >= 10) {
                                                const last10 = rawPhone.slice(-10);
                                                const matchedSession = findSessionInList(last10, sessions);

                                                if (matchedSession) {
                                                    navigate(isAdmin ? `/admin/session/${matchedSession.session_id}` : `/user/session/${matchedSession.session_id}`);
                                                    return;
                                                }

                                                // API search by phone
                                                toast.loading('Searching for session by phone...', { id: 'search-phone' });
                                                api.get('/api/sessions', { params: { agent_id: agentId, search: last10, limit: 1 } })
                                                    .then(res => {
                                                        toast.dismiss('search-phone');
                                                        if (res.data && res.data.data && res.data.data.length > 0) {
                                                            const remoteSession = res.data.data[0];
                                                            navigate(isAdmin ? `/admin/session/${remoteSession.session_id}` : `/user/session/${remoteSession.session_id}`);
                                                        } else {
                                                            toast('Session not found yet. It may take a few minutes to sync.', { icon: '⏳' });
                                                        }
                                                    })
                                                    .catch(() => {
                                                        toast.dismiss('search-phone');
                                                        toast.error('Failed to search for session.');
                                                    });
                                            } else {
                                                toast('Session link not yet available or not found for this call', { icon: 'ℹ️' });
                                            }
                                        };

                                        // 2. Try matching by CallSid (Exotel ID) which is most reliable
                                        const callSid = call.call_sid || call.Sid || call.sid || call.CallSid || call.id;

                                        if (callSid && typeof callSid === 'string' && callSid.length > 10) {
                                            const matchedBySid = sessions.find(s =>
                                                s.metadata?.telephony?.call_id === callSid ||
                                                s.metadata?.call_id === callSid ||
                                                s.session_id === callSid
                                            );

                                            if (matchedBySid) {
                                                navigate(isAdmin ? `/admin/session/${matchedBySid.session_id}` : `/user/session/${matchedBySid.session_id}`);
                                                return;
                                            }

                                            // Specific API search for CallSid if not found locally
                                            toast.loading(`Searching session for Call ID...`, { id: 'search-sid' });

                                            api.get('/api/sessions', { params: { agent_id: agentId, search: callSid, limit: 1 } })
                                                .then(res => {
                                                    toast.dismiss('search-sid');
                                                    if (res.data && res.data.data && res.data.data.length > 0) {
                                                        const remoteSession = res.data.data[0];
                                                        navigate(isAdmin ? `/admin/session/${remoteSession.session_id}` : `/user/session/${remoteSession.session_id}`);
                                                    } else {
                                                        // Fallback to phone search if Sid search fails
                                                        searchByPhone();
                                                    }
                                                })
                                                .catch((err) => {
                                                    toast.dismiss('search-sid');
                                                    searchByPhone();
                                                });
                                            return;
                                        }

                                        // If no Sid, go straight to phone search
                                        searchByPhone();
                                    }}
                                />
                            )
                        }
                    </div >
                </main >
            </div >

            {/* Config Modal */}
            {
                showConfigModal && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                        <div style={{ background: 'white', padding: '24px', borderRadius: '12px', width: '400px', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                                <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>Telephony Configuration</h2>
                                <button onClick={() => setShowConfigModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', fontSize: '0.9rem' }}>Exophone (Virtual Number)</label>
                                    <input
                                        type="text"
                                        value={configForm.exophone}
                                        onChange={e => setConfigForm({ ...configForm, exophone: e.target.value })}
                                        placeholder="e.g. 04045210661"
                                        style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                                    />
                                </div>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', fontSize: '0.9rem' }}>App ID (Flow ID)</label>
                                    <input
                                        type="text"
                                        value={configForm.app_id}
                                        onChange={e => setConfigForm({ ...configForm, app_id: e.target.value })}
                                        placeholder="e.g. 1175263"
                                        style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1' }}
                                    />
                                </div>
                                <button
                                    onClick={handleSaveConfig}
                                    style={{ marginTop: '10px', padding: '10px', background: '#008F4B', color: 'white', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer' }}
                                >
                                    Save Configuration
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Call Modal */}
            {
                showCallModal && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                        <div style={{ background: 'white', padding: '24px', borderRadius: '12px', width: '400px', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                                <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <Phone size={20} /> Initiate Call
                                </h2>
                                <button onClick={() => setShowCallModal(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
                            </div>
                            <div style={{ marginBottom: '15px', padding: '10px', background: '#f0fdf4', borderRadius: '6px', border: '1px solid #bbf7d0', fontSize: '0.85rem', color: '#166534' }}>
                                Calling via <strong>{telephonyConfig?.exophone}</strong><br />
                                Flow App ID: {telephonyConfig?.app_id}
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                                <div>
                                    <label style={{ display: 'block', marginBottom: '5px', fontWeight: '500', fontSize: '0.9rem' }}>Receiver Phone Number(s)</label>
                                    <textarea
                                        value={callForm.receiverNumber}
                                        onChange={e => setCallForm({ ...callForm, receiverNumber: e.target.value })}
                                        placeholder={'Enter numbers separated by comma or new line e.g.\n9876543210\n9988776655'}
                                        rows={5}
                                        style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontFamily: 'inherit', resize: 'vertical' }}
                                    />
                                    <p style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '4px' }}>To call multiple users, verify numbers are correct.</p>
                                </div>
                                <button
                                    onClick={handleSendCall}
                                    style={{ marginTop: '10px', padding: '10px', background: '#008F4B', color: 'white', border: 'none', borderRadius: '6px', fontWeight: '600', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                                >
                                    <Phone size={18} /> Send Call Now
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Recycle Bin Modal */}
            {
                recycleBinOpen && (() => {
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
                })()
            }
        </>
    );
}
