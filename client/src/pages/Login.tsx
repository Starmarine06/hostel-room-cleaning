import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { authService, getErrorMessage } from '../services/api';
import { Building2, Mail, Lock, Eye, EyeOff } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login, loginWithGoogle } = useAuth();
  const navigate = useNavigate();
  const googleButton = useRef<HTMLDivElement>(null);
  const [googleClientId, setGoogleClientId] = useState<string | null>(null);

  useEffect(() => {
    authService.config().then((c) => setGoogleClientId(c.googleClientId)).catch(() => undefined);
  }, []);

  // Google sign-in appears only once the server has a Google client id configured
  useEffect(() => {
    if (!googleClientId) return;
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => {
      const google = (window as unknown as { google?: { accounts: { id: {
        initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
        renderButton: (el: HTMLElement, o: { theme: string; size: string; width: number }) => void;
      } } } }).google;
      if (!google || !googleButton.current) return;
      google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (response) => {
          setError('');
          try {
            await loginWithGoogle(response.credential);
            navigate('/');
          } catch (err) {
            setError(getErrorMessage(err, 'Google sign-in failed'));
          }
        },
      });
      google.accounts.id.renderButton(googleButton.current, { theme: 'outline', size: 'large', width: 320 });
    };
    document.head.appendChild(script);
    return () => {
      script.remove();
    };
  }, [googleClientId, loginWithGoogle, navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(getErrorMessage(err, 'Invalid email or password'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
      <div className="max-w-md w-full space-y-8">
        <div className="text-center">
          <Link to="/" className="inline-flex items-center space-x-2 text-3xl font-bold text-primary-600">
            <Building2 className="h-10 w-10" />
            <span>Hostel Cleaning</span>
          </Link>
          <h2 className="mt-6 text-3xl font-bold text-gray-900">Sign in to your account</h2>
          <p className="mt-2 text-gray-600">
            Accounts are created by the hostel office. Use the email they registered for you.
          </p>
        </div>

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg text-sm" role="alert">
              {error}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="sr-only">Email address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="input pl-10"
                  placeholder="Email address"
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="sr-only">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-gray-400" />
                <input
                  id="password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input pl-10 pr-10"
                  placeholder="Password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                </button>
              </div>
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="btn btn-primary w-full py-3"
            >
              {loading ? (
                <span className="flex items-center justify-center space-x-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>Signing in...</span>
                </span>
              ) : (
                'Sign in'
              )}
            </button>
          </div>
        </form>

        {googleClientId && (
          <div className="flex flex-col items-center space-y-3">
            <span className="text-sm text-gray-500">or</span>
            <div ref={googleButton} />
          </div>
        )}

        {import.meta.env.DEV && (
        <div className="text-center text-sm text-gray-500">
          <p>Demo credentials:</p>
          <p className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">resident@hostel.com / password123</p>
          <p className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">cleaner@hostel.com / password123</p>
          <p className="font-mono text-xs bg-gray-100 px-2 py-1 rounded">admin@hostel.com / password123</p>
        </div>
        )}
      </div>
    </div>
  );
}