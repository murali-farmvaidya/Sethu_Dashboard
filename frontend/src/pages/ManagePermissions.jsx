import { useState, useEffect } from 'react';
import api from '../api/client';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Check, X } from 'lucide-react';
import Header from '../components/Header';

export default function ManagePermissions() {
    const [users, setUsers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState({});
    const navigate = useNavigate();

    useEffect(() => {
        fetchData();
    }, []);

    const fetchData = async () => {
        try {
            setLoading(true);
            const [usersRes, agentsRes] = await Promise.all([
                api.get('/api/users?limit=1000'),
                api.get('/api/agents?limit=1000')
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
            await api.post(`/api/admin/users/${userId}/agents/${agentId}/mark-permission`, {
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
            alert('Failed to update permission. Please try again.');
            // Revert on error
            fetchData();
        } finally {
            setSaving(prev => ({ ...prev, [key]: false }));
        }
    };

    if (loading) {
        return <div className="loading">Loading permissions...</div>;
    }

    return (
        <>
            <Header />
            <div className="dashboard-layout">
                <aside className="dashboard-sidebar">
                    <div className="session-info-sidebar" style={{ flex: 1, padding: '1.5rem' }}>
                        <h3 style={{ marginBottom: '1rem', color: 'var(--primary)' }}>Mark Permissions</h3>
                        <p style={{ fontSize: '0.9rem', color: '#666', lineHeight: '1.6' }}>
                            Control which users can mark sessions as "Needs Review" or "Completed" for their assigned agents.
                        </p>
                        <div style={{ marginTop: '1.5rem', padding: '1rem', background: '#f8f9fa', borderRadius: '8px' }}>
                            <h4 style={{ fontSize: '0.85rem', color: '#444', marginBottom: '0.8rem' }}>How it Works</h4>
                            <ul style={{ fontSize: '0.8rem', color: '#666', lineHeight: '1.8', paddingLeft: '1.2rem' }}>
                                <li>Each user sees only their assigned agents</li>
                                <li>Toggle checkboxes to grant/revoke mark permissions</li>
                                <li>Changes apply immediately</li>
                                <li>Admins already have full permissions</li>
                            </ul>
                        </div>
                    </div>
                    <div className="sidebar-footer">
                        <button className="btn-logout" onClick={() => navigate('/admin/users')}>
                            <ArrowLeft size={18} style={{ marginRight: '8px' }} /> Back to Users
                        </button>
                    </div>
                </aside>

                <main className="dashboard-content">
                    <div className="page-header">
                        <h1>Manage Mark Permissions</h1>
                        <p style={{ color: '#666', marginTop: '0.5rem' }}>
                            {users.length} user{users.length !== 1 ? 's' : ''} with agent assignments
                        </p>
                    </div>

                    <div className="page-container" style={{ padding: '2rem' }}>
                        {users.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '3rem', color: '#666' }}>
                                No users found. Create regular users and assign them to agents first.
                            </div>
                        ) : (
                            <div style={{ width: '100%' }}>
                                <table style={{
                                    width: '100%',
                                    borderCollapse: 'collapse',
                                    background: 'white',
                                    borderRadius: '12px',
                                    overflow: 'hidden',
                                    boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
                                    fontSize: '1rem'
                                }}>
                                    <thead style={{ background: '#f8f9fa' }}>
                                        <tr>
                                            <th style={{ padding: '1.25rem 1.5rem', textAlign: 'left', fontWeight: '600', fontSize: '1.05rem', width: '20%', color: '#2c3e50' }}>User</th>
                                            <th style={{ padding: '1.25rem 1.5rem', textAlign: 'left', fontWeight: '600', fontSize: '1.05rem', width: '35%', color: '#2c3e50' }}>Assigned Agents</th>
                                            <th style={{ padding: '1.25rem 1.5rem', textAlign: 'left', fontWeight: '600', fontSize: '1.05rem', width: '45%', color: '#2c3e50' }}>Can Mark Permissions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {users.map(user => (
                                            <tr key={user.user_id} style={{ borderTop: '1px solid #dee2e6' }}>
                                                <td style={{ padding: '1.5rem', verticalAlign: 'top' }}>
                                                    <div style={{ fontWeight: '500', fontSize: '1rem', marginBottom: '0.4rem' }}>{user.email}</div>
                                                    <div style={{ fontSize: '0.85rem', color: '#666' }}>
                                                        {user.agentDetails.length} agent{user.agentDetails.length !== 1 ? 's' : ''}
                                                    </div>
                                                </td>
                                                <td style={{ padding: '1.5rem', verticalAlign: 'top' }}>
                                                    {user.agentDetails.length === 0 ? (
                                                        <span style={{ color: '#999', fontSize: '0.95rem' }}>No agents assigned</span>
                                                    ) : (
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.65rem' }}>
                                                            {user.agentDetails.map(agent => (
                                                                <span
                                                                    key={agent.agent_id}
                                                                    style={{
                                                                        padding: '0.5rem 1rem',
                                                                        background: '#e9ecef',
                                                                        borderRadius: '14px',
                                                                        fontSize: '0.95rem',
                                                                        color: '#495057',
                                                                        fontWeight: '500'
                                                                    }}
                                                                >
                                                                    {agent.name}
                                                                </span>
                                                            ))}
                                                        </div>
                                                    )}
                                                </td>
                                                <td style={{ padding: '1.5rem', verticalAlign: 'top' }}>
                                                    {user.agentDetails.length === 0 ? (
                                                        <span style={{ color: '#999', fontSize: '0.95rem' }}>-</span>
                                                    ) : (
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.85rem' }}>
                                                            {user.agentDetails.map(agent => {
                                                                const key = `${user.user_id}-${agent.agent_id}`;
                                                                const isSaving = saving[key];

                                                                return (
                                                                    <div
                                                                        key={agent.agent_id}
                                                                        style={{
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '0.65rem',
                                                                            padding: '0.65rem 1rem',
                                                                            background: agent.can_mark ? '#d4edda' : '#f8d7da',
                                                                            border: agent.can_mark ? '2px solid #28a745' : '2px solid #dc3545',
                                                                            borderRadius: '10px',
                                                                            fontSize: '0.95rem',
                                                                            minWidth: '140px',
                                                                            transition: 'all 0.2s'
                                                                        }}
                                                                    >
                                                                        <button
                                                                            onClick={() => togglePermission(user.user_id, agent.agent_id, agent.can_mark)}
                                                                            disabled={isSaving}
                                                                            style={{
                                                                                border: 'none',
                                                                                background: 'none',
                                                                                cursor: isSaving ? 'not-allowed' : 'pointer',
                                                                                opacity: isSaving ? 0.5 : 1,
                                                                                padding: '0',
                                                                                display: 'flex',
                                                                                alignItems: 'center'
                                                                            }}
                                                                            title={agent.can_mark ? 'Click to revoke permission' : 'Click to grant permission'}
                                                                        >
                                                                            {agent.can_mark ? (
                                                                                <Check size={20} color="#28a745" strokeWidth={3} />
                                                                            ) : (
                                                                                <X size={20} color="#dc3545" strokeWidth={3} />
                                                                            )}
                                                                        </button>
                                                                        <span style={{ color: '#2c3e50', fontWeight: '500' }}>{agent.name}</span>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                </main>
            </div>
        </>
    );
}
