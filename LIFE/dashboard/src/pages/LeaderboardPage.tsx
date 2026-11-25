/**
 * L.I.F.E. Leaderboard
 * Top performers by average accuracy, with date/organization filters and a hide-names mode
 * for projecting on a shared screen. Refreshes when new sessions are uploaded.
 */

import { useCallback, useEffect, useState } from 'react';
import { api, type LeaderboardEntry, type OrganizationStats } from '../api/client';
import { useOnSessionsSynced } from '../hooks/useOutbox';
import { usePreference } from '../hooks/usePreference';
import { Banner, EmptyState, PageHeader, Spinner } from '../components/ui';
import { ChartIcon } from '../components/icons';
import { accuracyClass, errorMessage, formatDate, localDayEndIso, localDayStartIso } from '../utils/format';
import './LeaderboardPage.css';

const AUTO_REFRESH_MS = 30_000;

interface Filters {
  start_date: string;
  end_date: string;
  organization: string;
  limit: number;
}

export function LeaderboardPage() {
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [top3, setTop3] = useState<LeaderboardEntry[]>([]);
  const [organizations, setOrganizations] = useState<OrganizationStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<Filters>({ start_date: '', end_date: '', organization: '', limit: 50 });
  const [hideNames, setHideNames] = usePreference('life_leaderboard_hide_names', false);
  const [autoRefresh, setAutoRefresh] = usePreference('life_leaderboard_auto_refresh', false);
  const [passMark, setPassMark] = useState(80);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const dateRangeInvalid = Boolean(filters.start_date && filters.end_date && filters.start_date > filters.end_date);

  // `quiet` refreshes keep the current table on screen instead of flashing a spinner.
  const loadLeaderboard = useCallback(async (quiet = false) => {
    if (dateRangeInvalid) return;
    if (!quiet) setLoading(true);
    try {
      const res = await api.getLeaderboard({
        limit: filters.limit,
        start_date: localDayStartIso(filters.start_date),
        end_date: localDayEndIso(filters.end_date),
        organization: filters.organization || undefined,
        hide_names: hideNames,
      });
      setLeaderboard(res.leaderboard);
      setTop3(res.top3);
      setUpdatedAt(new Date());
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Failed to load leaderboard'));
    } finally {
      setLoading(false);
    }
  }, [filters, hideNames, dateRangeInvalid]);

  useEffect(() => { void loadLeaderboard(); }, [loadLeaderboard]);

  // The interval is rebuilt whenever the filters change, so refreshes always use the current filters.
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = window.setInterval(() => void loadLeaderboard(true), AUTO_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [autoRefresh, loadLeaderboard]);

  useOnSessionsSynced(() => void loadLeaderboard(true));

  useEffect(() => {
    api.getLeaderboardOrganizations().then(res => setOrganizations(res.organizations)).catch(() => undefined);
    api.getSettings().then(res => setPassMark(res.settings.pass_mark_pct)).catch(() => undefined);
  }, []);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters(previous => ({ ...previous, [key]: value }));
  };

  const filtered = Boolean(filters.start_date || filters.end_date || filters.organization);

  return (
    <div>
      <Banner kind="error" onDismiss={() => setError('')}>{error}</Banner>

      <PageHeader
        title="Leaderboard"
        subtitle="Top performers by average accuracy in trainer-supervised sessions (self-practice is not ranked)"
        actions={
          <>
            <label className="form-checkbox">
              <input type="checkbox" checked={hideNames} onChange={event => setHideNames(event.target.checked)} />
              <span>Hide names</span>
            </label>
            <label className="form-checkbox">
              <input type="checkbox" checked={autoRefresh} onChange={event => setAutoRefresh(event.target.checked)} />
              <span>Auto refresh (30 s)</span>
            </label>
          </>
        }
      />

      <div className="filters-bar">
        <div className="filter-group">
          <label className="form-label" htmlFor="lb-start">From</label>
          <input type="date" id="lb-start" className="form-input" value={filters.start_date} max={filters.end_date || undefined} onChange={event => setFilter('start_date', event.target.value)} />
        </div>
        <div className="filter-group">
          <label className="form-label" htmlFor="lb-end">To</label>
          <input type="date" id="lb-end" className="form-input" value={filters.end_date} min={filters.start_date || undefined} onChange={event => setFilter('end_date', event.target.value)} />
        </div>
        <div className="filter-group">
          <label className="form-label" htmlFor="lb-org">Organization</label>
          <select id="lb-org" className="form-select" value={filters.organization} onChange={event => setFilter('organization', event.target.value)}>
            <option value="">All organizations</option>
            {organizations.map(org => (
              <option key={org.organization} value={org.organization}>
                {org.organization} ({org.session_count} sessions)
              </option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label className="form-label" htmlFor="lb-limit">Show</label>
          <select id="lb-limit" className="form-select" value={filters.limit} onChange={event => setFilter('limit', Number(event.target.value))}>
            <option value={10}>Top 10</option>
            <option value={25}>Top 25</option>
            <option value={50}>Top 50</option>
            <option value={100}>Top 100</option>
          </select>
        </div>
      </div>

      {dateRangeInvalid && <Banner kind="warning">The "From" date is after the "To" date.</Banner>}

      {top3.length > 0 && (
        <div className="top3-highlights">
          {top3.map((entry, index) => (
            <div key={entry.trainee_id} className={`top3-card rank-${index + 1}`}>
              <div className="top3-rank">#{entry.rank}</div>
              <div className="top3-name">{entry.full_name}</div>
              <div className="top3-org">{entry.organization || '—'}</div>
              <div className="top3-stats">
                <div className="top3-stat">
                  <span className="top3-stat-label">Avg accuracy</span>
                  <span className={`top3-stat-value ${accuracyClass(entry.avg_accuracy, passMark)}`}>{entry.avg_accuracy.toFixed(1)}%</span>
                </div>
                <div className="top3-stat">
                  <span className="top3-stat-label">Best</span>
                  <span className="top3-stat-value">{entry.best_accuracy.toFixed(1)}%</span>
                </div>
                <div className="top3-stat">
                  <span className="top3-stat-label">Sessions</span>
                  <span className="top3-stat-value">{entry.total_sessions}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <div className="card-body" style={{ padding: 0 }}>
          {loading ? (
            <div className="page-loading"><Spinner size={24} /> Loading leaderboard...</div>
          ) : leaderboard.length === 0 ? (
            <EmptyState icon={<ChartIcon />} title="No leaderboard data">
              <p>{filtered ? 'No sessions match these filters.' : 'Complete sessions to see rankings.'}</p>
            </EmptyState>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 60 }}>Rank</th>
                    <th>Trainee</th>
                    <th>Organization</th>
                    <th>Sessions</th>
                    <th>Avg accuracy</th>
                    <th>Best accuracy</th>
                    <th>Avg BPM</th>
                    <th>Last session</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map(entry => (
                    <tr key={entry.trainee_id}>
                      <td><span className={`rank-badge ${entry.rank <= 3 ? `rank-${entry.rank}` : ''}`}>#{entry.rank}</span></td>
                      <td><strong>{entry.full_name}</strong></td>
                      <td>{entry.organization || <span className="text-muted">—</span>}</td>
                      <td>{entry.total_sessions}</td>
                      <td><span className={`accuracy-value ${accuracyClass(entry.avg_accuracy, passMark)}`}>{entry.avg_accuracy.toFixed(1)}%</span></td>
                      <td><span className={`accuracy-value ${accuracyClass(entry.best_accuracy, passMark)}`}>{entry.best_accuracy.toFixed(1)}%</span></td>
                      <td>{entry.avg_bpm.toFixed(1)}</td>
                      <td>{formatDate(entry.last_session)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {updatedAt && (
        <p className="form-help mt-3" aria-live="polite">
          Updated {updatedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </p>
      )}
    </div>
  );
}

export default LeaderboardPage;
