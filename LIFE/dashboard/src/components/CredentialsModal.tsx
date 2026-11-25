/**
 * Shows a trainee's username and one-time temporary password after the admin creates the
 * account or resets the password. The password is not stored in readable form, so this is the
 * only time it can be seen.
 */

import { useRef, useState } from 'react';
import type { TraineeCredentials } from '../api/types';
import { Modal } from './ui';
import { KeyIcon, PrintIcon, WarningIcon } from './icons';
import './CredentialsModal.css';

export function CredentialsModal({
  traineeName,
  credentials,
  reset = false,
  onClose,
}: {
  traineeName: string;
  credentials: TraineeCredentials;
  reset?: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const signInUrl = `${window.location.origin}/login`;

  const text = `L.I.F.E. sign-in for ${traineeName}\nAddress: ${signInUrl}\nUsername: ${credentials.username}\nTemporary password: ${credentials.temporary_password}\nYou will be asked to choose your own password at first sign-in.`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopied(false);
      window.prompt('Copy the sign-in details:', text);
    }
  };

  // Print a small slip in a hidden frame (no scripts; values are escaped).
  const print = () => {
    const escape = (value: string) => value.replace(/[&<>"']/g, ch => `&#${ch.charCodeAt(0)};`);
    const html = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>L.I.F.E. sign-in</title><style>
body{font-family:Segoe UI,Arial,sans-serif;padding:24px;color:#0f2240}
.slip{border:2px dashed #0a2e56;border-radius:8px;padding:18px 22px;max-width:420px}
h1{font-size:18px;margin:0 0 4px;color:#0a2e56}p{margin:6px 0}code{font-size:18px;font-weight:700;letter-spacing:1px}
small{color:#5b6880}</style></head><body><div class="slip">
<h1>L.I.F.E. sign-in</h1><p>${escape(traineeName)}</p>
<p>Address: ${escape(signInUrl)}</p>
<p>Username: <code>${escape(credentials.username)}</code></p>
<p>Temporary password: <code>${escape(credentials.temporary_password)}</code></p>
<small>You will be asked to choose your own password at first sign-in. Keep this slip private.</small>
</div></body></html>`;
    frameRef.current?.remove();
    const frame = document.createElement('iframe');
    frame.setAttribute('aria-hidden', 'true');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;visibility:hidden;';
    frame.onload = () => { frame.contentWindow?.focus(); frame.contentWindow?.print(); };
    frame.srcdoc = html;
    document.body.appendChild(frame);
    frameRef.current = frame;
  };

  return (
    <Modal
      title={reset ? 'New temporary password' : 'Sign-in account created'}
      subtitle={traineeName}
      size="sm"
      closeOnBackdrop={false}
      onClose={() => { frameRef.current?.remove(); onClose(); }}
      actions={
        <>
          <button type="button" className="btn btn-secondary" onClick={print}><PrintIcon /> Print slip</button>
          <button type="button" className="btn btn-secondary" onClick={() => void copy()}>{copied ? 'Copied ✓' : 'Copy'}</button>
          <button type="button" className="btn btn-primary" onClick={() => { frameRef.current?.remove(); onClose(); }} autoFocus>Done</button>
        </>
      }
    >
      <div className="credentials">
        <div className="credential-row">
          <span>Username</span>
          <code>{credentials.username}</code>
        </div>
        <div className="credential-row">
          <span><KeyIcon size={14} /> Temporary password</span>
          <code>{credentials.temporary_password}</code>
        </div>
        <p className="credentials-note">
          <WarningIcon size={16} />
          <span>
            Give these to the trainee now: the password is shown <strong>only once</strong>. They will choose their own
            password at first sign-in. {reset && 'Their previous password no longer works.'}
          </span>
        </p>
      </div>
    </Modal>
  );
}

export default CredentialsModal;
