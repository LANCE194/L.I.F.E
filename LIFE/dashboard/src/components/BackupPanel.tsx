/**
 * Data & backup panel (Settings, admin only).
 * Download a fresh database backup (.db), every record as JSON, or any backup the server keeps
 * (manual, daily automatic and pre-upgrade copies); save a new copy on the server.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, downloadBlob, type ServerBackup } from '../api/client';
import { errorMessage, formatDateTime, todayLocal } from '../utils/format';
import { DatabaseIcon, DownloadIcon, FileIcon, RefreshIcon, ShieldIcon } from './icons';
import { Spinner } from './ui';

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const KIND_BADGE: Record<ServerBackup['kind'], string> = {
  manual: 'badge-info',
  automatic: 'badge-neutral',
  'safety copy': 'badge-gold',
};

export function BackupPanel({ onError, onSuccess }: { onError: (message: string) => void; onSuccess: (message: string) => void }) {
  const [backups, setBackups] = useState<ServerBackup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBackups((await api.getBackups()).backups);
    } catch (err) {
      onError(errorMessage(err, 'Could not list the backups'));
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => { void load(); }, [load]);

  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key);
    try {
      await task();
    } catch (err) {
      onError(errorMessage(err, 'The download failed'));
    } finally {
      setBusy(null);
    }
  };

  const stamp = todayLocal();

  return (
    <section className="card backup-panel">
      <div className="card-header">
        <div>
          <h2 className="card-title"><DatabaseIcon size={18} /> Data & backup</h2>
          <div className="card-subtitle">Keep a copy of every trainee, account and session, including trainee self-practice.</div>
        </div>
        <span className="badge badge-success badge-dot"><ShieldIcon size={12} /> Auto backup daily</span>
      </div>
      <div className="card-body">
        <div className="backup-actions">
          <div className="backup-action">
            <div className="backup-action-icon"><DatabaseIcon size={20} /></div>
            <div className="backup-action-text">
              <strong>Full backup (.db)</strong>
              <span>The complete database, made now. Restore it with <code>npm run restore -- file.db --yes</code> or open it in DB Browser for SQLite.</span>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy !== null}
              onClick={() => void run('db', async () => {
                downloadBlob(await api.downloadBackup(), `life_backup_${stamp}.db`);
                onSuccess('Backup downloaded. Keep it somewhere safe, such as a USB drive or cloud folder.');
              })}
            >
              {busy === 'db' ? <Spinner size={14} /> : <DownloadIcon />} Download backup
            </button>
          </div>

          <div className="backup-action">
            <div className="backup-action-icon gold"><FileIcon size={20} /></div>
            <div className="backup-action-text">
              <strong>All data (JSON)</strong>
              <span>Trainees, accounts (without passwords), settings and every session with its compression record, readable without L.I.F.E.</span>
            </div>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy !== null}
              onClick={() => void run('json', async () => downloadBlob(await api.exportAllData(), `life_full_data_${stamp}.json`))}
            >
              {busy === 'json' ? <Spinner size={14} /> : <DownloadIcon />} Download JSON
            </button>
          </div>
        </div>

        <div className="backup-list-head">
          <h3>Backups on this server</h3>
          <div className="header-actions">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              disabled={busy !== null}
              onClick={() => void run('save', async () => {
                const res = await api.backupDatabase();
                onSuccess(`Backup saved on the server: ${res.path}`);
                await load();
              })}
            >
              {busy === 'save' ? <Spinner size={14} /> : <DatabaseIcon size={14} />} Save a copy now
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setLoading(true); void load(); }} aria-label="Refresh the list">
              <RefreshIcon size={14} />
            </button>
          </div>
        </div>

        {loading ? (
          <div className="page-loading" style={{ padding: 24 }}><Spinner size={18} /> Loading backups...</div>
        ) : backups.length === 0 ? (
          <p className="text-muted">No backups yet. One is made automatically each day while L.I.F.E. runs.</p>
        ) : (
          <div className="table-container backup-table">
            <table className="table">
              <thead>
                <tr><th>File</th><th>Type</th><th>Saved</th><th>Size</th><th aria-label="Download" /></tr>
              </thead>
              <tbody>
                {backups.slice(0, 12).map(backup => (
                  <tr key={backup.name}>
                    <td><code>{backup.name}</code></td>
                    <td><span className={`badge ${KIND_BADGE[backup.kind]}`}>{backup.kind}</span></td>
                    <td className="text-muted">{formatDateTime(backup.modified_at)}</td>
                    <td>{formatBytes(backup.bytes)}</td>
                    <td className="text-right">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy !== null}
                        onClick={() => void run(backup.name, async () => downloadBlob(await api.downloadServerBackup(backup.name), backup.name))}
                      >
                        {busy === backup.name ? <Spinner size={14} /> : <DownloadIcon size={14} />} Download
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {backups.length > 12 && <p className="form-help mt-2">Showing the newest 12 of {backups.length} backups.</p>}
      </div>
    </section>
  );
}

export default BackupPanel;
