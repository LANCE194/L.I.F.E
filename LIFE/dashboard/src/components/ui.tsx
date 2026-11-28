/**
 * Small shared UI building blocks: Banner, Modal, PageHeader, EmptyState.
 */

import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { SessionScope } from '../api/types';
import { AlertIcon, CheckCircleIcon, ChevronDownIcon, CloseIcon, DownloadIcon, InfoIcon, WarningIcon } from './icons';

type BannerKind = 'error' | 'success' | 'warning' | 'info';

const BANNER_ICONS = {
  error: AlertIcon,
  success: CheckCircleIcon,
  warning: WarningIcon,
  info: InfoIcon,
};

export function Banner({
  kind,
  children,
  onDismiss,
}: {
  kind: BannerKind;
  children: ReactNode;
  onDismiss?: () => void;
}) {
  if (!children) return null;
  const Icon = BANNER_ICONS[kind];
  return (
    <div className={`banner banner-${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      <Icon size={18} />
      <div className="banner-text">{children}</div>
      {onDismiss && (
        <button type="button" className="banner-dismiss" onClick={onDismiss} aria-label="Dismiss message">
          <CloseIcon size={16} />
        </button>
      )}
    </div>
  );
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';

/**
 * Accessible modal dialog: Escape closes, focus moves into the dialog and is trapped there,
 * and focus returns to the previously focused element on close.
 */
export function Modal({
  title,
  subtitle,
  onClose,
  children,
  actions,
  size = 'md',
  closeOnBackdrop = true,
  headerExtra,
}: {
  title: string;
  subtitle?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  actions?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  closeOnBackdrop?: boolean;
  headerExtra?: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>('[autofocus]') ?? dialog?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialog)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key === 'Tab' && dialog) {
        const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (focusable.length === 0) return;
        const firstEl = focusable[0];
        const lastEl = focusable[focusable.length - 1];
        if (event.shiftKey && document.activeElement === firstEl) {
          event.preventDefault();
          lastEl.focus();
        } else if (!event.shiftKey && document.activeElement === lastEl) {
          event.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previouslyFocused?.focus?.();
    };
  }, []);

  return createPortal(
    <div className="modal-overlay" onMouseDown={event => { if (closeOnBackdrop && event.target === event.currentTarget) onClose(); }}>
      <div
        className={`modal modal-${size}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
      >
        <div className="modal-header">
          <div>
            <h2 className="modal-title" id={titleId}>{title}</h2>
            {subtitle && <p className="modal-subtitle">{subtitle}</p>}
          </div>
          <div className="modal-header-extra">
            {headerExtra}
            <button type="button" className="btn btn-icon btn-secondary" onClick={onClose} aria-label="Close dialog">
              <CloseIcon />
            </button>
          </div>
        </div>
        <div className="modal-body">{children}</div>
        {actions && <div className="modal-actions">{actions}</div>}
      </div>
    </div>,
    document.body
  );
}

export function PageHeader({ title, subtitle, actions, eyebrow }: { title: string; subtitle?: string; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="page-header">
      <div>
        {eyebrow && <div className="page-eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon}
      <h3>{title}</h3>
      {children && <div>{children}</div>}
    </div>
  );
}

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size, borderWidth: 2 }} aria-hidden="true" />;
}

export function ResultBadge({ result }: { result: string }) {
  return <span className={`badge ${result === 'Pass' ? 'badge-success' : 'badge-danger'}`}>{result}</span>;
}

const SCOPE_OPTIONS: { value: SessionScope; label: string; title: string }[] = [
  { value: 'all', label: 'All sessions', title: 'Trainer-supervised sessions and trainee self-practice' },
  { value: 'supervised', label: 'Supervised', title: 'Sessions run by a trainer only (the Chapter 4 evaluation set)' },
  { value: 'self', label: 'Self-practice', title: 'Sessions trainees recorded on their own account' },
];

/** Segmented switch for which sessions rankings and statistics count. */
export function ScopeSwitch({ value, onChange, label = 'Sessions counted' }: { value: SessionScope; onChange: (scope: SessionScope) => void; label?: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {SCOPE_OPTIONS.map(option => (
        <button key={option.value} type="button" aria-pressed={value === option.value} title={option.title} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

export const SCOPE_DESCRIPTION: Record<SessionScope, string> = {
  all: 'all sessions (trainer-supervised and trainee self-practice)',
  supervised: 'trainer-supervised sessions only',
  self: 'trainee self-practice sessions only',
};

export interface DownloadOption {
  key: string;
  title: string;
  description?: string;
  run: () => Promise<void>;
}

/** Button with a small menu of downloads; shows progress and reports failures through onError. */
export function DownloadMenu({ label = 'Download', options, onError, variant = 'btn-secondary' }: {
  label?: string;
  options: DownloadOption[];
  onError?: (message: string) => void;
  variant?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const run = async (option: DownloadOption) => {
    setBusy(option.key);
    try {
      await option.run();
      setOpen(false);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="menu" ref={ref}>
      <button type="button" className={`btn ${variant}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)} disabled={busy !== null}>
        {busy ? <Spinner size={14} /> : <DownloadIcon />} {busy ? 'Preparing...' : label} <ChevronDownIcon />
      </button>
      {open && (
        <div className="menu-panel" role="menu">
          {options.map(option => (
            <button key={option.key} type="button" role="menuitem" className="menu-item" onClick={() => void run(option)} disabled={busy !== null}>
              <DownloadIcon />
              <span>
                <span className="menu-item-title">{option.title}</span>
                {option.description && <span className="menu-item-desc">{option.description}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Headline number with a label, an icon and an optional hint. */
export function Kpi({ label, value, icon, tone = 'primary', valueTone, hint }: {
  label: string;
  value: ReactNode;
  icon?: ReactNode;
  tone?: 'primary' | 'success' | 'warning' | 'info' | 'accent' | 'gold';
  valueTone?: string;
  hint?: ReactNode;
}) {
  return (
    <div className="kpi">
      <div className="kpi-head">
        <span className="kpi-label">{label}</span>
        {icon && <span className={`kpi-icon ${tone}`}>{icon}</span>}
      </div>
      <span className={`kpi-value ${valueTone ?? ''}`}>{value}</span>
      {hint && <span className="kpi-hint">{hint}</span>}
    </div>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase();
}

/** Avatar with initials, name and an optional second line. */
export function Person({ name, meta, badge }: { name: string; meta?: ReactNode; badge?: ReactNode }) {
  return (
    <div className="person">
      <span className="person-avatar" aria-hidden="true">{initials(name)}</span>
      <div style={{ minWidth: 0 }}>
        <div className="person-name">{name}{badge}</div>
        {meta && <div className="person-meta">{meta}</div>}
      </div>
    </div>
  );
}

/** Accuracy as a number with a thin bar. */
export function AccuracyBar({ value, tone }: { value: number; tone: string }) {
  return (
    <div className="mini-bar">
      <span className={`accuracy-value ${tone}`} style={{ minWidth: 48 }}>{value.toFixed(1)}%</span>
      <span className="mini-bar-track"><span className={`mini-bar-fill ${tone}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></span>
    </div>
  );
}
