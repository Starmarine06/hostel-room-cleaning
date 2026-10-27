import { Outlet, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useSocket } from '../context/SocketContext';
import { LogOut, User, Home, Building2, Wifi, WifiOff } from 'lucide-react';

export default function Layout() {
  const { user, logout } = useAuth();
  const { isConnected } = useSocket();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  const getDashboardPath = () => {
    switch (user?.role) {
      case 'CLEANER':
        return '/cleaner';
      case 'ADMIN':
        return '/admin';
      default:
        return '/dashboard';
    }
  };

  const navLinks = [
    { path: getDashboardPath(), label: 'Dashboard', icon: Home },
    { path: '/profile', label: 'Profile', icon: User },
  ];

  if (user?.role === 'ADMIN' && getDashboardPath() !== '/admin') {
    navLinks.push({ path: '/admin', label: 'Admin', icon: Building2 });
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm border-b border-gray-200">
        <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8" aria-label="Main navigation">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center">
              <NavLink
                to={getDashboardPath()}
                className="flex items-center space-x-2 text-xl font-bold text-primary-600"
              >
                <Building2 className="h-8 w-8" />
                <span>Hostel Cleaning</span>
              </NavLink>
            </div>

            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 text-sm text-gray-500">
                <span className={isConnected ? 'text-green-500' : 'text-red-500'}>
                  {isConnected ? (
                    <Wifi className="h-4 w-4" />
                  ) : (
                    <WifiOff className="h-4 w-4" />
                  )}
                </span>
                <span>{isConnected ? 'Live' : 'Offline'}</span>
              </div>

              <div className="hidden md:flex items-center space-x-1">
                {navLinks.map((link) => (
                  <NavLink
                    key={link.path}
                    to={link.path}
                    className={({ isActive }) =>
                      `flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                        isActive
                          ? 'bg-primary-50 text-primary-700'
                          : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                      }`
                    }
                  >
                    <link.icon className="h-4 w-4" />
                    <span>{link.label}</span>
                  </NavLink>
                ))}
              </div>

              <div className="flex items-center space-x-3">
                <span className="hidden sm:block text-sm text-gray-700">
                  {user?.name} ({user?.role})
                </span>
                <button
                  onClick={handleLogout}
                  className="flex items-center space-x-2 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  <span className="hidden sm:inline">Logout</span>
                </button>
              </div>
            </div>
          </div>
        </nav>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
}