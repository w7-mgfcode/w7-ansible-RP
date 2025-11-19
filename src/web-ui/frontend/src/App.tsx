import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from './lib/store';
import { WebSocketProvider } from './contexts/WebSocketContext';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import Playbooks from './pages/Playbooks';
import Executions from './pages/Executions';
import Templates from './pages/Templates';
import Jobs from './pages/Jobs';
import Settings from './pages/Settings';
import Login from './pages/Login';

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated } = useAuthStore();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <WebSocketProvider>
              <Layout>
                <Routes>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/playbooks" element={<Playbooks />} />
                  <Route path="/playbooks/:id" element={<Playbooks />} />
                  <Route path="/executions" element={<Executions />} />
                  <Route path="/executions/:id" element={<Executions />} />
                  <Route path="/templates" element={<Templates />} />
                  <Route path="/jobs" element={<Jobs />} />
                  <Route path="/settings" element={<Settings />} />
                </Routes>
              </Layout>
            </WebSocketProvider>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}
