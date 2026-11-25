/**
 * Change-password form, used for the forced first-login change and from the user menu.
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { useAuth } from '../hooks/useAuth';
import { errorMessage } from '../utils/format';
import { Banner, Spinner } from './ui';

export const PASSWORD_MIN_LENGTH = 8;

export function ChangePasswordForm({ onDone, submitLabel = 'Change Password' }: { onDone?: () => void; submitLabel?: string }) {
  const { changePassword } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setError(`The new password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('The new passwords do not match.');
      return;
    }
    if (newPassword === currentPassword) {
      setError('Choose a password different from the current one.');
      return;
    }

    setSaving(true);
    try {
      await changePassword({ currentPassword, newPassword });
      onDone?.();
    } catch (err) {
      setError(errorMessage(err, 'Failed to change password'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} noValidate>
      <Banner kind="error">{error}</Banner>
      <div className="form-group">
        <label htmlFor="current-password" className="form-label">Current password</label>
        <input
          id="current-password"
          type="password"
          className="form-input"
          autoComplete="current-password"
          value={currentPassword}
          onChange={event => setCurrentPassword(event.target.value)}
          autoFocus
          required
        />
      </div>
      <div className="form-group">
        <label htmlFor="new-password" className="form-label">New password</label>
        <input
          id="new-password"
          type="password"
          className="form-input"
          autoComplete="new-password"
          value={newPassword}
          onChange={event => setNewPassword(event.target.value)}
          minLength={PASSWORD_MIN_LENGTH}
          required
          aria-describedby="new-password-help"
        />
        <p className="form-help" id="new-password-help">At least {PASSWORD_MIN_LENGTH} characters.</p>
      </div>
      <div className="form-group">
        <label htmlFor="confirm-password" className="form-label">Confirm new password</label>
        <input
          id="confirm-password"
          type="password"
          className="form-input"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={event => setConfirmPassword(event.target.value)}
          required
        />
      </div>
      <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={saving}>
        {saving ? <><Spinner /> Saving...</> : submitLabel}
      </button>
    </form>
  );
}
