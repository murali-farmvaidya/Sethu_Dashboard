import React, { useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
    LayoutDashboard, Users, UserCog, CreditCard,
    PieChart, TrendingUp, Key, FileText, ClipboardList, Wallet, List, PlusCircle, Settings, Activity, ChevronDown
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import './Sidebar.css';

export default function Sidebar({ isOpen, setIsOpen }) {
    const location = useLocation();
    const navigate = useNavigate();
    const { user } = useAuth();
    const isAdmin = user?.role === 'admin' || user?.role === 'super_admin';
    const isRootMaster = user?.id === 'master_root_0';
    const isMaster = user?.role === 'super_admin' || isRootMaster;

    const adminSections = [
        {
            id: 'dashboard',
            label: 'Dashboard',
            icon: <LayoutDashboard size={20} />,
            subItems: [
                { path: '/admin/dashboard', label: 'Analytics', icon: <PieChart size={16} />, exact: true },
                { path: '/admin/dashboard/user-analytics', label: 'User Analytics', icon: <TrendingUp size={16} /> }
            ]
        },
        {
            id: 'agents',
            label: 'Agents',
            icon: <Users size={20} />,
            subItems: [
                { path: '/admin/agents', label: 'All Agents', icon: <Users size={16} /> }
            ]
        },
        {
            id: 'usermanagement',
            label: 'User Management',
            icon: <UserCog size={20} />,
            subItems: [
                { path: '/admin/users/create', label: 'Create User', icon: <PlusCircle size={16} /> },
                ...(isMaster ? [{ path: '/admin/system-settings', label: 'System Settings', icon: <Settings size={16} /> }] : []),
                ...(isRootMaster ? [{ path: '/master/status', label: 'System Status', icon: <Activity size={16} /> }] : []),
                { path: '/admin/users/permissions', label: 'Permissions', icon: <Key size={16} /> }
            ]
        },
        {
            id: 'payments',
            label: 'Payments',
            icon: <CreditCard size={20} />,
            subItems: [
                { path: '/admin/payments/make', label: 'Make Payments', icon: <Wallet size={16} /> },
                ...(user?.role === 'super_admin' ? [{ path: '/admin/payments/tools', label: 'Admin Tools', icon: <Settings size={16} /> }] : []),
                { path: '/admin/payments/history', label: 'Payment History', icon: <CreditCard size={16} /> },
                { path: '/admin/payments/ledger', label: 'Ledger', icon: <List size={16} /> },
                { path: '/admin/payments/plans', label: 'Plans', icon: <ClipboardList size={16} /> },
                { path: '/admin/payments/bills', label: 'Bills', icon: <FileText size={16} /> }
            ]
        }
    ];

    const userSections = [
        {
            id: 'dashboard',
            label: 'Dashboard',
            icon: <LayoutDashboard size={20} />,
            subItems: [
                { path: '/user/dashboard', label: 'My Agents', icon: <PieChart size={16} /> }
            ]
        }
    ];

    const sections = isAdmin ? adminSections : userSections;

    // All sections open by default — user can collapse any section
    const [openSections, setOpenSections] = useState(
        () => Object.fromEntries(sections.map(s => [s.id, true]))
    );

    const toggleSection = (id) => {
        setOpenSections(prev => ({ ...prev, [id]: !prev[id] }));
    };

    return (
        <div className={`sidebar-container ${isOpen ? 'open' : 'closed'}`}>
            {/* Clickable logo → home */}
            <div
                className="sidebar-logo-container"
                style={{ padding: '20px', display: 'flex', justifyContent: 'center', cursor: 'pointer' }}
                onClick={() => navigate(isAdmin ? '/admin' : '/')}
                title="Go to Home"
            >
                <img src="/logo.png" alt="Company Logo" style={{ height: '40px', maxWidth: '100%', objectFit: 'contain' }} />
            </div>

            <nav className="sidebar-nav">
                {sections.map(section => (
                    <div key={section.id} className="sidebar-section">
                        {/* Collapsible section header */}
                        <button
                            className={`sidebar-section-header ${openSections[section.id] ? 'is-open' : ''}`}
                            onClick={() => toggleSection(section.id)}
                        >
                            <div className="section-title">
                                {section.icon}
                                <span className="section-label">{section.label}</span>
                            </div>
                            <div className="section-chevron">
                                <ChevronDown
                                    size={14}
                                    style={{
                                        transition: 'transform 0.2s',
                                        transform: openSections[section.id] ? 'rotate(0deg)' : 'rotate(-90deg)',
                                    }}
                                />
                            </div>
                        </button>

                        {openSections[section.id] && (
                            <div className="sidebar-subitems show-all">
                                {section.subItems.map(item => (
                                    <NavLink
                                        key={item.path}
                                        to={item.path}
                                        end={item.exact}
                                        className={({ isActive }) => `sidebar-subitem ${isActive ? 'active' : ''}`}
                                    >
                                        {item.label}
                                    </NavLink>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </nav>
        </div>
    );
}
