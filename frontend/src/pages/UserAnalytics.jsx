import React, { useState, useEffect } from 'react';
import UsageGraph from '../components/UsageGraph';
import { useAuth } from '../context/AuthContext';
import { adminAPI } from '../services/api';
import { ArrowLeft, Users } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const UserAnalytics = () => {
    const { user, isAdmin } = useAuth();
    const navigate = useNavigate();
    const [selectedUserId, setSelectedUserId] = useState(user?.id);
    const [admins, setAdmins] = useState([]);
    const [loading, setLoading] = useState(false);

    const isSuperAdmin = user?.role === 'super_admin' || user?.isMaster;

    useEffect(() => {
        if (isSuperAdmin) {
            fetchAdmins();
        }
    }, [isSuperAdmin]);

    const fetchAdmins = async () => {
        try {
            setLoading(true);
            const res = await adminAPI.getUsers({ limit: 100 });
            if (res.data?.users) {
                // Filter only admins as requested
                const filtered = res.data.users.filter(u => u.role === 'admin' || u.role === 'super_admin');
                setAdmins(filtered);
            }
        } catch (e) {
            console.error('Failed to fetch admins:', e);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="page-container" style={{ maxWidth: 1000, margin: '0 auto' }}>
            {/* Page Header */}
            <div className="page-header" style={{ marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <button onClick={() => navigate(-1)} className="btn-back" style={{ background: 'var(--bg-secondary)', color: 'var(--text)', border: '1px solid var(--border)' }}>
                            <ArrowLeft size={16} /> Back
                        </button>
                        <h1 style={{ fontSize: '1.75rem', fontWeight: '800', color: 'var(--text)' }}>User Analytics</h1>
                    </div>

                    {isSuperAdmin && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <Users size={18} color="var(--text-muted)" />
                            <select
                                value={selectedUserId}
                                onChange={(e) => setSelectedUserId(e.target.value)}
                                style={{
                                    padding: '8px 12px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--border)',
                                    background: 'white',
                                    fontSize: '0.9rem',
                                    fontWeight: '600'
                                }}
                            >
                                <option value={user?.id}>My Analytics</option>
                                {admins.filter(a => a.user_id !== user?.id).map(a => (
                                    <option key={a.user_id} value={a.user_id}>
                                        {a.name || a.email} ({a.role})
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>
            </div>

            <div style={{ padding: '0 0 2rem' }}>
                <UsageGraph userId={selectedUserId} />
            </div>
        </div>
    );
};

export default UserAnalytics;
