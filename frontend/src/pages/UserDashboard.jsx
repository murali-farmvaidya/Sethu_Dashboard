import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { userAPI } from '../services/api';
import { Users, MessageSquare, Clock, Search, ArrowUpDown, ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import Header from '../components/Header';

export default function UserDashboard() {
  const [dashboard, setDashboard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortBy, setSortBy] = useState('sessionCount');
  const [sortOrder, setSortOrder] = useState('desc');
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [itemsPerPage] = useState(10);
  const navigate = useNavigate();

  useEffect(() => {
    loadDashboard();

    // Add real-time update polling (every 5 seconds)
    const interval = setInterval(() => {
      loadDashboard(true);
    }, 5000);

    return () => clearInterval(interval);
  }, [currentPage, searchTerm, sortBy, sortOrder]);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchTerm, sortBy, sortOrder]);

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
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('desc');
    }
  };

  return (
    <>
      <Header />
      <div className="dashboard-layout">
        {/* Left Sidebar */}
        <aside className="dashboard-sidebar">
          <div className="sidebar-header">
            <img src="/logo.png" alt="FarmVaidya" className="sidebar-logo" style={{ cursor: 'pointer', maxWidth: '100%' }} onClick={() => navigate('/user/dashboard')} />
          </div>

          <div className="stats-vertical">
            <div className="stat-card-vertical">
              <div className="stat-icon"><Users size={24} /></div>
              <div className="stat-info">
                <p className="stat-value">{stats.totalAgents || 0}</p>
                <p className="stat-label">Assigned Agents</p>
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
                  {Math.round((stats.totalDuration || 0) / 60)} <span style={{ fontSize: '1rem', fontWeight: 'normal' }}>min</span>
                </p>
                <p className="stat-label">Total Duration</p>
                <p className="stat-sublabel" style={{ fontSize: '0.7rem', color: '#666', marginTop: '4px', whiteSpace: 'nowrap' }}>
                  Jan 1, 2026 - Now
                </p>
              </div>
            </div>
          </div>

          <div className="sidebar-footer" style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <button className="btn-logout" onClick={() => navigate('/change-password')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', border: '2px solid #e2e8f0', background: 'white', color: 'var(--text)' }}>
              <Lock size={18} /> Change Password
            </button>
            <button className="btn-logout" onClick={() => navigate('/login')}>
              Logout
            </button>
          </div>
        </aside>

        {/* Main Content */}
        <main className="dashboard-main">
          <header className="dashboard-header-title">
            <h1>My Dashboard</h1>
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
          {totalPages > 1 && (
            <div className="pagination" style={{ marginTop: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '20px' }}>
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
    </>
  );
}
