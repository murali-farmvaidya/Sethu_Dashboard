import { useState } from 'react';
import axios from 'axios';
import { useNavigate } from 'react-router-dom';

export default function Login() {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const navigate = useNavigate();

    const handleLogin = async (e) => {
        e.preventDefault();
        setError('');
        try {
            const res = await axios.post('/api/login', { username, password });
            if (res.data.success) {
                localStorage.setItem('token', res.data.token);
                localStorage.setItem('user', JSON.stringify(res.data.user));
                navigate('/');
            }
        } catch (err) {
            setError('Invalid credentials');
        }
    };

    return (
        <div className="login-page">
            {/* Left Side - Image and Branding */}
            <div className="login-left">
                <img src="/loginpage.png" alt="FarmVaidya" className="login-bg-image" />
                <div className="login-overlay">
                    <img src="/logo.png" alt="FarmVaidya Logo" className="login-logo" />
                    <h1 className="login-brand-title">Pipecat Dashboard</h1>
                </div>
            </div>

            {/* Right Side - Login Form */}
            <div className="login-right">
                <div className="login-form-container">
                    <h2 className="login-title">Admin Login</h2>
                    <form onSubmit={handleLogin} className="login-form">
                        <div className="form-group">
                            <label>Username</label>
                            <input
                                type="text"
                                className="input-field"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="admin@farmvaidya.ai"
                            />
                        </div>
                        <div className="form-group">
                            <label>Password</label>
                            <input
                                type="password"
                                className="input-field"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Password"
                            />
                        </div>
                        {error && <p className="error-text">{error}</p>}
                        <button type="submit" className="btn-primary">Login</button>
                    </form>
                </div>
            </div>
        </div>
    );
}
