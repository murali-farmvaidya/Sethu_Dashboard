import React from 'react';
import { Clock, Receipt } from 'lucide-react';

const Bills = () => {
    return (
        <div style={{
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '80vh',
            background: 'linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%)',
            borderRadius: '24px',
            margin: '1rem',
            overflow: 'hidden',
            position: 'relative',
            perspective: '1000px'
        }}>
            {/* Animated Background Spheres with Floating Effect */}
            <div className="bg-sphere" style={{ position: 'absolute', top: '10%', left: '10%', width: '300px', height: '300px', borderRadius: '50%', background: 'rgba(0,143,75,0.05)', filter: 'blur(60px)', animation: 'float-main 20s infinite alternate' }} />
            <div className="bg-sphere" style={{ position: 'absolute', bottom: '15%', right: '12%', width: '400px', height: '400px', borderRadius: '50%', background: 'rgba(16,185,129,0.08)', filter: 'blur(80px)', animation: 'float-alt 25s infinite alternate-reverse' }} />
            <div className="bg-sphere" style={{ position: 'absolute', top: '40%', left: '50%', width: '200px', height: '200px', borderRadius: '50%', background: 'rgba(255,200,5,0.05)', filter: 'blur(50px)', animation: 'float-main 15s infinite alternate-reverse' }} />

            <div className="main-content-card" style={{
                textAlign: 'center',
                background: 'rgba(255, 255, 255, 0.4)',
                backdropFilter: 'blur(20px)',
                padding: '5rem 3.5rem',
                borderRadius: '40px',
                border: '1px solid rgba(255, 255, 255, 0.6)',
                boxShadow: '0 25px 60px rgba(0,143,75,0.08)',
                maxWidth: '650px',
                width: '100%',
                zIndex: 1,
                transformStyle: 'preserve-3d',
                animation: 'card-entrance 1s cubic-bezier(0.2, 0.8, 0.2, 1)'
            }}>
                <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    marginBottom: '2.5rem',
                    position: 'relative'
                }}>
                    <div className="icon-glow" style={{
                        position: 'absolute',
                        width: '120px',
                        height: '120px',
                        background: 'radial-gradient(circle, rgba(0,143,75,0.2) 0%, transparent 70%)',
                        animation: 'glow-pulse 3s infinite'
                    }} />
                    <div className="icon-pulse" style={{
                        width: '110px',
                        height: '110px',
                        borderRadius: '30% 70% 70% 30% / 30% 30% 70% 70%',
                        background: 'white',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 15px 35px rgba(0,143,75,0.12)',
                        color: '#008F4B',
                        animation: 'blob-morph 10s linear infinite'
                    }}>
                        <Receipt size={54} strokeWidth={1} />
                    </div>
                </div>

                <h1 style={{
                    fontSize: '3rem',
                    fontWeight: '900',
                    color: '#0f172a',
                    marginBottom: '1.25rem',
                    letterSpacing: '-0.04em',
                    background: 'linear-gradient(135deg, #0f172a 0%, #334155 100%)',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent'
                }}>
                    Billing Dashboard
                </h1>

                <div style={{
                    display: 'inline-block',
                    padding: '8px 24px',
                    borderRadius: '50px',
                    background: 'linear-gradient(90deg, #008F4B, #10b981)',
                    color: 'white',
                    fontSize: '0.9rem',
                    fontWeight: '800',
                    textTransform: 'uppercase',
                    letterSpacing: '0.15em',
                    marginBottom: '2.5rem',
                    boxShadow: '0 10px 20px rgba(0,143,75,0.2)',
                    animation: 'float-label 3s ease-in-out infinite'
                }}>
                    Under Construction
                </div>

                <p style={{
                    color: '#475569',
                    fontSize: '1.2rem',
                    lineHeight: '1.7',
                    marginBottom: '3.5rem',
                    fontWeight: '450'
                }}>
                    Our engineering team is hand-crafting a premium billing experience.
                    Automated invoices, usage tracking, and one-click settlements are on the horizon.
                </p>

                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '1.5rem'
                }}>
                    <div className="progress-bar-container" style={{
                        width: '240px',
                        height: '6px',
                        background: 'rgba(0,143,75,0.1)',
                        borderRadius: '10px',
                        overflow: 'hidden'
                    }}>
                        <div className="progress-fill" style={{
                            width: '65%',
                            height: '100%',
                            background: 'linear-gradient(90deg, #008F4B, #10b981)',
                            borderRadius: '10px',
                            animation: 'progress-load 2s ease-out forwards'
                        }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#94a3b8', fontSize: '0.9rem', fontWeight: '600' }}>
                        <Clock size={18} /> Arriving in Q2 2026
                    </div>
                </div>
            </div>

            <style>{`
                @keyframes float-main {
                    from { transform: translate(-20px, -20px) scale(1); }
                    to { transform: translate(40px, 40px) scale(1.1); }
                }
                @keyframes float-alt {
                    from { transform: translate(30px, -30px) rotate(0deg); }
                    to { transform: translate(-40px, 40px) rotate(15deg); }
                }
                @keyframes float-label {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-8px); }
                }
                @keyframes blob-morph {
                    0% { border-radius: 30% 70% 70% 30% / 30% 30% 70% 70%; }
                    25% { border-radius: 58% 42% 75% 25% / 76% 46% 54% 24%; }
                    50% { border-radius: 50% 50% 33% 67% / 55% 27% 73% 45%; }
                    75% { border-radius: 33% 67% 58% 42% / 63% 68% 32% 37%; }
                    100% { border-radius: 30% 70% 70% 30% / 30% 30% 70% 70%; }
                }
                @keyframes glow-pulse {
                    0%, 100% { transform: scale(1); opacity: 0.5; }
                    50% { transform: scale(1.5); opacity: 1; }
                }
                @keyframes card-entrance {
                    from { opacity: 0; transform: translateY(30px) rotateX(10deg); }
                    to { opacity: 1; transform: translateY(0) rotateX(0deg); }
                }
                @keyframes progress-load {
                    from { width: 0; }
                    to { width: 65%; }
                }
            `}</style>
        </div>
    );
};

export default Bills;
