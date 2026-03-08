import { useState, useEffect, useMemo } from 'react';
import toast from 'react-hot-toast';
import api from '../api/client';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Search, User, UserCheck, Shield } from 'lucide-react';

export default function ManagePermissions() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState({});
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedUserId, setSelectedUserId] = useState(null);
    const navigate = useNavigate();

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            setLoading(true);
            const [usersRes, agentsRes] = await Promise.all([
                api.get('users?limit=1000'),
                api.get('agents?limit=1000')
            ]);

            const allUsers = usersRes.data.users || [];
            const allAgents = agentsRes.data.data || [];

            // Filter to only regular users (not admins)
            const regularUsers = allUsers.filter(u => u.role === 'user');

            // Enrich users with agent details and can_mark status from agentPermissions
            const enrichedUsers = regularUsers.map(user => {
                const userAgents = (user.agents || []).map(agentId => {
                    const agent = allAgents.find(a => a.agent_id === agentId);
                    return {
                        agent_id: agentId,
                        name: agent?.name || agentId,
                        can_mark: user.agentPermissions?.[agentId] || false
                    };
                });

                return {
                    ...user,
                    agentDetails: userAgents
                };
            });

            setUsers(enrichedUsers);
            if (enrichedUsers.length > 0) {
                setSelectedUserId(enrichedUsers[0].user_id);
            }
        } catch (err) {
            console.error('Failed to fetch data:', err);
        } finally {
            setLoading(false);
        }
    };

    const togglePermission = async (userId, agentId, currentValue) => {
        const key = `${userId}-${agentId}`;
        setSaving(prev => ({ ...prev, [key]: true }));

        try {
            await api.post(`admin/users/${userId}/agents/${agentId}/mark-permission`, {
                canMark: !currentValue
            });

            // Update local state immediately (optimistic update)
            setUsers(prevUsers => prevUsers.map(user => {
                if (user.user_id === userId) {
                    return {
                        ...user,
                        agentDetails: user.agentDetails.map(agent =>
                            agent.agent_id === agentId
                                ? { ...agent, can_mark: !currentValue }
                                : agent
                        )
                    };
                }
                return user;
            }));

        } catch (err) {
            console.error('Failed to update permission:', err);
            toast.error('Failed to update permission. Please try again.');
            // Revert on error
            fetchData();
        } finally {
            setSaving(prev => ({ ...prev, [key]: false }));
        }
    };

    const filteredUsers = useMemo(() => {
        if (!searchTerm) return users;
        const lowerTerm = searchTerm.toLowerCase();
        return users.filter(u => u.email.toLowerCase().includes(lowerTerm));
    }, [users, searchTerm]);

    const selectedUser = useMemo(() => {
        return users.find(u => u.user_id === selectedUserId) || null;
    }, [users, selectedUserId]);

    if (loading) {
        return <div className="loading">Loading permissions...</div>;
    }

    return (
        <>
            <div className="permissions-split-page">
                {/* HEADERS */}
                <div className="page-header-container">
                    <button className="back-btn" onClick={() => navigate('/admin/users')}>
                        <ArrowLeft size={18} /> Back to Users
                    </button>
                    <div className="header-titles">
                        <h1>Manage Agent Permissions</h1>
                        <p>{users.length} assigned user{users.length !== 1 ? 's' : ''} total</p>
                    </div>
                </div>

                <div className="how-it-works-card">
                    <div className="how-it-works-header">
                        <Shield size={16} color="#008F4B" />
                        <h4>How Permissions Work</h4>
                    </div>
                    <p>Permissions define what this user is allowed to do for each specific agent assigned to them. Once granted, the changes take effect immediately without requiring a save button.</p>
                    <ul>
                        <li><strong>Mark Sessions:</strong> Grants the user the ability to review active/past chat sessions for this agent and manually mark them as "Needs Review" or "Completed" in their dashboard.</li>
                    </ul>
                </div>

                {/* SPLIT LAYOUT */}
                <div className="split-layout">
                    {/* LEFT PANE: User List */}
                    <div className="left-pane">
                        <div className="pane-header">
                            <div className="search-box">
                                <Search size={18} color="#94a3b8" />
                                <input
                                    type="text"
                                    placeholder="Search users..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                />
                            </div>
                        </div>

                        <div className="user-list">
                            {filteredUsers.length === 0 ? (
                                <div className="empty-list">No users match your search.</div>
                            ) : (
                                filteredUsers.map(user => (
                                    <div
                                        key={user.user_id}
                                        className={`list-item ${selectedUserId === user.user_id ? 'active' : ''}`}
                                        onClick={() => setSelectedUserId(user.user_id)}
                                    >
                                        <div className="item-icon">
                                            {selectedUserId === user.user_id ? <UserCheck size={20} color="#008F4B" /> : <User size={20} color="#64748b" />}
                                        </div>
                                        <div className="item-content">
                                            <div className="item-email">{user.email}</div>
                                            <div className="item-subtitle">
                                                {user.agentDetails.length} agent{user.agentDetails.length !== 1 ? 's' : ''}
                                            </div>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    </div>

                    {/* RIGHT PANE: Details & Toggles */}
                    <div className="right-pane">
                        {!selectedUser ? (
                            <div className="empty-details">
                                <Shield size={48} color="#cbd5e1" />
                                <h3>Select a User</h3>
                                <p>Choose a user from the left to manage their permissions.</p>
                            </div>
                        ) : (
                            <div className="details-content">
                                <div className="details-header">
                                    <div className="avatar-circle">
                                        {selectedUser.email.charAt(0).toUpperCase()}
                                    </div>
                                    <div>
                                        <h2>{selectedUser.email}</h2>
                                        <p>Manage all permissions for their assigned agents below.</p>
                                    </div>
                                </div>

                                <div className="toggles-container">
                                    {selectedUser.agentDetails.length === 0 ? (
                                        <div className="no-agents">This user has no assigned agents yet.</div>
                                    ) : (
                                        selectedUser.agentDetails.map(agent => {
                                            const key = `${selectedUser.user_id}-${agent.agent_id}`;
                                            const isSaving = saving[key];

                                            return (
                                                <div key={agent.agent_id} className="agent-permission-card">
                                                    <div className="agent-card-header">
                                                        <h4>{agent.name}</h4>
                                                    </div>

                                                    <div className="agent-card-permissions">
                                                        {/* Permission 1: Mark Sessions */}
                                                        <div className={`permission-item ${agent.can_mark ? 'granted' : ''}`}>
                                                            <div className="permission-info">
                                                                <span className="perm-name">Mark Sessions</span>
                                                                <span className="perm-desc">Allow user to mark sessions as Needs Review or Completed</span>
                                                            </div>
                                                            <label className="toggle-switch">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={agent.can_mark}
                                                                    onChange={() => togglePermission(selectedUser.user_id, agent.agent_id, agent.can_mark)}
                                                                    disabled={isSaving}
                                                                />
                                                                <span className="toggle-slider"></span>
                                                            </label>
                                                        </div>

                                                        {/* Future permissions (e.g., Export, Edit) can simply be added as more .permission-item divs here */}
                                                    </div>
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <style>{`
                .permissions-split-page {
                    max-width: 1400px;
                    margin: 0 auto;
                    padding: 32px 24px;
                    background-color: #f8fafc;
                    min-height: 100vh;
                    display: flex;
                    flex-direction: column;
                }

                .page-header-container {
                    margin-bottom: 24px;
                }

                .back-btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 8px;
                    background: none;
                    border: none;
                    color: #64748b;
                    font-weight: 500;
                    font-size: 15px;
                    cursor: pointer;
                    padding: 0;
                    margin-bottom: 16px;
                    transition: color 0.2s;
                }

                .back-btn:hover {
                    color: #0f172a;
                }

                .header-titles h1 {
                    font-size: 32px;
                    font-weight: 700;
                    color: #0f172a;
                    margin: 0 0 4px 0;
                }

                .header-titles p {
                    color: #64748b;
                    margin: 0;
                    font-size: 16px;
                }

                /* Layout */
                .split-layout {
                    display: flex;
                    gap: 24px;
                    height: calc(100vh - 160px);
                    min-height: 500px;
                }

                .left-pane {
                    width: 340px;
                    background: white;
                    border-radius: 16px;
                    border: 1px solid #e2e8f0;
                    display: flex;
                    flex-direction: column;
                    overflow: hidden;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                }

                .right-pane {
                    flex: 1;
                    background: white;
                    border-radius: 16px;
                    border: 1px solid #e2e8f0;
                    overflow-y: auto;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.05);
                    display: flex;
                    flex-direction: column;
                }

                /* Left Pane Elements */
                .pane-header {
                    padding: 16px;
                    border-bottom: 1px solid #e2e8f0;
                    background: #f8fafc;
                }

                .search-box {
                    display: flex;
                    align-items: center;
                    background: white;
                    border: 1px solid #cbd5e1;
                    padding: 8px 12px;
                    border-radius: 8px;
                    gap: 8px;
                }

                .search-box input {
                    border: none;
                    outline: none;
                    width: 100%;
                    font-size: 14px;
                    color: #334155;
                }

                .search-box input::placeholder {
                    color: #94a3b8;
                }

                .user-list {
                    flex: 1;
                    overflow-y: auto;
                }

                .empty-list {
                    padding: 32px 16px;
                    text-align: center;
                    color: #94a3b8;
                    font-size: 14px;
                }

                .list-item {
                    display: flex;
                    align-items: center;
                    padding: 16px;
                    border-bottom: 1px solid #f1f5f9;
                    cursor: pointer;
                    transition: background 0.2s;
                    gap: 12px;
                }

                .list-item:hover {
                    background: #f8fafc;
                }

                .list-item.active {
                    background: #f0fdf4;
                    border-left: 4px solid #008F4B;
                }

                .item-email {
                    font-weight: 500;
                    color: #1e293b;
                    font-size: 14px;
                    margin-bottom: 2px;
                    word-break: break-all;
                }

                .list-item.active .item-email {
                    color: #008F4B;
                    font-weight: 600;
                }

                .item-subtitle {
                    font-size: 12px;
                    color: #64748b;
                }

                /* Right Pane Elements */
                .empty-details {
                    flex: 1;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    color: #94a3b8;
                }

                .empty-details h3 {
                    margin: 16px 0 8px 0;
                    color: #475569;
                }

                .details-content {
                    padding: 32px;
                }

                .details-header {
                    display: flex;
                    align-items: center;
                    gap: 20px;
                    margin-bottom: 32px;
                    padding-bottom: 24px;
                    border-bottom: 1px solid #e2e8f0;
                }

                .avatar-circle {
                    width: 64px;
                    height: 64px;
                    border-radius: 50%;
                    background: linear-gradient(135deg, #008F4B 0%, #006837 100%);
                    color: white;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 28px;
                    font-weight: 600;
                }

                .details-header h2 {
                    margin: 0 0 8px 0;
                    color: #0f172a;
                    font-size: 24px;
                }

                .details-header p {
                    margin: 0;
                    color: #64748b;
                }

                .how-it-works-card {
                    background: #f0fdf4;
                    border: 1px solid #bbf7d0;
                    border-radius: 12px;
                    padding: 16px 20px;
                    margin-bottom: 24px;
                }

                .how-it-works-header {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 8px;
                }

                .how-it-works-header h4 {
                    margin: 0;
                    color: #166534;
                    font-size: 15px;
                    font-weight: 600;
                }

                .how-it-works-card p {
                    margin: 0 0 10px 0;
                    color: #15803d;
                    font-size: 13.5px;
                    line-height: 1.5;
                }

                .how-it-works-card ul {
                    margin: 0;
                    padding-left: 20px;
                    color: #166534;
                    font-size: 13.5px;
                    line-height: 1.5;
                }

                .how-it-works-card li {
                    margin-bottom: 4px;
                }
                .how-it-works-card li:last-child {
                    margin-bottom: 0;
                }

                .toggles-container {
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                }

                .no-agents {
                    color: #64748b;
                    font-style: italic;
                    background: #f8fafc;
                    padding: 24px;
                    border-radius: 8px;
                    text-align: center;
                }

                .agent-permission-card {
                    background: white;
                    border: 1px solid #e2e8f0;
                    border-radius: 12px;
                    overflow: hidden;
                    box-shadow: 0 1px 2px rgba(0,0,0,0.02);
                }

                .agent-card-header {
                    background: #f8fafc;
                    padding: 16px 20px;
                    border-bottom: 1px solid #e2e8f0;
                }

                .agent-card-header h4 {
                    margin: 0;
                    color: #0f172a;
                    font-size: 16px;
                    font-weight: 600;
                }

                .agent-card-permissions {
                    display: flex;
                    flex-direction: column;
                }

                .permission-item {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    padding: 16px 20px;
                    border-bottom: 1px solid #f1f5f9;
                    background: white;
                    transition: all 0.2s;
                }
                
                .permission-item:last-child {
                    border-bottom: none;
                }

                .permission-item.granted {
                    background: #f0fdf4;
                }

                .permission-info {
                    display: flex;
                    flex-direction: column;
                    gap: 4px;
                    padding-right: 24px;
                }

                .perm-name {
                    font-weight: 600;
                    color: #1e293b;
                    font-size: 15px;
                }

                .perm-desc {
                    font-size: 13px;
                    color: #64748b;
                }

                .permission-item.granted .perm-name {
                    color: #166534;
                }

                /* Toggle Switch Core CSS */
                .toggle-switch {
                    position: relative;
                    display: inline-block;
                    width: 48px;
                    height: 26px;
                    flex-shrink: 0;
                }
                .toggle-switch input {
                    opacity: 0;
                    width: 0;
                    height: 0;
                }
                .toggle-slider {
                    position: absolute;
                    cursor: pointer;
                    top: 0; left: 0; right: 0; bottom: 0;
                    background-color: #cbd5e1;
                    transition: .3s;
                    border-radius: 26px;
                }
                .toggle-slider:before {
                    position: absolute;
                    content: "";
                    height: 20px;
                    width: 20px;
                    left: 3px;
                    bottom: 3px;
                    background-color: white;
                    transition: .3s;
                    border-radius: 50%;
                    box-shadow: 0 1px 3px rgba(0,0,0,0.3);
                }
                .toggle-switch input:checked + .toggle-slider {
                    background-color: #008F4B;
                }
                .toggle-switch input:focus + .toggle-slider {
                    box-shadow: 0 0 0 2px rgba(0, 143, 75, 0.2);
                }
                .toggle-switch input:checked + .toggle-slider:before {
                    transform: translateX(22px);
                }
                .toggle-switch input:disabled + .toggle-slider {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                /* Responsiveness */
                @media (max-width: 800px) {
                    .split-layout {
                        flex-direction: column;
                        height: auto;
                    }
                    .left-pane {
                        width: 100%;
                        max-height: 300px;
                    }
                    .right-pane {
                        box-shadow: none;
                        border: none;
                        background: transparent;
                        padding: 0;
                    }
                    .details-content {
                        padding: 16px 0;
                    }
                }
            `}</style>
        </>
    );
}
