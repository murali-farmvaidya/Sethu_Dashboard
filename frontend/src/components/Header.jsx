import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { LogOut, User, Users, LayoutDashboard, Lock } from 'lucide-react';

export default function Header() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="dashboard-header">
      <div className="header-content">
        <div className="header-left">
          <img src="/logo.png" alt="FarmVaidya" style={{ height: '40px' }} />
          <span className="header-role-badge">
            {user?.role === 'super_admin' ? 'Super Admin' : (isAdmin ? 'Admin' : 'User')}
          </span>
        </div>

        <nav className="header-nav">
          {isAdmin && (
            <>
              <button
                onClick={() => navigate('/admin')}
                className={`nav-button ${location.pathname === '/admin' ? 'active' : ''}`}
              >
                <LayoutDashboard size={18} />
                Dashboard
              </button>
              <button
                onClick={() => navigate('/admin/users')}
                className={`nav-button ${location.pathname === '/admin/users' ? 'active' : ''}`}
              >
                <Users size={18} />
                Users
              </button>
            </>
          )}
        </nav>

        <div className="header-right">
          <div className="user-info">
            <User size={18} />
            <span>{user?.email}</span>
          </div>
          <button
            onClick={() => navigate('/change-password')}
            className="nav-button"
            title="Change Password"
            style={{ padding: '8px' }}
          >
            <Lock size={18} />
          </button>
          <button onClick={handleLogout} className="logout-button">
            <LogOut size={18} />
            Logout
          </button>
        </div>
      </div>

      <style>{`
        .dashboard-header {
          background: white;
          border-bottom: 1px solid #e2e8f0;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
          position: sticky;
          top: 0;
          z-index: 100;
        }

        .header-content {
          max-width: 1400px;
          margin: 0 auto;
          padding: 16px 24px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 24px;
        }

        .header-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .header-title {
          font-size: 20px;
          font-weight: 700;
          color: #1a202c;
          margin: 0;
        }

        .header-role-badge {
          background: linear-gradient(135deg, #008F4B 0%, #006837 100%);
          color: white;
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
        }

        .header-nav {
          display: flex;
          gap: 8px;
          flex: 1;
        }

        .nav-button {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          background: transparent;
          border: none;
          border-radius: 8px;
          color: #4a5568;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .nav-button:hover {
          background: rgba(0, 143, 75, 0.05);
          color: #008F4B;
        }

        .nav-button.active {
          background: rgba(0, 143, 75, 0.1);
          color: #008F4B;
        }

        .header-right {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .user-info {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          background: #f7fafc;
          border-radius: 8px;
          color: #2d3748;
          font-size: 14px;
          font-weight: 500;
        }

        .logout-button {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 16px;
          background: #fed7d7;
          color: #c53030;
          border: none;
          border-radius: 8px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .logout-button:hover {
          background: #fc8181;
          color: white;
        }

        @media (max-width: 768px) {
          .header-content {
            flex-wrap: wrap;
          }

          .header-nav {
            order: 3;
            width: 100%;
          }

          .user-info span {
            display: none;
          }
        }
      `}</style>
    </header>
  );
}
