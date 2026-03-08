import React from 'react';
import UsageGraph from '../components/UsageGraph';
import { useAuth } from '../context/AuthContext';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const UserAnalytics = () => {
    const { user } = useAuth();
    const navigate = useNavigate();

    return (
        <div className="page-container" style={{ maxWidth: 1000, margin: '0 auto' }}>
            {/* Page Header */}
            <div className="page-header" style={{ marginBottom: '2rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <button onClick={() => navigate(-1)} className="btn-back" style={{ background: 'var(--bg-secondary)', color: 'var(--text)', border: '1px solid var(--border)' }}>
                        <ArrowLeft size={16} /> Back
                    </button>
                    <h1 style={{ fontSize: '1.75rem', fontWeight: '800', color: 'var(--text)' }}>User Analytics</h1>
                </div>
            </div>

            <div style={{ padding: '0 0 2rem' }}>
                <UsageGraph userId={user?.id} />
            </div>
        </div>
    );
};

export default UserAnalytics;
