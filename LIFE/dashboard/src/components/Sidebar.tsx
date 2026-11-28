/**
 * L.I.F.E. Sidebar navigation
 */

import type { ComponentType, SVGProps } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import {
  CameraIcon,
  ChartIcon,
  DashboardIcon,
  FileIcon,
  HeartPulseIcon,
  HistoryIcon,
  LogoutIcon,
  SettingsIcon,
  ShieldIcon,
  TrophyIcon,
  UsersIcon,
} from './icons';
import './Sidebar.css';

interface NavItem {
  path: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement> & { size?: number }>;
  adminOnly?: boolean;
  /** Who sees the item: staff (default), trainee accounts, or both. */
  audience?: 'staff' | 'trainee' | 'all';
  /** Label shown to trainee accounts, if different. */
  traineeLabel?: string;
  /** Short highlight shown next to the label. */
  tag?: string;
}

export const NAVIGATION: { section: string; items: NavItem[] }[] = [
  { section: 'Overview', items: [
    { path: '/dashboard', label: 'Dashboard', icon: DashboardIcon },
    { path: '/my-progress', label: 'My Progress', icon: ChartIcon, audience: 'trainee' },
    { path: '/live', label: 'Live Session', icon: CameraIcon, audience: 'all', traineeLabel: 'Practice', tag: 'AI' },
    { path: '/leaderboard', label: 'Leaderboard', icon: TrophyIcon, audience: 'all' },
    { path: '/guide', label: 'CPR Guide', icon: HeartPulseIcon, audience: 'all' },
  ]},
  { section: 'Manage', items: [
    { path: '/trainees', label: 'Trainees', icon: UsersIcon },
    { path: '/history', label: 'Session History', icon: HistoryIcon },
    { path: '/reports', label: 'Reports & Export', icon: FileIcon },
  ]},
  { section: 'Administration', items: [
    { path: '/settings', label: 'Settings & Backup', icon: SettingsIcon, adminOnly: true },
  ]},
];

const ROLE_LABEL: Record<string, string> = { admin: 'Administrator', trainer: 'Trainer', trainee: 'Trainee' };

interface SidebarProps {
  isOpen?: boolean;
  onClose?: () => void;
}

export function Sidebar({ isOpen = false, onClose }: SidebarProps) {
  const { user, logout } = useAuth();
  const isTrainee = user?.role === 'trainee';
  const navigate = useNavigate();

  const handleLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <>
      <aside className={`sidebar ${isOpen ? 'open' : ''}`} aria-label="Main navigation">
        <div className="sidebar-header">
          <img className="sidebar-emblem" src="/brand/logo-128.png" alt="" width={44} height={44} />
          <div className="sidebar-brand">
            <div className="sidebar-logo">L.I.F.E<span className="brand-accent">.</span></div>
            <div className="sidebar-tagline">AI CPR Training Coach</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          {NAVIGATION.map(section => {
            const items = section.items.filter(item => {
              const audience = item.audience ?? 'staff';
              if (audience === 'trainee' && !isTrainee) return false;
              if (audience === 'staff' && isTrainee) return false;
              return !item.adminOnly || user?.role === 'admin';
            });
            if (items.length === 0) return null;
            return (
              <div key={section.section} className="nav-section">
                <div className="nav-section-title">{section.section}</div>
                {items.map(item => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
                    onClick={onClose}
                  >
                    <item.icon className="nav-icon" />
                    <span className="nav-label">{(isTrainee && item.traineeLabel) || item.label}</span>
                    {item.tag && <span className="nav-tag">{item.tag}</span>}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-trust">
            <ShieldIcon size={14} />
            <span>Private by design · video never leaves this device</span>
          </div>
          <div className="user-info">
            <div className="user-avatar">{user ? user.username.slice(0, 2).toUpperCase() : '?'}</div>
            <div className="user-details">
              <div className="user-name">{user?.username || 'Guest'}</div>
              <div className="user-role">{ROLE_LABEL[user?.role ?? ''] ?? ''}</div>
            </div>
            <button type="button" className="sidebar-logout" onClick={() => void handleLogout()} aria-label="Sign out" title="Sign out">
              <LogoutIcon size={18} />
            </button>
          </div>
        </div>
      </aside>
      {isOpen && (
        <button type="button" className="sidebar-overlay open" aria-label="Close navigation" onClick={onClose} />
      )}
    </>
  );
}

export default Sidebar;
