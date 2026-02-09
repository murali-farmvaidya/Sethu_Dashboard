import { useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { LogOut, Users, Lock } from 'lucide-react';

export default function Header() {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [scrollProgress, setScrollProgress] = useState(0);

  useEffect(() => {
    const handleScroll = () => {
      // The transition happens exactly over 70px (the height of the brand tier)
      const progress = Math.min(1, Math.max(0, window.scrollY / 70));
      setScrollProgress(progress);
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="app-header">
      <div className="header-content-wrapper">
        {/* Brand Tier: 70px height */}
        <div
          className="brand-tier"
          style={{
            opacity: 1 - scrollProgress,
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between'
          }}
        >
          <div className="brand-left">
            <img
              src="/logo.png"
              alt="FarmVaidya"
              className="brand-logo"
              onClick={() => navigate('/')}
            />
            {/* Left side text removed/minimized as title is now centered */}
            <div className="brand-text">
              <span className="brand-title"></span>
            </div>
          </div>

          {/* Centered Main Title */}
          <div className="brand-center" style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%)', textAlign: 'center', width: 'max-content' }}>
            <h1 style={{ margin: 0, fontSize: '1.8rem', color: '#008F4B', fontWeight: 'bold', letterSpacing: '-0.5px' }}>
              {(() => {
                if (user?.id === 'master_root_0' || user?.isMaster) return 'Sevak Master Dashboard';
                if (user?.role === 'super_admin') return 'Sevak Super Admin Dashboard';
                if (user?.role === 'admin') return 'Sevak Admin Dashboard';
                if (user?.role === 'user') return 'Sevak User Dashboard';
                return 'Sevak Dashboard';
              })()}
            </h1>
          </div>

          <div className="brand-right" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {user?.email && (
              <span style={{ fontSize: '0.9rem', color: '#64748b', marginRight: '8px', fontWeight: '500' }}>
                {user.email}
              </span>
            )}
            <button onClick={() => navigate('/change-password')} className="action-icon-btn" title="Change Password">
              <Lock size={18} />
            </button>
            <button onClick={handleLogout} className="logout-btn-minimal" title="Logout">
              <LogOut size={18} />
            </button>
          </div>
        </div>

        {/* Nav Tier: 54px height */}
        <div
          className="nav-tier"
          style={{
            backgroundColor: `rgba(255, 255, 255, ${0.9 + (scrollProgress * 0.1)})`,
            backdropFilter: `blur(${scrollProgress * 8}px)`,
            boxShadow: `0 ${scrollProgress * 4}px ${scrollProgress * 12}px rgba(0,0,0,${scrollProgress * 0.08})`,
            borderBottom: scrollProgress > 0 ? '1px solid #e2e8f0' : '1px solid transparent'
          }}
        >
          <div className="nav-tier-inner">
            <div className="nav-tier-left">
              <div
                className="scrolled-logo-wrapper"
                style={{
                  width: `${scrollProgress * 140}px`,
                  opacity: Math.max(0, (scrollProgress - 0.4) * 2),
                  marginRight: scrollProgress > 0.4 ? '16px' : '0'
                }}
              >
                <img
                  src="/logo.png"
                  alt="FV"
                  className="scrolled-logo"
                  onClick={() => navigate('/')}
                />
              </div>

              <nav className="nav-links">
                {isAdmin && (
                  <>
                    <button
                      onClick={() => navigate('/admin')}
                      className={`nav-link-btn ${location.pathname === '/admin' ? 'active' : ''}`}
                    >
                      Agents
                    </button>
                    <button
                      onClick={() => navigate('/admin/users')}
                      className={`nav-link-btn ${location.pathname === '/admin/users' ? 'active' : ''}`}
                    >
                      Users
                    </button>
                    <button
                      onClick={() => navigate('/admin/permissions')}
                      className={`nav-link-btn ${location.pathname === '/admin/permissions' ? 'active' : ''}`}
                    >
                      Permissions
                    </button>
                  </>
                )}
              </nav>
            </div>

            <div className="nav-tier-right">
              <div
                className="user-role-badge"
                title={user?.email}
              >
                {user?.role === 'super_admin' ? 'SUPER ADMIN' : user?.role?.toUpperCase() || 'USER'}
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        .app-header {
          position: sticky;
          top: -70px; /* PINS the navigation tier (+70 margin) to the top of viewport */
          z-index: 2000;
          width: 100%;
          height: 124px; /* Fixed physical height: 70 (Brand) + 54 (Nav) */
          background: #ffffff;
          overflow: visible; /* Allow shadow to be seen */
        }

        .header-content-wrapper {
          display: flex;
          flex-direction: column;
          height: 100%;
          width: 100%;
        }

        /* BRAND TIER (The part that slides away) */
        .brand-tier {
          display: flex;
          justify-content: space-between;
          align-items: center;
          height: 70px;
          padding: 0 24px;
          border-bottom: 1px solid #f8fafc;
          background: white;
        }

        .brand-left {
          display: flex;
          align-items: center;
          gap: 16px;
        }

        .brand-logo {
          height: 44px;
          width: auto;
          cursor: pointer;
        }

        .brand-text {
          display: flex;
          flex-direction: column;
        }

        .brand-title {
          font-weight: 700;
          font-size: 15px;
          color: #1a1a1a;
          line-height: 1.2;
        }

        .brand-subtitle {
          font-size: 11px;
          color: #64748b;
        }

        .user-role-badge {
          padding: 6px 14px;
          background: #008F4B;
          color: white;
          border-radius: 20px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 700;
          font-size: 11px;
          letter-spacing: 0.05em;
          box-shadow: 0 2px 4px rgba(0, 143, 75, 0.2);
        }

        /* NAV TIER (The part that sticks) */
        .nav-tier {
          height: 54px;
          width: 100%;
          display: flex;
          align-items: center;
          transition: background-color 0.2s;
        }

        .nav-tier-inner {
          width: 100%;
          padding: 0 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          height: 100%;
        }

        .nav-tier-left {
          display: flex;
          align-items: center;
          height: 100%;
        }

        .scrolled-logo-wrapper {
          overflow: hidden;
          display: flex;
          align-items: center;
          height: 100%;
          will-change: width, opacity;
        }

        .scrolled-logo {
          height: 32px;
          width: auto;
          cursor: pointer;
          flex-shrink: 0;
        }

        .nav-links {
          display: flex;
          gap: 24px;
          height: 100%;
        }

        .nav-link-btn {
          background: none;
          border: none;
          color: #64748b;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          padding: 0 4px;
          height: 100%;
          display: flex;
          align-items: center;
          position: relative;
          transition: color 0.15s;
        }

        .nav-link-btn:hover { color: #008F4B; }
        .nav-link-btn.active { color: #008F4B; }

        .nav-link-btn.active::after {
          content: '';
          position: absolute;
          bottom: 0;
          left: 0;
          right: 0;
          height: 2px;
          background: #008F4B;
        }

        .nav-tier-right {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .action-icon-btn, .logout-btn-minimal {
          background: none;
          border: none;
          color: #64748b;
          cursor: pointer;
          padding: 6px;
          border-radius: 6px;
          transition: all 0.2s;
          display: flex;
          align-items: center;
        }

        .action-icon-btn:hover, .logout-btn-minimal:hover {
          color: #008F4B;
          background: #f1f5f9;
        }

        @media (max-width: 768px) {
          .brand-text { display: none; }
          .nav-links { gap: 16px; }
        }
      `}</style>
    </header>
  );
}
