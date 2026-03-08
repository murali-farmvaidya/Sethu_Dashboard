import React, { useState, useEffect, useRef } from 'react';
import { paymentAPI, adminAPI } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { toast } from 'react-hot-toast';
import { Link } from 'react-router-dom';
import {
    CreditCard, CheckCircle, AlertCircle,
    Download, ChevronLeft, ChevronRight,
    Calendar, ArrowUpRight, ArrowDownLeft,
    Link as LinkIcon, RefreshCw, Zap
} from 'lucide-react';

const Billing = () => {
    const { user: authUser, refreshUser } = useAuth();
    const [balances, setBalances] = useState(null);
    const [loading, setLoading] = useState(true);
    const [processing, setProcessing] = useState(false);
    const [rechargeAmount, setRechargeAmount] = useState(1000);
    const [paymentTab, setPaymentTab] = useState('topup');
    useEffect(() => { fetchBalances(); }, []);

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


    if (loading) return (
        <React.Fragment>
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

    return (
        <React.Fragment>
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

                {/* ==================== OVERVIEW TAB ==================== */}
                {(() => {
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


                        </div>
                    );
                })()}



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
