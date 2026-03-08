import React, { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Info, ArrowLeft } from 'lucide-react';

export default function Settings() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (user) {
            setLoading(false);
        }
    }, [user]);

    return (
        <div>
            <div style={{ maxWidth: '800px', margin: '0 auto', padding: '2rem 1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '2rem' }}>
                    <button
                        onClick={() => navigate(-1)}
                        style={{
                            background: 'none', border: '1px solid #e2e8f0', borderRadius: '8px',
                            padding: '8px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                            color: '#64748b'
                        }}
                    >
                        <ArrowLeft size={18} />
                    </button>
                    <div>
                        <h1 style={{ margin: 0, fontSize: '1.5rem', color: '#1a1a1a' }}>My Account</h1>
                        <p style={{ margin: '4px 0 0', fontSize: '0.85rem', color: '#94a3b8' }}>
                            View your profile and account details
                        </p>
                    </div>
                </div>

                {loading ? (
                    <div style={{ textAlign: 'center', padding: '3rem', color: '#94a3b8' }}>
                        <div className="spin" style={{ marginBottom: '1rem' }}>⌛</div>
                        <p>Loading profile...</p>
                    </div>
                ) : (
                    <div style={{
                        background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0',
                        padding: '2rem', marginBottom: '1.5rem',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.04)'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1.5rem' }}>
                            <Info size={22} color="var(--primary)" />
                            <h2 style={{ margin: 0, fontSize: '1.15rem', color: '#1f2937' }}>Profile Information</h2>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '1.5rem' }}>
                            <div>
                                <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>Email Address</div>
                                <div style={{ fontSize: '1rem', fontWeight: '600', color: '#1e293b' }}>{user?.email || 'N/A'}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>User Role</div>
                                <div style={{ display: 'inline-block', fontSize: '0.75rem', fontWeight: '800', padding: '4px 10px', background: '#f1f5f9', borderRadius: '20px', color: '#475569', textTransform: 'uppercase' }}>
                                    {user?.role || 'User'}
                                </div>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>Account ID</div>
                                <div style={{ fontSize: '0.9rem', fontFamily: 'monospace', color: '#64748b' }}>{user?.id || 'N/A'}</div>
                            </div>
                            <div>
                                <div style={{ fontSize: '0.75rem', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>Credits Balance</div>
                                <div style={{ fontSize: '1rem', fontWeight: '700', color: 'var(--primary)' }}>{parseFloat(user?.minutes_balance || 0).toFixed(2)} Minutes</div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
