import { useState, useEffect, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { adminAPI, authAPI } from '../services/api';
import { Users, Plus, Edit2, Trash2, Power, Mail, UserPlus, ChevronDown, ChevronLeft, ChevronRight, X, Settings as SettingsIcon } from 'lucide-react';
import { useSearchParams, useNavigate } from 'react-router-dom';

export default function AdminUsers() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [users, setUsers] = useState([]);
  const [creators, setCreators] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', role: 'user', agents: [] });
  const [allAgents, setAllAgents] = useState([]);
  const [showEditAgentsModal, setShowEditAgentsModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [showAgentDropdown, setShowAgentDropdown] = useState(false);
  const [totalPages, setTotalPages] = useState(1);
  const [itemsPerPage] = useState(10);
  const [error, setError] = useState(null);
  const userCache = useRef({});
  const latestReqId = useRef(0);

  // Confirmation Modal State
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState({
    message: '',
    onConfirm: () => { },
    type: 'default' // 'default' or 'danger'
  });
  const [btnLoading, setBtnLoading] = useState(false);

  // Derive state from URL
  const activeTab = searchParams.get('tab') || 'user';
  const createdByFilter = searchParams.get('createdBy') || 'all';
  const currentPage = parseInt(searchParams.get('page')) || 1;

  const updateParam = (key, value) => {
    const newParams = new URLSearchParams(searchParams);
    if (value === 'all' || !value) newParams.delete(key);
    else newParams.set(key, value);

    // Always reset page when changing filters/tabs
    if (key !== 'page') newParams.delete('page');

    setSearchParams(newParams);
  };

  // 1. Initial Load (Auth Profile \u0026 Static Data)
  useEffect(() => {
    const startup = async () => {
      try {
        const [meRes, agentRes, creatorRes] = await Promise.all([
          authAPI.getProfile(),
          adminAPI.getAllAgents({ limit: 1000, simple: 'true' }),
          adminAPI.getCreators()
        ]);
        setCurrentUser(meRes.data.user);
        setAllAgents(agentRes.data.data || []);
        setCreators(creatorRes.data.creators || []);
      } catch (err) {
        console.error('Initialization error:', err);
        setError('Failed to initialize admin panel');
      } finally {
        setLoading(false);
      }
    };
    startup();
  }, []);

  // 2. Data Fetching (Users List)
  const loadUsers = useCallback(async (silent = false) => {
    const currentReqId = ++latestReqId.current;
    const cacheKey = `${activeTab}-${currentPage}-${createdByFilter}`;

    try {
      if (!silent) {
        // Try Cache First
        if (userCache.current[cacheKey]) {
          setUsers(userCache.current[cacheKey].users);
          setTotalPages(userCache.current[cacheKey].totalPages);
          setRefreshing(true);
          setLoading(false);
        } else {
          if (users.length === 0) setLoading(true);
          else setRefreshing(true);
        }
      }

      const response = await adminAPI.getUsers({
        page: currentPage,
        limit: itemsPerPage,
        role: activeTab,
        createdBy: createdByFilter
      });

      // Prevent race conditions (stale responses)
      if (currentReqId !== latestReqId.current) return;

      const newUsers = response.data.users;
      const newTotal = response.data.pagination ? response.data.pagination.totalPages : 1;

      setUsers(newUsers);
      setTotalPages(newTotal);

      // Update Cache
      userCache.current[cacheKey] = { users: newUsers, totalPages: newTotal };

    } catch (err) {
      if (currentReqId === latestReqId.current) {
        setError(err.response?.data?.error || 'Failed to load users');
      }
    } finally {
      if (currentReqId === latestReqId.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [currentPage, itemsPerPage, activeTab, createdByFilter, users.length]);

  useEffect(() => {
    loadUsers();

    const interval = setInterval(() => {
      loadUsers(true);
    }, 45000);

    return () => clearInterval(interval);
  }, [loadUsers]);


  const handleCreateUser = async (e) => {
    e.preventDefault();
    setBtnLoading(true);
    try {
      await adminAPI.createUser(newUser);
      setShowCreateModal(false);
      setShowAgentDropdown(false);
      setNewUser({ email: '', role: 'user', agents: [], subscription_expiry: '', minutes_balance: 0 });
      loadUsers(true);
      const creatorRes = await adminAPI.getCreators();
      setCreators(creatorRes.data.creators || []);
      toast.success('User created! Default password: Password123! (Mock Mode)');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to create user');
    } finally {
      setBtnLoading(false);
    }
  };

  const handleOpenEditAgents = (user) => {
    setEditingUser({
      ...user,
      agents: user.agents || [],
      low_balance_threshold: user.low_balance_threshold || 50,
      subscription_expiry: user.subscription_expiry ? new Date(user.subscription_expiry).toISOString().split('T')[0] : '',
      minutes_balance: user.minutes_balance || 0
    });
    setShowAgentDropdown(false);
    setShowEditAgentsModal(true);
  };

  const handleUpdateUser = async () => {
    setBtnLoading(true);
    try {
      await Promise.all([
        adminAPI.updateAgents(editingUser.user_id, editingUser.agents),
        adminAPI.updateUser(editingUser.user_id, {
          role: editingUser.role,
          low_balance_threshold: parseInt(editingUser.low_balance_threshold) || 50,
          subscription_expiry: editingUser.subscription_expiry || null,
          minutes_balance: parseFloat(editingUser.minutes_balance) || 0
        })
      ]);
      setShowEditAgentsModal(false);
      setShowAgentDropdown(false);
      loadUsers(true);
      toast.success('User updated successfully!');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Failed to update user');
    } finally {
      setBtnLoading(false);
    }
  };

  const toggleAgentInList = (agentId, isNewUser = false) => {
    if (isNewUser) {
      const currentAgents = [...newUser.agents];
      if (currentAgents.includes(agentId)) {
        setNewUser({ ...newUser, agents: currentAgents.filter(id => id !== agentId) });
      } else {
        setNewUser({ ...newUser, agents: [...currentAgents, agentId] });
      }
    } else {
      const currentAgents = [...editingUser.agents];
      if (currentAgents.includes(agentId)) {
        setEditingUser({ ...editingUser, agents: currentAgents.filter(id => id !== agentId) });
      } else {
        setEditingUser({ ...editingUser, agents: [...currentAgents, agentId] });
      }
    }
  };

  const handleToggleActive = (userId) => {
    const user = users.find(u => u.user_id === userId);
    const action = user?.is_active ? 'deactivate' : 'activate';

    setConfirmConfig({
      message: `Are you sure you want to ${action} user ${user?.email}?`,
      type: user?.is_active ? 'danger' : 'default',
      onConfirm: async () => {
        try {
          await adminAPI.toggleUserActive(userId);
          loadUsers(true);
          setShowConfirmModal(false);
        } catch (err) {
          toast.error(err.response?.data?.error || 'Failed to toggle user status');
        }
      }
    });
    setShowConfirmModal(true);
  };

  const handleDeleteUser = (userId, email) => {
    setConfirmConfig({
      message: `Are you sure you want to DELETE user ${email}? This action cannot be undone.`,
      type: 'danger',
      onConfirm: async () => {
        try {
          await adminAPI.deleteUser(userId);
          loadUsers(true);
          setShowConfirmModal(false);
        } catch (err) {
          toast.error(err.response?.data?.error || 'Failed to delete user');
        }
      }
    });
    setShowConfirmModal(true);
  };

  const handleSendReset = (userId, email) => {
    setConfirmConfig({
      message: `Send password reset email to ${email}?`,
      type: 'default',
      onConfirm: async () => {
        try {
          await adminAPI.sendPasswordReset(userId);
          toast.success('Password reset email sent!');
          setShowConfirmModal(false);
        } catch (err) {
          toast.error(err.response?.data?.error || 'Failed to send reset email');
        }
      }
    });
    setShowConfirmModal(true);
  };


  if (loading) {
    return (
      <>
        <div className="loading-container">
          <div className="spinner"></div>
          <p>Loading Admin Panel...</p>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="admin-users-page">
        <div className="page-header">
          <div>
            <h1><Users size={32} /> User Management {refreshing && <span className="refreshing-indicator">Updating...</span>}</h1>
            <p>Manage user accounts and permissions</p>
          </div>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={() => setShowCreateModal(true)} className="create-button">
              <Plus size={20} />
              Create User
            </button>
          </div>
        </div>

        {error && <div className="error-message">{error}</div>}

        <div className="admin-controls">
          {currentUser?.role === 'super_admin' && (
            <div className="tabs">
              <button
                className={`tab-btn ${activeTab === 'super_admin' ? 'active' : ''}`}
                onClick={() => updateParam('tab', 'super_admin')}
              >
                Super Admins
              </button>
              <button
                className={`tab-btn ${activeTab === 'admin' ? 'active' : ''}`}
                onClick={() => updateParam('tab', 'admin')}
              >
                Admins
              </button>
              <button
                className={`tab-btn ${activeTab === 'user' ? 'active' : ''}`}
                onClick={() => updateParam('tab', 'user')}
              >
                Users
              </button>
            </div>
          )}

          {currentUser?.role === 'super_admin' && (
            <div className="filters">
              <label>Filter by Creator:</label>
              <select value={createdByFilter} onChange={(e) => updateParam('createdBy', e.target.value)}>
                <option value="all">All Creators</option>
                {creators.map(c => (
                  <option key={c.user_id} value={c.user_id}>{c.email}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <div className="users-table-container">
          <table className="users-table">
            <thead>
              <tr>
                <th>Email</th>
                <th>Role</th>
                <th>Assigned Agents</th>
                <th>Status</th>
                <th>Created By</th>
                <th>Created Date</th>
                <th>Sub & Credits</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const canManage = currentUser?.role === 'super_admin' ||
                  (currentUser?.role === 'admin' && user.created_by === currentUser?.id) ||
                  (user.user_id === currentUser?.id);
                return (
                  <tr key={user.user_id}>
                    <td>
                      <div className="user-email">
                        {user.email}
                        {user.must_change_password && (
                          <span className="badge badge-warning">Must change password</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`role-badge role-${user.role}`}>
                        {user.role}
                      </span>
                    </td>

                    <td>
                      {user.role === 'super_admin' ? (
                        <span style={{ background: '#edf2f7', color: '#718096', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '600' }}>All Access</span>
                      ) : (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', maxWidth: '280px' }}>
                          {user.agents && user.agents.length > 0 ? (
                            user.agents.map(agentId => {
                              const agent = allAgents.find(a => a.agent_id === agentId);
                              return (
                                <span key={agentId} style={{ background: '#f0fdf4', color: '#166534', border: '1px solid #bbf7d0', padding: '2px 6px', borderRadius: '4px', fontSize: '11px', whiteSpace: 'nowrap' }}>
                                  {agent ? agent.name : 'Unknown'}
                                </span>
                              )
                            })
                          ) : (
                            <span style={{ color: '#cbd5e0', fontSize: '12px' }}>-</span>
                          )}
                        </div>
                      )}
                    </td>
                    <td>
                      <span className={`status-badge ${user.is_active ? 'active' : 'inactive'}`}>
                        {user.is_active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>
                      <div className="creator-info" title={user.created_by}>
                        {user.creator_email || (user.user_id === 'admin_1' ? 'System' : 'Unknown')}
                      </div>
                    </td>
                    <td>{new Date(user.created_at).toLocaleDateString()}</td>
                    <td>
                      <div className="creator-info" style={{ display: 'flex', flexDirection: 'column' }}>
                        <span>Exp: {user.subscription_expiry ? new Date(user.subscription_expiry).toLocaleDateString() : 'None'}</span>
                        <span style={{ color: '#008F4B', fontWeight: 'bold' }}>{parseFloat(user.minutes_balance || 0).toFixed(2)} Credits</span>
                      </div>
                    </td>
                    <td>
                      <div className="action-buttons">
                        <button
                          onClick={() => handleOpenEditAgents(user)}
                          className="action-btn"
                          title={!canManage ? "You only have permission to manage users you created" : "Edit User"}
                          disabled={!canManage}
                          style={{ cursor: !canManage ? 'not-allowed' : 'pointer', opacity: !canManage ? 0.5 : 1 }}
                        >
                          <Edit2 size={16} />
                        </button>
                        <button
                          onClick={() => handleToggleActive(user.user_id)}
                          className="action-btn"
                          title={!canManage ? "You only have permission to manage users you created" : (user.is_active ? 'Deactivate' : 'Activate')}
                          disabled={!canManage}
                          style={{ cursor: !canManage ? 'not-allowed' : 'pointer', opacity: !canManage ? 0.5 : 1 }}
                        >
                          <Power size={16} />
                        </button>
                        <button
                          onClick={() => handleSendReset(user.user_id, user.email)}
                          className="action-btn"
                          title={!canManage ? "You only have permission to manage users you created" : "Send password reset"}
                          disabled={!canManage}
                          style={{ cursor: !canManage ? 'not-allowed' : 'pointer', opacity: !canManage ? 0.5 : 1 }}
                        >
                          <Mail size={16} />
                        </button>
                        <button
                          onClick={() => handleDeleteUser(user.user_id, user.email)}
                          className="action-btn danger"
                          title={!canManage ? "You only have permission to manage users you created" : "Delete user"}
                          disabled={!canManage}
                          style={{ cursor: !canManage ? 'not-allowed' : 'pointer', opacity: !canManage ? 0.5 : 1 }}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {users.length === 0 && (
                <tr>
                  <td colSpan="8" className="text-center" style={{ padding: '40px', color: '#718096' }}>
                    No {activeTab.replace('_', ' ')}s found matching these criteria.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="pagination" style={{ marginTop: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '20px' }}>
            <button
              className="pagination-btn"
              onClick={() => updateParam('page', currentPage - 1)}
              disabled={currentPage === 1}
            >
              <ChevronLeft size={18} /> Prev
            </button>
            <div className="pagination-info">
              Page {currentPage} of {totalPages}
            </div>
            <button
              className="pagination-btn"
              onClick={() => updateParam('page', currentPage + 1)}
              disabled={currentPage === totalPages}
            >
              Next <ChevronRight size={18} />
            </button>
          </div>
        )}

        {/* Create User Modal */}
        {showCreateModal && (
          <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Create New User</h2>
              </div>
              <div className="modal-body">
                <form onSubmit={handleCreateUser}>
                  <div className="form-group">
                    <label>Email *</label>
                    <input
                      type="email"
                      value={newUser.email}
                      onChange={(e) => setNewUser({ ...newUser, email: e.target.value })}
                      required
                      placeholder="user@example.com"
                    />
                  </div>

                  <div className="form-group">
                    <label>Role *</label>
                    <select
                      value={newUser.role}
                      onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                    >
                      {currentUser?.role === 'super_admin' && (
                        <>
                          <option value="super_admin">Super Admin</option>
                          <option value="admin">Admin</option>
                        </>
                      )}
                      <option value="user">User</option>
                    </select>
                  </div>



                  <div className="form-group">
                    <label>Assign Agents</label>
                    <div className="custom-dropdown">
                      <div
                        className="dropdown-trigger"
                        onClick={() => setShowAgentDropdown(!showAgentDropdown)}
                        style={{ height: 'auto', minHeight: '42px', padding: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px' }}
                      >
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', flex: 1 }}>
                          {newUser.agents.length === 0 && <span style={{ color: '#a0aec0', paddingLeft: '8px', fontSize: '0.9rem' }}>Select Agents...</span>}
                          {newUser.agents.map(agentId => {
                            const agent = allAgents.find(a => a.agent_id === agentId);
                            return (
                              <span key={agentId} style={{ background: '#e6fffa', color: '#008F4B', border: '1px solid #b2f5ea', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                {agent ? agent.name : agentId}
                                <span
                                  onClick={(e) => { e.stopPropagation(); toggleAgentInList(agentId, true); }}
                                  style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '2px' }}
                                >
                                  <X size={12} />
                                </span>
                              </span>
                            );
                          })}
                        </div>
                        <ChevronDown size={18} className={showAgentDropdown ? 'rotate' : ''} style={{ color: '#a0aec0', marginLeft: '8px' }} />
                      </div>

                      {showAgentDropdown && (
                        <div className="dropdown-content">
                          <div className="agent-list">
                            {allAgents.map(agent => (
                              <label key={agent.agent_id} className="agent-checkbox-item">
                                <input
                                  type="checkbox"
                                  checked={newUser.agents.includes(agent.agent_id)}
                                  onChange={() => toggleAgentInList(agent.agent_id, true)}
                                />
                                <span>{agent.name}</span>
                              </label>
                            ))}
                            {allAgents.length === 0 && <p className="text-center p-2">No agents found.</p>}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {currentUser?.role === 'super_admin' && newUser.role !== 'user' && (
                    <>
                      <div className="form-group" style={{ marginTop: '15px' }}>
                        <label>Platform Access End Date (Optional)</label>
                        <input
                          type="date"
                          value={newUser.subscription_expiry || ''}
                          onChange={(e) => setNewUser({ ...newUser, subscription_expiry: e.target.value })}
                          title="If set, the user's platform access will expire on this date."
                        />
                      </div>
                      <div className="form-group">
                        <label>Grant Free Call Credits</label>
                        <input
                          type="number"
                          min="0"
                          value={newUser.minutes_balance || ''}
                          onChange={(e) => setNewUser({ ...newUser, minutes_balance: e.target.value })}
                          placeholder="e.g. 5000"
                          title="Give arbitrary free credits during creation."
                        />
                      </div>
                    </>
                  )}

                  {import.meta.env.DEV && (
                    <div style={{ margin: '1rem 0', padding: '0.75rem', backgroundColor: 'rgba(0, 143, 75, 0.05)', color: '#006837', borderRadius: '4px', fontSize: '0.85rem' }}>
                      <strong>Dev Mode:</strong> A random secure password is generated for the new user. Check console for password if no email is configured.
                    </div>
                  )}

                  <div className="modal-actions">
                    <button type="button" onClick={() => setShowCreateModal(false)} className="cancel-btn" disabled={btnLoading}>
                      Cancel
                    </button>
                    <button type="submit" className="submit-btn" disabled={btnLoading} style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: btnLoading ? 0.8 : 1 }}>
                      {btnLoading ? (
                        <><svg style={{ animation: 'spin 0.8s linear infinite', width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity="0.3" /><path d="M12 2a10 10 0 0 1 10 10" /></svg> Creating...</>
                      ) : 'Create User'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Edit Agents Modal */}
        {showEditAgentsModal && editingUser && (
          <div className="modal-overlay" onClick={() => setShowEditAgentsModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>✏️ Edit User: {editingUser.email}</h2>
              </div>
              <div className="modal-body">

                <div className="form-group">
                  <label>Role</label>
                  <select
                    value={editingUser.role}
                    onChange={(e) => setEditingUser({ ...editingUser, role: e.target.value })}
                    disabled={currentUser?.role !== 'super_admin'}
                    title={currentUser?.role !== 'super_admin' ? "Only Super Admins can change user roles" : ""}
                  >
                    {currentUser?.role === 'super_admin' && (
                      <>
                        <option value="super_admin">Super Admin</option>
                        <option value="admin">Admin</option>
                      </>
                    )}
                    <option value="user">User</option>
                  </select>
                </div>



                {editingUser.role !== 'user' && (
                  <div className="form-group">
                    <label>Low Balance Threshold (Credits)</label>
                    <input
                      type="number"
                      min="0"
                      value={editingUser.low_balance_threshold}
                      onChange={(e) => setEditingUser({ ...editingUser, low_balance_threshold: e.target.value })}
                      placeholder="100"
                      disabled={currentUser?.role !== 'super_admin'}
                      title={currentUser?.role !== 'super_admin' ? "Only Super Admins can change low balance threshold." : "Notify user when balance drops below this amount of credits."}
                    />
                  </div>
                )}

                <div className="form-group">
                  <label>Assigned Agents</label>
                  <div className="custom-dropdown">
                    <div
                      className="dropdown-trigger"
                      onClick={() => setShowAgentDropdown(!showAgentDropdown)}
                      style={{ height: 'auto', minHeight: '42px', padding: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px' }}
                    >
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', flex: 1 }}>
                        {editingUser.agents.length === 0 && <span style={{ color: '#a0aec0', paddingLeft: '8px', fontSize: '0.9rem' }}>Select Agents...</span>}
                        {editingUser.agents.map(agentId => {
                          const agent = allAgents.find(a => a.agent_id === agentId);
                          return (
                            <span key={agentId} style={{ background: '#e6fffa', color: '#008F4B', border: '1px solid #b2f5ea', padding: '2px 6px', borderRadius: '4px', fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '4px' }}>
                              {agent ? agent.name : agentId}
                              <span
                                onClick={(e) => { e.stopPropagation(); toggleAgentInList(agentId); }}
                                style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', padding: '2px' }}
                              >
                                <X size={12} />
                              </span>
                            </span>
                          );
                        })}
                      </div>
                      <ChevronDown size={18} className={showAgentDropdown ? 'rotate' : ''} style={{ color: '#a0aec0', marginLeft: '8px' }} />
                    </div>

                    {showAgentDropdown && (
                      <div className="dropdown-content">
                        <div className="agent-list">
                          {allAgents.map(agent => (
                            <label key={agent.agent_id} className="agent-checkbox-item">
                              <input
                                type="checkbox"
                                checked={editingUser.agents.includes(agent.agent_id)}
                                onChange={() => toggleAgentInList(agent.agent_id)}
                              />
                              <span>{agent.name}</span>
                            </label>
                          ))}
                          {allAgents.length === 0 && <p className="text-center p-2">No agents found.</p>}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {currentUser?.role === 'super_admin' && editingUser.role !== 'user' && (
                  <>
                    <div className="form-group" style={{ marginTop: '15px' }}>
                      <label>Platform Access End Date</label>
                      <input
                        type="date"
                        value={editingUser.subscription_expiry || ''}
                        onChange={(e) => setEditingUser({ ...editingUser, subscription_expiry: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label>Call Credits Balance</label>
                      <input
                        type="number"
                        min="0"
                        value={editingUser.minutes_balance || 0}
                        onChange={(e) => setEditingUser({ ...editingUser, minutes_balance: e.target.value })}
                        placeholder="e.g. 5000"
                      />
                    </div>
                  </>
                )}

                <div className="modal-actions">
                  <button type="button" onClick={() => setShowEditAgentsModal(false)} className="cancel-btn" disabled={btnLoading}>
                    Cancel
                  </button>
                  <button onClick={handleUpdateUser} className="submit-btn" disabled={btnLoading} style={{ display: 'flex', alignItems: 'center', gap: '8px', opacity: btnLoading ? 0.8 : 1 }}>
                    {btnLoading ? (
                      <><svg style={{ animation: 'spin 0.8s linear infinite', width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity="0.3" /><path d="M12 2a10 10 0 0 1 10 10" /></svg> Saving...</>
                    ) : 'Save Changes'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Generic Confirmation Modal */}
        {showConfirmModal && (
          <div className="modal-overlay" onClick={() => setShowConfirmModal(false)}>
            <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '420px', padding: 0 }}>
              <div className="modal-header" style={{ borderBottom: 'none', paddingBottom: '0' }}>
                <h2 style={{ color: confirmConfig.type === 'danger' ? '#e53e3e' : '#2d3748', fontSize: '1.4rem' }}>
                  {confirmConfig.type === 'danger' ? 'Confirm Action' : 'Please Confirm'}
                </h2>
              </div>
              <div className="modal-body" style={{ padding: '16px 28px', overflowY: 'visible' }}>
                <p style={{ margin: '0', fontSize: '15px', lineHeight: '1.6', color: '#4a5568', wordBreak: 'break-word' }}>
                  {confirmConfig.message}
                </p>
              </div>
              <div className="modal-actions" style={{ marginTop: 'auto', padding: '20px 28px', background: '#f8fafc', borderTop: '1px solid #e2e8f0', borderRadius: '0 0 12px 12px' }}>
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="cancel-btn"
                  disabled={btnLoading}
                >
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    setBtnLoading(true);
                    try { await confirmConfig.onConfirm(); } finally { setBtnLoading(false); }
                  }}
                  className={confirmConfig.type === 'danger' ? 'delete-btn' : 'submit-btn'}
                  disabled={btnLoading}
                  style={{
                    ...(confirmConfig.type === 'danger' ? { background: '#e53e3e', color: 'white', border: 'none', padding: '10px 20px', borderRadius: '6px', cursor: 'pointer', fontWeight: 600 } : {}),
                    display: 'flex', alignItems: 'center', gap: '8px', opacity: btnLoading ? 0.8 : 1
                  }}
                >
                  {btnLoading ? (
                    <><svg style={{ animation: 'spin 0.8s linear infinite', width: 16, height: 16 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="12" cy="12" r="10" strokeOpacity="0.3" /><path d="M12 2a10 10 0 0 1 10 10" /></svg> Processing...</>
                  ) : 'Confirm'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        .admin-users-page {
          max-width: 1400px;
          margin: 0 auto;
          padding: 32px 24px;
        }

        .page-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 32px;
        }

        .page-header h1 {
          display: flex;
          align-items: center;
          gap: 12px;
          font-size: 32px;
          font-weight: 700;
          color: #1a202c;
          margin: 0 0 8px 0;
        }

        .page-header p {
          color: #718096;
          margin: 0;
        }

        .admin-controls {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
          gap: 20px;
          flex-wrap: wrap;
        }

        .tabs {
          display: flex;
          background: #edf2f7;
          padding: 4px;
          border-radius: 8px;
          gap: 4px;
        }

        .tab-btn {
          padding: 8px 16px;
          border-radius: 6px;
          border: none;
          background: transparent;
          color: #4a5568;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .tab-btn.active {
          background: white;
          color: #008F4B;
          box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        }

        .filters {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .filters select {
          padding: 8px 12px;
          border-radius: 6px;
          border: 1px solid #e2e8f0;
          background: white;
          color: #2d3748;
          min-width: 200px;
        }

        .creator-info {
          font-size: 13px;
          color: #4a5568;
        }

        .create-button {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px 24px;
          background: linear-gradient(135deg, #008F4B 0%, #006837 100%);
          color: white;
          border: none;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
          transition: transform 0.2s;
        }

        .create-button:hover {
          transform: translateY(-2px);
        }

        .users-table-container {
          background: white;
          border-radius: 12px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          overflow: hidden;
        }

        .users-table {
          width: 100%;
          border-collapse: collapse;
        }

        .users-table thead {
          background: #f7fafc;
        }

        .users-table th {
          padding: 16px;
          text-align: left;
          font-weight: 600;
          color: #4a5568;
          font-size: 14px;
          border-bottom: 2px solid #e2e8f0;
        }

        .users-table td {
          padding: 16px;
          border-bottom: 1px solid #e2e8f0;
        }

        .users-table tbody tr:hover {
          background: #f7fafc;
        }

        .user-email {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .role-badge {
          display: inline-block;
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .role-admin {
          background: #e9d8fd;
          color: #553c9a;
        }

        .role-super_admin {
          background: #fed7d7;
          color: #c53030;
        }
        
        .role-user {
          background: #e2e8f0; 
          color: #4a5568;
        }

        .tier-badge {
          display: inline-block;
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 500;
          background: #e6fffa;
          color: #319795;
        }

        .status-badge {
          display: inline-block;
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
        }

        .status-badge.active {
          background: #c6f6d5;
          color: #276749;
        }

        .status-badge.inactive {
          background: #fed7d7;
          color: #c53030;
        }

        .badge-warning {
          background: #feebc8;
          color: #c05621;
          padding: 2px 8px;
          border-radius: 8px;
          font-size: 11px;
        }

        .text-center {
          text-align: center;
        }

        .action-buttons {
          display: flex;
          gap: 8px;
        }

        .action-btn {
          padding: 8px;
          background: #edf2f7;
          border: none;
          border-radius: 6px;
          cursor: pointer;
          transition: all 0.2s;
          color: #4a5568;
        }

        .action-btn:hover {
          background: #cbd5e0;
        }

        .action-btn.danger:hover {
          background: #fc8181;
          color: white;
        }

        /* Modal Styles */
        .modal-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.55);
          z-index: 1000;
          overflow-y: auto;
          padding: 0;
        }

        .modal-content {
          background: white;
          border-radius: 12px;
          width: 90%;
          max-width: 520px;
          max-height: none;
          overflow: hidden;
          display: flex;
          flex-direction: column;
          margin: 40px auto;
        }

        .modal-header {
          padding: 24px 28px 16px 28px;
          border-bottom: 2px solid #f0f4f8;
          position: sticky;
          top: 0;
          background: white;
          z-index: 2;
          border-radius: 12px 12px 0 0;
        }

        .modal-header h2 {
          margin: 0;
          color: #1a202c;
          font-size: 1.25rem;
          font-weight: 700;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .modal-body {
          overflow-y: auto;
          padding: 20px 28px 24px 28px;
          flex: 1;
        }

        .modal-content h2 {
          margin: 0 0 24px 0;
          color: #1a202c;
        }

        .form-group {
          margin-bottom: 20px;
        }

        .form-group label {
          display: block;
          margin-bottom: 8px;
          font-weight: 600;
          color: #2d3748;
        }

        .form-group input,
        .form-group select {
          width: 100%;
          padding: 12px;
          border: 2px solid #e2e8f0;
          border-radius: 8px;
          font-size: 16px;
        }

        .form-group input:focus,
        .form-group select:focus {
          outline: none;
          border-color: #008F4B;
        }

        .modal-actions {
          display: flex;
          gap: 12px;
          justify-content: flex-end;
          margin-top: 24px;
        }

        .cancel-btn {
          padding: 12px 24px;
          background: #edf2f7;
          border: none;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
        }

        .submit-btn {
          padding: 12px 24px;
          background: linear-gradient(135deg, #008F4B 0%, #006837 100%);
          color: white;
          border: none;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
        }

        .error-message {
          background: #fed7d7;
          color: #c53030;
          padding: 12px 16px;
          border-radius: 8px;
          margin-bottom: 20px;
        }

        .loading-container {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 60vh;
          gap: 16px;
        }

        .spinner {
          border: 4px solid #e2e8f0;
          border-top: 4px solid #008F4B;
          border-radius: 50%;
          width: 48px;
          height: 48px;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        .custom-dropdown {
          position: relative;
          width: 100%;
        }

        .dropdown-trigger {
          width: 100%;
          padding: 12px;
          border: 2px solid #e2e8f0;
          border-radius: 8px;
          background: white;
          display: flex;
          justify-content: space-between;
          align-items: center;
          cursor: pointer;
          font-size: 16px;
          color: #2d3748;
          transition: border-color 0.2s;
        }

        .dropdown-trigger:hover {
          border-color: #008F4B;
        }

        .dropdown-trigger .rotate {
          transform: rotate(180deg);
          transition: transform 0.2s;
        }

        .dropdown-content {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          margin-top: 4px;
          background: white;
          border: 2px solid #e2e8f0;
          border-radius: 8px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
          z-index: 10;
          max-height: 250px;
          overflow: hidden;
          display: flex;
          flex-direction: column;
        }

        .agent-list {
          overflow-y: auto;
          display: flex;
          flex-direction: column;
          padding: 8px;
        }

        .agent-checkbox-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 10px;
          border-radius: 6px;
          cursor: pointer;
          transition: background 0.2s;
        }

        .agent-checkbox-item:hover {
          background: #f7fafc;
        }

        .agent-checkbox-item input {
          width: 18px !important;
          height: 18px !important;
          cursor: pointer;
        }

        .agent-checkbox-item span {
          color: #2d3748;
          font-size: 14px;
          font-weight: 500;
        }

        .refreshing-indicator {
          font-size: 14px;
          font-weight: 500;
          color: #008F4B;
          background: rgba(0, 143, 75, 0.1);
          padding: 4px 12px;
          border-radius: 12px;
          margin-left: 12px;
          vertical-align: middle;
          animation: pulse 1.5s infinite;
        }

        @keyframes pulse {
          0% { opacity: 0.6; }
          50% { opacity: 1; }
          100% { opacity: 0.6; }
        }

        /* Mobile Responsiveness */
        @media (max-width: 768px) {
          .admin-users-page {
            padding: 16px;
          }

          .page-header {
            flex-direction: column;
            gap: 16px;
            margin-bottom: 24px;
          }

          .page-header h1 {
            font-size: 24px;
          }

          .admin-controls {
            flex-direction: column;
            align-items: stretch;
            gap: 12px;
          }

          .tabs {
            overflow-x: auto;
            white-space: nowrap;
            padding-bottom: 8px; /* space for scrollbar */
            max-width: 100%;
          }
          
          .tab-btn {
            flex-shrink: 0;
          }

          .filters {
            flex-direction: column;
            align-items: stretch;
          }

          .filters select {
            width: 100%;
            min-width: 0;
          }
          
          .create-button {
            justify-content: center;
          }
          
          /* Modal Mobile */
          .modal-content {
            width: 95%;
            padding: 20px;
            max-height: 85vh;
            overflow-y: auto;
          }

          .users-table-container {
            overflow-x: auto;
          }
           
          /* Table horizontal scroll */
          .users-table th, .users-table td {
            white-space: nowrap;
            padding: 12px 8px;
            font-size: 13px;
          }
        }
      `}</style>
    </>
  );
}
