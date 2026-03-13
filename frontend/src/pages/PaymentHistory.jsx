import React, { useState, useEffect } from 'react';
import { paymentAPI } from '../services/api';
import { toast } from 'react-hot-toast';
import { CreditCard, RefreshCw, ChevronLeft, ChevronRight, LinkIcon, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';

const PaymentHistory = () => {
    const [transactions, setTransactions] = useState([]);
    const [processing, setProcessing] = useState(false);
    const [transactionsPage, setTransactionsPage] = useState(1);
    const [transactionsPagination, setTransactionsPagination] = useState({ total: 0, totalPages: 1 });
    const transactionsLimit = 10;

    useEffect(() => { fetchTransactions(); }, [transactionsPage]);

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

    return (
        <div className="page-container" style={{ maxWidth: 1300 }}>
            {/* Page Header */}
            <div style={{ marginBottom: '2.5rem', textAlign: 'center' }}>
                <h1 style={{ fontSize: '2rem', fontWeight: '800', color: 'var(--text)', marginBottom: '4px' }}>
                    Payment History
                </h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                    View a ledger of your past transactions and top-ups
                </p>
            </div>

            <div style={{ background: 'white', borderRadius: '20px', padding: '1.5rem', border: '1px solid var(--border)', boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '8px' }}>
                    <h2 style={{ fontSize: '1.15rem', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <CreditCard size={20} color="var(--primary)" /> Payment Transactions
                    </h2>
                    <button onClick={fetchTransactions} style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 12px', borderRadius: '8px', border: '1px solid var(--border)', background: 'white', cursor: 'pointer', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                        <RefreshCw size={14} className={processing ? "spin" : ""} /> Refresh
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
                                                    <div style={{ fontSize: '0.875rem', fontWeight: '600' }}>
                                                        {(() => {
                                                            const d = new Date(txn.created_at);
                                                            const day = d.getDate().toString().padStart(2, '0');
                                                            const month = (d.getMonth() + 1).toString().padStart(2, '0');
                                                            const year = d.getFullYear();
                                                            return `${day}-${month}-${year}`;
                                                        })()}
                                                    </div>
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
                                            {(() => {
                                                const d = new Date(txn.created_at);
                                                const day = d.getDate().toString().padStart(2, '0');
                                                const month = (d.getMonth() + 1).toString().padStart(2, '0');
                                                const year = d.getFullYear();
                                                const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                                                return `${day}-${month}-${year}, ${time}`;
                                            })()}
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

            <style>{`
                .spin { animation: spin 1s linear infinite; }
                @keyframes spin { 100% { transform: rotate(360deg); } }
            `}</style>
        </div>
    );
};

export default PaymentHistory;
