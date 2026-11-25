/**
 * Small shared UI building blocks: Banner, Modal, PageHeader, EmptyState.
 */

import { useEffect, useId, useRef } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertIcon, CheckCircleIcon, CloseIcon, InfoIcon, WarningIcon } from './icons';

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

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
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
