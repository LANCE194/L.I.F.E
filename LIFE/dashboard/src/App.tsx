/**
 * L.I.F.E. Main App Component
 * Routing, layout (sidebar + top bar rendered once), auth gates and lazy-loaded pages.
 */

import { lazy, Suspense, useEffect, useState } from 'react';
import { Routes, Route, Navigate, Outlet, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './hooks/useAuth';
import { OutboxProvider } from './hooks/useOutbox';
import { LoginPage } from './pages/LoginPage';
import { Sidebar, NAVIGATION } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import { ChangePasswordForm } from './components/ChangePasswordForm';
import { Spinner } from './components/ui';
import { LoginBackdrop } from './components/LoginBackdrop';
import './App.css';

// Pages are split into separate chunks; MediaPipe only loads with the Live Session page.
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const LiveSessionPage = lazy(() => import('./pages/LiveSessionPage'));
const TraineesPage = lazy(() => import('./pages/TraineesPage'));
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage'));
const HistoryPage = lazy(() => import('./pages/HistoryPage'));
const ReportsPage = lazy(() => import('./pages/ReportsPage'));
const SettingsPage = lazy(() => import('./pages/SettingsPage'));
const CprGuidePage = lazy(() => import('./pages/CprGuidePage'));
const MyProgressPage = lazy(() => import('./pages/MyProgressPage'));

function FullScreenLoading() {
  return (
    <div className="loading-screen">
      <div className="spinner" style={{ width: 40, height: 40 }} />
      <p>Loading...</p>
    </div>
  );
}

/** Requires a signed-in user; forces the first-login password change before anything else. */
function ProtectedRoute() {
  const { isAuthenticated, isLoading, mustChangePassword } = useAuth();
  const location = useLocation();

  if (isLoading) return <FullScreenLoading />;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />;
  if (mustChangePassword) return <ForcedPasswordChange />;
  return <Outlet />;
}

/** Staff pages (trainers and admins). Trainee accounts are sent to their own progress page. */
function StaffRoute() {
  const { isTrainee } = useAuth();
  return isTrainee ? <Navigate to="/my-progress" replace /> : <Outlet />;
}

function TraineeRoute() {
  const { isTrainee } = useAuth();
  return isTrainee ? <Outlet /> : <Navigate to="/dashboard" replace />;
}

function AdminRoute() {
  const { isAdmin } = useAuth();
  return isAdmin ? <Outlet /> : <Navigate to="/dashboard" replace />;
}

function ForcedPasswordChange() {
  const { user, logout } = useAuth();
  return (
    <div className="login-container">
      <LoginBackdrop />
      <div className="login-card">
        <div className="login-header">
          <img className="login-emblem" src="/brand/logo-256.png" alt="Project L.I.F.E. emblem" width={128} height={128} />
          <div className="login-logo">L.I.F.E<span className="brand-accent">.</span></div>
          <div className="login-subtitle">Choose a new password</div>
        </div>
        <div className="login-body">
          <p style={{ marginBottom: 16 }}>
            Signed in as <strong>{user?.username}</strong>. This account is using an initial or temporary password,
            so you must set your own before continuing.
          </p>
          <ChangePasswordForm submitLabel="Save and continue" />
          <button type="button" className="btn btn-secondary mt-3" style={{ width: '100%' }} onClick={() => void logout()}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function pageTitle(pathname: string, isTrainee: boolean): string {
  for (const section of NAVIGATION) {
    const item = section.items.find(entry => pathname.startsWith(entry.path));
    if (item) return (isTrainee && item.traineeLabel) || item.label;
  }
  return 'L.I.F.E.';
}

function AppLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const location = useLocation();
  const { isTrainee } = useAuth();
  const title = pageTitle(location.pathname, isTrainee);

  useEffect(() => {
    document.title = `${title} · L.I.F.E.`;
    setSidebarOpen(false);
  }, [title, location.pathname]);

  return (
    <OutboxProvider>
      <div className="app-layout">
        <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />
        <div className="main-content">
          <TopBar title={title} menuOpen={sidebarOpen} onMenuClick={() => setSidebarOpen(open => !open)} />
          <main className="page-content" id="main">
            <Suspense fallback={<div className="page-loading"><Spinner size={24} /> Loading page...</div>}>
              <Outlet />
            </Suspense>
          </main>
        </div>
      </div>
    </OutboxProvider>
  );
}

const App = () => (
  <AuthProvider>
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/guide" element={<CprGuidePage />} />
          {/* Staff run sessions for any trainee; trainee accounts practise as themselves. */}
          <Route path="/live" element={<LiveSessionPage />} />
          <Route element={<TraineeRoute />}>
            <Route path="/my-progress" element={<MyProgressPage />} />
          </Route>
          <Route element={<StaffRoute />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/trainees" element={<TraineesPage />} />
            <Route path="/leaderboard" element={<LeaderboardPage />} />
            <Route path="/history" element={<HistoryPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route element={<AdminRoute />}>
              <Route path="/settings" element={<SettingsPage />} />
            </Route>
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  </AuthProvider>
);

export default App;
