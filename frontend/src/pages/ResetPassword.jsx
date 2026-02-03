import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { authAPI } from '../services/api';

export default function ResetPassword() {
    const { token } = useParams();
    const navigate = useNavigate();
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            return setError('Passwords do not match');
        }
        if (newPassword.length < 6) {
            return setError('Password must be at least 6 characters');
        }

        setLoading(true);
        setError('');
        try {
            const response = await authAPI.resetPasswordWithToken(token, newPassword);
            if (response.data.success) {
                setSuccess(true);
                setTimeout(() => navigate('/login'), 3000);
            }
        } catch (err) {
            setError(err.response?.data?.error || 'Failed to reset password. Link may be expired.');
        } finally {
            setLoading(false);
        }
    };

    if (success) {
        return (
            <div className="reset-password-page">
                <div className="reset-card">
                    <div className="success-icon">✓</div>
                    <h2>Success!</h2>
                    <p>Your password has been updated. Redirecting to login...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="reset-password-page">
            <div className="reset-card">
                <h2>Reset Password</h2>
                <p>Enter your new password below</p>

                <form onSubmit={handleSubmit}>
                    <div className="form-group">
                        <label>New Password</label>
                        <input
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                            className="reset-input"
                        />
                    </div>
                    <div className="form-group">
                        <label>Confirm Password</label>
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            placeholder="••••••••"
                            required
                            className="reset-input"
                        />
                    </div>

                    {error && <div className="error-message">{error}</div>}

                    <button type="submit" disabled={loading} className="reset-btn">
                        {loading ? 'Updating...' : 'Update Password'}
                    </button>
                </form>
            </div>

            <style>{`
        .reset-password-page {
          height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          background: #f7fafc;
        }
        .reset-card {
          background: white;
          padding: 40px;
          border-radius: 12px;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
          width: 100%;
          max-width: 400px;
          text-align: center;
        }
        .reset-card h2 {
          margin-bottom: 8px;
          color: #1a202c;
        }
        .reset-card p {
          color: #718096;
          margin-bottom: 24px;
        }
        .form-group {
          text-align: left;
          margin-bottom: 20px;
        }
        .form-group label {
          display: block;
          margin-bottom: 8px;
          font-weight: 600;
          color: #4a5568;
        }
        .reset-input {
          width: 100%;
          padding: 12px;
          border: 2px solid #e2e8f0;
          border-radius: 8px;
          font-size: 16px;
        }
        .reset-input:focus {
          border-color: #008F4B;
          outline: none;
        }
        .error-message {
          color: #e53e3e;
          background: #fff5f5;
          padding: 10px;
          border-radius: 6px;
          font-size: 14px;
          margin-bottom: 20px;
        }
        .reset-btn {
          width: 100%;
          padding: 12px;
          background: linear-gradient(135deg, #008F4B 0%, #006837 100%);
          color: white;
          border: none;
          border-radius: 8px;
          font-weight: 600;
          cursor: pointer;
          font-size: 16px;
        }
        .success-icon {
          width: 60px;
          height: 60px;
          background: #c6f6d5;
          color: #276749;
          font-size: 32px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          margin: 0 auto 20px;
        }
      `}</style>
        </div>
    );
}
