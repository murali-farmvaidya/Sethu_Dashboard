import React, { useState, useEffect, useRef } from 'react';
import { paymentAPI, adminAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-hot-toast';
import Header from '../components/Header';
import UsageGraph from '../components/UsageGraph';
import { Link } from 'react-router-dom';
import {
    CreditCard, Clock, CheckCircle, AlertCircle, Zap, Shield,
    PhoneCall, Download, ChevronLeft, ChevronRight,
    TrendingUp, Activity, Calendar, ArrowUpRight, ArrowDownLeft,
    Users, Link as LinkIcon, RefreshCw
} from 'lucide-react';

const Billing = () => {
    const { user: authUser, refreshUser } = useAuth();
    const [balances, setBalances] = useState(null);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [rechargeAmount, setRechargeAmount] = useState(1000);
    const [transactions, setTransactions] = useState([]);
    const [transactionsPage, setTransactionsPage] = useState(1);
    const [transactionsPagination, setTransactionsPagination] = useState({ total: 0, totalPages: 1 });
    const [users, setUsers] = useState([]);
    const [activeTab, setActiveTab] = useState('overview'); // overview | history | admin
    const [paymentTab, setPaymentTab] = useState('topup'); // topup | extend
    const [filterTarget, setFilterTarget] = useState(authUser?.id || '');
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

    const transactionsLimit = 10;

    useEffect(() => { fetchBalances(); }, []);
    useEffect(() => { fetchTransactions(); }, [transactionsPage]);
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

    const fetchTransactions = async () => {
        setProcessing(true);
        try {
            const response = await paymentAPI.getTransactionHistory('payments', transactionsPage, transactionsLimit);
            if (response.data.success) {
                setTransactions(response.data.data);
                if (response.data.pagination) setTransactionsPagination(response.data.pagination);
            }
        } catch (e) {
            toast.error('Could not load billing history');
        } finally { setProcessing(false); }
    };

    const fetchBalances = async () => {
        try {
            setLoading(true);
            const response = await paymentAPI.getBalances();
            if (response.data.success) setBalances(response.data.data);
        } catch (e) {
            toast.error('Failed to load billing details');
        } finally { setLoading(false); }
    };

    const handlePayment = async (type) => {
        try {
            setProcessing(true);
            let orderResponse;
            if (type === 'subscription') {
                orderResponse = await paymentAPI.createSubscription();
            } else {
                if (rechargeAmount < 1000) { toast.error('Minimum recharge amount is ₹1,000'); setProcessing(false); return; }
                orderResponse = await paymentAPI.createRecharge(rechargeAmount);
            }
            const { order_id, amount, key_id } = orderResponse.data;
            const options = {
                key: key_id, amount, currency: 'INR',
                name: 'FarmVaidya Admin',
                description: type === 'subscription' ? 'Monthly Platform Subscription' : `${amount / 100} Credits Recharge`,
                order_id,
                handler: async function (response) {
                    try {
                        const v = await paymentAPI.verifyPayment({ order_id: response.razorpay_order_id, payment_id: response.razorpay_payment_id, signature: response.razorpay_signature });
                        if (v.data.success) {
                            toast.success(v.data.message || 'Payment successful! 🎉');
                            fetchBalances();
                            fetchTransactions();
                            if (refreshUser) refreshUser();
                            window.dispatchEvent(new Event('refresh-notifications'));
                        }
                        else toast.error('Payment verification failed');
                    } catch { toast.error('Payment verification failed'); }
                },
                prefill: { name: authUser?.name, contact: authUser?.phone_number, email: authUser?.email },
                theme: { color: '#008F4B' },
                modal: { ondismiss: () => setProcessing(false) }
            };
            const rzp = new window.Razorpay(options);
            rzp.on('payment.failed', (r) => { toast.error(r.error.description || 'Payment failed'); });
            rzp.open();
        } catch (e) {
            toast.error('Failed to initiate payment');
            setProcessing(false);
        }
    };

    const handleAdjustCredits = async () => {
        const amount = parseInt(adjAmount);
        if (isNaN(amount) || amount === 0) { toast.error('Enter a valid non-zero amount'); return; }
        try {
            const res = await paymentAPI.adjustCredits(amount, adjTarget || authUser?.id);
            if (res.data.success) {
                toast.success('Credits updated successfully');
                setAdjAmount('');
                fetchBalances(); fetchTransactions(); fetchUsers();
                if (refreshUser) refreshUser();
                window.dispatchEvent(new Event('refresh-notifications'));
            } else toast.error(res.data.message || 'Failed');
        } catch { toast.error('Error updating credits'); }
    };

    const fetchUserAnalytics = async () => {
        if (!analyticsUser) { toast.error('Please select a user'); return; }
        try {
            setAnalyticsLoading(true);
            // Pass targetUserId so backend returns that specific user's transactions
            const res = await paymentAPI.getTransactionHistory('all', 1, 500, '', '', analyticsUser);
            if (res.data?.success) {
                const rows = res.data.data || [];
                const localStart = new Date(analyticsStart + 'T00:00:00');
                const localEnd = new Date(analyticsEnd + 'T23:59:59.999');
                const filtered = rows.filter(r => {
                    const dStr = r.created_at + (r.created_at.includes('Z') ? '' : 'Z');
                    const d = new Date(dStr);
                    return d >= localStart && d <= localEnd;
                });
                // debit_amount = credits consumed (minutes * 3.5)
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

    if (loading) return (
        <React.Fragment>
            <Header />
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
                <div style={{ textAlign: 'center', color: 'var(--text-muted)' }}>
                    <div className="spinner-small" style={{ margin: '0 auto 12px', width: 32, height: 32, borderWidth: 3, borderColor: 'var(--primary)' }} />
                    Loading billing details...
                </div>
            </div>
        </React.Fragment>
    );

    const isSubscriptionActive = balances?.subscription_expiry && new Date(balances.subscription_expiry) > new Date();
    const expiryDate = balances?.subscription_expiry ? new Date(balances.subscription_expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, ' ') : 'N/A';
    const balance = parseFloat(balances?.minutes_balance || 0);
    const isLowBalance = balance < 100;

    const tabs = [
        { id: 'overview', label: 'Overview', icon: <TrendingUp size={14} /> },
        { id: 'history', label: 'Payment History', icon: <CreditCard size={14} /> },
        ...(authUser?.role === 'super_admin' || authUser?.isMaster
            ? [{ id: 'admin', label: 'Admin Tools', icon: <Shield size={14} /> }]
            : []),
    ];

    return (
        <React.Fragment>
            <Header />
            <div className="page-container" style={{ maxWidth: 1300 }}>
                {/* Page Header */}
                <div style={{ marginBottom: '2.5rem', textAlign: 'center' }}>
                    <h1 style={{ fontSize: '2rem', fontWeight: '800', color: 'var(--text)', marginBottom: '4px' }}>
                        Billing & Credits
                    </h1>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                        Manage your subscription, call credits and usage analytics
                    </p>
                </div>

                {/* Tab Navigation */}
                <div style={{ display: 'flex', gap: '4px', background: '#f1f5f9', padding: '5px', borderRadius: '14px', width: 'fit-content', margin: '0 auto 2.5rem auto' }}>
                    {tabs.map(tab => (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                            display: 'flex', alignItems: 'center', gap: '6px',
                            padding: '9px 22px', borderRadius: '10px', border: 'none', cursor: 'pointer',
                            fontWeight: '600', fontSize: '0.875rem', transition: 'all 0.2s',
                            background: activeTab === tab.id ? 'white' : 'transparent',
                            color: activeTab === tab.id ? 'var(--primary)' : 'var(--text-muted)',
                            boxShadow: activeTab === tab.id ? '0 2px 8px rgba(0,0,0,0.08)' : 'none'
                        }}>
                            {tab.icon}{tab.label}
                        </button>
                    ))}
                </div>

                {/* ==================== OVERVIEW TAB ==================== */}
                {/* ==================== OVERVIEW TAB ==================== */}
                {activeTab === 'overview' && (() => {
                    const CREDIT_AMOUNTS = [1000, 2000, 5000, 10000, 15000, 20000, 30000, 40000, 50000, 75000, 100000];
                    return (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxWidth: '900px', margin: '0 auto', width: '100%' }}>

                            {/* ── Account Summary Bar ── */}
                            <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', padding: '1.25rem 1.75rem', display: 'flex', alignItems: 'center', gap: '2.5rem', flexWrap: 'wrap', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '2px', fontWeight: '500' }}>A/C Balance</div>
                                    <div style={{ fontSize: '1.8rem', fontWeight: '800', color: '#008F4B', letterSpacing: '-0.5px' }}>
                                        ₹{balance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </div>
                                </div>
                                <div style={{ width: '1px', height: '42px', background: '#e2e8f0', flexShrink: 0 }} />
                                <div>
                                    <div style={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '2px', fontWeight: '500' }}>Valid Till</div>
                                    <div style={{ fontSize: '1rem', fontWeight: '700', color: isSubscriptionActive ? '#1e293b' : '#ef4444' }}>
                                        {expiryDate}
                                    </div>
                                    <div style={{ fontSize: '0.7rem', marginTop: '2px', fontWeight: '600', color: isSubscriptionActive ? '#008F4B' : '#ef4444' }}>
                                        {isSubscriptionActive ? 'Active' : 'Expired'}
                                    </div>
                                </div>
                                {isLowBalance && (
                                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px', background: '#fef9c3', border: '1px solid #fde047', borderRadius: '10px', padding: '8px 14px' }}>
                                        <AlertCircle size={15} color="#d97706" />
                                        <span style={{ fontSize: '0.78rem', color: '#92400e', fontWeight: '600' }}>Low Balance — Recharge now</span>
                                    </div>
                                )}
                            </div>

                            {/* ── Auto-renewal note ── */}
                            <div style={{ fontSize: '0.8rem', color: '#475569', padding: '0 4px', lineHeight: 1.5 }}>
                                When your validity expires, 6,500 credits are automatically deducted from your balance to renew platform access for 30 days. Keep your balance topped up.{' '}
                                <span style={{ color: '#008F4B', fontWeight: '600', cursor: 'pointer' }}>Learn more</span>
                            </div>

                            {/* ── Main Payment Panel ── */}
                            <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>

                                {/* Panel Header */}
                                <div style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <CreditCard size={16} color="#008F4B" />
                                    <span style={{ fontWeight: '700', color: '#008F4B', fontSize: '0.9rem' }}>Online Payment</span>
                                </div>

                                <div style={{ padding: '1.5rem' }}>
                                    {/* ── 3 Payment Tabs ── */}
                                    <div style={{ display: 'flex', gap: '0', marginBottom: '1.5rem', border: '1px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', width: 'fit-content' }}>
                                        {[
                                            { id: 'topup', label: 'Top-up for extra credits' },
                                            { id: 'extend', label: 'Extend validity (₹9,999)' },
                                        ].map((t, idx) => (
                                            <button key={t.id} onClick={() => setPaymentTab(t.id)} style={{
                                                padding: '9px 20px',
                                                border: 'none',
                                                borderLeft: idx > 0 ? '1px solid #e2e8f0' : 'none',
                                                cursor: 'pointer',
                                                fontSize: '0.82rem',
                                                fontWeight: '600',
                                                background: paymentTab === t.id ? '#008F4B' : '#f8fafc',
                                                color: paymentTab === t.id ? 'white' : '#64748b',
                                                transition: 'all 0.15s',
                                                whiteSpace: 'nowrap'
                                            }}>
                                                {t.label}
                                            </button>
                                        ))}
                                    </div>

                                    {/* ── TOP UP TAB: radio grid ── */}
                                    {paymentTab === 'topup' && (
                                        <div>
                                            <div style={{
                                                display: 'grid',
                                                gridTemplateColumns: '1fr 1fr',
                                                gap: '0',
                                                border: '1px solid #e2e8f0',
                                                borderRadius: '10px',
                                                overflow: 'hidden',
                                                marginBottom: '1.5rem'
                                            }}>
                                                {CREDIT_AMOUNTS.map((amt, idx) => {
                                                    const isSelected = rechargeAmount === amt;
                                                    const isEvenRow = Math.floor(idx / 2) % 2 === 0;
                                                    return (
                                                        <label key={amt} style={{
                                                            display: 'flex', alignItems: 'center', gap: '10px',
                                                            padding: '13px 16px',
                                                            cursor: 'pointer',
                                                            background: isSelected ? 'rgba(0,143,75,0.06)' : (isEvenRow ? '#fafafa' : 'white'),
                                                            borderBottom: idx < CREDIT_AMOUNTS.length - 2 ? '1px solid #f1f5f9' : 'none',
                                                            borderRight: idx % 2 === 0 ? '1px solid #f1f5f9' : 'none',
                                                            transition: 'background 0.12s',
                                                            userSelect: 'none'
                                                        }}>
                                                            <input
                                                                type="radio"
                                                                name="topup_amount"
                                                                checked={isSelected}
                                                                onChange={() => setRechargeAmount(amt)}
                                                                style={{ margin: 0, width: 16, height: 16, accentColor: '#008F4B' }}
                                                            />
                                                            <span style={{ fontSize: '0.875rem', color: isSelected ? '#008F4B' : '#334155', fontWeight: isSelected ? '700' : '400' }}>
                                                                ₹{amt.toLocaleString('en-IN')} credits
                                                            </span>
                                                        </label>
                                                    );
                                                })}
                                            </div>

                                            {/* Custom amount input */}
                                            <div style={{ marginBottom: '1.25rem' }}>
                                                <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: '600', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.04em' }}>Or enter custom amount</div>
                                                <div style={{ display: 'flex', alignItems: 'center', border: '1.5px solid #e2e8f0', borderRadius: '8px', overflow: 'hidden', background: '#fafafa' }}>
                                                    <span style={{ padding: '10px 14px', background: '#f1f5f9', color: '#64748b', fontWeight: '700', borderRight: '1px solid #e2e8f0', fontSize: '0.9rem' }}>₹</span>
                                                    <input
                                                        type="number"
                                                        min="1000"
                                                        placeholder="Enter amount"
                                                        value={CREDIT_AMOUNTS.includes(rechargeAmount) ? '' : (rechargeAmount || '')}
                                                        onChange={e => setRechargeAmount(Number(e.target.value))}
                                                        style={{ flex: 1, padding: '10px 12px', border: 'none', background: 'transparent', outline: 'none', fontSize: '0.9rem', color: '#1e293b', fontWeight: '600' }}
                                                    />
                                                    <span style={{ padding: '10px 14px', color: '#008F4B', fontWeight: '700', fontSize: '0.8rem' }}>
                                                        = {(rechargeAmount || 0).toLocaleString('en-IN')} credits
                                                    </span>
                                                </div>
                                                <div style={{ fontSize: '0.72rem', color: '#94a3b8', marginTop: '4px' }}>Minimum ₹1,000 · 1 INR = 1 Credit</div>
                                            </div>
                                        </div>
                                    )}

                                    {/* ── EXTEND VALIDITY TAB ── */}
                                    {paymentTab === 'extend' && (
                                        <div style={{ marginBottom: '1.5rem' }}>
                                            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '1rem 1.25rem', marginBottom: '1rem' }}>
                                                <div style={{ fontSize: '0.75rem', color: '#64748b', fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>Combo Pack — ₹9,999</div>
                                                {[
                                                    { label: 'Platform Access', value: '₹6,500 (30 days)', color: '#008F4B' },
                                                    { label: 'Call Credits Included', value: '₹3,499 credits', color: '#d97706' },
                                                    { label: 'Validity Extended By', value: '30 days' },
                                                    { label: 'Current Valid Till', value: expiryDate, color: isSubscriptionActive ? '#008F4B' : '#ef4444' },
                                                ].map(r => (
                                                    <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f1f5f9' }}>
                                                        <span style={{ fontSize: '0.83rem', color: '#64748b' }}>{r.label}</span>
                                                        <span style={{ fontSize: '0.875rem', fontWeight: '700', color: r.color || '#1e293b' }}>{r.value}</span>
                                                    </div>
                                                ))}
                                            </div>
                                            <div style={{ background: 'rgba(0,143,75,0.06)', border: '1px solid rgba(0,143,75,0.2)', borderRadius: '8px', padding: '10px 14px', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
                                                <CheckCircle size={14} color="#008F4B" style={{ flexShrink: 0, marginTop: '1px' }} />
                                                <p style={{ margin: 0, fontSize: '0.78rem', color: '#166534', lineHeight: 1.5 }}>
                                                    After purchase, platform access is extended by 30 days and 3,499 credits are added to your wallet for calls.
                                                </p>
                                            </div>
                                        </div>
                                    )}

                                    {/* ── Payment Summary + CTA ── */}
                                    <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '1.25rem' }}>
                                        <div style={{ fontSize: '0.85rem', fontWeight: '700', color: '#1e293b', marginBottom: '10px' }}>Payment Summary</div>

                                        {paymentTab === 'topup' ? (
                                            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 16px', marginBottom: '1rem' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <span style={{ fontSize: '0.83rem', color: '#64748b' }}>Credits being added</span>
                                                    <span style={{ fontSize: '0.9rem', fontWeight: '700', color: '#008F4B' }}>{(rechargeAmount || 0).toLocaleString('en-IN')} credits</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #f1f5f9' }}>
                                                    <span style={{ fontSize: '0.83rem', color: '#64748b' }}>Amount to pay</span>
                                                    <span style={{ fontSize: '1.05rem', fontWeight: '800', color: '#1e293b' }}>₹{(rechargeAmount || 0).toLocaleString('en-IN')}</span>
                                                </div>
                                            </div>
                                        ) : (
                                            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px 16px', marginBottom: '1rem' }}>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                    <span style={{ fontSize: '0.83rem', color: '#64748b' }}>Platform Access (30 days)</span>
                                                    <span style={{ fontSize: '0.875rem', fontWeight: '600', color: '#1e293b' }}>₹6,500</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px' }}>
                                                    <span style={{ fontSize: '0.83rem', color: '#64748b' }}>Call Credits</span>
                                                    <span style={{ fontSize: '0.875rem', fontWeight: '600', color: '#d97706' }}>₹3,499</span>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '6px', paddingTop: '8px', borderTop: '1px solid #f1f5f9' }}>
                                                    <span style={{ fontSize: '0.83rem', color: '#64748b' }}>Total Amount</span>
                                                    <span style={{ fontSize: '1.05rem', fontWeight: '800', color: '#1e293b' }}>₹9,999</span>
                                                </div>
                                            </div>
                                        )}

                                        <button
                                            onClick={() => handlePayment(paymentTab === 'topup' ? 'minutes' : 'subscription')}
                                            disabled={processing || (paymentTab === 'topup' && !rechargeAmount)}
                                            style={{
                                                width: '100%', padding: '13px', borderRadius: '10px', border: 'none',
                                                background: (processing || (paymentTab === 'topup' && !rechargeAmount))
                                                    ? '#94a3b8'
                                                    : 'linear-gradient(135deg, #008F4B 0%, #006830 100%)',
                                                color: 'white', fontWeight: '700', fontSize: '0.95rem',
                                                cursor: (processing || (paymentTab === 'topup' && !rechargeAmount)) ? 'not-allowed' : 'pointer',
                                                display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px',
                                                transition: 'all 0.2s'
                                            }}
                                        >
                                            {processing ? <div className="spinner-small" /> : <Zap size={16} />}
                                            {processing
                                                ? 'Processing...'
                                                : paymentTab === 'topup'
                                                    ? `Pay ₹${(rechargeAmount || 0).toLocaleString('en-IN')}`
                                                    : 'Pay ₹9,999 — Extend & Get Credits'}
                                        </button>
                                        <div style={{ textAlign: 'center', marginTop: '8px', fontSize: '0.72rem', color: '#94a3b8' }}>
                                            Secured by Razorpay · Instant processing
                                        </div>
                                    </div>
                                </div>
                            </div>

                            {/* ── Usage Activity (unchanged) ── */}
                            <div style={{ background: 'white', borderRadius: '20px', padding: '2rem', border: '1px solid var(--border)', boxShadow: '0 2px 12px rgba(0,0,0,0.03)', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
                                    <div>
                                        <h2 style={{ fontSize: '1.15rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                                            <TrendingUp size={20} color="var(--primary)" /> Usage Activity
                                        </h2>
                                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginTop: '4px', marginBottom: 0 }}>Daily minute consumption and trends</p>
                                    </div>
                                    <Link to="/admin/usage-history" style={{ fontSize: '0.82rem', color: 'var(--primary)', fontWeight: '600', textDecoration: 'none', display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 14px', borderRadius: '8px', border: '1.5px solid rgba(0,143,75,0.25)', background: 'rgba(0,143,75,0.04)' }}>
                                        View Usage Ledger <ChevronRight size={14} />
                                    </Link>
                                </div>
                                <UsageGraph userId={authUser?.id} />
                            </div>
                        </div>
                    );
                })()}

                {/* ==================== HISTORY TAB ==================== */}
                {
                    activeTab === 'history' && (
                        <div style={{ background: 'white', borderRadius: '20px', padding: '1.5rem', border: '1px solid var(--border)', boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '8px' }}>
                                <h2 style={{ fontSize: '1.15rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <CreditCard size={20} color="var(--primary)" /> Payment History
                                </h2>
                                <button onClick={fetchTransactions} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'white', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                    <RefreshCw size={14} /> Refresh
                                </button>
                            </div>

                            {transactions.length === 0 ? (
                                <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                                    <CreditCard size={48} style={{ opacity: 0.2, display: 'block', margin: '0 auto 16px' }} />
                                    No payment transactions found
                                </div>
                            ) : (
                                <>
                                    {/* Desktop Table */}
                                    <div className="table-container desktop-only">
                                        <table className="session-table">
                                            <thead>
                                                <tr>
                                                    <th>Date & Time</th>
                                                    <th>Description</th>
                                                    <th style={{ textAlign: 'center' }}>Amount</th>
                                                    <th>Status</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {transactions.map((txn) => {
                                                    const isCredit = txn.transaction_type === 'credit';
                                                    const isCall = txn.type === 'call';
                                                    const details = txn.details || {};
                                                    const amount = isCredit ? txn.credit_amount : txn.debit_amount;
                                                    const amountLabel = `${parseFloat(amount || 0).toFixed(2)} Credits`;
                                                    const rawStatus = (details.status || txn.status || '').toLowerCase();
                                                    const statusConfig = rawStatus === 'captured' || rawStatus === 'completed'
                                                        ? { label: 'Success', color: '#059669', bg: 'rgba(5,150,105,0.1)' }
                                                        : rawStatus === 'failed' || rawStatus === 'refused' || rawStatus === 'refunded'
                                                            ? { label: 'Failed', color: '#ef4444', bg: 'rgba(239,68,68,0.1)' }
                                                            : rawStatus === 'created' || rawStatus === 'pending'
                                                                ? { label: 'Pending', color: '#d97706', bg: 'rgba(217,119,6,0.1)' }
                                                                : isCall
                                                                    ? { label: 'Completed', color: '#059669', bg: 'rgba(5,150,105,0.1)' }
                                                                    : { label: rawStatus || 'Success', color: '#059669', bg: 'rgba(5,150,105,0.1)' };
                                                    return (
                                                        <tr key={txn.id} className="session-row">
                                                            <td>
                                                                <div style={{ fontSize: '0.875rem', fontWeight: '600' }}>{new Date(txn.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
                                                                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{new Date(txn.created_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}</div>
                                                            </td>
                                                            <td>
                                                                <div style={{ fontWeight: '600', color: 'var(--text)' }}>{txn.description}</div>
                                                                {isCall && (
                                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '2px' }}>
                                                                        {details.from && details.to ? `${details.from} → ${details.to}` : details.from || details.to || ''}
                                                                        {details.session_id && (
                                                                            <Link to={`/admin/session/${details.session_id}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '3px', color: 'var(--primary)', textDecoration: 'none', fontWeight: '600', marginLeft: '8px' }}>
                                                                                <LinkIcon size={11} /> View Session
                                                                            </Link>
                                                                        )}
                                                                    </div>
                                                                )}
                                                                {!isCall && details.order_id && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontFamily: 'monospace', marginTop: '2px' }}>{details.order_id}</div>}
                                                            </td>
                                                            <td style={{ textAlign: 'center', fontWeight: '700', color: isCredit ? 'var(--primary)' : '#ef4444', fontSize: '1rem' }}>
                                                                {isCredit ? '+' : '-'}{amountLabel}
                                                            </td>
                                                            <td>
                                                                <span style={{ padding: '3px 10px', borderRadius: '20px', fontSize: '0.75rem', fontWeight: '700', background: statusConfig.bg, color: statusConfig.color }}>
                                                                    {statusConfig.label}
                                                                </span>
                                                            </td>
                                                        </tr>
                                                    );
                                                })}
                                            </tbody>
                                        </table>
                                    </div>

                                    {/* Mobile Cards */}
                                    <div className="mobile-only sessions-cards">
                                        {transactions.map((txn) => {
                                            const isCredit = txn.transaction_type === 'credit';
                                            const isCall = txn.type === 'call';
                                            const details = txn.details || {};
                                            const amount = isCredit ? txn.credit_amount : txn.debit_amount;
                                            return (
                                                <div key={txn.id} className="session-card">
                                                    <div className="session-card-header">
                                                        <div style={{ fontWeight: '700', color: 'var(--text)' }}>{txn.description}</div>
                                                        <div style={{ fontWeight: '800', color: isCredit ? 'var(--primary)' : '#ef4444', fontSize: '1rem' }}>
                                                            {isCredit ? '+' : '-'}{parseFloat(amount || 0).toFixed(2)} C
                                                        </div>
                                                    </div>
                                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                                                        {new Date(txn.created_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                    {isCall && details.session_id && (
                                                        <Link to={`/admin/session/${details.session_id}`} style={{ fontSize: '0.8rem', color: 'var(--primary)', textDecoration: 'none', fontWeight: '600', marginTop: '4px', display: 'block' }}>
                                                            → View Session
                                                        </Link>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Pagination */}
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem', marginTop: '1.5rem', borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
                                        <button className="pagination-btn" disabled={transactionsPage === 1} onClick={() => setTransactionsPage(p => Math.max(1, p - 1))}>
                                            <ChevronLeft size={16} /> Previous
                                        </button>
                                        <span style={{ color: 'var(--text-muted)', fontSize: '0.875rem', fontWeight: '500' }}>
                                            Page {transactionsPage} of {transactionsPagination.totalPages || 1}
                                        </span>
                                        <button className="pagination-btn" disabled={transactionsPage >= transactionsPagination.totalPages} onClick={() => setTransactionsPage(p => Math.min(transactionsPagination.totalPages, p + 1))}>
                                            Next <ChevronRight size={16} />
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    )
                }

                {/* ==================== ADMIN TOOLS TAB ==================== */}
                {activeTab === 'admin' && (authUser?.role === 'super_admin' || authUser?.isMaster) && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>

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
                                            {users.filter(u => u.user_id !== authUser?.id).map(u => (
                                                <option key={u.user_id} value={u.user_id}>
                                                    {u.name || u.email} — {parseFloat(u.minutes_balance || 0).toFixed(0)} credits
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
                                            {users.map(u => (
                                                <option key={u.user_id} value={u.user_id}>{u.name || u.email}</option>
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
                @media (max-width: 768px) {
                    .billing-tab-bar { overflow-x: auto; }
                }
            `}</style>
        </React.Fragment >
    );
};

export default Billing;
