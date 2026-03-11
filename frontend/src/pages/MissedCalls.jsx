import React, { useState, useEffect } from 'react';
import { userAPI } from '../services/api';
import toast from 'react-hot-toast';
import { 
    PhoneOff, 
    RefreshCw, 
    Calendar, 
    Clock, 
    User, 
    Phone, 
    AlertCircle, 
    ChevronLeft, 
    ChevronRight,
    Search,
    ArrowUpDown,
    Download,
    X
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export default function MissedCalls() {
    const [missedCalls, setMissedCalls] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [currentPage, setCurrentPage] = useState(1);
    const [itemsPerPage] = useState(10);
    const [sortConfig, setSortConfig] = useState({ key: 'timestamp', direction: 'desc' });
    
    const navigate = useNavigate();

    useEffect(() => {
        fetchMissedCalls();
    }, []);

    const fetchMissedCalls = async () => {
        try {
            setLoading(true);
            const res = await userAPI.getMissedCalls();
            if (res.data && res.data.success) {
                setMissedCalls(res.data.missedCalls || []);
            } else {
                toast.error('Failed to fetch missed calls');
            }
        } catch (error) {
            console.error('Fetch missed calls error:', error);
            toast.error('Error loading missed calls');
        } finally {
            setLoading(false);
        }
    };

    const handleSort = (key) => {
        let direction = 'desc';
        if (sortConfig.key === key && sortConfig.direction === 'desc') {
            direction = 'asc';
        }
        setSortConfig({ key, direction });
    };

    const sortedCalls = [...missedCalls].sort((a, b) => {
        if (!a[sortConfig.key] || !b[sortConfig.key]) return 0;
        
        let valA = a[sortConfig.key];
        let valB = b[sortConfig.key];
        
        if (typeof valA === 'string') {
            valA = valA.toLowerCase();
            valB = valB.toLowerCase();
        }
        
        if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
        return 0;
    });

    const filteredCalls = sortedCalls.filter(call => 
        (call.from_number && call.from_number.includes(searchTerm)) ||
        (call.to_number && call.to_number.includes(searchTerm)) ||
        (call.call_sid && call.call_sid.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (call.detailed_status && call.detailed_status.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = filteredCalls.slice(indexOfFirstItem, indexOfLastItem);
    const totalPages = Math.ceil(filteredCalls.length / itemsPerPage);

    const formatDate = (dateStr) => {
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
    };

    const formatTime = (dateStr) => {
        const date = new Date(dateStr);
        return date.toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
    };

    const getStatusVariant = (status) => {
        const s = (status || '').toLowerCase();
        if (s.includes('throttle') || s.includes('limit')) return 'warning';
        if (s.includes('fail') || s.includes('error')) return 'error';
        return 'info';
    };

    const downloadCSV = () => {
        if (missedCalls.length === 0) return;
        
        const headers = ['Date', 'Time', 'From', 'To', 'Status', 'Detailed Status', 'Call SID'];
        const rows = missedCalls.map(call => [
            formatDate(call.timestamp),
            formatTime(call.timestamp),
            call.from_number,
            call.to_number,
            call.status,
            call.detailed_status,
            call.call_sid
        ]);
        
        const csvContent = [headers, ...rows].map(e => e.join(",")).join("\n");
        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.setAttribute("href", url);
        link.setAttribute("download", `missed_calls_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    return (
        <div className="page-container" style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
            {/* Header Section */}
            <div style={{ 
                display: 'flex', 
                justifyContent: 'space-between', 
                alignItems: 'flex-start',
                marginBottom: '32px'
            }}>
                <div>
                    <h1 style={{ 
                        fontSize: '28px', 
                        fontWeight: '800', 
                        color: 'var(--text)',
                        margin: 0,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '12px'
                    }}>
                        <div style={{ 
                            background: 'rgba(239, 68, 68, 0.1)', 
                            color: '#ef4444', 
                            padding: '10px', 
                            borderRadius: '12px',
                            display: 'flex'
                        }}>
                            <PhoneOff size={24} />
                        </div>
                        Missed Calls
                    </h1>
                    <p style={{ color: 'var(--text-muted)', marginTop: '8px', fontSize: '15px' }}>
                        Track and manage calls that didn't connect to your agents.
                    </p>
                </div>
                
                <div style={{ display: 'flex', gap: '12px' }}>
                    <button 
                        onClick={downloadCSV}
                        className="btn-secondary"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px' }}
                    >
                        <Download size={18} /> Export CSV
                    </button>
                    <button 
                        onClick={fetchMissedCalls}
                        className="btn-primary"
                        style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', background: 'var(--primary)' }}
                        disabled={loading}
                    >
                        <RefreshCw size={18} className={loading ? 'spin' : ''} /> Refresh
                    </button>
                </div>
            </div>

            {/* Stats Cards */}
            <div style={{ 
                display: 'grid', 
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', 
                gap: '24px',
                marginBottom: '32px'
            }}>
                <div className="card" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <div style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '12px', borderRadius: '50%' }}>
                        <PhoneOff size={24} />
                    </div>
                    <div>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Total Missed</div>
                        <div style={{ fontSize: '28px', fontWeight: '800', color: 'var(--text)', marginTop: '4px' }}>{missedCalls.length}</div>
                    </div>
                </div>
                <div className="card" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <div style={{ background: 'rgba(245, 158, 11, 0.1)', color: '#f59e0b', padding: '12px', borderRadius: '50%' }}>
                        <AlertCircle size={24} />
                    </div>
                    <div>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Throttled Calls</div>
                        <div style={{ fontSize: '28px', fontWeight: '800', color: 'var(--text)', marginTop: '4px' }}>
                            {missedCalls.filter(c => (c.detailed_status || '').toLowerCase().includes('throttle')).length}
                        </div>
                    </div>
                </div>
                <div className="card" style={{ padding: '24px', display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <div style={{ background: 'rgba(59, 130, 246, 0.1)', color: '#3b82f6', padding: '12px', borderRadius: '50%' }}>
                        <Clock size={24} />
                    </div>
                    <div>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Last 24 Hours</div>
                        <div style={{ fontSize: '28px', fontWeight: '800', color: 'var(--text)', marginTop: '4px' }}>
                            {missedCalls.filter(c => new Date(c.timestamp) > new Date(Date.now() - 24 * 60 * 60 * 1000)).length}
                        </div>
                    </div>
                </div>
            </div>

            {/* Search and Filters Bar */}
            <div className="card" style={{ padding: '16px', marginBottom: '24px', display: 'flex', gap: '16px', alignItems: 'center', background: 'white' }}>
                <div style={{ position: 'relative', flex: 1 }}>
                    <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input 
                        type="text" 
                        placeholder="Search by number, SID or status..." 
                        value={searchTerm}
                        onChange={(e) => { setSearchTerm(e.target.value); setCurrentPage(1); }}
                        style={{ 
                            width: '100%', 
                            padding: '10px 10px 10px 40px', 
                            borderRadius: '8px', 
                            border: '1px solid var(--border)',
                            outline: 'none',
                            fontSize: '14px'
                        }}
                    />
                    {searchTerm && (
                        <X 
                            size={16} 
                            onClick={() => setSearchTerm('')}
                            style={{ position: 'absolute', right: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', cursor: 'pointer' }} 
                        />
                    )}
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '14px', fontWeight: '500' }}>
                    Showing {filteredCalls.length} results
                </div>
            </div>

            {/* Table Section */}
            <div className="card" style={{ overflow: 'hidden', background: 'white' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                            <tr style={{ background: '#f8fafc', borderBottom: '1px solid var(--border)' }}>
                                <th onClick={() => handleSort('timestamp')} style={{ padding: '16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', cursor: 'pointer' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        Timestamp <ArrowUpDown size={14} />
                                    </div>
                                </th>
                                <th style={{ padding: '16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase' }}>From Number</th>
                                <th style={{ padding: '16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase' }}>To Number</th>
                                <th onClick={() => handleSort('status')} style={{ padding: '16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase', cursor: 'pointer' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        Status <ArrowUpDown size={14} />
                                    </div>
                                </th>
                                <th style={{ padding: '16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Detailed Status</th>
                                <th style={{ padding: '16px', textAlign: 'left', fontSize: '13px', fontWeight: '600', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Call SID</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                Array(5).fill(0).map((_, i) => (
                                    <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                                        <td colSpan="6" style={{ padding: '24px', textAlign: 'center' }}>
                                            <div style={{ display: 'flex', justifyContent: 'center' }}><RefreshCw className="spin" size={24} color="#CBD5E1" /></div>
                                        </td>
                                    </tr>
                                ))
                            ) : currentItems.length === 0 ? (
                                <tr>
                                    <td colSpan="6" style={{ padding: '48px', textAlign: 'center', color: 'var(--text-muted)' }}>
                                        <PhoneOff size={48} style={{ opacity: 0.2, marginBottom: '16px' }} />
                                        <p style={{ margin: 0, fontSize: '16px', fontWeight: '500' }}>No missed calls found.</p>
                                    </td>
                                </tr>
                            ) : (
                                currentItems.map((call) => (
                                    <tr key={call.id} className="table-row" style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.2s' }}>
                                        <td style={{ padding: '16px' }}>
                                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                                                <span style={{ fontWeight: '600', color: 'var(--text)', fontSize: '14px' }}>{formatDate(call.timestamp)}</span>
                                                <span style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{formatTime(call.timestamp)}</span>
                                            </div>
                                        </td>
                                        <td style={{ padding: '16px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text)', fontWeight: '500' }}>
                                                <Phone size={14} style={{ color: 'var(--primary)' }} />
                                                {call.from_number}
                                            </div>
                                        </td>
                                        <td style={{ padding: '16px', color: 'var(--text-muted)', fontSize: '14px' }}>
                                            {call.to_number}
                                        </td>
                                        <td style={{ padding: '16px' }}>
                                            <span style={{ 
                                                padding: '4px 10px', 
                                                borderRadius: '20px', 
                                                fontSize: '12px', 
                                                fontWeight: '700',
                                                textTransform: 'uppercase',
                                                background: getStatusVariant(call.detailed_status) === 'warning' ? 'rgba(245, 158, 11, 0.1)' : 
                                                            getStatusVariant(call.detailed_status) === 'error' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(59, 130, 246, 0.1)',
                                                color: getStatusVariant(call.detailed_status) === 'warning' ? '#d97706' : 
                                                       getStatusVariant(call.detailed_status) === 'error' ? '#dc2626' : '#2563eb'
                                            }}>
                                                {call.status}
                                            </span>
                                        </td>
                                        <td style={{ padding: '16px', color: 'var(--text)', fontSize: '14px', maxWidth: '300px' }}>
                                            {call.detailed_status || '-'}
                                        </td>
                                        <td style={{ padding: '16px' }}>
                                            <span style={{ 
                                                fontFamily: 'monospace', 
                                                fontSize: '12px', 
                                                background: '#f1f5f9', 
                                                padding: '4px 8px', 
                                                borderRadius: '4px',
                                                color: '#64748b'
                                            }}>
                                                {call.call_sid ? `${call.call_sid.substring(0, 8)}...` : '-'}
                                            </span>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>

                {/* Pagination Section */}
                {!loading && totalPages > 1 && (
                    <div style={{ 
                        display: 'flex', 
                        justifyContent: 'center', 
                        alignItems: 'center', 
                        gap: '16px', 
                        padding: '20px', 
                        borderTop: '1px solid var(--border)',
                        background: '#f8fafc'
                    }}>
                        <button 
                            className="btn-secondary"
                            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                            disabled={currentPage === 1}
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 12px' }}
                        >
                            <ChevronLeft size={16} /> Previous
                        </button>
                        <span style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-muted)' }}>
                            Page {currentPage} of {totalPages}
                        </span>
                        <button 
                            className="btn-secondary"
                            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                            disabled={currentPage === totalPages}
                            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '8px 12px' }}
                        >
                            Next <ChevronRight size={16} />
                        </button>
                    </div>
                )}
            </div>
            
            <style dangerouslySetInnerHTML={{ __html: `
                .table-row:hover {
                    background-color: #f8fafc !important;
                }
                .btn-primary:hover {
                    opacity: 0.9;
                }
                .btn-secondary:hover {
                    background: #f1f5f9;
                }
                .spin {
                    animation: spin 1s linear infinite;
                }
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}} />
        </div>
    );
}
