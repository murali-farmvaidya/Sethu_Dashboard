import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { userAPI } from '../services/api';
import { Users, MessageSquare, Clock, Search, ArrowUpDown, ChevronLeft, ChevronRight, ChevronDown, ChevronUp, Lock } from 'lucide-react';

export default function UserDashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [searchTerm, setSearchTerm] = useState(searchParams.get('search') || '');
  const [sortBy, setSortBy] = useState(searchParams.get('sortBy') || 'sessionCount');
  const [sortOrder, setSortOrder] = useState(searchParams.get('sortOrder') || 'desc');
  const [currentPage, setCurrentPage] = useState(parseInt(searchParams.get('page')) || 1);
  const [totalPages, setTotalPages] = useState(1);
  const [itemsPerPage] = useState(10);

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

  useEffect(() => {
    loadDashboard();

    // Add real-time update polling (every 5 seconds)
    const interval = setInterval(() => {
      loadDashboard(true);
    }, 5000);

    return () => clearInterval(interval);
  }, [currentPage, searchTerm, sortBy, sortOrder]);

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

  const updatePage = (page) => {
    setCurrentPage(page);
    updateSearchParams({ page });
  };

  const loadDashboard = async (silent = false) => {
    try {
      if (!silent) setLoading(true);
      const response = await userAPI.getDashboard({
        page: currentPage,
        limit: itemsPerPage,
        search: searchTerm,
        sortBy,
        sortOrder
      });
      setDashboard(response.data);
      if (response.data.pagination) {
        setTotalPages(response.data.pagination.totalPages);
      }
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load dashboard');
    } finally {
      if (!silent) setLoading(false);
    }
  };

  if (loading) return <div className="loading">Loading dashboard...</div>;

  if (error) {
    return (
      <div className="error-container" style={{ padding: '20px', textAlign: 'center' }}>
        <h2>Error</h2>
        <p>{error}</p>
        <button onClick={loadDashboard} className="btn-primary">Retry</button>
      </div>
    );
  }

  const { agents = [], stats = {} } = dashboard || {};


  const handleSort = (field) => {
    const newOrder = sortBy === field ? (sortOrder === 'asc' ? 'desc' : 'asc') : 'desc';
    setSortBy(field);
    setSortOrder(newOrder);
    setCurrentPage(1);
    updateSearchParams({ sortBy: field, sortOrder: newOrder, page: 1 });
  };

  return (
    <div style={{ padding: '0 24px' }}>
      {/* Main Content */}
      <div className="dashboard-main-content" style={{ padding: '0', maxWidth: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginBottom: '24px' }}>
          <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>My Assigned Agents</span>
            <span style={{ fontSize: '28px', fontWeight: '800', color: 'var(--text)', marginTop: '8px' }}>{stats.totalAgents || 0}</span>
          </div>
          <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Sessions</span>
            <span style={{ fontSize: '28px', fontWeight: '800', color: 'var(--text)', marginTop: '8px' }}>{stats.totalSessions || 0}</span>
          </div>
          <div style={{ background: 'white', border: '1px solid var(--border)', borderRadius: '12px', padding: '20px', display: 'flex', flexDirection: 'column' }}>
            <span style={{ color: 'var(--text-muted)', fontSize: '13px', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Usage</span>
            <span style={{ fontSize: '28px', fontWeight: '800', color: 'var(--text)', marginTop: '8px' }}>{Math.floor((stats.totalDuration || 0) / 60).toLocaleString()} min</span>
            <span style={{ fontSize: '13px', fontWeight: '500', color: 'var(--text-muted)', marginTop: '8px' }}>Since Jan 1, 2026</span>
          </div>
        </div>

        <header className="dashboard-header-title">
          <h1>My Agents Dashboard</h1>
        </header>

        {/* Search Bar */}
        <div className="search-container">
          <Search size={20} className="search-icon" />
          <input
            type="text"
            className="search-input"
            placeholder="Search my agents..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>

        {/* Sorting & Info */}
        <div className="section-header">
          <h2 className="section-title">My Agents</h2>
          <div className="section-controls">
            <span className="section-count">{agents.length} agents</span>
            <button className="btn-sort" onClick={() => handleSort('sessionCount')}>
              <ArrowUpDown size={16} />
              Sessions {sortBy === 'sessionCount' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
            </button>
            <button className="btn-sort" onClick={() => handleSort('name')}>
              <ArrowUpDown size={16} />
              Name {sortBy === 'name' ? (sortOrder === 'desc' ? '↓' : '↑') : ''}
            </button>
          </div>
        </div>

        {/* Agents Grid */}
        <div className="agents-grid">
          {agents.map(agent => (
            <div
              key={agent.agentId}
              className="card agent-card"
              onClick={() => navigate(`/user/agent/${agent.agentId}`)}
            >
              <h3 className="agent-name">{agent.agentName}</h3>
              <span className="badge">{agent.stats.sessionCount} Sessions</span>
              <div style={{ marginTop: '8px', fontSize: '0.9rem', color: '#666' }}>
                {Math.round((agent.stats.totalDuration || 0) / 60)} Minutes
              </div>
              <p className="text-small text-muted agent-id" style={{ marginTop: 'auto' }}>ID: {agent.agentId}</p>
            </div>
          ))}
          {agents.length === 0 && <p className="text-center text-muted">No agents found.</p>}
        </div>

        {/* Pagination */}
        {
          totalPages > 1 && (
            <div className="pagination" style={{ marginTop: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '20px' }}>
              <button
                className="pagination-btn"
                onClick={() => updatePage(currentPage - 1)}
                disabled={currentPage === 1}
              >
                <ChevronLeft size={18} /> Prev
              </button>
              <div className="pagination-info">
                Page {currentPage} of {totalPages}
              </div>
              <button
                className="pagination-btn"
                onClick={() => updatePage(currentPage + 1)}
                disabled={currentPage === totalPages}
              >
                Next <ChevronRight size={18} />
              </button>
            </div>
          )
        }
      </div>
    </div>
  );
}
