import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import AgentDetails from './pages/AgentDetails';
import SessionDetails from './pages/SessionDetails';
import './App.css';

function PrivateRoute({ children }) {
  // Simple check
  const token = localStorage.getItem('token');
  return token ? children : <Navigate to="/login" />;
}

function App() {
  return (
    <Router>
      <div className="app-container">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/" element={
            <PrivateRoute>
              <Dashboard />
            </PrivateRoute>
          } />
          <Route path="/agent/:agentId" element={
            <PrivateRoute>
              <AgentDetails />
            </PrivateRoute>
          } />
          <Route path="/session/:sessionId" element={
            <PrivateRoute>
              <SessionDetails />
            </PrivateRoute>
          } />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
