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

  const [showProfileMenu, setShowProfileMenu] = useState(false);

  return (
    <header className="app-header" style={{ position: 'sticky', top: 0, zIndex: 100, background: 'white', borderBottom: '1px solid var(--border)', height: '64px', display: 'flex', alignItems: 'center', padding: '0 24px', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
        <button className="sidebar-toggle-btn" onClick={() => window.dispatchEvent(new Event('toggle-sidebar'))} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'none', color: 'var(--text)' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12h18M3 6h18M3 18h18"></path></svg>
        </button>
        <h1
          onClick={() => navigate(isAdmin ? '/admin' : '/')}
          style={{ fontSize: '1.25rem', fontWeight: 'bold', color: 'var(--primary)', margin: 0, cursor: 'pointer' }}
          title="Go to Home"
        >
          {user?.id === 'master_root_0' || user?.isMaster ? 'Sevak Master Dashboard' : 'Sevak Dashboard'}
        </h1>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '24px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'auto auto', columnGap: '6px', rowGap: '2px', alignItems: 'center', fontSize: '13px' }}>
          <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>Credits:</span>
          <span style={{ fontWeight: '600', color: 'var(--text)' }}>{parseFloat(user?.minutes_balance || 0).toFixed(2)}</span>
          <span style={{ color: 'var(--text-muted)', textAlign: 'right' }}>Validity:</span>
          <span style={{ fontWeight: '500', color: 'var(--text)' }}>
            {user?.subscription_expiry
              ? (() => {
                const date = new Date(user.subscription_expiry);
                const d = date.getDate().toString().padStart(2, '0');
                const m = (date.getMonth() + 1).toString().padStart(2, '0');
                const y = date.getFullYear();
                return `${d}-${m}-${y}`;
              })()
              : 'Active'}
          </span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          <div style={{ position: 'relative' }}>
            <button onClick={() => { setShowNotifications(!showNotifications); setShowProfileMenu(false); }} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex' }}>
              <Bell size={22} />
              {unreadCount > 0 && <span style={{ position: 'absolute', top: '-4px', right: '-4px', background: '#ef4444', color: 'white', fontSize: '10px', borderRadius: '50%', padding: '2px 5px', fontWeight: 'bold' }}>{unreadCount}</span>}
            </button>
            {showNotifications && (
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '12px', width: '300px', background: 'white', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', overflow: 'hidden', zIndex: 3000 }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--bg)' }}>
                  <span style={{ fontWeight: '600', fontSize: '14px' }}>Notifications</span>
                  {unreadCount > 0 && <button onClick={handleMarkAllAsRead} style={{ border: 'none', background: 'none', color: 'var(--primary)', fontSize: '12px', cursor: 'pointer' }}>Mark all read</button>}
                </div>
                <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                  {notifications.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '13px' }}>No new notifications</div>
                  ) : (
                    notifications.map(n => (
                      <div key={n.id} style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: n.is_read ? 'white' : 'rgba(0,143,75,0.05)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                          <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>{n.title}</div>
                          {n.created_at && (
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', whiteSpace: 'nowrap', marginLeft: '8px' }}>
                              {new Date(n.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </div>
                          )}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }} dangerouslySetInnerHTML={{ __html: n.message }}></div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <div style={{ position: 'relative' }}>
            <button onClick={() => { setShowProfileMenu(!showProfileMenu); setShowNotifications(false); }} style={{ background: 'none', border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'var(--primary)', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Users size={16} />
              </div>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>

            {showProfileMenu && (
              <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: '12px', background: 'white', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: '0 10px 15px -3px rgba(0,0,0,0.1)', minWidth: '180px', zIndex: 3000, overflow: 'hidden' }}>
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--bg)' }}>
                  <div style={{ fontWeight: '600', fontSize: '13px', color: 'var(--text)' }}>{user?.email}</div>
                  <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px', textTransform: 'uppercase' }}>{user?.role}</div>
                </div>
                <div style={{ padding: '8px 0' }}>
                  <button onClick={() => { navigate('/admin'); setShowProfileMenu(false); }} style={{ display: 'block', width: '100%', padding: '8px 16px', textAlign: 'left', background: 'none', border: 'none', fontSize: '13px', cursor: 'pointer', color: 'var(--text)' }}>Home</button>
                  <button onClick={() => { navigate('/admin/payments/make'); setShowProfileMenu(false); }} style={{ display: 'block', width: '100%', padding: '8px 16px', textAlign: 'left', background: 'none', border: 'none', fontSize: '13px', cursor: 'pointer', color: 'var(--text)' }}>Buy Credits</button>
                  <button onClick={() => { navigate('/settings'); setShowProfileMenu(false); }} style={{ display: 'block', width: '100%', padding: '8px 16px', textAlign: 'left', background: 'none', border: 'none', fontSize: '13px', cursor: 'pointer', color: 'var(--text)' }}>My Account</button>
                </div>
                <div style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                  <button onClick={() => { handleLogout(); setShowProfileMenu(false); }} style={{ display: 'flex', alignItems: 'center', gap: '8px', width: '100%', padding: '8px 16px', textAlign: 'left', background: 'none', border: 'none', fontSize: '13px', cursor: 'pointer', color: '#ef4444', fontWeight: '500' }}>
                    <LogOut size={14} /> Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <style>{`
        /* Remove unused styles */
        @media (max-width: 768px) {
          .sidebar-toggle-btn {
            display: block !important;
          }
        }
      `}</style>
    </header >
  );
}
