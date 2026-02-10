import React, { useEffect, useState, useCallback } from 'react';
import { adminAPI } from '../services/api';
import { useNavigate } from 'react-router-dom';
import { Users, MessageSquare, Clock, Search, ChevronLeft, ChevronRight, ArrowUpDown, Lock, Trash2, Activity, RotateCcw, ShieldAlert, X, EyeOff, CheckSquare, Square, MinusSquare } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import Header from '../components/Header';

const ITEMS_PER_PAGE = 10;

export default function Dashboard() {
    const { user } = useAuth();
    const [agents, setAgents] = useState([]);
    const [stats, setStats] = useState({ totalAgents: 0, totalSessions: 0, successRate: 0 });
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalAgents, setTotalAgents] = useState(0);
    const [sortBy, setSortBy] = useState('recent');
    const [sortOrder, setSortOrder] = useState('desc');
    const navigate = useNavigate();

    const [recycleBinOpen, setRecycleBinOpen] = useState(false);
    const [hiddenAgents, setHiddenAgents] = useState([]);
    const [excludedAgents, setExcludedAgents] = useState([]);

    // Multi-select for agents grid
    const [selectedAgents, setSelectedAgents] = useState(new Set());

    // Multi-select for recycle bin
    const [selectedBinItems, setSelectedBinItems] = useState(new Set());

    const toggleAgentSelect = (agentId, e) => {
        e.stopPropagation();
        setSelectedAgents(prev => {
            const next = new Set(prev);
            if (next.has(agentId)) next.delete(agentId); else next.add(agentId);
            return next;
        });
    };

    const toggleSelectAllAgents = () => {
        const pageIds = agents.map(a => a.agent_id || a._id);
        const allSelected = pageIds.every(id => selectedAgents.has(id));
        setSelectedAgents(prev => {
            const next = new Set(prev);
            if (allSelected) pageIds.forEach(id => next.delete(id)); else pageIds.forEach(id => next.add(id));
            return next;
        });
    };

    const clearAgentSelection = () => setSelectedAgents(new Set());

    const handleBulkAgentAction = async (permanent) => {
        const count = selectedAgents.size;
        const action = permanent ? 'PERMANENTLY DELETE' : 'HIDE';
        if (!window.confirm(`Are you sure you want to ${action} ${count} agent(s)?`)) return;
        let s = 0;
        for (const id of selectedAgents) {
            try { await adminAPI.deleteAgent(id, permanent); s++; } catch (e) { console.error(e); }
        }
        alert(`${s} of ${count} agents ${permanent ? 'permanently deleted' : 'hidden'}.`);
        clearAgentSelection();
        fetchAgents();
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
        let s = 0;
        for (const key of selectedBinItems) {
            try {
                const [type, id] = key.split('::');
                const { default: api } = await import('../services/api');
                if (action === 'restore') {
                    await adminAPI.restoreAgent(id);
                } else if (action === 'resync') {
                    await api.delete(`/api/data-admin/excluded/agent/${id}`);
                } else {
                    await api.delete(`/api/data-admin/excluded-permanent/agent/${id}`);
                }
                s++;
            } catch (e) { console.error(e); }
        }
        alert(`${s} of ${count} items processed.`);
        setSelectedBinItems(new Set());
        fetchRecycleBin();
        fetchAgents();
    };

    const fetchRecycleBin = async () => {
        try {
            const hiddenRes = await adminAPI.getAllAgents({ show_hidden: 'true', limit: 100 });
            setHiddenAgents(hiddenRes.data.data.filter(a => a.is_hidden));

            const { default: api } = await import('../services/api');
            const excludedRes = await api.get('/api/data-admin/excluded');
            setExcludedAgents(excludedRes.data.excluded.filter(e => e.item_type === 'agent'));
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

    const handleRestore = async (id, type) => {
        try {
            const { default: api } = await import('../services/api');
            if (type === 'hidden') {
                await adminAPI.restoreAgent(id);
            } else {
                await api.delete(`/api/data-admin/excluded/agent/${id}`);
            }
            fetchRecycleBin();
            fetchAgents();
        } catch (e) {
            alert('Restore failed: ' + (e.response?.data?.error || e.message));
        }
    };

    const handlePermanentDeleteFromBin = async (id, itemType) => {
        if (!window.confirm(`Are you sure you want to PERMANENTLY remove this ${itemType} from the recycle bin? It will NOT be re-synced ever.`)) return;
        try {
            const { default: api } = await import('../services/api');
            await api.delete(`/api/data-admin/excluded-permanent/${itemType}/${id}`);
            fetchRecycleBin();
        } catch (e) {
            alert('Permanent delete failed: ' + (e.response?.data?.error || e.message));
        }
    };

    const getDaysRemaining = (excludedAt) => {
        const excluded = new Date(excludedAt);
        const expiry = new Date(excluded.getTime() + 30 * 24 * 60 * 60 * 1000);
        const now = new Date();
        const daysLeft = Math.ceil((expiry - now) / (24 * 60 * 60 * 1000));
        return Math.max(0, daysLeft);
    };

    const fetchAgents = useCallback(async () => {
        try {
            console.log('Fetching agents...');
            const params = {
                page: currentPage,
                limit: ITEMS_PER_PAGE,
                sortBy: sortBy,
                sortOrder: sortOrder,
                search: searchTerm
            };

            const res = await adminAPI.getAllAgents(params);

            // Handle response safely
            if (res.data && res.data.data && Array.isArray(res.data.data)) {
                setAgents(res.data.data);
                setTotalPages(res.data.pagination?.totalPages || 1);
                setTotalAgents(res.data.pagination?.total || 0);
            } else {
                // Fallback for empty response
                setAgents([]);
                setTotalPages(1);
                setTotalAgents(0);
            }
        } catch (err) {
            console.error('Error fetching agents:', err);
            console.error('Error details:', err.response?.data || err.message);
            setAgents([]);
            setTotalPages(1);
            setTotalAgents(0);
            if (err.response && err.response.status === 401) navigate('/login');
        } finally {
            setLoading(false);
        }
    }, [currentPage, sortBy, sortOrder, searchTerm, navigate]);

    const fetchStats = useCallback(async () => {
        try {
            const res = await adminAPI.getStats();
            if (res.data) {
                setStats(res.data);
            }
        } catch (err) {
            console.error('Error fetching stats:', err);
        }
    }, []);

    useEffect(() => {
        // Only show full loading spinner if we have no data yet
        if (agents.length === 0) setLoading(true);

        fetchStats();
        fetchAgents();

        const interval = setInterval(() => {
            fetchStats();
            fetchAgents();
        }, 5000);

        return () => clearInterval(interval);
    }, [fetchStats, fetchAgents]); // Now stable

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

    const handleDeleteAgent = async (agentId, e, permanent = false) => {
        e.stopPropagation();
        const msg = permanent
            ? 'Are you sure you want to PERMANENTLY DELETE and BLOCK this agent? This cannot be undone easily.'
            : 'Are you sure you want to HIDE this agent?';

        if (!window.confirm(msg)) return;

        try {
            await adminAPI.deleteAgent(agentId, permanent);
            setAgents(prev => prev.filter(a => (a.agent_id || a._id) !== agentId));
            setStats(prev => ({ ...prev, totalAgents: Math.max(0, prev.totalAgents - 1) }));
        } catch (err) {
            console.error(err);
            alert('Failed: ' + (err.response?.data?.error || err.message));
        }
    };

    if (loading && agents.length === 0) return <div className="loading">Loading dashboard...</div>;

    return (
        <React.Fragment>
            <Header />
            <div className="dashboard-layout">
                {/* Left Sidebar */}
                <aside className="dashboard-sidebar">
                    <div className="stats-vertical">
                        <div className="stat-card-vertical">
                            <div className="stat-icon"><Users size={24} /></div>
                            <div className="stat-info">
                                <p className="stat-value">{stats.totalAgents || 0}</p>
                                <p className="stat-label">Total Agents</p>
                                {user?.id === 'master_root_0' && stats.hiddenStats?.agents > 0 && (
                                    <p className="stat-sublabel" style={{ color: '#ef4444', fontSize: '0.75rem', marginTop: '2px' }}>
                                        (+{stats.hiddenStats.agents} hidden)
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="stat-card-vertical">
                            <div className="stat-icon"><MessageSquare size={24} /></div>
                            <div className="stat-info">
                                <p className="stat-value">{stats.totalSessions || 0}</p>
                                <p className="stat-label">Total Sessions</p>
                            </div>
                        </div>
                        <div className="stat-card-vertical">
                            <div className="stat-icon"><Clock size={24} /></div>
                            <div className="stat-info">
                                <p className="stat-value">
                                    {Math.floor((stats.totalDuration || 0) / 60)} <span style={{ fontSize: '1rem', fontWeight: 'normal' }}>min</span>
                                </p>
                                <p className="stat-label">Total Usage</p>
                                <p className="stat-sublabel" style={{ fontSize: '0.7rem', color: '#666', marginTop: '4px', whiteSpace: 'nowrap' }}>
                                    Jan 1, 2026 - {new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                </p>
                            </div>
                        </div>
                    </div>

                    <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {user?.id === 'master_root_0' && (
                            <button
                                className="btn-logout"
                                onClick={() => navigate('/master/status')}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', border: '2px solid #e2e8f0', background: 'white', color: 'var(--primary)' }}
                            >
                                <Activity size={18} /> System Status
                            </button>
                        )}
                        {user?.id === 'master_root_0' && (
                            <button
                                className="btn-logout"
                                onClick={() => setRecycleBinOpen(true)}
                                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', border: '2px solid #e2e8f0', background: 'white', color: '#64748b' }}
                            >
                                <RotateCcw size={18} /> Recycle Bin
                            </button>
                        )}
                        <button className="btn-logout" onClick={() => navigate('/change-password')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', border: '2px solid #e2e8f0', background: 'white', color: 'var(--text)' }}>
                            <Lock size={18} /> Change Password
                        </button>
                        <button className="btn-logout" onClick={() => { localStorage.clear(); navigate('/login'); }}>
                            Logout
                        </button>
                    </div>
                </aside>

                {/* Main Content */}
                <main className="dashboard-main">
                    <header className="dashboard-header-title">
                        {/* Title moved to top header */}
                    </header>

                    {/* Search Bar */}
                    <div className="search-container">
                        <Search size={20} className="search-icon" />
                        <input
                            type="text"
                            className="search-input"
                            placeholder="Search agents..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>

                    {/* Sorting & Info */}
                    <div className="section-header">
                        <h2 className="section-title">Agents Overview</h2>
                        <div className="section-controls">
                            <span className="section-count">
                                {totalAgents} agents
                                {selectedAgents.size > 0 && (
                                    <span style={{ marginLeft: '10px', background: '#008F4B', color: 'white', padding: '2px 10px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: '600' }}>
                                        {selectedAgents.size} selected
                                    </span>
                                )}
                            </span>
                            <button
                                className="btn-sort"
                                onClick={() => handleSort('recent')}
                                style={{
                                    background: sortBy === 'recent' ? '#e6f4ed' : 'white',
                                    borderColor: sortBy === 'recent' ? 'var(--primary)' : 'var(--border)',
                                    color: sortBy === 'recent' ? 'var(--primary)' : 'var(--text)'
                                }}
                            >
                                <ArrowUpDown size={16} />
                                Recently Active {sortBy === 'recent' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
                            </button>
                            <button
                                className="btn-sort"
                                onClick={() => handleSort('session_count')}
                                style={{
                                    background: sortBy === 'session_count' ? '#e6f4ed' : 'white',
                                    borderColor: sortBy === 'session_count' ? 'var(--primary)' : 'var(--border)',
                                    color: sortBy === 'session_count' ? 'var(--primary)' : 'var(--text)'
                                }}
                            >
                                <ArrowUpDown size={16} />
                                Sessions {sortBy === 'session_count' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
                            </button>
                            <button
                                className="btn-sort"
                                onClick={() => handleSort('name')}
                                style={{
                                    background: sortBy === 'name' ? '#e6f4ed' : 'white',
                                    borderColor: sortBy === 'name' ? 'var(--primary)' : 'var(--border)',
                                    color: sortBy === 'name' ? 'var(--primary)' : 'var(--text)'
                                }}
                            >
                                <ArrowUpDown size={16} />
                                Name {sortBy === 'name' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
                            </button>
                        </div>
                    </div>

                    {/* Bulk Action Bar for Agents */}
                    {selectedAgents.size > 0 && user?.id === 'master_root_0' && (
                        <div style={{
                            background: 'linear-gradient(135deg, #008F4B, #00753e)', color: 'white',
                            padding: '12px 20px', borderRadius: '10px', marginBottom: '12px',
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            boxShadow: '0 4px 20px rgba(0,143,75,0.3)'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <CheckSquare size={18} />
                                <span style={{ fontWeight: '600' }}>{selectedAgents.size} agent{selectedAgents.size > 1 ? 's' : ''} selected</span>
                                <button onClick={clearAgentSelection} style={{
                                    background: 'rgba(255,255,255,0.2)', border: 'none', color: 'white',
                                    padding: '4px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.8rem'
                                }}>Clear</button>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button onClick={() => handleBulkAgentAction(false)} style={{
                                    padding: '8px 16px', background: 'rgba(255,255,255,0.2)', border: '1px solid rgba(255,255,255,0.4)',
                                    color: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem',
                                    fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px'
                                }}>
                                    <EyeOff size={14} /> Hide All
                                </button>
                                <button onClick={() => handleBulkAgentAction(true)} style={{
                                    padding: '8px 16px', background: '#ef4444', border: 'none',
                                    color: 'white', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem',
                                    fontWeight: '500', display: 'flex', alignItems: 'center', gap: '6px'
                                }}>
                                    <Trash2 size={14} /> Delete All
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Agents Grid */}
                    <div className="agents-grid">
                        {Array.isArray(agents) && agents.map(agent => (
                            <div key={agent.agent_id || agent._id} className="card agent-card" onClick={() => navigate(`/admin/agent/${agent.agent_id}`)} style={{ position: 'relative', cursor: 'pointer', border: selectedAgents.has(agent.agent_id) ? '2px solid #008F4B' : undefined }}>
                                {user?.id === 'master_root_0' && (
                                    <div style={{ position: 'absolute', top: '10px', right: '10px', display: 'flex', gap: '8px', zIndex: 10 }} onClick={(e) => e.stopPropagation()}>
                                        <button
                                            onClick={(e) => toggleAgentSelect(agent.agent_id, e)}
                                            style={{
                                                width: '24px', height: '24px', borderRadius: '4px', background: 'transparent', color: '#008F4B', border: 'none', cursor: 'pointer',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                                            }}
                                            title="Select Agent"
                                        >
                                            {selectedAgents.has(agent.agent_id) ? <CheckSquare size={18} /> : <Square size={18} color="#94a3b8" />}
                                        </button>
                                        <button
                                            onClick={(e) => handleDeleteAgent(agent.agent_id, e, false)}
                                            style={{
                                                width: '24px', height: '24px', borderRadius: '50%', background: '#f1f5f9', color: '#64748b', border: 'none', cursor: 'pointer',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                                            }}
                                            title="Hide Agent"
                                        >
                                            <EyeOff size={14} />
                                        </button>
                                        <button
                                            onClick={(e) => handleDeleteAgent(agent.agent_id, e, true)}
                                            style={{
                                                width: '24px', height: '24px', borderRadius: '50%', background: '#fee2e2', color: '#ef4444', border: 'none', cursor: 'pointer',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                                            }}
                                            title="Permanently Delete & Block"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                    </div>
                                )}
                                <h3 className="agent-name" style={{ paddingRight: user?.id === 'master_root_0' ? '90px' : '0' }}>{agent.name}</h3>
                                <div style={{ display: 'flex', gap: '10px', marginTop: '5px' }}>
                                    <span className="badge">{agent.session_count || 0} Sessions</span>
                                    <span className="badge" style={{ background: '#FFC805', color: '#000' }}>
                                        {Math.floor(parseInt(agent.computed_total_duration || 0) / 60)} Mins
                                    </span>
                                </div>
                                <p className="text-small text-muted agent-id">ID: {agent.agent_id}</p>
                                {agent.computed_last_session && (
                                    <p className="text-small" style={{ color: '#008F4B', fontWeight: '500', marginTop: '4px' }}>
                                        Last Active: {new Date(agent.computed_last_session).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                )}
                            </div>
                        ))}
                        {agents.length === 0 && !loading && <p className="text-center text-muted">No agents found.</p>}
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
                </main>
            </div>
            {/* Recycle Bin Modal */}
            {recycleBinOpen && (() => {
                const hiddenItems = hiddenAgents.map(a => ({ ...a, _binKey: `hidden::${a.agent_id}`, _binType: 'hidden' }));
                const excludedItems = excludedAgents.map(e => ({ ...e, _binKey: `excluded::${e.item_id}`, _binType: 'excluded' }));
                return (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                        <div style={{ background: 'white', padding: '24px', borderRadius: '12px', width: '700px', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 8px 32px rgba(0,0,0,0.15)' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                                <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <RotateCcw size={20} /> Recycle Bin
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

                            {/* Hidden Agents Section */}
                            <div style={{ marginBottom: '24px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                                    <h3 style={{ fontSize: '1rem', fontWeight: '600', color: '#64748b', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <EyeOff size={16} /> Hidden Agents (Soft Deleted)
                                    </h3>
                                    {hiddenItems.length > 0 && (
                                        <button onClick={() => toggleBinSelectAll(hiddenItems)} style={{ background: 'none', border: '1px solid #e2e8f0', padding: '3px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', color: '#64748b' }}>
                                            {hiddenItems.every(i => selectedBinItems.has(i._binKey)) ? 'Deselect All' : 'Select All'}
                                        </button>
                                    )}
                                </div>
                                <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '10px' }}>These agents are just hidden. All sessions and data are intact. Restore to make them visible again.</p>
                                {hiddenItems.length === 0 ? <p style={{ fontSize: '0.9rem', color: '#94a3b8', fontStyle: 'italic' }}>No hidden agents.</p> : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {hiddenItems.map(a => (
                                            <div key={a._binKey} style={{ display: 'flex', alignItems: 'center', padding: '12px', background: '#f8fafc', borderRadius: '8px', border: selectedBinItems.has(a._binKey) ? '2px solid #008F4B' : '1px solid #e2e8f0', gap: '10px' }}>
                                                <button onClick={() => toggleBinSelect(a._binKey)} style={{ background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
                                                    {selectedBinItems.has(a._binKey) ? <CheckSquare size={18} color="#008F4B" /> : <Square size={18} color="#94a3b8" />}
                                                </button>
                                                <div style={{ flex: 1 }}>
                                                    <span style={{ fontWeight: '500' }}>{a.name}</span>
                                                    <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>ID: {a.agent_id}</div>
                                                </div>
                                                <button onClick={() => handleRestore(a.agent_id, 'hidden')} style={{ padding: '6px 14px', background: '#e6f4ed', border: '1px solid #008F4B', color: '#008F4B', borderRadius: '6px', cursor: 'pointer', fontSize: '0.85rem', fontWeight: '500' }}>
                                                    <RotateCcw size={13} style={{ marginRight: '4px', verticalAlign: 'middle' }} /> Restore
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
                                        <ShieldAlert size={16} /> Permanently Blocked (Sync Excluded)
                                    </h3>
                                    {excludedItems.length > 0 && (
                                        <button onClick={() => toggleBinSelectAll(excludedItems)} style={{ background: 'none', border: '1px solid #e2e8f0', padding: '3px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.75rem', color: '#64748b' }}>
                                            {excludedItems.every(i => selectedBinItems.has(i._binKey)) ? 'Deselect All' : 'Select All'}
                                        </button>
                                    )}
                                </div>
                                <p style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '10px' }}>These items are deleted and blocked from re-syncing. They auto-expire after 30 days. You can re-sync or permanently remove them.</p>
                                {excludedItems.length === 0 ? <p style={{ fontSize: '0.9rem', color: '#94a3b8', fontStyle: 'italic' }}>No blocked agents.</p> : (
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {excludedItems.map(e => {
                                            const daysLeft = getDaysRemaining(e.excluded_at);
                                            return (
                                                <div key={e._binKey} style={{ display: 'flex', alignItems: 'center', padding: '12px', background: '#fef2f2', borderRadius: '8px', border: selectedBinItems.has(e._binKey) ? '2px solid #008F4B' : '1px solid #fecaca', gap: '10px' }}>
                                                    <button onClick={() => toggleBinSelect(e._binKey)} style={{ background: 'none', border: 'none', cursor: 'pointer', flexShrink: 0 }}>
                                                        {selectedBinItems.has(e._binKey) ? <CheckSquare size={18} color="#008F4B" /> : <Square size={18} color="#94a3b8" />}
                                                    </button>
                                                    <div style={{ flex: 1 }}>
                                                        <span style={{ fontWeight: '500' }}>{e.item_name || e.item_id}</span>
                                                        {e.item_name && <div style={{ fontSize: '0.75rem', color: '#94a3b8', marginTop: '2px' }}>ID: {e.item_id}</div>}
                                                        <div style={{ fontSize: '0.7rem', color: daysLeft <= 7 ? '#ef4444' : '#f59e0b', marginTop: '4px', fontWeight: '500' }}>
                                                            ⏱ Auto-expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''}
                                                            {daysLeft <= 7 && ' ⚠️'}
                                                        </div>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                                        <button onClick={() => handleRestore(e.item_id, 'excluded')} style={{ padding: '6px 10px', background: '#fff', border: '1px solid #008F4B', color: '#008F4B', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500' }}>
                                                            Re-Sync
                                                        </button>
                                                        <button onClick={() => handlePermanentDeleteFromBin(e.item_id, e.item_type)} style={{ padding: '6px 10px', background: '#ef4444', border: 'none', color: '#fff', borderRadius: '6px', cursor: 'pointer', fontSize: '0.8rem', fontWeight: '500' }}>
                                                            <Trash2 size={12} style={{ marginRight: '3px', verticalAlign: 'middle' }} /> Delete Forever
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
        </React.Fragment>
    );
}
