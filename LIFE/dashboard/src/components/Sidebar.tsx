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
}

export const NAVIGATION: { section: string; items: NavItem[] }[] = [
  { section: 'Main', items: [
    { path: '/dashboard', label: 'Dashboard', icon: DashboardIcon },
    { path: '/my-progress', label: 'My Progress', icon: ChartIcon, audience: 'trainee' },
    { path: '/live', label: 'Live Session', icon: CameraIcon, audience: 'all', traineeLabel: 'Practice' },
    { path: '/guide', label: 'CPR Guide', icon: HeartPulseIcon, audience: 'all' },
  ]},
  { section: 'Data', items: [
    { path: '/trainees', label: 'Trainees', icon: UsersIcon },
    { path: '/leaderboard', label: 'Leaderboard', icon: ChartIcon },
    { path: '/history', label: 'History', icon: HistoryIcon },
  ]},
  { section: 'Reports', items: [
    { path: '/reports', label: 'Reports & Export', icon: FileIcon },
  ]},
  { section: 'Settings', items: [
    { path: '/settings', label: 'Settings', icon: SettingsIcon, adminOnly: true },
  ]},
];

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
          <img className="sidebar-emblem" src="/brand/logo-128.png" alt="" width={56} height={56} />
          <div className="sidebar-brand">
            <div className="sidebar-logo">L.I.F.E<span className="brand-accent">.</span></div>
            <div className="sidebar-tagline">Localized Intelligent First-aid Evaluator</div>
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
                    {(isTrainee && item.traineeLabel) || item.label}
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <div className="user-info">
            <div className="user-avatar">{user ? user.username.slice(0, 2).toUpperCase() : '?'}</div>
            <div className="user-details">
              <div className="user-name">{user?.username || 'Guest'}</div>
              <div className="user-role">{user?.role || ''}</div>
            </div>
          </div>
          <button type="button" className="btn btn-secondary btn-sm mt-2" style={{ width: '100%' }} onClick={() => void handleLogout()}>
            <LogoutIcon className="nav-icon" />
            Logout
          </button>
        </div>
      </aside>
      {isOpen && (
        <button type="button" className="sidebar-overlay open" aria-label="Close navigation" onClick={onClose} />
      )}
    </>
  );
}

export default Sidebar;
