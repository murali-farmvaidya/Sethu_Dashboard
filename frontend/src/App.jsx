import { Routes, Route, Navigate, Outlet } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import AgentDetails from './pages/AgentDetails';
import SessionDetails from './pages/SessionDetails';
import AdminUsers from './pages/AdminUsers';
import ManagePermissions from './pages/ManagePermissions';
import UserDashboard from './pages/UserDashboard';
import ChangePassword from './pages/ChangePassword';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import SystemStatus from './pages/SystemStatus';
import Billing from './pages/Billing';
import UsageHistory from './pages/UsageHistory';
import Settings from './pages/Settings';
import SystemSettings from './pages/SystemSettings';
import UserAnalytics from './pages/UserAnalytics';
import PaymentHistory from './pages/PaymentHistory';
import AdminTools from './pages/AdminTools';
import Plans from './pages/Plans';
import Bills from './pages/Bills';
import Campaigns from './pages/Campaigns';
import MissedCalls from './pages/MissedCalls';

import Header from './components/Header';
import MainLayout from './components/MainLayout';
import DeactivationModal from './components/DeactivationModal';


import './App.css';

function PrivateRoute({ adminOnly = false }) {
  const { isAuthenticated, isAdmin, loading, user } = useAuth();

  if (loading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (adminOnly && !isAdmin) {
    return <Navigate to="/user/dashboard" replace />;
  }

  // Enforce Password Change
  if (user?.mustChangePassword && window.location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }

  return (
    <MainLayout>
      <Outlet />
    </MainLayout>
  );
}

function AppRoutes() {
  const { isAdmin } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password/:token" element={<ResetPassword />} />

      {/* Authenticated user routes grouping */}
      <Route element={<PrivateRoute />}>
        <Route path="/change-password" element={<ChangePassword />} />
        <Route path="/user/dashboard" element={<UserDashboard />} />
        <Route path="/user/agent/:agentId" element={<AgentDetails />} />
        <Route path="/user/session/:sessionId" element={<SessionDetails />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/campaigns" element={<Campaigns />} />
        <Route path="/missed-calls" element={<MissedCalls />} />
        <Route path="/" element={
          isAdmin ? <Navigate to="/admin/dashboard" replace /> : <Navigate to="/user/dashboard" replace />
        } />
      </Route>

      {/* Admin routes grouping */}
      <Route element={<PrivateRoute adminOnly={true} />}>
        <Route path="/admin" element={<Navigate to="/admin/dashboard" replace />} />
        <Route path="/admin/dashboard" element={<Dashboard />} />
        <Route path="/admin/dashboard/user-analytics" element={<UserAnalytics />} />
        <Route path="/admin/agents" element={<Dashboard />} />
        <Route path="/admin/users/create" element={<AdminUsers />} />
        <Route path="/admin/users/permissions" element={<ManagePermissions />} />
        <Route path="/admin/agent/:agentId" element={<AgentDetails />} />
        <Route path="/admin/session/:sessionId" element={<SessionDetails />} />
        <Route path="/master/status" element={<SystemStatus />} />
        <Route path="/admin/system-settings" element={<SystemSettings />} />

        {/* Payment Routes */}
        <Route path="/admin/billing" element={<Navigate to="/admin/payments/make" replace />} />
        <Route path="/admin/payments/make" element={<Billing />} />
        <Route path="/admin/payments/tools" element={<AdminTools />} />
        <Route path="/admin/payments/history" element={<PaymentHistory />} />
        <Route path="/admin/payments/ledger" element={<UsageHistory />} />
        <Route path="/admin/payments/plans" element={<Plans />} />
        <Route path="/admin/payments/bills" element={<Bills />} />
        <Route path="/admin/usage-history" element={<Navigate to="/admin/dashboard/user-analytics" replace />} />
      </Route>
    </Routes>
  );
}

import { Toaster } from 'react-hot-toast';

function App() {
  return (
    <div className="app-container">
      <DeactivationModal />
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: '#fff',
            color: '#333',
            border: '1px solid #e0e0e0',
            padding: '16px',
            borderRadius: '8px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
          },
          success: {
            iconTheme: {
              primary: '#4CAF50', // Green
              secondary: '#fff',
            },
            style: {
              borderLeft: '4px solid #4CAF50',
            }
          },
          error: {
            iconTheme: {
              primary: '#FFC107', // Yellow/Amber for error/warning per request
              secondary: '#fff',
            },
            style: {
              borderLeft: '4px solid #FFC107',
            }
          },
          loading: {
            iconTheme: {
              primary: '#FFC107', // Yellow
              secondary: '#fff',
            },
          }
        }}
      />
      <AppRoutes />
    </div>
  );
}

export default App;
