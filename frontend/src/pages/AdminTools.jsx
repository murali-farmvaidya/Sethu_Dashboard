import React, { useState, useEffect } from 'react';
import { adminAPI, paymentAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-hot-toast';
import {
    Zap, Shield, Users, Activity, Clock, TrendingUp, CreditCard, PhoneCall
} from 'lucide-react';

const AdminTools = () => {
    const { user: authUser, refreshUser } = useAuth();
    const [users, setUsers] = useState([]);
    const [adjAmount, setAdjAmount] = useState('');
    const [adjTarget, setAdjTarget] = useState('');
    const [analyticsUser, setAnalyticsUser] = useState('');
    const [analyticsData, setAnalyticsData] = useState(null);
    const [analyticsLoading, setAnalyticsLoading] = useState(false);
    const [analyticsFilter, setAnalyticsFilter] = useState('all'); // all | credit | debit
    const [analyticsStart, setAnalyticsStart] = useState(() => {
        const d = new Date(); d.setDate(d.getDate() - 30);
        return d.toISOString().split('T')[0];
    });
    const [analyticsEnd, setAnalyticsEnd] = useState(() => new Date().toISOString().split('T')[0]);
    const [adminSubTab, setAdminSubTab] = useState('adjust'); // adjust | balances | analytics

    useEffect(() => {
        if (authUser?.role === 'super_admin' || authUser?.isMaster) {
            fetchUsers();
            setAdjTarget(authUser?.id);
        }
    }, [authUser]);

    const fetchUsers = async () => {
        try {
            const response = await adminAPI.getUsers({ limit: 100 });
            if (response.data?.users) setUsers(response.data.users);
        } catch (e) { console.error('Failed to fetch users:', e); }
    };

    const handleAdjustCredits = async () => {
        const amount = parseInt(adjAmount);
        if (isNaN(amount) || amount === 0) { toast.error('Enter a valid non-zero amount'); return; }
        try {
            const res = await paymentAPI.adjustCredits(amount, adjTarget || authUser?.id);
            if (res.data.success) {
                toast.success('Credits updated successfully');
                setAdjAmount('');
                fetchUsers();
                if (refreshUser) refreshUser();
                window.dispatchEvent(new Event('refresh-notifications'));
            } else toast.error(res.data.message || 'Failed');
        } catch { toast.error('Error updating credits'); }
    };

    const fetchUserAnalytics = async () => {
        if (!analyticsUser) { toast.error('Please select a user'); return; }
        try {
            console.log('Fetching analytics for user:', analyticsUser);
            setAnalyticsLoading(true);
            const res = await paymentAPI.getTransactionHistory('all', 1, 500, '', '', analyticsUser);
            console.log('Analytics Response:', res.data);
            if (res.data?.success) {
                const rows = res.data.data || [];
                const localStart = new Date(analyticsStart + 'T00:00:00');
                const localEnd = new Date(analyticsEnd + 'T23:59:59.999');
                const filtered = rows.filter(r => {
                    const dStr = r.created_at + (r.created_at.includes('Z') ? '' : 'Z');
                    const d = new Date(dStr);
                    return d >= localStart && d <= localEnd;
                });
                const totalCreditsConsumed = filtered
                    .filter(r => r.transaction_type === 'debit')
                    .reduce((s, r) => s + parseFloat(r.debit_amount || 0), 0);
                const totalMinutes = totalCreditsConsumed / 3.5;
                const totalCreditsAdded = filtered
                    .filter(r => r.transaction_type === 'credit')
                    .reduce((s, r) => s + parseFloat(r.credit_amount || 0), 0);
                const totalBillings = filtered.filter(r => r.transaction_type === 'debit').length;
                setAnalyticsData({ totalMinutes, totalCreditsConsumed, totalCreditsAdded, totalBillings, rows: filtered });
            }
        } catch (e) {
            console.error('Analytics fetch error:', e);
            toast.error('Failed to load analytics');
        } finally { setAnalyticsLoading(false); }
    };

    if (authUser?.role !== 'super_admin' && !authUser?.isMaster) {
        return (
            <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
                You do not have permission to access Admin Tools.
            </div>
        );
    }

    return (
        <div className="page-container" style={{ maxWidth: 1300 }}>
            {/* Page Header */}
            <div style={{ marginBottom: '2.5rem', textAlign: 'center' }}>
                <h1 style={{ fontSize: '2rem', fontWeight: '800', color: 'var(--text)', marginBottom: '4px' }}>
                    Admin Tools
                </h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                    Manage credits, view user balances, and inspect analytics
                </p>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem', maxWidth: '900px', margin: '0 auto', width: '100%' }}>
                {/* Admin Sub-Tab Navigation */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem' }}>
                    {[
                        { id: 'adjust', label: 'Credit Adjustment', desc: 'Add or deduct credits', icon: <Zap size={20} />, color: '#6366f1', bg: 'rgba(99,102,241,0.08)', border: '#e8e7ff' },
                        { id: 'balances', label: 'User Balances', desc: 'View all credit balances', icon: <Users size={20} />, color: 'var(--primary)', bg: 'rgba(0,143,75,0.08)', border: '#d1fae5' },
                        { id: 'analytics', label: 'User Analytics', desc: 'Usage & billing reports', icon: <Activity size={20} />, color: '#d97706', bg: 'rgba(217,119,6,0.08)', border: '#fde68a' },
                    ].map(tab => (
                        <button
                            key={tab.id}
                            onClick={() => setAdminSubTab(tab.id)}
                            style={{
                                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                                gap: '10px', padding: '1.25rem 1.5rem',
                                borderRadius: '16px', border: `2px solid ${adminSubTab === tab.id ? tab.color : tab.border}`,
                                background: adminSubTab === tab.id ? tab.bg : 'white',
                                cursor: 'pointer', textAlign: 'left', transition: 'all 0.2s',
                                boxShadow: adminSubTab === tab.id ? `0 4px 16px ${tab.color}22` : '0 1px 4px rgba(0,0,0,0.04)'
                            }}
                        >
                            <div style={{ width: 38, height: 38, borderRadius: '10px', background: adminSubTab === tab.id ? tab.bg : '#f8fafc', display: 'flex', alignItems: 'center', justifyContent: 'center', color: tab.color, border: `1px solid ${tab.border}` }}>
                                {tab.icon}
                            </div>
                            <div>
                                <div style={{ fontSize: '0.9rem', fontWeight: '800', color: adminSubTab === tab.id ? tab.color : 'var(--text)', marginBottom: '3px' }}>{tab.label}</div>
                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: '500' }}>{tab.desc}</div>
                            </div>
                        </button>
                    ))}
                </div>

                {/* Card 1: Credit Adjustment Tool */}
                {adminSubTab === 'adjust' && (
                    <div style={{ background: 'white', borderRadius: '20px', padding: '2rem', border: '2px solid #e8e7ff', boxShadow: '0 2px 16px rgba(99,102,241,0.06)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.75rem', paddingBottom: '1.25rem', borderBottom: '1px solid #f1f5f9' }}>
                            <div style={{ width: 40, height: 40, borderRadius: '12px', background: 'rgba(99,102,241,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <Shield size={20} color="#6366f1" />
                            </div>
                            <div>
                                <h2 style={{ fontSize: '1.05rem', fontWeight: '800', color: 'var(--text)', margin: 0 }}>Credit Adjustment Tool</h2>
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>Manually add or deduct credits for any user account</p>
                            </div>
                        </div>
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                                <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: '700', display: 'block', marginBottom: '7px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Target User Email</label>
                                <select value={adjTarget} onChange={e => setAdjTarget(e.target.value)}
                                    style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1.5px solid var(--border)', fontSize: '0.875rem', color: 'var(--text)', background: 'white', height: '44px', boxSizing: 'border-box', outline: 'none' }}>
                                    <option value={authUser?.id}>My Account (Self)</option>
                                    {users.filter(u => u.user_id !== authUser?.id && (u.role === 'admin' || u.role === 'super_admin')).map(u => (
                                        <option key={u.user_id} value={u.user_id}>
                                            {u.name || u.email} ({u.role}) — {parseFloat(u.minutes_balance || 0).toFixed(0)} credits
                                        </option>
                                    ))}
                                </select>
                            </div>
                            <div style={{ flex: '1 1 180px', minWidth: 0 }}>
                                <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: '700', display: 'block', marginBottom: '7px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Adjustment Amount</label>
                                <input type="number" placeholder="e.g. +500 or -100" value={adjAmount} onChange={e => setAdjAmount(e.target.value)}
                                    style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1.5px solid var(--border)', fontSize: '0.875rem', color: 'var(--text)', background: 'white', height: '44px', boxSizing: 'border-box', outline: 'none' }} />
                            </div>
                            <div style={{ flex: '0 0 auto' }}>
                                <button onClick={handleAdjustCredits}
                                    style={{ padding: '0 28px', height: '44px', borderRadius: '10px', border: 'none', background: 'linear-gradient(135deg, #6366f1, #4f46e5)', color: 'white', fontWeight: '700', cursor: 'pointer', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '7px', whiteSpace: 'nowrap' }}>
                                    <Zap size={15} /> Update Balance
                                </button>
                            </div>
                        </div>
                        <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', margin: '12px 0 0 0' }}>Positive value adds credits &nbsp;·&nbsp; Negative value deducts credits</p>
                    </div>
                )}

                {/* Card 2: All Users Credit Balances */}
                {adminSubTab === 'balances' && (
                    <div style={{ background: 'white', borderRadius: '20px', padding: '2rem', border: '1px solid var(--border)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.75rem', paddingBottom: '1.25rem', borderBottom: '1px solid #f1f5f9' }}>
                            <div style={{ width: 40, height: 40, borderRadius: '12px', background: 'rgba(0,143,75,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <Users size={20} color="var(--primary)" />
                            </div>
                            <div>
                                <h2 style={{ fontSize: '1.05rem', fontWeight: '800', color: 'var(--text)', margin: 0 }}>All User Credit Balances</h2>
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>{users.length} users registered on the platform</p>
                            </div>
                        </div>
                        <div className="table-container">
                            <table className="session-table">
                                <thead>
                                    <tr>
                                        <th>User</th>
                                        <th>Created By</th>
                                        <th>Role</th>
                                        <th style={{ textAlign: 'center' }}>Credits Balance</th>
                                        <th style={{ textAlign: 'center' }}>Platform Access</th>
                                        <th style={{ textAlign: 'center' }}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.map(u => {
                                        const bal = parseFloat(u.minutes_balance || 0);
                                        const subActive = u.subscription_expiry && new Date(u.subscription_expiry) > new Date();
                                        const validityDate = u.subscription_expiry
                                            ? new Date(u.subscription_expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, ' ')
                                            : 'N/A';
                                        const creatorEmail = u.creator_email || (u.created_by && u.created_by !== '-' ? u.created_by : 'Unknown');
                                        const displayName = u.name && u.name !== '-' ? u.name : u.email;
                                        return (
                                            <tr key={u.user_id} className="session-row">
                                                <td>
                                                    <div style={{ fontWeight: '600', color: 'var(--text)' }}>{displayName}</div>
                                                    {displayName !== u.email && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{u.email}</div>}
                                                </td>
                                                <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{creatorEmail}</td>
                                                <td>
                                                    <span style={{ fontSize: '0.72rem', padding: '3px 10px', borderRadius: '20px', background: u.role === 'super_admin' ? 'rgba(99,102,241,0.1)' : 'rgba(0,143,75,0.1)', color: u.role === 'super_admin' ? '#6366f1' : 'var(--primary)', fontWeight: '700' }}>
                                                        {u.role === 'super_admin' ? 'Super Admin' : u.role}
                                                    </span>
                                                </td>
                                                <td style={{ textAlign: 'center', fontWeight: '800', color: bal < 100 ? '#ef4444' : 'var(--text)', fontSize: '1rem' }}>
                                                    {bal.toFixed(2)}
                                                </td>
                                                <td style={{ textAlign: 'center', fontSize: '0.8rem', color: subActive ? '#059669' : 'var(--text-muted)', fontWeight: '600' }}>
                                                    {validityDate}
                                                </td>
                                                <td style={{ textAlign: 'center' }}>
                                                    <span style={{ fontSize: '0.72rem', padding: '3px 10px', borderRadius: '20px', background: subActive ? 'rgba(5,150,105,0.1)' : 'rgba(239,68,68,0.1)', color: subActive ? '#059669' : '#ef4444', fontWeight: '700' }}>
                                                        {subActive ? 'Active' : 'Expired'}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}

                {/* Card 3: User Analytics */}
                {adminSubTab === 'analytics' && (
                    <div style={{ background: 'white', borderRadius: '20px', padding: '2rem', border: '1px solid var(--border)', boxShadow: '0 2px 12px rgba(0,0,0,0.04)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.75rem', paddingBottom: '1.25rem', borderBottom: '1px solid #f1f5f9' }}>
                            <div style={{ width: 40, height: 40, borderRadius: '12px', background: 'rgba(217,119,6,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                                <Activity size={20} color="#d97706" />
                            </div>
                            <div>
                                <h2 style={{ fontSize: '1.05rem', fontWeight: '800', color: 'var(--text)', margin: 0 }}>User Analytics</h2>
                                <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', margin: '2px 0 0 0' }}>View detailed usage and billing breakdown for any user</p>
                            </div>
                        </div>

                        {/* Filter controls */}
                        <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '2rem' }}>
                            <div style={{ flex: '1 1 220px', minWidth: 0 }}>
                                <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: '700', display: 'block', marginBottom: '7px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Select User</label>
                                <select value={analyticsUser} onChange={e => { setAnalyticsUser(e.target.value); setAnalyticsData(null); }}
                                    style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1.5px solid var(--border)', fontSize: '0.875rem', color: 'var(--text)', background: 'white', height: '44px', boxSizing: 'border-box', outline: 'none' }}>
                                    <option value="">— Choose a user —</option>
                                    {users.filter(u => u.role === 'admin' || u.role === 'super_admin').map(u => (
                                        <option key={u.user_id} value={u.user_id}>{u.name || u.email} ({u.role})</option>
                                    ))}
                                </select>
                            </div>
                            <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                                <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: '700', display: 'block', marginBottom: '7px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>From Date</label>
                                <input type="date" value={analyticsStart} onChange={e => setAnalyticsStart(e.target.value)}
                                    style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1.5px solid var(--border)', fontSize: '0.875rem', height: '44px', boxSizing: 'border-box', outline: 'none' }} />
                            </div>
                            <div style={{ flex: '1 1 140px', minWidth: 0 }}>
                                <label style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: '700', display: 'block', marginBottom: '7px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>To Date</label>
                                <input type="date" value={analyticsEnd} onChange={e => setAnalyticsEnd(e.target.value)}
                                    style={{ width: '100%', padding: '10px 12px', borderRadius: '10px', border: '1.5px solid var(--border)', fontSize: '0.875rem', height: '44px', boxSizing: 'border-box', outline: 'none' }} />
                            </div>
                            <div style={{ flex: '0 0 auto' }}>
                                <button onClick={fetchUserAnalytics} disabled={analyticsLoading || !analyticsUser}
                                    style={{ padding: '0 24px', height: '44px', borderRadius: '10px', border: 'none', background: analyticsUser ? 'linear-gradient(135deg, #d97706, #b45309)' : '#e5e7eb', color: analyticsUser ? 'white' : '#9ca3af', fontWeight: '700', cursor: analyticsUser ? 'pointer' : 'not-allowed', fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '7px', whiteSpace: 'nowrap', transition: 'all 0.2s' }}>
                                    {analyticsLoading ? <div className="spinner-small" style={{ width: 14, height: 14, border: '2px solid rgba(255,255,255,0.4)', borderTopColor: 'white' }} /> : <TrendingUp size={15} />}
                                    {analyticsLoading ? 'Loading...' : 'Run Report'}
                                </button>
                            </div>
                        </div>

                        {/* Empty state */}
                        {!analyticsData && !analyticsLoading && (
                            <div style={{ textAlign: 'center', padding: '3.5rem 1rem', color: 'var(--text-muted)', borderRadius: '14px', background: '#f8fafc', border: '1.5px dashed #d1d5db' }}>
                                <Activity size={38} style={{ opacity: 0.2, display: 'block', margin: '0 auto 12px' }} />
                                <p style={{ margin: 0, fontWeight: '500', fontSize: '0.9rem' }}>Select a user and date range, then click Run Report</p>
                            </div>
                        )}

                        {/* Analytics results */}
                        {analyticsData && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.75rem' }}>
                                {/* KPI summary grid */}
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '1rem' }}>
                                    {[
                                        { label: 'Total Minutes Used', value: `${analyticsData.totalMinutes.toFixed(1)} min`, color: '#6366f1', bg: 'rgba(99,102,241,0.07)', border: 'rgba(99,102,241,0.15)', icon: <Clock size={18} color="#6366f1" /> },
                                        { label: 'Credits Consumed', value: `${(analyticsData.totalCreditsConsumed || 0).toFixed(2)}`, color: '#ef4444', bg: 'rgba(239,68,68,0.06)', border: 'rgba(239,68,68,0.15)', icon: <TrendingUp size={18} color="#ef4444" /> },
                                        { label: 'Credits Recharged', value: `${analyticsData.totalCreditsAdded.toFixed(2)}`, color: 'var(--primary)', bg: 'rgba(0,143,75,0.06)', border: 'rgba(0,143,75,0.15)', icon: <CreditCard size={18} color="var(--primary)" /> },
                                        { label: 'Total Call Sessions', value: analyticsData.totalBillings, color: '#d97706', bg: 'rgba(217,119,6,0.06)', border: 'rgba(217,119,6,0.15)', icon: <PhoneCall size={18} color="#d97706" /> },
                                    ].map(kpi => (
                                        <div key={kpi.label} style={{ background: kpi.bg, borderRadius: '14px', padding: '1.25rem 1.5rem', border: `1px solid ${kpi.border}` }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                                                <span style={{ fontSize: '0.68rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{kpi.label}</span>
                                                {kpi.icon}
                                            </div>
                                            <div style={{ fontSize: '1.6rem', fontWeight: '900', color: kpi.color, letterSpacing: '-0.02em' }}>{kpi.value}</div>
                                        </div>
                                    ))}
                                </div>

                                {/* Transaction detail table */}
                                <div>
                                    <div style={{ fontSize: '0.72rem', fontWeight: '700', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '12px' }}>
                                        Transaction Details &mdash; {analyticsData.rows.filter(r => analyticsFilter === 'all' || r.transaction_type === analyticsFilter).length} of {analyticsData.rows.length} records
                                    </div>
                                    {analyticsData.rows.length > 0 ? (
                                        <>
                                            {/* Filter buttons */}
                                            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                                                {[
                                                    { key: 'all', label: 'All Transactions' },
                                                    { key: 'credit', label: 'Recharges Only' },
                                                    { key: 'debit', label: 'Call Debits Only' },
                                                ].map(f => (
                                                    <button key={f.key} onClick={() => setAnalyticsFilter(f.key)}
                                                        style={{ padding: '6px 16px', borderRadius: '20px', border: `1.5px solid ${analyticsFilter === f.key ? 'var(--primary)' : 'var(--border)'}`, background: analyticsFilter === f.key ? 'var(--primary)' : 'white', color: analyticsFilter === f.key ? 'white' : 'var(--text-muted)', fontWeight: '600', fontSize: '0.78rem', cursor: 'pointer', transition: 'all 0.15s' }}>
                                                        {f.label}
                                                    </button>
                                                ))}
                                                <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: 'var(--text-muted)', alignSelf: 'center' }}>
                                                    {analyticsData.rows.filter(r => analyticsFilter === 'all' || r.transaction_type === analyticsFilter).length} record(s)
                                                </span>
                                            </div>
                                            <div className="table-container" style={{ maxHeight: '340px', overflowY: 'auto' }}>
                                                <table className="session-table">
                                                    <thead>
                                                        <tr>
                                                            <th>Date</th>
                                                            <th>Description</th>
                                                            <th style={{ textAlign: 'center' }}>Amount</th>
                                                            <th style={{ textAlign: 'center' }}>Type</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {analyticsData.rows
                                                            .filter(r => analyticsFilter === 'all' || r.transaction_type === analyticsFilter)
                                                            .map(r => (
                                                                <tr key={r.id} className="session-row">
                                                                    <td style={{ whiteSpace: 'nowrap', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                                                        {new Date(r.created_at).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}
                                                                    </td>
                                                                    <td style={{ fontSize: '0.85rem', fontWeight: '500' }}>{r.description}</td>
                                                                    <td style={{ textAlign: 'center', fontWeight: '700', color: r.transaction_type === 'credit' ? 'var(--primary)' : '#ef4444' }}>
                                                                        {r.transaction_type === 'credit' ? '+' : '-'}{Math.abs(parseFloat(r.transaction_type === 'credit' ? r.credit_amount : r.debit_amount || 0)).toFixed(2)}
                                                                    </td>
                                                                    <td style={{ textAlign: 'center' }}>
                                                                        <span style={{ fontSize: '0.7rem', padding: '3px 10px', borderRadius: '20px', fontWeight: '700', background: r.transaction_type === 'credit' ? 'rgba(0,143,75,0.1)' : 'rgba(99,102,241,0.1)', color: r.transaction_type === 'credit' ? 'var(--primary)' : '#6366f1' }}>
                                                                            {r.transaction_type === 'credit' ? 'Recharge' : 'Call Debit'}
                                                                        </span>
                                                                    </td>
                                                                </tr>
                                                            ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </>
                                    ) : (
                                        <div style={{ textAlign: 'center', padding: '2.5rem', color: 'var(--text-muted)', background: '#f8fafc', borderRadius: '12px', fontSize: '0.875rem' }}>
                                            No transactions found in the selected date range.
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </div>
            <style>{`
                .spinner-small {
                    width: 18px; height: 18px;
                    border: 2px solid rgba(255,255,255,0.4);
                    border-top-color: white;
                    border-radius: 50%;
                    animation: spin 0.7s linear infinite;
                    display: inline-block;
                }
                @keyframes spin { to { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
};

export default AdminTools;
