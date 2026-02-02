import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { Lock, CheckCircle, AlertTriangle } from 'lucide-react';

export default function ChangePassword() {
    const { user, changePassword, logout } = useAuth();
    const navigate = useNavigate();
    const [formData, setFormData] = useState({
        oldPassword: '',
        newPassword: '',
        confirmPassword: ''
    });
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');
    const [loading, setLoading] = useState(false);

    const isForceReset = user?.mustChangePassword;

    const handleChange = (e) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (formData.newPassword !== formData.confirmPassword) {
            setError('New passwords do not match');
            return;
        }
        if (formData.newPassword.length < 8) {
            setError('Password must be at least 8 characters long');
            return;
        }

        try {
            setLoading(true);
            setError('');
            const result = await changePassword(formData.oldPassword, formData.newPassword);
            if (result.success) {
                setSuccess('Password changed successfully!');
                // Update user state locally implies refresh or re-login? 
                // Backend updated, next token check will be clean.
                // If force reset, we might want to reload page or update context user.
                // For simplicity: Alert and Redirect.
                setTimeout(() => {
                    // Force logout if user prefers, or just redirect?
                    // Usually force reset flows continue session.
                    if (isForceReset) {
                        // We need to re-fetch profile to clear mustChangePassword flag in context?
                        // Or just trust backend.
                        // Page refresh will clear it.
                        window.location.href = '/user/dashboard';
                    } else {
                        navigate(-1); // Go back
                    }
                }, 1500);
            } else {
                setError(result.error);
            }
        } catch (err) {
            setError('An error occurred');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="login-page">
            <div className="login-form-container" style={{ margin: 'auto', background: 'white', padding: '2rem', borderRadius: '12px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}>

                <div style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
                    <div style={{
                        background: 'rgba(0, 143, 75, 0.1)',
                        width: '48px', height: '48px',
                        borderRadius: '50%',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        margin: '0 auto 1rem auto'
                    }}>
                        <Lock size={24} color="#008F4B" />
                    </div>
                    <h2 style={{ color: '#008F4B', fontSize: '1.5rem', marginBottom: '0.5rem' }}>
                        {isForceReset ? 'Setup New Password' : 'Change Password'}
                    </h2>
                    {isForceReset && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center', color: '#dd6b20', fontSize: '0.9rem', background: '#fffaf0', padding: '0.5rem', borderRadius: '6px' }}>
                            <AlertTriangle size={16} />
                            <span>You must change your password to continue.</span>
                        </div>
                    )}
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

                <form onSubmit={handleSubmit} className="login-form">
                    <div className="form-group">
                        <label>Current Password</label>
                        <input
                            type="password"
                            name="oldPassword"
                            value={formData.oldPassword}
                            onChange={handleChange}
                            placeholder="Enter current password"
                            required
                            className="search-input" // Reusing input style
                        />
                    </div>

                    <div className="form-group">
                        <label>New Password</label>
                        <input
                            type="password"
                            name="newPassword"
                            value={formData.newPassword}
                            onChange={handleChange}
                            placeholder="Enter new password (min 8 chars)"
                            required
                            minLength={8}
                            className="search-input"
                        />
                    </div>

                    <div className="form-group">
                        <label>Confirm New Password</label>
                        <input
                            type="password"
                            name="confirmPassword"
                            value={formData.confirmPassword}
                            onChange={handleChange}
                            placeholder="Confirm new password"
                            required
                            className="search-input"
                        />
                    </div>

                    <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem' }}>
                        {!isForceReset && (
                            <button
                                type="button"
                                onClick={() => navigate(-1)}
                                style={{ flex: 1, padding: '0.75rem', border: '2px solid #e2e8f0', background: 'white', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
                            >
                                Cancel
                            </button>
                        )}
                        {isForceReset && (
                            <button
                                type="button"
                                onClick={logout}
                                style={{ flex: 1, padding: '0.75rem', border: '2px solid #e2e8f0', background: 'white', borderRadius: '8px', fontWeight: 600, cursor: 'pointer' }}
                            >
                                Logout
                            </button>
                        )}
                        <button
                            type="submit"
                            disabled={loading}
                            style={{
                                flex: 1,
                                padding: '0.75rem',
                                background: 'linear-gradient(135deg, #008F4B 0%, #006837 100%)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontWeight: 600,
                                cursor: loading ? 'not-allowed' : 'pointer',
                                opacity: loading ? 0.7 : 1
                            }}
                        >
                            {loading ? 'Updating...' : 'Update Password'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
