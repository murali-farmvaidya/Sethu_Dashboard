import { useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { LogOut, Users, Lock, Settings, Bell, Check, Trash2 } from 'lucide-react';
import { notificationsAPI } from '../services/api';

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

  const [notifications, setNotifications] = useState([]);
  const [showNotifications, setShowNotifications] = useState(false);

  const fetchNotifications = async () => {
    try {
      const res = await notificationsAPI.getNotifications();
      if (res.data?.success) setNotifications(res.data.notifications);
    } catch (err) {
      console.error("Failed to load notifications", err);
    }
  };

  useEffect(() => {
    if (user) {
      fetchNotifications();
      const interval = setInterval(fetchNotifications, 60000); // Poll every minute

      const onRefresh = () => fetchNotifications();
      window.addEventListener('refresh-notifications', onRefresh);

      return () => {
        clearInterval(interval);
        window.removeEventListener('refresh-notifications', onRefresh);
      };
    }
  }, [user]);

  const handleMarkAsRead = async (id, e) => {
    e.stopPropagation();
    try {
      await notificationsAPI.markAsRead(id);
      setNotifications(notifications.map(n => n.id === id ? { ...n, is_read: true } : n));
    } catch (err) { }
  };

  const handleMarkAllAsRead = async () => {
    try {
      await notificationsAPI.markAllAsRead();
      setNotifications(notifications.map(n => ({ ...n, is_read: true })));
    } catch (err) { }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;

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
          <div className="brand-center">
            <h1>
              {(() => {
                if (user?.id === 'master_root_0' || user?.isMaster) return 'Sevak Master Dashboard';
                if (user?.role === 'super_admin') return 'Sevak Super Admin Dashboard';
                if (user?.role === 'admin') return 'Sevak Admin Dashboard';
                if (user?.role === 'user') return 'Sevak User Dashboard';
                return 'Sevak Dashboard';
              })()}
            </h1>
          </div>

          <div className="brand-right" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>


            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              {user?.email && (
                <span style={{ fontSize: '0.9rem', color: '#64748b', marginRight: '4px', fontWeight: '500' }}>
                  {user.email}
                </span>
              )}
              <button onClick={() => navigate('/change-password')} className="action-icon-btn" title="Change Password">
                <Lock size={18} />
              </button>
              <div style={{ position: 'relative' }}>
                <button onClick={() => setShowNotifications(!showNotifications)} className="action-icon-btn" title="Notifications">
                  <Bell size={18} />
                  {unreadCount > 0 && (
                    <span style={{ position: 'absolute', top: 0, right: 0, background: '#ef4444', color: 'white', borderRadius: '50%', width: '16px', height: '16px', fontSize: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
                      {unreadCount > 9 ? '9+' : unreadCount}
                    </span>
                  )}
                </button>

                {showNotifications && (
                  <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '8px', width: '320px', background: 'white', borderRadius: '8px', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)', border: '1px solid #e2e8f0', zIndex: 3000, overflow: 'hidden' }}>
                    <div style={{ padding: '12px 16px', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
                      <h3 style={{ margin: 0, fontSize: '14px', fontWeight: '600', color: '#1e293b' }}>Notifications</h3>
                      {unreadCount > 0 && (
                        <button onClick={handleMarkAllAsRead} style={{ background: 'none', border: 'none', color: '#008F4B', fontSize: '12px', cursor: 'pointer', fontWeight: '500' }}>
                          Mark all read
                        </button>
                      )}
                    </div>
                    <div style={{ maxHeight: '350px', overflowY: 'auto' }}>
                      {notifications.length === 0 ? (
                        <div style={{ padding: '24px 16px', textAlign: 'center', color: '#64748b', fontSize: '13px' }}>
                          No notifications
                        </div>
                      ) : (
                        notifications.map(n => (
                          <div key={n.id} style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', background: n.is_read ? 'white' : '#f0fdf4', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                              <span style={{ fontSize: '13px', fontWeight: '600', color: '#1e293b' }}>{n.title}</span>
                              {!n.is_read && (
                                <button onClick={(e) => handleMarkAsRead(n.id, e)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: '#008F4B' }} title="Mark as read">
                                  <Check size={14} />
                                </button>
                              )}
                            </div>
                            <p
                              style={{ margin: 0, fontSize: '12px', color: '#475569', lineHeight: '1.5' }}
                              dangerouslySetInnerHTML={{ __html: n.message }}
                            />
                            <span style={{ fontSize: '10px', color: '#94a3b8', marginTop: '4px' }}>
                              {new Date(n.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true })}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}
              </div>

              <button onClick={handleLogout} className="logout-btn-minimal" title="Logout">
                <LogOut size={18} />
              </button>
            </div>
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
                    {(user?.role === 'super_admin' || user?.isMaster) && (
                      <button
                        onClick={() => navigate('/admin/settings')}
                        className={`nav-link-btn ${location.pathname === '/admin/settings' ? 'active' : ''}`}
                      >
                        Settings
                      </button>
                    )}

                    <button
                      onClick={() => navigate('/admin/billing')}
                      className={`nav-link-btn ${location.pathname === '/admin/billing' ? 'active' : ''}`}
                    >
                      Billing
                    </button>
                  </>
                )}
              </nav>
            </div>

            <div className="nav-tier-right">
              {/* Credits Display (Sticky) */}
              {/* Credits Display (Sticky) */}
              {(user?.minutes_balance !== undefined) && (
                <div
                  onClick={() => navigate('/admin/usage-history')}
                  title="View Minutes Ledger"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    background: 'rgba(241, 245, 249, 0.8)',
                    padding: '4px 10px',
                    borderRadius: '16px',
                    border: '1px solid #e2e8f0',
                    fontSize: '0.8rem',
                    fontWeight: '600',
                    color: '#475569',
                    marginRight: '8px',
                    cursor: 'pointer',
                    userSelect: 'none',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = '#e2e8f0'}
                  onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(241, 245, 249, 0.8)'}
                >
                  <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: (user.minutes_balance > 100) ? '#10b981' : '#ef4444' }}></div>
                  {parseFloat(user.minutes_balance || 0).toFixed(2)} Credits
                </div>
              )}

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
          .app-header {
            position: sticky;
            position: -webkit-sticky;
            top: -50px; /* Allow brand tier (50px) to scroll away, leaving nav tier sticky */
            height: auto;
            min-height: 94px; /* 50 + 44 */
            z-index: 2000;
          }

          .brand-tier {
            height: 50px;
            padding: 0 12px;
          }

          .nav-tier {
            height: 44px;
          }

          .brand-text { display: none; }
          .nav-links { gap: 12px; }
          
          .brand-center {
            position: static;
            transform: none;
            width: auto;
            flex: 1;
            padding: 0 4px;
            text-align: center;
            min-width: 0; 
            display: none !important; /* Hide on mobile per previous request */
          }
          
          .brand-center h1 {
            font-size: 1rem;
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
          }
          
          .brand-logo, .brand-left img {
            height: 28px !important;
            width: auto;
          }
          
          .scrolled-logo-wrapper {
             display: none !important;
          }
          
          .brand-right {
             gap: 8px;
          }
          
          .action-icon-btn, .logout-btn-minimal {
            padding: 4px;
          }

          .nav-link-btn {
            font-size: 13px;
            padding: 0 8px;
          }
        }
        
        /* Desktop styles for brand center */
        .brand-center {
          position: absolute;
          left: 50%;
          transform: translateX(-50%);
          text-align: center;
          width: max-content;
        }
        
        .brand-center h1 {
           margin: 0;
           font-size: 1.8rem;
           color: #008F4B;
           font-weight: bold;
           letter-spacing: -0.5px;
        }
      `}</style>
    </header >
  );
}
