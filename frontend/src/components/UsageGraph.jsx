import React, { useEffect, useState, useMemo } from 'react';
import { paymentAPI } from '../services/api';
import {
    BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, AreaChart, Area
} from 'recharts';
import { Calendar, ChevronLeft, ChevronRight, Download, Filter, TrendingUp } from 'lucide-react';

export default function UsageGraph({ userId }) {
    const [usageData, setUsageData] = useState({});
    const [loading, setLoading] = useState(true);
    const [dateRange, setDateRange] = useState('7d'); // 7d, 30d, 90d, custom
    const [customStart, setCustomStart] = useState('');
    const [customEnd, setCustomEnd] = useState('');

    useEffect(() => {
        const fetchUsage = async () => {
            try {
                setLoading(true);
                const res = await paymentAPI.getHeatmap(userId);
                if (res.data?.success) {
                    setUsageData(res.data.data || {});
                }
            } catch (e) {
                console.error('Usage fetch failed:', e);
            } finally {
                setLoading(false);
            }
        };
        fetchUsage();
    }, [userId]);

    const chartData = useMemo(() => {
        const data = [];
        const today = new Date();
        today.setHours(23, 59, 59, 999);

        let daysToFetch = 7;
        if (dateRange === '30d') daysToFetch = 30;
        else if (dateRange === '90d') daysToFetch = 90;
        else if (dateRange === '1y') daysToFetch = 365;

        let start = new Date();
        if (dateRange === 'custom' && customStart && customEnd) {
            start = new Date(customStart);
            const end = new Date(customEnd);
            let cur = new Date(start);
            while (cur <= end) {
                const key = cur.toISOString().split('T')[0];
                data.push({
                    date: cur.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                    fullDate: key,
                    minutes: parseFloat(usageData[key] || 0)
                });
                cur.setDate(cur.getDate() + 1);
            }
            return data;
        }

        start.setDate(today.getDate() - daysToFetch + 1);
        start.setHours(0, 0, 0, 0);

        let cur = new Date(start);
        while (cur <= today) {
            const key = cur.toISOString().split('T')[0];
            data.push({
                date: cur.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
                fullDate: key,
                minutes: parseFloat(usageData[key] || 0)
            });
            cur.setDate(cur.getDate() + 1);
        }
        return data;
    }, [usageData, dateRange, customStart, customEnd]);

    const totalMinutes = useMemo(() => {
        return chartData.reduce((acc, curr) => acc + curr.minutes, 0).toFixed(1);
    }, [chartData]);

    const avgMinutes = useMemo(() => {
        if (chartData.length === 0) return 0;
        return (totalMinutes / chartData.length).toFixed(1);
    }, [chartData, totalMinutes]);

    if (loading) {
        return (
            <div style={{ background: 'white', borderRadius: '20px', padding: '3rem', border: '1px solid var(--border)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px' }}>
                <div className="spinner-graph" />
                <p style={{ marginTop: '1rem', color: 'var(--text-muted)', fontWeight: '500' }}>Analyzing usage patterns...</p>
                <style>{`
                    .spinner-graph {
                        width: 40px; height: 40px;
                        border: 3px solid rgba(0,143,75,0.1);
                        border-top-color: var(--primary);
                        border-radius: 50%;
                        animation: spin 0.8s linear infinite;
                    }
                    @keyframes spin { to { transform: rotate(360deg); } }
                `}</style>
            </div>
        );
    }

    return (
        <div style={{ background: 'white', borderRadius: '24px', padding: '2rem', border: '1px solid var(--border)', boxShadow: '0 4px 20px rgba(0,0,0,0.03)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '2rem', flexWrap: 'wrap', gap: '1.5rem' }}>
                <div>
                    <h2 style={{ fontSize: '1.25rem', fontWeight: '800', display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text)' }}>
                        <TrendingUp size={22} color="var(--primary)" /> Usage Analytics
                    </h2>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem', marginTop: '4px' }}>
                        Total consumption: <strong style={{ color: 'var(--text)' }}>{totalMinutes} min</strong> &nbsp;·&nbsp;
                        Avg: <strong style={{ color: 'var(--text)' }}>{avgMinutes} min/day</strong>
                    </p>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: '#f3f4f6', padding: '4px', borderRadius: '12px' }}>
                    {[
                        { label: '7D', id: '7d' },
                        { label: '30D', id: '30d' },
                        { label: '90D', id: '90d' },
                        { label: 'Custom', id: 'custom' }
                    ].map(btn => (
                        <button
                            key={btn.id}
                            onClick={() => setDateRange(btn.id)}
                            style={{
                                padding: '6px 14px', borderRadius: '10px', border: 'none', cursor: 'pointer',
                                fontSize: '0.75rem', fontWeight: '700', transition: 'all 0.2s',
                                background: dateRange === btn.id ? 'white' : 'transparent',
                                color: dateRange === btn.id ? 'var(--primary)' : 'var(--text-muted)',
                                boxShadow: dateRange === btn.id ? '0 2px 6px rgba(0,0,0,0.08)' : 'none'
                            }}
                        >
                            {btn.label}
                        </button>
                    ))}
                </div>
            </div>

            {dateRange === 'custom' && (
                <div style={{ display: 'flex', gap: '10px', marginBottom: '1.5rem', alignItems: 'center', background: '#f8fafc', padding: '12px', borderRadius: '12px', border: '1px solid #e2e8f0' }}>
                    <Calendar size={16} color="var(--text-muted)" />
                    <input
                        type="date"
                        value={customStart}
                        onChange={e => setCustomStart(e.target.value)}
                        style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
                    />
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>to</span>
                    <input
                        type="date"
                        value={customEnd}
                        onChange={e => setCustomEnd(e.target.value)}
                        style={{ padding: '6px 10px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '0.8rem' }}
                    />
                </div>
            )}

            <div style={{ width: '100%', height: 320, marginTop: '1rem' }}>
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorUsage" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.2} />
                                <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                        <XAxis
                            dataKey="date"
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 500 }}
                            interval={dateRange === '7d' ? 0 : 'preserveStartEnd'}
                        />
                        <YAxis
                            axisLine={false}
                            tickLine={false}
                            tick={{ fontSize: 11, fill: '#94a3b8', fontWeight: 500 }}
                        />
                        <Tooltip
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 8px 30px rgba(0,0,0,0.12)', padding: '12px' }}
                            itemStyle={{ fontWeight: '700', fontSize: '0.9rem' }}
                            labelStyle={{ fontSize: '0.75rem', color: '#64748b', marginBottom: '4px', fontWeight: '600' }}
                            cursor={{ stroke: 'var(--primary)', strokeWidth: 1, strokeDasharray: '4 4' }}
                        />
                        <Area
                            type="monotone"
                            dataKey="minutes"
                            stroke="var(--primary)"
                            strokeWidth={3}
                            fillOpacity={1}
                            fill="url(#colorUsage)"
                            animationDuration={1500}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
