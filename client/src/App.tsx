import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { SocketProvider } from './context/SocketContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import ResidentDashboard from './pages/ResidentDashboard';
import CleanerDashboard from './pages/CleanerDashboard';
import AdminDashboard from './pages/AdminDashboard';
import RequestDetail from './pages/RequestDetail';
import Profile from './pages/Profile';
import { useAuth } from './context/AuthContext';

function ProtectedRoute({ children, allowedRoles }: { children: React.ReactNode; allowedRoles?: string[] }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-4 border-primary-600 border-t-transparent"></div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Someone still on an issued password can only reach the page where they choose their own
  if (user.mustChangePassword && !location.pathname.endsWith('/profile')) {
    return <Navigate to="/profile" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <RoleHome />;
  }

  return <>{children}</>;
}

function RoleHome() {
  const { user } = useAuth();
  const home = user?.role === 'ADMIN' ? '/admin' : user?.role === 'CLEANER' ? '/cleaner' : '/dashboard';
  return <Navigate to={home} replace />;
}

function App() {
  return (
    <AuthProvider>
      <SocketProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<RoleHome />} />
            <Route
              path="dashboard"
              element={
                <ProtectedRoute allowedRoles={['RESIDENT']}>
                  <ResidentDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="cleaner"
              element={
                <ProtectedRoute allowedRoles={['CLEANER']}>
                  <CleanerDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="admin"
              element={
                <ProtectedRoute allowedRoles={['ADMIN']}>
                  <AdminDashboard />
                </ProtectedRoute>
              }
            />
            <Route
              path="request/:id"
              element={
                <ProtectedRoute>
                  <RequestDetail />
                </ProtectedRoute>
              }
            />
            <Route
              path="profile"
              element={
                <ProtectedRoute>
                  <Profile />
                </ProtectedRoute>
              }
            />
          </Route>
        </Routes>
      </SocketProvider>
    </AuthProvider>
  );
}

export default App;