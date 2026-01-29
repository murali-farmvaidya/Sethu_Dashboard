import { useEffect, useState, useCallback } from 'react';
import api from '../api/client';
import { useNavigate } from 'react-router-dom';
import { Users, MessageSquare, Clock, Search, ChevronLeft, ChevronRight, ArrowUpDown } from 'lucide-react';

const ITEMS_PER_PAGE = 10;

export default function Dashboard() {
    const [agents, setAgents] = useState([]);
    const [stats, setStats] = useState({ totalAgents: 0, totalSessions: 0, successRate: 0 });
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [totalPages, setTotalPages] = useState(1);
    const [totalAgents, setTotalAgents] = useState(0);
    const [sortBy, setSortBy] = useState('session_count');
    const [sortOrder, setSortOrder] = useState('desc');
    const navigate = useNavigate();

    const fetchAgents = useCallback(async () => {
        try {
            console.log('Fetching agents...');
            const params = new URLSearchParams({
                page: currentPage.toString(),
                limit: ITEMS_PER_PAGE.toString(),
                sortBy: sortBy,
                sortOrder: sortOrder,
                search: searchTerm
            });

            const url = `/api/agents?${params.toString()}`;

            const res = await api.get(url);

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
            const res = await api.get('/api/stats');
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

    if (loading && agents.length === 0) return <div className="loading">Loading dashboard...</div>;

    return (
        <div className="dashboard-layout">
            {/* Left Sidebar */}
            <aside className="dashboard-sidebar">
                <div className="sidebar-header">
                    <img src="/logo.png" alt="FarmVaidya" className="sidebar-logo" style={{ cursor: 'pointer' }} onClick={() => navigate('/')} />
                </div>

                <div className="stats-vertical">
                    <div className="stat-card-vertical">
                        <div className="stat-icon"><Users size={24} /></div>
                        <div className="stat-info">
                            <p className="stat-value">{stats.totalAgents || 0}</p>
                            <p className="stat-label">Total Agents</p>
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

                <div className="sidebar-footer">
                    <button className="btn-logout" onClick={() => { localStorage.clear(); navigate('/login'); }}>
                        Logout
                    </button>
                </div>
            </aside>

            {/* Main Content */}
            <main className="dashboard-main">
                <header className="dashboard-header">
                    <h1>Sethu Admin Dashboard</h1>
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
                        <button className="btn-sort" onClick={() => handleSort('session_count')}>
                            <ArrowUpDown size={16} />
                            Sessions {sortBy === 'session_count' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
                        </button>
                        <button className="btn-sort" onClick={() => handleSort('name')}>
                            <ArrowUpDown size={16} />
                            Name {sortBy === 'name' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
                        </button>
                    </div>
                </div>

                {/* Agents Grid */}
                <div className="agents-grid">
                    {Array.isArray(agents) && agents.map(agent => (
                        <div key={agent.agent_id || agent._id} className="card agent-card" onClick={() => navigate(`/agent/${agent.agent_id}`)}>
                            <h3 className="agent-name">{agent.name}</h3>
                            <span className="badge">{agent.session_count || 0} Sessions</span>
                            <p className="text-small text-muted agent-id">ID: {agent.agent_id}</p>
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
    );
}
