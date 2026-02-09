import React, { useEffect, useState, useCallback } from 'react';
import { adminAPI } from '../services/api';
import { useNavigate } from 'react-router-dom';
import { Users, MessageSquare, Clock, Search, ChevronLeft, ChevronRight, ArrowUpDown, Lock, Trash2, Activity, RotateCcw, ShieldAlert, X, EyeOff } from 'lucide-react';
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
        if (recycleBinOpen) fetchRecycleBin();
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
            alert('Restore failed');
        }
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
                            <span className="section-count">{totalAgents} agents</span>
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

                    {/* Agents Grid */}
                    <div className="agents-grid">
                        {Array.isArray(agents) && agents.map(agent => (
                            <div key={agent.agent_id || agent._id} className="card agent-card" onClick={() => navigate(`/admin/agent/${agent.agent_id}`)} style={{ position: 'relative' }}>
                                {user?.id === 'master_root_0' && (
                                    <div style={{ position: 'absolute', top: '10px', right: '10px', display: 'flex', gap: '5px', zIndex: 10 }}>
                                        <div
                                            onClick={(e) => handleDeleteAgent(agent.agent_id, e, false)}
                                            style={{
                                                padding: '6px', borderRadius: '50%', background: '#f1f5f9', color: '#64748b', cursor: 'pointer',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                                            }}
                                            title="Hide Agent"
                                        >
                                            <EyeOff size={14} />
                                        </div>
                                        <div
                                            onClick={(e) => handleDeleteAgent(agent.agent_id, e, true)}
                                            style={{
                                                padding: '6px', borderRadius: '50%', background: '#fee2e2', color: '#ef4444', cursor: 'pointer',
                                                display: 'flex', alignItems: 'center', justifyContent: 'center'
                                            }}
                                            title="Permanently Delete & Block"
                                        >
                                            <Trash2 size={14} />
                                        </div>
                                    </div>
                                )}
                                <h3 className="agent-name" style={{ paddingRight: user?.id === 'master_root_0' ? '30px' : '0' }}>{agent.name}</h3>
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
            {recycleBinOpen && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                    <div style={{ background: 'white', padding: '20px', borderRadius: '12px', width: '600px', maxHeight: '80vh', overflowY: 'auto', boxShadow: '0 4px 6px rgba(0,0,0,0.1)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <h2 style={{ fontSize: '1.2rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                <RotateCcw size={20} /> Recycle Bin
                            </h2>
                            <button onClick={() => setRecycleBinOpen(false)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
                        </div>

                        <div style={{ marginBottom: '20px' }}>
                            <h3 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '10px', color: '#64748b' }}>Hidden Agents (Soft Deleted)</h3>
                            {hiddenAgents.length === 0 ? <p style={{ fontSize: '0.9rem', color: '#94a3b8' }}>No hidden agents found.</p> : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {hiddenAgents.map(a => (
                                        <div key={a.agent_id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', background: '#f8fafc', borderRadius: '6px' }}>
                                            <span>{a.name} <small style={{ color: '#94a3b8' }}>({a.agent_id})</small></span>
                                            <button onClick={() => handleRestore(a.agent_id, 'hidden')} style={{ padding: '4px 12px', background: '#fff', border: '1px solid #cbd5e1', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}>Restore</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div>
                            <h3 style={{ fontSize: '1rem', fontWeight: '600', marginBottom: '10px', color: '#ef4444' }}>Permanently Blocked (Sync Excluded)</h3>
                            {excludedAgents.length === 0 ? <p style={{ fontSize: '0.9rem', color: '#94a3b8' }}>No blocked agents.</p> : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {excludedAgents.map(e => (
                                        <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', background: '#fef2f2', borderRadius: '6px' }}>
                                            <span>{e.item_name || e.item_id} <small style={{ color: '#94a3b8' }}>({e.item_id})</small></span>
                                            <button onClick={() => handleRestore(e.item_id, 'excluded')} style={{ padding: '4px 12px', background: '#fff', border: '1px solid #fecaca', color: '#ef4444', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85rem' }}>Unblock & Re-Sync</button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </React.Fragment>
    );
}
