/**
 * L.I.F.E. Settings (admin only; the route is guarded in App.tsx and by the server)
 * Calibration settings, database backup and user accounts.
 *
 * Field ranges mirror SETTING_RULES in server/routes/settings.js. Only changed settings are
 * sent, so a stored value that is out of range is flagged but never blocks other changes.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { api, type Settings, type SettingsUpdateRequest, type User } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { Banner, EmptyState, Modal, PageHeader, Spinner } from '../components/ui';
import { DownloadIcon, EditIcon, PlusIcon, TrashIcon, UsersIcon } from '../components/icons';
import { PASSWORD_MIN_LENGTH } from '../components/ChangePasswordForm';
import { errorMessage, formatDate } from '../utils/format';
import { ALL_FIELDS, SETTING_GROUPS, parseInput, rangeError, type FieldSpec, type SettingKey } from '../utils/settingsSchema';
import './SettingsPage.css';

interface UserForm {
  username: string;
  password: string;
  role: 'admin' | 'trainer';
  is_active: boolean;
}

export function SettingsPage() {
  const { user } = useAuth();
  const [saved, setSaved] = useState<Partial<Settings>>({});
  const [inputs, setInputs] = useState<Partial<Record<SettingKey, string>>>({});
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [saving, setSaving] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [users, setUsers] = useState<User[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [userForm, setUserForm] = useState<UserForm>({ username: '', password: '', role: 'trainer', is_active: true });
  const [userFormError, setUserFormError] = useState('');
  const [userSubmitting, setUserSubmitting] = useState(false);

  const applySettings = useCallback((settings: Settings) => {
    setSaved(settings);
    setInputs(Object.fromEntries(ALL_FIELDS.map(field => [field.key, settings[field.key] === undefined ? '' : String(settings[field.key])])));
  }, []);

  const loadSettings = useCallback(async () => {
    try {
      applySettings((await api.getSettings()).settings);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load settings'));
    } finally {
      setLoadingSettings(false);
    }
  }, [applySettings]);

  const loadUsers = useCallback(async () => {
    try {
      setUsers((await api.getUsers()).users);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load users'));
    } finally {
      setLoadingUsers(false);
    }
  }, []);

  useEffect(() => {
    void loadSettings();
    void loadUsers();
  }, [loadSettings, loadUsers]);

  // Changed fields, per-field errors for them, and warnings for out-of-range stored values.
  const { changes, fieldErrors, storedWarnings, crossError } = useMemo(() => {
    const nextChanges: SettingsUpdateRequest = {};
    const errors: Partial<Record<SettingKey, string>> = {};
    const warnings: Partial<Record<SettingKey, string>> = {};

    for (const field of ALL_FIELDS) {
      const value = parseInput(inputs[field.key] ?? '');
      const stored = saved[field.key];
      if (value !== stored) {
        nextChanges[field.key] = value;
        const message = rangeError(field, value);
        if (message) errors[field.key] = message;
      } else if (stored !== undefined && rangeError(field, stored)) {
        warnings[field.key] = `The saved value ${stored} is outside the allowed range (${field.min}–${field.max}). Default: ${field.defaultValue}.`;
      }
    }

    const bpmMin = nextChanges.bpm_min ?? saved.bpm_min;
    const bpmMax = nextChanges.bpm_max ?? saved.bpm_max;
    const cross = bpmMin !== undefined && bpmMax !== undefined && bpmMin >= bpmMax ? 'Min BPM must be lower than max BPM.' : '';

    return { changes: nextChanges, fieldErrors: errors, storedWarnings: warnings, crossError: cross };
  }, [inputs, saved]);

  const changedCount = Object.keys(changes).length;
  const hasErrors = Object.keys(fieldErrors).length > 0 || Boolean(crossError);

  const handleSaveSettings = async (event?: FormEvent) => {
    event?.preventDefault();
    if (changedCount === 0 || hasErrors) return;
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      applySettings((await api.updateSettings(changes)).settings);
      setSuccess(`Saved ${changedCount} setting${changedCount === 1 ? '' : 's'}. New sessions use them right away.`);
    } catch (err) {
      setError(errorMessage(err, 'Failed to save settings'));
    } finally {
      setSaving(false);
    }
  };

  const discardChanges = () => applySettings(saved as Settings);

  const applyDefault = (field: FieldSpec) => setInputs(previous => ({ ...previous, [field.key]: String(field.defaultValue) }));

  const handleBackup = async () => {
    setBackingUp(true);
    setError('');
    setSuccess('');
    try {
      const res = await api.backupDatabase();
      setSuccess(`Database backed up to ${res.path}`);
    } catch (err) {
      setError(errorMessage(err, 'Backup failed'));
    } finally {
      setBackingUp(false);
    }
  };

  // --- Users ---

  const openAddUser = () => {
    setEditingUser(null);
    setUserForm({ username: '', password: '', role: 'trainer', is_active: true });
    setUserFormError('');
    setShowUserModal(true);
  };

  const openEditUser = (target: User) => {
    setEditingUser(target);
    setUserForm({ username: target.username, password: '', role: target.role === 'admin' ? 'admin' : 'trainer', is_active: target.is_active });
    setUserFormError('');
    setShowUserModal(true);
  };

  const handleUserFormChange = (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = event.target;
    setUserForm(previous => ({ ...previous, [name]: type === 'checkbox' ? (event.target as HTMLInputElement).checked : value }));
    setUserFormError('');
  };

  const handleUserSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const username = userForm.username.trim();
    if (!username) {
      setUserFormError('Username is required.');
      return;
    }
    if (!editingUser && !userForm.password) {
      setUserFormError('A password is required for new users.');
      return;
    }
    if (userForm.password && userForm.password.length < PASSWORD_MIN_LENGTH) {
      setUserFormError(`The password must be at least ${PASSWORD_MIN_LENGTH} characters.`);
      return;
    }

    setUserSubmitting(true);
    try {
      if (editingUser) {
        await api.updateUser(editingUser.user_id, {
          username,
          role: userForm.role,
          is_active: userForm.is_active,
          ...(userForm.password ? { password: userForm.password } : {}),
        });
        setSuccess(`Saved ${username}.${userForm.password ? ' They will choose a new password at their next sign-in.' : ''}`);
      } else {
        await api.createUser({ username, password: userForm.password, role: userForm.role });
        setSuccess(`Created ${username}. They will choose their own password at first sign-in.`);
      }
      setShowUserModal(false);
      await loadUsers();
    } catch (err) {
      setUserFormError(errorMessage(err, 'Failed to save user'));
    } finally {
      setUserSubmitting(false);
    }
  };

  const handleUserDelete = async (target: User) => {
    if (!window.confirm(`Delete the account "${target.username}"? They will be signed out and can no longer sign in. This cannot be undone.`)) return;
    try {
      await api.deleteUser(target.user_id);
      setSuccess(`Deleted ${target.username}.`);
      await loadUsers();
    } catch (err) {
      setError(errorMessage(err, 'Failed to delete user'));
    }
  };

  return (
    <div>
      <Banner kind="error" onDismiss={() => setError('')}>{error}</Banner>
      <Banner kind="success" onDismiss={() => setSuccess('')}>{success}</Banner>

      <PageHeader
        title="Settings"
        subtitle="Calibration, backups and user accounts"
        actions={
          <button type="button" className="btn btn-secondary" onClick={() => void handleBackup()} disabled={backingUp}>
            {backingUp ? <><Spinner /> Backing up...</> : <><DownloadIcon /> Back up database</>}
          </button>
        }
      />

      {loadingSettings ? (
        <div className="page-loading"><Spinner size={24} /> Loading settings...</div>
      ) : (
        <form onSubmit={handleSaveSettings} noValidate>
          {Object.keys(storedWarnings).length > 0 && (
            <Banner kind="warning">
              Some saved settings are outside their allowed range and are marked below. Correct them and save.
            </Banner>
          )}

          <div className="settings-grid">
            {SETTING_GROUPS.map(group => (
              <div key={group.title} className="settings-card">
                <div className="settings-card-header">
                  <h3>{group.title}</h3>
                  <p>{group.description}</p>
                </div>
                <div className="settings-fields">
                  {group.fields.map(field => {
                    const message = fieldErrors[field.key] ?? storedWarnings[field.key] ?? (
                      (field.key === 'bpm_min' || field.key === 'bpm_max') ? crossError : ''
                    );
                    const changed = field.key in changes;
                    const helpId = `${field.key}-help`;
                    const errorId = `${field.key}-error`;
                    return (
                      <div key={field.key} className="form-group">
                        <label htmlFor={field.key} className="form-label">
                          {field.label}{changed && <span className="setting-changed"> · changed</span>}
                        </label>
                        <input
                          type="number"
                          id={field.key}
                          className={`form-input${message ? ' input-error' : ''}`}
                          value={inputs[field.key] ?? ''}
                          onChange={event => setInputs(previous => ({ ...previous, [field.key]: event.target.value }))}
                          min={field.min}
                          max={field.max}
                          step={field.step}
                          inputMode={field.integer ? 'numeric' : 'decimal'}
                          aria-invalid={Boolean(message)}
                          aria-describedby={message ? `${errorId} ${helpId}` : helpId}
                          disabled={saving}
                        />
                        {message && (
                          <span className="form-error" id={errorId}>
                            {message}{' '}
                            {storedWarnings[field.key] && (
                              <button type="button" className="link-button" onClick={() => applyDefault(field)}>Use default</button>
                            )}
                          </span>
                        )}
                        <p className="form-help" id={helpId}>
                          {field.help} Range {field.min}–{field.max}, default {field.defaultValue}.
                        </p>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="settings-savebar">
            <span className="text-muted" aria-live="polite">
              {changedCount === 0 ? 'No unsaved changes.' : `${changedCount} unsaved change${changedCount === 1 ? '' : 's'}.`}
            </span>
            <div className="header-actions">
              <button type="button" className="btn btn-secondary" onClick={discardChanges} disabled={saving || changedCount === 0}>
                Discard changes
              </button>
              <button type="submit" className="btn btn-primary" disabled={saving || changedCount === 0 || hasErrors}>
                {saving ? <><Spinner /> Saving...</> : 'Save settings'}
              </button>
            </div>
          </div>
        </form>
      )}

      <div className="card mt-4">
        <div className="card-header">
          <h2 className="card-title">User accounts</h2>
          <button type="button" className="btn btn-primary" onClick={openAddUser}><PlusIcon /> Add user</button>
        </div>
        <div className="card-body" style={{ padding: 0 }}>
          {loadingUsers ? (
            <div className="page-loading"><Spinner size={24} /> Loading users...</div>
          ) : users.length === 0 ? (
            <EmptyState icon={<UsersIcon />} title="No users found" />
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Username</th><th>Role</th><th>Status</th><th>Created</th>
                    <th style={{ width: 120 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {users.map(u => {
                    const isSelf = u.user_id === user?.user_id;
                    return (
                      <tr key={u.user_id}>
                        <td>
                          <strong>{u.username}</strong>
                          {isSelf && <span className="text-muted"> (you)</span>}
                        </td>
                        <td><span className={`badge ${u.role === 'admin' ? 'badge-info' : 'badge-success'}`}>{u.role}</span></td>
                        <td>
                          <span className={`badge ${u.is_active ? 'badge-success' : 'badge-neutral'}`}>{u.is_active ? 'Active' : 'Inactive'}</span>
                          {u.must_change_password && u.is_active && <span className="badge badge-warning" style={{ marginLeft: 6 }}>Password change due</span>}
                        </td>
                        <td>{formatDate(u.created_at)}</td>
                        <td>
                          {isSelf ? (
                            <span className="form-help">Use the account menu (top right) to change your password.</span>
                          ) : (
                            <div className="action-buttons">
                              <button type="button" className="btn btn-icon btn-secondary" onClick={() => openEditUser(u)} title="Edit" aria-label={`Edit ${u.username}`}>
                                <EditIcon />
                              </button>
                              <button type="button" className="btn btn-icon btn-danger" onClick={() => void handleUserDelete(u)} title="Delete" aria-label={`Delete ${u.username}`}>
                                <TrashIcon />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showUserModal && (
        <Modal title={editingUser ? `Edit ${editingUser.username}` : 'Add user'} onClose={() => setShowUserModal(false)} size="sm" closeOnBackdrop={false}>
          <form onSubmit={handleUserSubmit} noValidate>
            <Banner kind="error">{userFormError}</Banner>
            <div className="form-group">
              <label htmlFor="user-username" className="form-label">Username *</label>
              <input
                id="user-username"
                name="username"
                className="form-input"
                value={userForm.username}
                onChange={handleUserFormChange}
                autoComplete="off"
                maxLength={50}
                autoFocus
              />
            </div>
            <div className="form-group">
              <label htmlFor="user-password" className="form-label">
                {editingUser ? 'New temporary password (leave blank to keep the current one)' : 'Temporary password *'}
              </label>
              <input
                type="password"
                id="user-password"
                name="password"
                className="form-input"
                value={userForm.password}
                onChange={handleUserFormChange}
                autoComplete="new-password"
                minLength={PASSWORD_MIN_LENGTH}
                aria-describedby="user-password-help"
              />
              <p className="form-help" id="user-password-help">
                At least {PASSWORD_MIN_LENGTH} characters. The user must replace it with their own password at their next sign-in.
              </p>
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="user-role" className="form-label">Role</label>
                <select id="user-role" name="role" className="form-select" value={userForm.role} onChange={handleUserFormChange}>
                  <option value="trainer">Trainer</option>
                  <option value="admin">Admin</option>
                </select>
              </div>
              {editingUser && (
                <div className="form-group">
                  <label className="form-checkbox" style={{ marginTop: 28 }}>
                    <input type="checkbox" name="is_active" checked={userForm.is_active} onChange={handleUserFormChange} />
                    <span>Active (can sign in)</span>
                  </label>
                </div>
              )}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setShowUserModal(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={userSubmitting}>
                {userSubmitting ? <><Spinner /> Saving...</> : editingUser ? 'Save' : 'Create user'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export default SettingsPage;
