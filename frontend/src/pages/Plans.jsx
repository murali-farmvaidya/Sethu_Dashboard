import React from 'react';

const Plans = () => {
    return (
        <div className="page-container" style={{ maxWidth: 1300, display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ marginBottom: '2.5rem', textAlign: 'center' }}>
                <h1 style={{ fontSize: '2rem', fontWeight: '800', color: 'var(--text)', marginBottom: '4px' }}>
                    Available Plans
                </h1>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.95rem' }}>
                    Explore our subscription plans offering flexible limits tailored to your needs.
                </p>
            </div>

            <div style={{
                background: 'white',
                borderRadius: '20px',
                padding: '2rem',
                border: '1px solid var(--border)',
                boxShadow: '0 4px 20px rgba(0,0,0,0.06)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                width: '100%',
                maxWidth: '1000px'
            }}>
                <img
                    src="/plans.jpeg"
                    alt="Subscription Plans"
                    style={{
                        maxWidth: '100%',
                        height: 'auto',
                        borderRadius: '12px'
                    }}
                />
            </div>
        </div>
    );
};

export default Plans;
