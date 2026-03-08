import React, { useState, useEffect } from 'react';
import toast from 'react-hot-toast';
import { settingsAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { Gauge, Megaphone, Phone, Info, Lock, Unlock, RefreshCw, Save, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function SystemSettings() {
    const { user: currentUser } = useAuth();
    const navigate = useNavigate();
    const [settings, setSettings] = useState({
        total_throttle_cpm: 4,
        campaign_throttle_cpm: 2,
        calls_throttle_cpm: 2,
    });
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [totalLocked, setTotalLocked] = useState(true);
    const [lastUpdate, setLastUpdate] = useState(null);

    const fetchSettings = async () => {
        try {
            setLoading(true);
            const res = await settingsAPI.getSettings();
            if (res.data?.settings) {
                const s = res.data.settings;
                setSettings({
                    total_throttle_cpm: parseInt(s.total_throttle_cpm?.value) || 4,
                    campaign_throttle_cpm: parseInt(s.campaign_throttle_cpm?.value) || 2,
                    calls_throttle_cpm: parseInt(s.calls_throttle_cpm?.value) || 2,
                });
                const times = Object.values(s).map(v => v.updatedAt).filter(Boolean);
                if (times.length > 0) {
                    setLastUpdate(new Date(Math.max(...times.map(t => new Date(t)))).toLocaleString());
                }
            }
        } catch (err) {
            console.error('Failed to load settings:', err);
            toast.error('Failed to load system settings');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (currentUser?.role === 'super_admin' || currentUser?.id === 'master_root_0') {
            fetchSettings();
        } else {
            navigate('/admin/dashboard');
        }
    }, [currentUser, navigate]);

    const handleSave = async () => {
        const total = parseInt(settings.total_throttle_cpm);
        const campaign = parseInt(settings.campaign_throttle_cpm);
        const calls = parseInt(settings.calls_throttle_cpm);

        if (total < 1 || campaign < 0 || calls < 0 || (campaign + calls > total)) {
            toast.error('Invalid line allocation. Check your math!');
            return;
        }

        try {
            setSaving(true);
            await settingsAPI.updateSettings(settings);
            toast.success('System settings updated successfully!');
            fetchSettings();
        } catch (err) {
            toast.error('Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    const remaining = settings.total_throttle_cpm - settings.campaign_throttle_cpm - settings.calls_throttle_cpm;

    if (loading) {
        return (
            <div className="loading-container">
                <div className="spinner"></div>
                <p>Loading System Configuration...</p>
            </div>
        );
    }

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '2.5rem' }}>
                <button
                    onClick={() => navigate(-1)}
                    style={{
                        background: 'none', border: '1px solid #e2e8f0', borderRadius: '8px',
                        padding: '10px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                        color: '#64748b'
                    }}
                >
                    <ArrowLeft size={20} />
                </button>
                <div>
                    <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: '800', color: '#1a202c' }}>System Configuration</h1>
                    <p style={{ margin: '4px 0 0', color: '#718096', fontSize: '0.95rem' }}>Manage global call line allocations and system capacity</p>
                </div>
            </div>

            <div style={{
                background: 'white', borderRadius: '20px', border: '1px solid #e2e8f0',
                padding: '2.5rem', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.05), 0 2px 4px -1px rgba(0, 0, 0, 0.03)'
            }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '2rem' }}>
                    <div style={{ background: 'rgba(0, 143, 75, 0.1)', padding: '10px', borderRadius: '12px' }}>
                        <Gauge size={24} color="#008F4B" />
                    </div>
                    <h2 style={{ margin: 0, fontSize: '1.25rem', color: '#1a202c', fontWeight: '700' }}>Active Call Lines Distribution</h2>
                </div>

                <div style={{
                    background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px',
                    padding: '16px 20px', marginBottom: '2.5rem', display: 'flex', gap: '12px', alignItems: 'flex-start'
                }}>
                    <div style={{ marginTop: '2px' }}><Info size={20} color="#16a34a" /></div>
                    <div style={{ fontSize: '0.95rem', color: '#166534', lineHeight: '1.6' }}>
                        This configuration controls the <strong>maximum concurrent calls</strong> the entire system can handle at once.
                        Allocate lines between campaigns (scheduled/batch) and direct agent calls.
                    </div>
                </div>

                <div style={{
                    background: totalLocked ? '#f8fafc' : '#ffffff', border: '2px solid',
                    borderColor: totalLocked ? '#e2e8f0' : '#008F4B',
                    borderRadius: '16px', padding: '2rem', marginBottom: '2rem',
                    transition: 'all 0.2s'
                }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            {totalLocked ? <Lock size={18} color="#64748b" /> : <Unlock size={18} color="#008F4B" />}
                            <label style={{ fontWeight: '700', fontSize: '1rem', color: totalLocked ? '#64748b' : '#1a202c' }}>Total System Capacity (Lines)</label>
                        </div>
                        <button
                            onClick={() => setTotalLocked(!totalLocked)}
                            style={{
                                background: totalLocked ? '#f1f5f9' : '#008F4B',
                                border: 'none', borderRadius: '6px',
                                padding: '6px 12px', cursor: 'pointer',
                                color: totalLocked ? '#475569' : 'white',
                                fontSize: '0.75rem', fontWeight: 'bold',
                                textTransform: 'uppercase', letterSpacing: '0.5px'
                            }}
                        >
                            {totalLocked ? 'Unlock to Scale' : 'Lock Capacity'}
                        </button>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
                        <input
                            type="number"
                            value={settings.total_throttle_cpm}
                            onChange={e => {
                                const val = parseInt(e.target.value) || 0;
                                const half = Math.floor(val / 2);
                                setSettings({ ...settings, total_throttle_cpm: val, campaign_throttle_cpm: half, calls_throttle_cpm: val - half });
                            }}
                            disabled={totalLocked}
                            style={{
                                width: '120px', padding: '12px', fontSize: '1.5rem', fontWeight: '800',
                                border: '1px solid #e2e8f0', borderRadius: '10px',
                                background: totalLocked ? '#f1f5f9' : '#fff', textAlign: 'center',
                                color: totalLocked ? '#64748b' : '#008F4B'
                            }}
                        />
                        {!totalLocked && <span style={{ color: '#008F4B', fontSize: '0.85rem', fontWeight: '600' }}>← Modify system-wide limit</span>}
                    </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '2rem', marginBottom: '2.5rem' }}>
                    <div style={{
                        background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '16px',
                        padding: '1.75rem', position: 'relative'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                            <Megaphone size={20} color="#d97706" />
                            <label style={{ fontWeight: '700', color: '#92400e', fontSize: '1rem' }}>Campaign Allotment</label>
                        </div>
                        <input
                            type="number"
                            value={settings.campaign_throttle_cpm}
                            onChange={e => setSettings({ ...settings, campaign_throttle_cpm: parseInt(e.target.value) || 0 })}
                            style={{
                                width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #fde68a',
                                fontSize: '1.25rem', fontWeight: '700', color: '#92400e'
                            }}
                        />
                        <p style={{ marginTop: '10px', fontSize: '0.8rem', color: '#b45309' }}>Lines dedicated to automated campaigns</p>
                    </div>

                    <div style={{
                        background: '#eff6ff', border: '1px solid #bfdbfe', borderRadius: '16px',
                        padding: '1.75rem', position: 'relative'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
                            <Phone size={20} color="#2563eb" />
                            <label style={{ fontWeight: '700', color: '#1e40af', fontSize: '1rem' }}>Direct Call Allotment</label>
                        </div>
                        <input
                            type="number"
                            value={settings.calls_throttle_cpm}
                            onChange={e => setSettings({ ...settings, calls_throttle_cpm: parseInt(e.target.value) || 0 })}
                            style={{
                                width: '100%', padding: '12px', borderRadius: '10px', border: '1px solid #bfdbfe',
                                fontSize: '1.25rem', fontWeight: '700', color: '#1e40af'
                            }}
                        />
                        <p style={{ marginTop: '10px', fontSize: '0.8rem', color: '#1d4ed8' }}>Lines dedicated to direct agent dialling</p>
                    </div>
                </div>

                <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '1.5rem 0 0 0', borderTop: '1px solid #f1f5f9'
                }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontWeight: '500' }}>
                            {remaining === 0 ? '✓ All lines allocated' :
                                remaining > 0 ? `⚠ ${remaining} lines unallocated` :
                                    `✘ Over-allocated by ${Math.abs(remaining)} lines!`}
                        </span>
                        {lastUpdate && <span style={{ fontSize: '0.75rem', color: '#cbd5e0' }}>Last synced: {lastUpdate}</span>}
                    </div>

                    <button
                        onClick={handleSave}
                        disabled={saving || remaining < 0}
                        className="submit-btn"
                        style={{
                            display: 'flex', alignItems: 'center', gap: '10px',
                            padding: '14px 40px', fontSize: '1rem', borderRadius: '12px',
                            boxShadow: '0 10px 15px -3px rgba(0, 143, 75, 0.2)'
                        }}
                    >
                        {saving ? <RefreshCw size={20} className="spin" /> : <Save size={20} />}
                        {saving ? 'Saving Changes...' : 'Save Configuration'}
                    </button>
                </div>
            </div>
        </div>
    );
}
