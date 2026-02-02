import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { authAPI } from '../services/api'; // Direct API call for public methods
import { Mail, Key, CheckCircle, ArrowLeft } from 'lucide-react';

export default function ForgotPassword() {
    const navigate = useNavigate();
    const [step, setStep] = useState(1); // 1: Email, 2: OTP
    const [email, setEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const handleSendOtp = async (e) => {
        e.preventDefault();
        try {
            setLoading(true);
            setError('');
            await authAPI.forgotPassword(email);
            setSuccess('OTP sent to your email!');
            setTimeout(() => {
                setSuccess('');
                setStep(2);
            }, 1500);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to send OTP. User not found?');
        } finally {
            setLoading(false);
        }
    };

    const handleReset = async (e) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        try {
            setLoading(true);
            setError('');
            await authAPI.resetPasswordOtp({ email, otp, newPassword });
            setSuccess('Password reset successfully! Redirecting to login...');
            setTimeout(() => navigate('/login'), 2000);
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to reset password. Invalid OTP?');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page">
            <div className="login-form-container" style={{ margin: 'auto', background: 'white', padding: '2rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>

                <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                    {/* Back link */}
                    <div style={{ position: 'absolute', top: '1rem', left: '1rem' }}>
                        <Link to="/login" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: '#666', textDecoration: 'none', fontSize: '0.9rem' }}>
                            <ArrowLeft size={16} /> Back
                        </Link>
                    </div>

                    <div style={{
                        background: 'rgba(0, 143, 75, 0.1)',
                        width: '48px', height: '48px',
                        borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 1rem auto'
                    }}>
                        {step === 1 ? <Mail size={24} color="#008F4B" /> : <Key size={24} color="#008F4B" />}
                    </div>
                    <h2 style={{ color: '#008F4B', fontSize: '1.5rem', marginBottom: '0.5rem' }}>
                        {step === 1 ? 'Forgot Password?' : 'Reset Password'}
                    </h2>
                    <p style={{ color: '#6b7280', fontSize: '0.9rem' }}>
                        {step === 1 ? 'Enter your email to receive a reset OTP.' : 'Enter the OTP sent to your email.'}
                    </p>
                </div>

                {error && (
                    <div style={{ background: '#fed7d7', color: '#c53030', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.9rem', textAlign: 'center' }}>
                        {error}
                    </div>
                )}

                {success && (
                    <div style={{ background: '#c6f6d5', color: '#276749', padding: '0.75rem', borderRadius: '6px', marginBottom: '1rem', fontSize: '0.9rem', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                        <CheckCircle size={16} /> {success}
                    </div>
                )}

                {step === 1 ? (
                    <form onSubmit={handleSendOtp} className="login-form">
                        <div className="form-group">
                            <label>Email Address</label>
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                placeholder="Enter your email"
                                required
                                className="search-input"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading}
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                background: 'linear-gradient(135deg, #008F4B 0%, #006837 100%)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontWeight: 600,
                                cursor: loading ? 'not-allowed' : 'pointer',
                                marginTop: '1rem'
                            }}
                        >
                            {loading ? 'Sending OTP...' : 'Send OTP'}
                        </button>
                    </form>
                ) : (
                    <form onSubmit={handleReset} className="login-form">
                        <div className="form-group">
                            <label>OTP Code</label>
                            <input
                                type="text"
                                value={otp}
                                onChange={(e) => setOtp(e.target.value)}
                                placeholder="Enter 6-digit OTP"
                                required
                                className="search-input"
                            />
                        </div>
                        <div className="form-group">
                            <label>New Password</label>
                            <input
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="Enter new password"
                                required
                                minLength={8}
                                className="search-input"
                            />
                        </div>
                        <div className="form-group">
                            <label>Confirm Password</label>
                            <input
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="Confirm new password"
                                required
                                className="search-input"
                            />
                        </div>
                        <button
                            type="submit"
                            disabled={loading}
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                background: 'linear-gradient(135deg, #008F4B 0%, #006837 100%)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontWeight: 600,
                                cursor: loading ? 'not-allowed' : 'pointer',
                                marginTop: '1rem'
                            }}
                        >
                            {loading ? 'Reset Password' : 'Set New Password'}
                        </button>
                    </form>
                )}
            </div>
        </div>
    );
}
