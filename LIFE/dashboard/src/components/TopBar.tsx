/**
 * L.I.F.E. Top Bar
 * Page title, offline-queue status, and the user menu (change password, logout).
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useOutbox } from '../hooks/useOutbox';
import { formatDateTime } from '../utils/format';
import { ChangePasswordForm } from './ChangePasswordForm';
import { ChevronDownIcon, CloudOffIcon, KeyIcon, LogoutIcon, MenuIcon } from './icons';
import { Banner, Modal } from './ui';
import './TopBar.css';

interface TopBarProps {
  title: string;
  onMenuClick?: () => void;
  menuOpen?: boolean;
}

export function TopBar({ title, onMenuClick, menuOpen = false }: TopBarProps) {
  const { user, logout } = useAuth();
  const { pendingCount, rejected, needsSignIn, syncing, syncNow, discard, retry } = useOutbox();
  const navigate = useNavigate();
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showOutbox, setShowOutbox] = useState(false);
  const [passwordChanged, setPasswordChanged] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showUserMenu) return;
    const onPointerDown = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) setShowUserMenu(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setShowUserMenu(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [showUserMenu]);

  const handleLogout = async () => {
    setShowUserMenu(false);
    await logout();
    navigate('/login', { replace: true });
  };

  const unsynced = pendingCount + rejected.length;

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button
          type="button"
          className="mobile-menu-btn"
          onClick={onMenuClick}
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          aria-expanded={menuOpen}
        >
          <MenuIcon size={24} />
        </button>
        <h1 className="topbar-title">{title}</h1>
      </div>

      <div className="topbar-actions">
        {unsynced > 0 && (
          <button
            type="button"
            className={`pending-badge ${rejected.length > 0 ? 'attention' : ''}`}
            onClick={() => setShowOutbox(true)}
            title="Sessions saved on this computer that have not reached the server yet"
          >
            <CloudOffIcon size={14} />
            {unsynced} unsynced
          </button>
        )}

        <div className="user-menu-wrapper" ref={menuRef}>
          <button
            type="button"
            className="user-menu-trigger"
            onClick={() => setShowUserMenu(open => !open)}
            aria-haspopup="menu"
            aria-expanded={showUserMenu}
          >
            <span className="user-avatar">{user ? user.username.charAt(0).toUpperCase() : '?'}</span>
            <span className="user-name">{user?.username || 'Guest'}</span>
            <ChevronDownIcon />
          </button>

          {showUserMenu && (
            <div className="user-menu-dropdown" role="menu">
              <div className="dropdown-header">
                <strong>{user?.username}</strong>
                <span className="dropdown-role">{user?.role}</span>
              </div>
              <button
                type="button"
                className="dropdown-item"
                role="menuitem"
                onClick={() => { setShowUserMenu(false); setPasswordChanged(false); setShowPasswordModal(true); }}
              >
                <KeyIcon /> Change password
              </button>
              <button type="button" className="dropdown-item" role="menuitem" onClick={() => void handleLogout()}>
                <LogoutIcon /> Logout
              </button>
            </div>
          )}
        </div>
      </div>

      {showPasswordModal && (
        <Modal title="Change Password" size="sm" onClose={() => setShowPasswordModal(false)}>
          {passwordChanged ? (
            <>
              <Banner kind="success">Your password was changed. Other signed-in devices have been signed out.</Banner>
              <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={() => setShowPasswordModal(false)}>
                Done
              </button>
            </>
          ) : (
            <ChangePasswordForm onDone={() => setPasswordChanged(true)} />
          )}
        </Modal>
      )}

      {showOutbox && (
        <Modal
          title="Unsynced Sessions"
          subtitle="Saved on this computer and not yet stored on the server."
          onClose={() => setShowOutbox(false)}
          actions={
            <button type="button" className="btn btn-primary" onClick={() => void syncNow()} disabled={syncing}>
              {syncing ? 'Syncing...' : 'Retry now'}
            </button>
          }
        >
          {needsSignIn && <Banner kind="warning">Your sign-in expired. Sign out and back in to upload these sessions — they stay saved here.</Banner>}
          {pendingCount > 0 && (
            <p>{pendingCount} session{pendingCount === 1 ? '' : 's'} waiting to upload. Uploads retry automatically every 30 seconds.</p>
          )}
          {rejected.length > 0 && (
            <>
              <h3 style={{ fontSize: 16, margin: '16px 0 8px' }}>Rejected by the server</h3>
              <ul className="outbox-list">
                {rejected.map(entry => (
                  <li key={entry.session.client_session_id}>
                    <div>
                      <strong>Trainee #{entry.session.trainee_id}</strong> · recorded {formatDateTime(entry.queuedAt)}
                      <div className="text-muted" style={{ fontSize: 13 }}>{entry.rejection}</div>
                    </div>
                    <div className="outbox-actions">
                    <button type="button" className="btn btn-sm btn-secondary" onClick={() => void retry(entry.session.client_session_id)}>
                      Retry
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-danger"
                      onClick={() => {
                        if (window.confirm('Discard this session permanently? It cannot be recovered.')) {
                          void discard(entry.session.client_session_id);
                        }
                      }}
                    >
                      Discard
                    </button>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="form-help">Fix the cause first (for example, record the trainee's consent on the Trainees page), then press Retry.</p>
            </>
          )}
        </Modal>
      )}
    </header>
  );
}

export default TopBar;
