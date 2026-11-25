/**
 * L.I.F.E. Login Page
 * Username/password sign-in. Failed-attempt lockout is enforced by the server.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ApiError } from '../api/client';
import { EyeIcon, EyeOffIcon, WarningIcon } from '../components/icons';
import { Banner, Spinner } from '../components/ui';
import { LoginBackdrop } from '../components/LoginBackdrop';
import './LoginPage.css';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, isAuthenticated, isLoading: authLoading } = useAuth();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname || '/dashboard';

  if (!authLoading && isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');

    if (!username.trim() || !password) {
      setError('Please enter both username and password.');
      return;
    }

    setSubmitting(true);
    try {
      await login({ username: username.trim(), password });
      navigate(from, { replace: true });
    } catch (err) {
      if (err instanceof ApiError && err.status === 429) {
        setError(err.message);
      } else if (err instanceof ApiError && err.status === 401) {
        setError('Invalid username or password. After 5 failed attempts, sign-in is locked for 5 minutes.');
      } else {
        setError(err instanceof Error ? err.message : 'Sign-in failed');
      }
      setPassword('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-container">
      <LoginBackdrop />
      <div className="login-card">
        <div className="login-header">
          <img className="login-emblem" src="/brand/logo-256.png" alt="Project L.I.F.E. emblem" width={128} height={128} />
          <div className="login-logo">L.I.F.E<span className="brand-accent">.</span></div>
          <div className="login-subtitle">Localized Intelligent First-aid Evaluator</div>
        </div>

        <div className="login-body">
          <form onSubmit={handleSubmit} noValidate>
            <div className="form-group">
              <label htmlFor="username" className="form-label">Username</label>
              <input
                type="text"
                id="username"
                className="form-input"
                value={username}
                onChange={event => setUsername(event.target.value)}
                placeholder="e.g. juan.delacruz"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                disabled={submitting}
                autoFocus
              />
            </div>

            <div className="form-group">
              <label htmlFor="password" className="form-label">Password</label>
              <div className="password-wrapper">
                <input
                  type={showPassword ? 'text' : 'password'}
                  id="password"
                  className="form-input"
                  value={password}
                  onChange={event => setPassword(event.target.value)}
                  placeholder="Enter password"
                  autoComplete="current-password"
                  disabled={submitting}
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(shown => !shown)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  aria-pressed={showPassword}
                >
                  {showPassword ? <EyeOffIcon size={20} /> : <EyeIcon size={20} />}
                </button>
              </div>
            </div>

            <Banner kind="error">{error}</Banner>

            <button
              type="submit"
              className="btn btn-primary btn-lg"
              style={{ width: '100%', marginTop: 8 }}
              disabled={submitting}
            >
              {submitting ? <><Spinner size={18} /> Signing in...</> : 'Sign In'}
            </button>
          </form>

          <p className="login-help">
            <strong>Trainees:</strong> sign in with the username and temporary password from your trainer; you will
            choose your own password. <strong>Staff:</strong> the first admin account is described in the README.
          </p>
        </div>

        <div className="login-footer">
          <div className="login-disclaimer">
            <WarningIcon />
            <span>
              <strong>Training aid only. Not a medical device.</strong> This system evaluates adult CPR practice for
              elbow lock and cadence only. A single 2D webcam does not measure compression depth, recoil, hand
              placement, or rescue breaths.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
