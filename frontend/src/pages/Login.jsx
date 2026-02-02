import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [localError, setLocalError] = useState('');
  const navigate = useNavigate();
  const { login } = useAuth();

  const handleLogin = async (e) => {
    e.preventDefault();
    setLocalError('');
    try {
      // Using the AuthContext login function
      const result = await login(username, password);

      if (result.success) {
        if (result.user.mustChangePassword) {
          navigate('/change-password');
        } else if (result.user.role === 'admin' || result.user.role === 'super_admin') {
          navigate('/admin');
        } else {
          navigate('/user/dashboard');
        }
      } else {
        setLocalError(result.error || 'Invalid credentials');
      }
    } catch (err) {
      setLocalError('An error occurred during login');
    }
  };

  return (
    <div className="login-page">
      {/* Left Side - Image and Branding */}
      <div className="login-left">
        {/* Fallback pattern if image is missing */}
        <div className="login-bg-image" style={{ backgroundImage: 'url(/loginpage.png)', backgroundSize: 'cover', backgroundPosition: 'center', opacity: 1 }}></div>
        <div className="login-overlay">
          <img src="/logo.png" alt="FarmVaidya" style={{ width: '200px', marginBottom: '1rem' }} />
          <p style={{ marginTop: '10px', fontSize: '1.2rem', opacity: 0.8, color: 'white' }}>Sethu Dashboard</p>
        </div>
      </div>

      {/* Right Side - Login Form */}
      <div className="login-right">
        <div className="login-form-container">
          <h2 className="login-title">Hello Again!</h2>
          <form onSubmit={handleLogin} className="login-form">
            <div className="form-group">
              <label>Username</label>
              <input
                type="text"
                className="search-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin@farmvaidya.ai"
                required
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                className="search-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                required
              />
              <div style={{ textAlign: 'right', marginTop: '0.5rem' }}>
                <span style={{ color: '#718096', fontSize: '0.85rem' }}>
                  Forgot Password? <span style={{ color: '#008F4B', fontWeight: 600 }}>Contact Admin</span>
                </span>
              </div>
            </div>
            {localError && <p className="error-text">{localError}</p>}
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '0.75rem',
                background: 'linear-gradient(135deg, #008F4B 0%, #006837 100%)',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                fontWeight: 600,
                cursor: 'pointer',
                marginTop: '1rem',
                fontSize: '1rem'
              }}
            >
              Login
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
