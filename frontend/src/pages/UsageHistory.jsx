import React, { useState, useEffect, useCallback, useRef } from 'react';
import { paymentAPI } from '../services/api';
import {
    ArrowLeft, Clock, PhoneIncoming, PhoneOutgoing,
    ChevronLeft, ChevronRight, CheckCircle, XCircle, Search, X
} from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';

const formatDuration = (seconds) => {
    if (!seconds && seconds !== 0) return '—';
    const s = parseInt(seconds, 10);
    if (s <= 0) return '< 1s';
    const m = Math.floor(s / 60);
    const rem = s % 60;
    if (m === 0) return `${rem}s`;
    if (rem === 0) return `${m}m`;
    return `${m}m ${rem}s`;
};

const DIRECTION_OPTIONS = [
    { value: '', label: 'All Calls' },
    { value: 'outbound', label: 'Outgoing' },
    { value: 'inbound', label: 'Incoming' },
];

const UsageHistory = () => {
    const navigate = useNavigate();
    const [transactions, setTransactions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(1);
    const [pagination, setPagination] = useState({ total: 0, totalPages: 1 });

    // Filters
    const [direction, setDirection] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [search, setSearch] = useState(''); // debounced
    const searchTimerRef = useRef(null);

    const limit = 10;

    const fetchHistory = useCallback(async () => {
        try {
            setLoading(true);
            const response = await paymentAPI.getTransactionHistory('calls', page, limit, direction, search);
            if (response.data.success) {
                setTransactions(response.data.data);
                if (response.data.pagination) setPagination(response.data.pagination);
            }
        } catch (error) {
            console.error('Failed to fetch history:', error);
            toast.error('Failed to load usage history');
        } finally {
            setLoading(false);
        }
    }, [page, direction, search]);

    useEffect(() => { fetchHistory(); }, [fetchHistory]);

    // Reset to page 1 when filters change
    useEffect(() => { setPage(1); }, [direction, search]);

    // Debounce search input by 400ms
    const handleSearchChange = (val) => {
        setSearchInput(val);
        clearTimeout(searchTimerRef.current);
        searchTimerRef.current = setTimeout(() => setSearch(val), 400);
    };

    const clearSearch = () => {
        setSearchInput('');
        setSearch('');
    };

    const hasActiveFilters = direction || search;

    return (
        <React.Fragment>
            <div className="page-container">
                {/* Page Header */}
                <div className="page-header">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                        <button onClick={() => navigate('/admin/billing')} className="btn-back">
                            <ArrowLeft size={16} /> Back
                        </button>
                        <h1>Call Usage Ledger</h1>
                    </div>
                </div>

                <div className="card" style={{ padding: 0, overflow: 'hidden' }}>

                    {/* ── Toolbar ──────────────────────────────── */}
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: '12px', flexWrap: 'wrap',
                        padding: '16px 20px',
                        borderBottom: '1px solid var(--border)',
                        background: 'var(--bg-secondary, #f8fafb)'
                    }}>
                        {/* Left: title + count */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <Clock size={18} color="var(--primary)" />
                            <span style={{ fontWeight: '700', fontSize: '0.95rem', color: 'var(--text)' }}>
                                Call Usage
                            </span>
                            <span style={{
                                background: 'var(--primary)', color: '#fff',
                                borderRadius: '20px', padding: '2px 10px',
                                fontSize: '0.75rem', fontWeight: '700'
                            }}>
                                {pagination.total}
                            </span>
                        </div>

                        {/* Right: filters */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>

                            {/* Direction buttons */}
                            <div style={{
                                display: 'flex', background: 'var(--bg, #fff)',
                                border: '1px solid var(--border)', borderRadius: '8px', overflow: 'hidden'
                            }}>
                                {DIRECTION_OPTIONS.map(opt => (
                                    <button
                                        key={opt.value}
                                        onClick={() => setDirection(opt.value)}
                                        style={{
                                            padding: '6px 14px', border: 'none', cursor: 'pointer',
                                            fontSize: '0.78rem', fontWeight: '600',
                                            background: direction === opt.value ? 'var(--primary)' : 'transparent',
                                            color: direction === opt.value ? '#fff' : 'var(--text-muted)',
                                            transition: 'all 0.15s',
                                            borderRight: opt.value !== 'inbound' ? '1px solid var(--border)' : 'none'
                                        }}
                                    >
                                        {opt.value === 'outbound' && <PhoneOutgoing size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />}
                                        {opt.value === 'inbound' && <PhoneIncoming size={11} style={{ marginRight: 4, verticalAlign: 'middle' }} />}
                                        {opt.label}
                                    </button>
                                ))}
                            </div>

                            {/* Phone search */}
                            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                                <Search size={14} style={{
                                    position: 'absolute', left: '10px',
                                    color: 'var(--text-muted)', pointerEvents: 'none'
                                }} />
                                <input
                                    type="text"
                                    placeholder="Search phone number..."
                                    value={searchInput}
                                    onChange={e => handleSearchChange(e.target.value)}
                                    style={{
                                        paddingLeft: '32px', paddingRight: searchInput ? '32px' : '12px',
                                        paddingTop: '7px', paddingBottom: '7px',
                                        border: '1px solid var(--border)', borderRadius: '8px',
                                        fontSize: '0.82rem', background: 'var(--bg, #fff)',
                                        color: 'var(--text)', outline: 'none', width: '200px',
                                        transition: 'border-color 0.15s'
                                    }}
                                    onFocus={e => e.target.style.borderColor = 'var(--primary)'}
                                    onBlur={e => e.target.style.borderColor = 'var(--border)'}
                                />
                                {searchInput && (
                                    <button onClick={clearSearch} style={{
                                        position: 'absolute', right: '8px',
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        color: 'var(--text-muted)', padding: '2px', display: 'flex'
                                    }}>
                                        <X size={13} />
                                    </button>
                                )}
                            </div>

                            {/* Clear all */}
                            {hasActiveFilters && (
                                <button
                                    onClick={() => { setDirection(''); clearSearch(); }}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '4px',
                                        padding: '6px 12px', border: '1px solid #fca5a5',
                                        borderRadius: '8px', background: '#fff1f1', color: '#dc2626',
                                        fontSize: '0.78rem', fontWeight: '600', cursor: 'pointer'
                                    }}
                                >
                                    <X size={12} /> Clear filters
                                </button>
                            )}
                        </div>
                    </div>

                    {/* ── Table ────────────────────────────────── */}
                    {loading ? (
                        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                            <div className="spinner" style={{ margin: '0 auto 1rem' }}></div>
                            Loading call records...
                        </div>
                    ) : transactions.length === 0 ? (
                        <div style={{ padding: '4rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                            <PhoneOutgoing size={36} style={{ opacity: 0.3, marginBottom: '12px' }} />
                            <div style={{ fontWeight: '600', marginBottom: '4px' }}>No call records found</div>
                            {hasActiveFilters && (
                                <div style={{ fontSize: '0.85rem' }}>
                                    Try adjusting your filters or{' '}
                                    <button onClick={() => { setDirection(''); clearSearch(); }}
                                        style={{ color: 'var(--primary)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: '600' }}>
                                        clear them
                                    </button>
                                </div>
                            )}
                        </div>
                    ) : (
                        <div style={{ overflowX: 'auto' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                <thead>
                                    <tr style={{ borderBottom: '2px solid var(--border, #e5e7eb)' }}>
                                        <th style={thStyle}>Date & Time</th>
                                        <th style={thStyle}>Duration</th>
                                        <th style={{ ...thStyle, minWidth: '300px' }}>Call Details</th>
                                        <th style={thStyle}>Credits</th>
                                        <th style={thStyle}>Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {transactions.map((txn, idx) => {
                                        const details = txn.details || {};
                                        const isInbound = details.direction === 'inbound';
                                        const creditsUsed = parseFloat(txn.debit_amount || 0).toFixed(2);
                                        const callStatus = details.status || txn.status || 'Completed';
                                        const isCompleted = ['completed', 'Completed', 'captured'].includes(callStatus);
                                        const durationSecs = details.duration || 0;
                                        const userNumber = isInbound ? details.from : details.to;
                                        const agentNumber = isInbound ? details.to : details.from;

                                        const txnDate = new Date(
                                            (txn.created_at || '').replace(' ', 'T').endsWith('Z')
                                                ? txn.created_at
                                                : (txn.created_at || '').replace(' ', 'T') + 'Z'
                                        );
                                        const rowBg = idx % 2 === 0 ? 'var(--bg, #fff)' : 'var(--bg-secondary, #fafbfc)';

                                        return (
                                            <tr
                                                key={txn.id}
                                                style={{ borderBottom: '1px solid var(--border, #f0f2f5)', background: rowBg, transition: 'background 0.12s' }}
                                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(0,143,75,0.04)'}
                                                onMouseLeave={e => e.currentTarget.style.background = rowBg}
                                            >
                                                {/* DATE */}
                                                <td style={tdStyle}>
                                                    <div style={{ fontWeight: '700', fontSize: '0.87rem', color: 'var(--text, #111)', whiteSpace: 'nowrap' }}>
                                                        {txnDate.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
                                                    </div>
                                                    <div style={{ fontSize: '0.74rem', color: 'var(--text-muted, #9ca3af)', marginTop: '3px', whiteSpace: 'nowrap' }}>
                                                        {txnDate.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
                                                    </div>
                                                </td>

                                                {/* DURATION */}
                                                <td style={tdStyle}>
                                                    <span style={{
                                                        display: 'inline-block',
                                                        background: durationSecs > 0 ? 'rgba(0,143,75,0.08)' : 'var(--bg-secondary,#f9fafb)',
                                                        color: durationSecs > 0 ? 'var(--primary,#008f4b)' : 'var(--text-muted,#9ca3af)',
                                                        border: `1px solid ${durationSecs > 0 ? 'rgba(0,143,75,0.2)' : 'var(--border,#e5e7eb)'}`,
                                                        borderRadius: '6px', padding: '4px 10px',
                                                        fontSize: '0.84rem', fontWeight: '700',
                                                        fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap'
                                                    }}>
                                                        {formatDuration(durationSecs)}
                                                    </span>
                                                </td>

                                                {/* CALL DETAILS */}
                                                <td style={tdStyle}>
                                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>

                                                        {/* Direction icon only */}
                                                        <span title={isInbound ? 'Incoming' : 'Outgoing'} style={{
                                                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                            width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                                                            background: isInbound ? 'rgba(34,197,94,0.12)' : 'rgba(99,102,241,0.12)',
                                                            color: isInbound ? '#15803d' : '#4338ca',
                                                            border: `1px solid ${isInbound ? 'rgba(34,197,94,0.3)' : 'rgba(99,102,241,0.3)'}`
                                                        }}>
                                                            {isInbound ? <PhoneIncoming size={13} /> : <PhoneOutgoing size={13} />}
                                                        </span>

                                                        {/* Phone number — clickable if session exists */}
                                                        {details.session_id ? (
                                                            <Link
                                                                to={`/admin/session/${details.session_id}`}
                                                                style={{
                                                                    fontSize: '0.9rem', fontWeight: '700',
                                                                    letterSpacing: '0.7px',
                                                                    fontFamily: '"Courier New", monospace',
                                                                    color: 'var(--primary)',
                                                                    textDecoration: 'none',
                                                                    whiteSpace: 'nowrap'
                                                                }}
                                                            >
                                                                {userNumber || '—'}
                                                            </Link>
                                                        ) : (
                                                            <span style={{
                                                                fontSize: '0.9rem', fontWeight: '700',
                                                                letterSpacing: '0.7px',
                                                                fontFamily: '"Courier New", monospace',
                                                                color: 'var(--text, #111827)',
                                                                whiteSpace: 'nowrap'
                                                            }}>
                                                                {userNumber || '—'}
                                                            </span>
                                                        )}
                                                    </div>
                                                </td>

                                                {/* CREDITS */}
                                                <td style={tdStyle}>
                                                    <span style={{
                                                        fontWeight: '800',
                                                        fontSize: '1rem',
                                                        color: '#dc2626',
                                                        fontVariantNumeric: 'tabular-nums'
                                                    }}>
                                                        −{creditsUsed}
                                                    </span>
                                                </td>

                                                {/* STATUS */}
                                                <td style={tdStyle}>
                                                    <span style={{
                                                        display: 'inline-flex', alignItems: 'center', gap: '5px',
                                                        padding: '4px 11px', borderRadius: '20px',
                                                        fontSize: '0.72rem', fontWeight: '700', whiteSpace: 'nowrap',
                                                        background: isCompleted ? 'rgba(0,143,75,0.1)' : 'rgba(239,68,68,0.1)',
                                                        color: isCompleted ? '#166534' : '#dc2626',
                                                        border: `1px solid ${isCompleted ? 'rgba(0,143,75,0.25)' : 'rgba(239,68,68,0.25)'}`
                                                    }}>
                                                        {isCompleted ? <CheckCircle size={11} /> : <XCircle size={11} />}
                                                        {isCompleted ? 'Completed' : callStatus}
                                                    </span>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    )}

                    {/* ── Pagination ───────────────────────────── */}
                    {pagination.totalPages > 1 && (
                        <div style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '12px 20px', borderTop: '1px solid var(--border)',
                            background: 'var(--bg-secondary, #f8fafb)'
                        }}>
                            <span style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>
                                Showing {((page - 1) * limit) + 1}–{Math.min(page * limit, pagination.total)} of {pagination.total} records
                            </span>
                            <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                <button
                                    className="btn-secondary"
                                    disabled={page === 1}
                                    onClick={() => setPage(p => Math.max(1, p - 1))}
                                    style={{ opacity: page === 1 ? 0.45 : 1, cursor: page === 1 ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px' }}
                                >
                                    <ChevronLeft size={15} /> Prev
                                </button>
                                {/* Page pills */}
                                {Array.from({ length: Math.min(pagination.totalPages, 5) }, (_, i) => {
                                    const pg = pagination.totalPages <= 5 ? i + 1
                                        : page <= 3 ? i + 1
                                            : page >= pagination.totalPages - 2 ? pagination.totalPages - 4 + i
                                                : page - 2 + i;
                                    return (
                                        <button key={pg} onClick={() => setPage(pg)} style={{
                                            width: '32px', height: '32px', borderRadius: '6px',
                                            cursor: 'pointer', fontSize: '0.82rem', fontWeight: '600',
                                            background: pg === page ? 'var(--primary)' : 'var(--bg,#fff)',
                                            color: pg === page ? '#fff' : 'var(--text-muted)',
                                            border: pg === page ? 'none' : '1px solid var(--border)',
                                            transition: 'all 0.15s'
                                        }}>
                                            {pg}
                                        </button>
                                    );
                                })}
                                <button
                                    className="btn-secondary"
                                    disabled={page >= pagination.totalPages}
                                    onClick={() => setPage(p => Math.min(pagination.totalPages, p + 1))}
                                    style={{ opacity: page >= pagination.totalPages ? 0.45 : 1, cursor: page >= pagination.totalPages ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px' }}
                                >
                                    Next <ChevronRight size={15} />
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </React.Fragment>
    );
};

const thStyle = {
    padding: '11px 16px',
    fontWeight: '600',
    color: 'var(--text-muted, #6b7280)',
    fontSize: '0.73rem',
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    whiteSpace: 'nowrap',
    textAlign: 'center',
    background: 'var(--bg-secondary, #f8fafb)'
};

const tdStyle = {
    padding: '13px 16px',
    verticalAlign: 'middle',
    textAlign: 'center'
};

export default UsageHistory;
