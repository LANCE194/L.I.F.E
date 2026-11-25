/**
 * L.I.F.E. Trainees
 * Add / edit / search / filter trainees, record consent, view progress.
 * Deactivating and reactivating is admin-only (enforced by the server too).
 */

import { useCallback, useEffect, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { api, type Trainee, type TraineeCredentials } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { Banner, EmptyState, Modal, PageHeader, Spinner } from '../components/ui';
import { ChartIcon, EditIcon, KeyIcon, PlusIcon, RefreshIcon, TrashIcon, UsersIcon } from '../components/icons';
import { CredentialsModal } from '../components/CredentialsModal';
import { TraineeProfile } from '../components/TraineeProfile';
import { errorMessage, formatDate } from '../utils/format';
import './TraineesPage.css';

interface TraineeForm {
  full_name: string;
  organization: string;
  notes: string;
  consent_given: boolean;
  create_account: boolean;
  username: string;
}

const EMPTY_FORM: TraineeForm = { full_name: '', organization: '', notes: '', consent_given: false, create_account: true, username: '' };

export function TraineesPage() {
  const { isAdmin } = useAuth();
  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [organizationFilter, setOrganizationFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'active' | 'inactive' | 'all'>('active');
  const [organizations, setOrganizations] = useState<string[]>([]);
  const [editing, setEditing] = useState<Trainee | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState<TraineeForm>(EMPTY_FORM);
  const [formError, setFormError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [profileId, setProfileId] = useState<number | null>(null);
  const [passMark, setPassMark] = useState(80);
  const [credentials, setCredentials] = useState<{ name: string; value: TraineeCredentials; reset: boolean } | null>(null);
  const [accountBusy, setAccountBusy] = useState<number | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const loadTrainees = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.getTrainees({
        search: debouncedSearch || undefined,
        organization: organizationFilter || undefined,
        is_active: statusFilter === 'all' ? undefined : statusFilter === 'active',
      });
      setTrainees(res.trainees);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load trainees'));
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, organizationFilter, statusFilter]);

  const loadOrganizations = useCallback(async () => {
    try {
      setOrganizations((await api.getOrganizations()).organizations);
    } catch {
      // filter list is optional
    }
  }, []);

  useEffect(() => { void loadTrainees(); }, [loadTrainees]);
  useEffect(() => {
    void loadOrganizations();
    api.getSettings().then(res => setPassMark(res.settings.pass_mark_pct)).catch(() => undefined);
  }, [loadOrganizations]);

  const openAdd = () => {
    setEditing(null);
    setFormData(EMPTY_FORM);
    setFormError('');
    setShowForm(true);
  };

  const openEdit = (trainee: Trainee) => {
    setEditing(trainee);
    setFormData({
      full_name: trainee.full_name,
      organization: trainee.organization || '',
      notes: trainee.notes || '',
      consent_given: trainee.consent_given,
      create_account: false,
      username: '',
    });
    setFormError('');
    setShowForm(true);
  };

  const handleChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value, type } = event.target;
    setFormData(previous => ({
      ...previous,
      [name]: type === 'checkbox' ? (event.target as HTMLInputElement).checked : value,
    }));
    setFormError('');
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!formData.full_name.trim()) {
      setFormError('Full name is required');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        full_name: formData.full_name.trim(),
        organization: formData.organization.trim() || undefined,
        notes: formData.notes.trim() || undefined,
        consent_given: formData.consent_given,
      };
      if (editing) {
        await api.updateTrainee(editing.trainee_id, {
          ...payload,
          organization: payload.organization ?? null,
          notes: payload.notes ?? null,
        });
        setNotice(`Saved ${payload.full_name}.`);
      } else {
        const wantsAccount = isAdmin && formData.create_account;
        const res = await api.createTrainee({
          ...payload,
          ...(wantsAccount ? { create_account: true, username: formData.username.trim() || undefined } : {}),
        });
        setNotice(`Added ${payload.full_name}.`);
        if (res.account) setCredentials({ name: payload.full_name, value: res.account, reset: false });
      }
      setShowForm(false);
      await Promise.all([loadTrainees(), loadOrganizations()]);
    } catch (err) {
      setFormError(errorMessage(err, 'Failed to save trainee'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeactivate = async (trainee: Trainee) => {
    if (!window.confirm(`Deactivate "${trainee.full_name}"? Their sessions are kept, but they will no longer appear in the active list or leaderboard.`)) return;
    try {
      await api.deleteTrainee(trainee.trainee_id);
      setNotice(`${trainee.full_name} was deactivated.`);
      await loadTrainees();
    } catch (err) {
      setError(errorMessage(err, 'Failed to deactivate trainee'));
    }
  };

  const handleCreateAccount = async (trainee: Trainee) => {
    setAccountBusy(trainee.trainee_id);
    try {
      const res = await api.createTraineeAccount(trainee.trainee_id);
      setCredentials({ name: trainee.full_name, value: res.account, reset: false });
      await loadTrainees();
    } catch (err) {
      setError(errorMessage(err, 'Failed to create the sign-in account'));
    } finally {
      setAccountBusy(null);
    }
  };

  const handleResetPassword = async (trainee: Trainee) => {
    if (!window.confirm(`Give ${trainee.full_name} a new temporary password? Their current password will stop working and they will be signed out.`)) return;
    setAccountBusy(trainee.trainee_id);
    try {
      const res = await api.resetTraineePassword(trainee.trainee_id);
      setCredentials({ name: trainee.full_name, value: res.account, reset: true });
      await loadTrainees();
    } catch (err) {
      setError(errorMessage(err, 'Failed to reset the password'));
    } finally {
      setAccountBusy(null);
    }
  };

  const handleReactivate = async (trainee: Trainee) => {
    try {
      await api.updateTrainee(trainee.trainee_id, { is_active: true });
      setNotice(`${trainee.full_name} was reactivated.`);
      await loadTrainees();
    } catch (err) {
      setError(errorMessage(err, 'Failed to reactivate trainee'));
    }
  };

  const filtered = Boolean(debouncedSearch || organizationFilter || statusFilter !== 'active');

  return (
    <div>
      <Banner kind="error" onDismiss={() => setError('')}>{error}</Banner>
      <Banner kind="success" onDismiss={() => setNotice('')}>{notice}</Banner>

      <PageHeader
        title="Trainees"
        subtitle="Manage trainee profiles and consent"
        actions={<button type="button" className="btn btn-primary" onClick={openAdd}><PlusIcon /> Add Trainee</button>}
      />

      <div className="filters-bar">
        <div className="filter-group" style={{ flex: 1, minWidth: 220 }}>
          <label className="form-label" htmlFor="trainee-search">Search</label>
          <input
            id="trainee-search"
            type="search"
            className="form-input"
            placeholder="Name or organization"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
        </div>
        <div className="filter-group">
          <label className="form-label" htmlFor="org-filter">Organization</label>
          <select id="org-filter" className="form-select" value={organizationFilter} onChange={event => setOrganizationFilter(event.target.value)}>
            <option value="">All organizations</option>
            {organizations.map(org => <option key={org} value={org}>{org}</option>)}
          </select>
        </div>
        <div className="filter-group">
          <label className="form-label" htmlFor="status-filter">Status</label>
          <select id="status-filter" className="form-select" value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="all">All</option>
          </select>
        </div>
      </div>

      <div className="card">
        <div className="card-body" style={{ padding: 0 }}>
          {loading ? (
            <div className="page-loading"><Spinner size={24} /> Loading trainees...</div>
          ) : trainees.length === 0 ? (
            <EmptyState icon={<UsersIcon />} title="No trainees found">
              <p>{filtered ? 'Try adjusting your search or filters.' : 'Add your first trainee to get started.'}</p>
            </EmptyState>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th><th>Organization</th><th>Consent</th><th>Status</th><th>Sign-in</th><th>Registered</th>
                    <th style={{ width: isAdmin ? 190 : 110 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {trainees.map(trainee => (
                    <tr key={trainee.trainee_id}>
                      <td><strong>{trainee.full_name}</strong></td>
                      <td>{trainee.organization || <span className="text-muted">—</span>}</td>
                      <td>
                        <span className={`badge ${trainee.consent_given ? 'badge-success' : 'badge-warning'}`}>
                          {trainee.consent_given ? 'Given' : 'Pending'}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${trainee.is_active ? 'badge-success' : 'badge-neutral'}`}>
                          {trainee.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td>
                        {trainee.account ? (
                          <span className="account-cell">
                            <code>{trainee.account.username}</code>
                            {!trainee.account.is_active
                              ? <span className="badge badge-neutral">Disabled</span>
                              : trainee.account.must_change_password
                                ? <span className="badge badge-warning" title="Has not signed in and chosen a password yet">Not yet signed in</span>
                                : null}
                          </span>
                        ) : (
                          <span className="text-muted">No login</span>
                        )}
                      </td>
                      <td>{formatDate(trainee.date_registered)}</td>
                      <td>
                        <div className="action-buttons">
                          <button type="button" className="btn btn-icon btn-secondary" onClick={() => setProfileId(trainee.trainee_id)} title="View progress" aria-label={`View progress for ${trainee.full_name}`}>
                            <ChartIcon />
                          </button>
                          <button type="button" className="btn btn-icon btn-secondary" onClick={() => openEdit(trainee)} title="Edit" aria-label={`Edit ${trainee.full_name}`}>
                            <EditIcon />
                          </button>
                          {isAdmin && trainee.is_active && (trainee.account ? (
                            <button type="button" className="btn btn-icon btn-secondary" onClick={() => void handleResetPassword(trainee)} disabled={accountBusy !== null} title="Reset password" aria-label={`Reset the password for ${trainee.full_name}`}>
                              <RefreshIcon />
                            </button>
                          ) : (
                            <button type="button" className="btn btn-icon btn-secondary" onClick={() => void handleCreateAccount(trainee)} disabled={accountBusy !== null} title="Create sign-in account" aria-label={`Create a sign-in account for ${trainee.full_name}`}>
                              <KeyIcon />
                            </button>
                          ))}
                          {isAdmin && (trainee.is_active ? (
                            <button type="button" className="btn btn-icon btn-danger" onClick={() => void handleDeactivate(trainee)} title="Deactivate" aria-label={`Deactivate ${trainee.full_name}`}>
                              <TrashIcon />
                            </button>
                          ) : (
                            <button type="button" className="btn btn-icon btn-secondary" onClick={() => void handleReactivate(trainee)} title="Reactivate" aria-label={`Reactivate ${trainee.full_name}`}>
                              <RefreshIcon />
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {showForm && (
        <Modal
          title={editing ? 'Edit Trainee' : 'Add Trainee'}
          onClose={() => setShowForm(false)}
          closeOnBackdrop={false}
        >
          <form onSubmit={handleSubmit} noValidate>
            <Banner kind="error">{formError}</Banner>
            <div className="form-group">
              <label htmlFor="full_name" className="form-label">Full name *</label>
              <input id="full_name" name="full_name" className="form-input" value={formData.full_name} onChange={handleChange} maxLength={120} autoFocus />
            </div>
            <div className="form-group">
              <label htmlFor="organization" className="form-label">Organization</label>
              <input
                id="organization"
                name="organization"
                className="form-input"
                list="organization-options"
                value={formData.organization}
                onChange={handleChange}
                placeholder="Type a new one or pick an existing one"
                maxLength={120}
              />
              <datalist id="organization-options">
                {organizations.map(org => <option key={org} value={org} />)}
              </datalist>
            </div>
            <div className="form-group">
              <label htmlFor="notes" className="form-label">Notes</label>
              <textarea id="notes" name="notes" className="form-input" value={formData.notes} onChange={handleChange} rows={3} maxLength={1000} />
            </div>
            <div className="form-group">
              <label className="form-checkbox">
                <input type="checkbox" name="consent_given" checked={formData.consent_given} onChange={handleChange} />
                <span>Informed consent (and guardian consent for minors) has been obtained for recording practice metrics</span>
              </label>
              <p className="form-help">Sessions cannot be saved for a trainee until consent is recorded. Camera video is never stored.</p>
            </div>
            {isAdmin && !editing && (
              <div className="form-group account-option">
                <label className="form-checkbox">
                  <input type="checkbox" name="create_account" checked={formData.create_account} onChange={handleChange} />
                  <span>Create a sign-in account so the trainee can view their own progress</span>
                </label>
                {formData.create_account && (
                  <>
                    <label htmlFor="username" className="form-label" style={{ marginTop: 8 }}>Username (optional)</label>
                    <input
                      id="username"
                      name="username"
                      className="form-input"
                      value={formData.username}
                      onChange={handleChange}
                      placeholder="Leave blank to generate one from the name"
                      maxLength={32}
                      autoComplete="off"
                    />
                    <p className="form-help">A temporary password is generated and shown once after saving. The trainee chooses their own password at first sign-in.</p>
                  </>
                )}
              </div>
            )}
            <div className="modal-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setShowForm(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={submitting}>
                {submitting ? <><Spinner /> Saving...</> : editing ? 'Save' : 'Add trainee'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {credentials && (
        <CredentialsModal
          traineeName={credentials.name}
          credentials={credentials.value}
          reset={credentials.reset}
          onClose={() => setCredentials(null)}
        />
      )}

      {profileId !== null && <TraineeProfile traineeId={profileId} passMark={passMark} onClose={() => setProfileId(null)} />}
    </div>
  );
}

export default TraineesPage;
