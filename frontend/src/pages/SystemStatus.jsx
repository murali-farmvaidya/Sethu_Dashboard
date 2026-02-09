import { useEffect, useState } from 'react';
import api from '../services/api'; // uses default export or adminAPI? adminAPI doesn't have system status. use raw api.
import { ArrowLeft, Activity, Server, Database, Cpu, Clock, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import Header from '../components/Header';
import { useAuth } from '../context/AuthContext';

export default function SystemStatus() {
    const [status, setStatus] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const navigate = useNavigate();
    const { user } = useAuth();

    useEffect(() => {
        if (user && user.id !== 'master_root_0') {
            navigate('/');
            return;
        }

        const fetchStatus = async () => {
            try {
                const res = await api.get('/api/system/status');
                setStatus(res.data);
            } catch (err) {
                setError(err.response?.data?.error || err.message);
            } finally {
                setLoading(false);
            }
        };

        fetchStatus();
        const interval = setInterval(fetchStatus, 3000); // Live updates
        return () => clearInterval(interval);
    }, [user, navigate]);

    if (loading && !status) return <div className="loading">Loading system status...</div>;

    const formatUptime = (seconds) => {
        const d = Math.floor(seconds / (3600 * 24));
        const h = Math.floor((seconds % (3600 * 24)) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${d}d ${h}h ${m}m ${s}s`;
    };

    return (
        <>
            <Header />
            <div className="dashboard-layout" style={{ background: '#f5f7fa', minHeight: '100vh', padding: '2rem' }}>
                <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
                    <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2rem' }}>
                        <button onClick={() => navigate('/admin')} style={{ background: 'none', border: 'none', cursor: 'pointer', marginRight: '1rem', color: '#666' }}>
                            <ArrowLeft size={24} />
                        </button>
                        <h1 style={{ fontSize: '1.8rem', fontWeight: 'bold', color: '#1a1a1a', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <Activity color="var(--primary)" size={28} /> System Status Dashboard
                        </h1>
                    </div>

                    {error && (
                        <div style={{ padding: '1rem', background: '#fee2e2', color: '#ef4444', borderRadius: '8px', marginBottom: '2rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <AlertTriangle size={20} />
                            {error}
                        </div>
                    )}

                    {status && (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1.5rem' }}>

                            {/* Server Uptime Card */}
                            <div className="card" style={{ padding: '1.5rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1rem', color: '#666' }}>
                                    <Clock size={20} />
                                    <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Server Uptime</h3>
                                </div>
                                <div style={{ fontSize: '1.5rem', fontWeight: 'bold', color: '#1a1a1a' }}>
                                    {formatUptime(status.uptime)}
                                </div>
                                <div style={{ fontSize: '0.85rem', color: '#888', marginTop: '0.5rem' }}>
                                    Last Updated: {new Date().toLocaleTimeString()}
                                </div>
                            </div>

                            {/* Memory Usage Card */}
                            <div className="card" style={{ padding: '1.5rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1rem', color: '#666' }}>
                                    <Server size={20} />
                                    <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Memory Usage</h3>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span>RSS (Resident):</span>
                                        <span style={{ fontWeight: '600' }}>{status.memory.rss}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span>Heap Used:</span>
                                        <span style={{ fontWeight: '600' }}>{status.memory.heapUsed}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span>Heap Total:</span>
                                        <span style={{ fontWeight: '600' }}>{status.memory.heapTotal}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Database Stats Card */}
                            <div className="card" style={{ padding: '1.5rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1rem', color: '#666' }}>
                                    <Database size={20} />
                                    <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Database</h3>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <span>Status:</span>
                                        <span style={{
                                            fontWeight: '600',
                                            padding: '2px 8px', borderRadius: '4px',
                                            background: status.database.status === 'Connected' ? '#dcfce7' : '#fee2e2',
                                            color: status.database.status === 'Connected' ? '#166534' : '#ef4444'
                                        }}>
                                            {status.database.status}
                                        </span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span>Latency:</span>
                                        <span style={{ fontWeight: '600' }}>{status.database.latency}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span>Clients (Total/Idle/Wait):</span>
                                        <span style={{ fontWeight: '600' }}>{status.database.totalClients} / {status.database.idleClients} / {status.database.waitingClients}</span>
                                    </div>
                                </div>
                            </div>

                            {/* System Info Card */}
                            <div className="card" style={{ padding: '1.5rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '1rem', color: '#666' }}>
                                    <Cpu size={20} />
                                    <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Environment</h3>
                                </div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span>Node Version:</span>
                                        <span style={{ fontWeight: '600' }}>{status.system.nodeVersion}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span>Platform:</span>
                                        <span style={{ fontWeight: '600' }}>{status.system.platform}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span>Environment:</span>
                                        <span style={{ fontWeight: '600', textTransform: 'uppercase' }}>{status.system.env || 'Development'}</span>
                                    </div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                        <span>Process ID:</span>
                                        <span style={{ fontWeight: '600' }}>{status.system.pid}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
}
