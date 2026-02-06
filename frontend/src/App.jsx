import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
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
import DeactivationModal from './components/DeactivationModal';
import './App.css';

function PrivateRoute({ children, adminOnly = false }) {
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

  return children;
}

function AppRoutes() {
  const { isAdmin } = useAuth();

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password/:token" element={<ResetPassword />} />
      <Route path="/change-password" element={
        <PrivateRoute>
          <ChangePassword />
        </PrivateRoute>
      } />

      {/* Admin Routes */}
      <Route path="/admin" element={
        <PrivateRoute adminOnly={true}>
          <Dashboard />
        </PrivateRoute>
      } />
      <Route path="/admin/users" element={
        <PrivateRoute adminOnly={true}>
          <AdminUsers />
        </PrivateRoute>
      } />
      <Route path="/admin/permissions" element={
        <PrivateRoute adminOnly={true}>
          <ManagePermissions />
        </PrivateRoute>
      } />
      <Route path="/admin/agent/:agentId" element={
        <PrivateRoute adminOnly={true}>
          <AgentDetails />
        </PrivateRoute>
      } />
      <Route path="/admin/session/:sessionId" element={
        <PrivateRoute adminOnly={true}>
          <SessionDetails />
        </PrivateRoute>
      } />

      {/* User Routes */}
      <Route path="/user/dashboard" element={
        <PrivateRoute>
          <UserDashboard />
        </PrivateRoute>
      } />
      <Route path="/user/agent/:agentId" element={
        <PrivateRoute>
          <AgentDetails />
        </PrivateRoute>
      } />
      <Route path="/user/session/:sessionId" element={
        <PrivateRoute>
          <SessionDetails />
        </PrivateRoute>
      } />

      {/* Root redirect based on role */}
      <Route path="/" element={
        <PrivateRoute>
          {isAdmin ? <Navigate to="/admin" replace /> : <Navigate to="/user/dashboard" replace />}
        </PrivateRoute>
      } />
    </Routes>
  );
}

function App() {
  return (
    <AuthProvider>
      <Router>
        <div className="app-container">
          <DeactivationModal />
          <AppRoutes />
        </div>
      </Router>
    </AuthProvider>
  );
}

export default App;
