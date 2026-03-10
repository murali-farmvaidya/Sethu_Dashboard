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
        <div className="page-container" style={{ width: '100%', maxWidth: '100%', margin: '0' }}>
            {/* Page Header */}
            <div className="page-header" style={{ marginBottom: '0.25rem', padding: '0 0.5rem', height: '36px', display: 'flex', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', width: '100%' }}>
                    <button onClick={() => navigate(-1)} style={{ background: 'none', border: '1px solid var(--border)', borderRadius: '6px', padding: '4px 8px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.8rem' }}>
                        <ArrowLeft size={12} /> Back
                    </button>

                    <h1 style={{ fontSize: '1rem', fontWeight: '800', color: 'var(--text)', margin: 0 }}>Analytics</h1>

                    <div style={{ flex: 1 }}></div>

                    {isSuperAdmin && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#f8fafc', padding: '2px 8px', borderRadius: '8px', border: '1px solid var(--border)' }}>
                            <Users size={12} color="var(--text-muted)" />
                            <select
                                value={selectedUserId}
                                onChange={(e) => setSelectedUserId(e.target.value)}
                                style={{
                                    border: 'none', background: 'transparent',
                                    fontSize: '0.75rem', fontWeight: '700', outline: 'none', cursor: 'pointer'
                                }}
                            >
                                <option value={user?.id}>My Analytics</option>
                                {admins.filter(a => a.user_id !== user?.id).map(a => (
                                    <option key={a.user_id} value={a.user_id}>
                                        {a.name || a.email.split('@')[0]}
                                    </option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>
            </div>

            <div style={{ padding: '0' }}>
                <UsageGraph userId={selectedUserId} />
            </div>
        </div>
    );
};

export default UserAnalytics;
