/**
 * L.I.F.E. Leaderboard
 * Rankings by average accuracy. Every recorded session counts by default, including the
 * self-practice sessions trainees record on the Practice page; the scope switch narrows it to
 * trainer-supervised or self-practice sessions. Staff and trainees both see this page: trainees
 * see their own row marked and other trainees as "First L." only. Refreshes when new sessions
 * are uploaded.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, downloadBlob, type LeaderboardEntry, type LeaderboardResponse, type OrganizationStats, type SessionScope } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useOnSessionsSynced } from '../hooks/useOutbox';
import { useChoicePreference, usePreference } from '../hooks/usePreference';
import { AccuracyBar, Banner, DownloadMenu, EmptyState, PageHeader, Person, SCOPE_DESCRIPTION, ScopeSwitch, Spinner } from '../components/ui';
import { CameraIcon, MedalIcon, TrophyIcon } from '../components/icons';
import { accuracyClass, errorMessage, formatDate, localDayEndIso, localDayStartIso, todayLocal } from '../utils/format';
import './LeaderboardPage.css';

const AUTO_REFRESH_MS = 30_000;
const SCOPES = ['all', 'supervised', 'self'] as const;

interface Filters {
  start_date: string;
  end_date: string;
  organization: string;
  limit: number;
}

function leaderboardCsv(rows: LeaderboardEntry[]): Blob {
  const header = ['Rank', 'Trainee', 'Organization', 'Sessions', 'Self-practice sessions', 'Avg accuracy %', 'Best accuracy %', 'Pass rate %', 'Avg BPM', 'Compressions', 'Last session'];
  const cell = (value: string | number) => {
    const text = String(value ?? '');
    // Neutralize spreadsheet formulas and quote every cell.
    const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = rows.map(row => [
    row.rank, row.full_name, row.organization ?? '', row.total_sessions, row.self_practice_sessions, row.avg_accuracy,
    row.best_accuracy, row.pass_rate, row.avg_bpm, row.total_compressions, row.last_session ? row.last_session.slice(0, 10) : '',
  ].map(cell).join(','));
  return new Blob([`﻿${[header.map(cell).join(','), ...lines].join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
}

export function LeaderboardPage() {
  const { isTrainee } = useAuth();
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [organizations, setOrganizations] = useState<OrganizationStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState<Filters>({ start_date: '', end_date: '', organization: '', limit: 50 });
  const [scope, setScope] = useChoicePreference<SessionScope>('life_leaderboard_scope', 'all', SCOPES);
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
      setData(await api.getLeaderboard({
        scope,
        limit: filters.limit,
        start_date: localDayStartIso(filters.start_date),
        end_date: localDayEndIso(filters.end_date),
        organization: filters.organization || undefined,
        hide_names: !isTrainee && hideNames,
      }));
      setUpdatedAt(new Date());
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Failed to load leaderboard'));
    } finally {
      setLoading(false);
    }
  }, [filters, hideNames, dateRangeInvalid, scope, isTrainee]);

  useEffect(() => { void loadLeaderboard(); }, [loadLeaderboard]);

  // The interval is rebuilt whenever the filters change, so refreshes always use the current filters.
  useEffect(() => {
    if (!autoRefresh) return;
    const interval = window.setInterval(() => void loadLeaderboard(true), AUTO_REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [autoRefresh, loadLeaderboard]);

  useOnSessionsSynced(() => void loadLeaderboard(true));

  useEffect(() => {
    api.getLeaderboardOrganizations(scope).then(res => setOrganizations(res.organizations)).catch(() => undefined);
  }, [scope]);

  useEffect(() => {
    api.getSettings().then(res => setPassMark(res.settings.pass_mark_pct)).catch(() => undefined);
  }, []);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters(previous => ({ ...previous, [key]: value }));
  };

  const filtered = Boolean(filters.start_date || filters.end_date || filters.organization);
  const leaderboard = data?.leaderboard ?? [];
  const top3 = data?.top3 ?? [];
  const me = data?.me ?? null;
  const meListed = Boolean(me && leaderboard.some(entry => entry.is_me));

  return (
    <div>
      <Banner kind="error" onDismiss={() => setError('')}>{error}</Banner>

      <PageHeader
        eyebrow="Rankings"
        title="Leaderboard"
        subtitle={`Ranked by average accuracy across ${SCOPE_DESCRIPTION[scope]}. Self-practice from the Practice page counts as soon as it is saved.`}
        actions={
          <>
            <ScopeSwitch value={scope} onChange={setScope} />
            <DownloadMenu
              label="Export"
              onError={setError}
              options={[{
                key: 'csv',
                title: 'Leaderboard (CSV)',
                description: 'The rows shown, for Excel or Google Sheets',
                run: async () => downloadBlob(leaderboardCsv(leaderboard), `life_leaderboard_${scope}_${todayLocal()}.csv`),
              }]}
            />
          </>
        }
      />

      {isTrainee && (
        <div className={`my-rank-card ${me ? '' : 'empty'}`}>
          <div className="my-rank-badge"><MedalIcon size={26} /></div>
          {me ? (
            <div className="my-rank-text">
              <div className="my-rank-title">You are <strong>#{me.rank}</strong> of {data?.total_ranked ?? 0}</div>
              <div className="my-rank-sub">
                Average accuracy {me.avg_accuracy.toFixed(1)}% · best {me.best_accuracy.toFixed(1)}% · {me.total_sessions} session{me.total_sessions === 1 ? '' : 's'}
                {me.rank > 1 && top3[0] ? ` · ${(top3[0].avg_accuracy - me.avg_accuracy).toFixed(1)} points behind #1` : ''}
              </div>
            </div>
          ) : (
            <div className="my-rank-text">
              <div className="my-rank-title">You are not ranked yet</div>
              <div className="my-rank-sub">Complete a practice session and it appears here right after it is saved.</div>
            </div>
          )}
          <Link to="/live" className="btn btn-gold"><CameraIcon /> Practice now</Link>
        </div>
      )}

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
        <div className="filter-toggles">
          {!isTrainee && (
            <label className="form-checkbox">
              <input type="checkbox" checked={hideNames} onChange={event => setHideNames(event.target.checked)} />
              <span>Hide names (projector)</span>
            </label>
          )}
          <label className="form-checkbox">
            <input type="checkbox" checked={autoRefresh} onChange={event => setAutoRefresh(event.target.checked)} />
            <span>Auto refresh (30 s)</span>
          </label>
        </div>
      </div>

      {dateRangeInvalid && <Banner kind="warning">The "From" date is after the "To" date.</Banner>}

      {!loading && top3.length > 0 && (
        <div className="podium" aria-label="Top three">
          {[1, 0, 2].map(position => {
            const entry = top3[position];
            if (!entry) return <div key={position} className="podium-spacer" />;
            const place = position + 1;
            return (
              <div key={entry.trainee_id} className={`podium-card place-${place} ${entry.is_me ? 'is-me' : ''}`}>
                <div className="podium-medal">{entry.rank}</div>
                <div className="podium-name">{entry.full_name}{entry.is_me && <span className="badge badge-gold self-badge">You</span>}</div>
                <div className="podium-org">{entry.organization || 'Independent'}</div>
                <div className={`podium-score ${accuracyClass(entry.avg_accuracy, passMark)}`}>{entry.avg_accuracy.toFixed(1)}%</div>
                <div className="podium-caption">average accuracy</div>
                <div className="podium-stats">
                  <span><strong>{entry.best_accuracy.toFixed(1)}%</strong> best</span>
                  <span><strong>{entry.total_sessions}</strong> session{entry.total_sessions === 1 ? '' : 's'}</span>
                  <span><strong>{entry.avg_bpm.toFixed(0)}</strong> BPM</span>
                </div>
                <div className="podium-step" aria-hidden="true">{place}</div>
              </div>
            );
          })}
        </div>
      )}

      <div className="card">
        <div className="card-header">
          <div>
            <h2 className="card-title"><TrophyIcon size={18} /> Rankings</h2>
            <div className="card-subtitle">{data ? `${data.total_ranked} trainee${data.total_ranked === 1 ? '' : 's'} ranked` : ' '}</div>
          </div>
          <span className="badge badge-info badge-dot">{scope === 'all' ? 'Supervised + self-practice' : scope === 'supervised' ? 'Supervised only' : 'Self-practice only'}</span>
        </div>
        <div className="card-body flush">
          {loading ? (
            <div className="page-loading"><Spinner size={24} /> Loading leaderboard...</div>
          ) : leaderboard.length === 0 ? (
            <EmptyState icon={<TrophyIcon />} title="No rankings yet">
              <p>{filtered ? 'No sessions match these filters.' : 'Complete a live session or a self-practice session to appear here.'}</p>
            </EmptyState>
          ) : (
            <div className="table-container">
              <table className="table leaderboard-table">
                <thead>
                  <tr>
                    <th style={{ width: 72 }}>Rank</th>
                    <th>Trainee</th>
                    <th>Sessions</th>
                    <th>Avg accuracy</th>
                    <th>Best</th>
                    <th>Pass rate</th>
                    <th>Avg BPM</th>
                    <th>Last session</th>
                  </tr>
                </thead>
                <tbody>
                  {leaderboard.map(entry => <LeaderboardRow key={entry.trainee_id} entry={entry} passMark={passMark} />)}
                  {me && !meListed && (
                    <>
                      <tr className="gap-row"><td colSpan={8}>···</td></tr>
                      <LeaderboardRow entry={me} passMark={passMark} />
                    </>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {updatedAt && (
        <p className="form-help mt-3" aria-live="polite">
          Updated {updatedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          {isTrainee ? ' · Other trainees are shown by first name and initial.' : ''}
        </p>
      )}
    </div>
  );
}

function LeaderboardRow({ entry, passMark }: { entry: LeaderboardEntry; passMark: number }) {
  const supervised = entry.total_sessions - entry.self_practice_sessions;
  return (
    <tr className={entry.is_me ? 'row-highlight' : undefined}>
      <td><span className={`rank-badge ${entry.rank <= 3 ? `rank-${entry.rank}` : ''}`}>{entry.rank}</span></td>
      <td>
        <Person
          name={entry.full_name}
          meta={entry.organization || 'Independent'}
          badge={entry.is_me ? <span className="badge badge-gold self-badge">You</span> : undefined}
        />
      </td>
      <td>
        <strong>{entry.total_sessions}</strong>
        <div className="person-meta" style={{ whiteSpace: 'nowrap' }}>
          {supervised > 0 && `${supervised} supervised`}
          {supervised > 0 && entry.self_practice_sessions > 0 && ' · '}
          {entry.self_practice_sessions > 0 && `${entry.self_practice_sessions} self`}
        </div>
      </td>
      <td><AccuracyBar value={entry.avg_accuracy} tone={accuracyClass(entry.avg_accuracy, passMark)} /></td>
      <td><span className={`accuracy-value ${accuracyClass(entry.best_accuracy, passMark)}`}>{entry.best_accuracy.toFixed(1)}%</span></td>
      <td>{entry.pass_rate}%</td>
      <td>{entry.avg_bpm.toFixed(1)}</td>
      <td className="text-muted">{formatDate(entry.last_session)}</td>
    </tr>
  );
}

export default LeaderboardPage;
