/**
 * L.I.F.E. Session History
 * Past sessions with filters and pagination, a detail view with charts and the procedure
 * checklist, and admin-only deletion. Refreshes when new sessions are uploaded.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type Session, type SessionDetailCreateRequest, type SessionWithDetails } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useOnSessionsSynced } from '../hooks/useOutbox';
import { Banner, EmptyState, Modal, PageHeader, ResultBadge, Spinner } from '../components/ui';
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, EyeIcon, TrashIcon } from '../components/icons';
import {
  accuracyClass,
  errorMessage,
  formatDateTime,
  formatDuration,
  formatNumber,
  localDayEndIso,
  localDayStartIso,
} from '../utils/format';
import { CHECKLIST } from '../cpr/protocol';
import './HistoryPage.css';

const PROCEDURE_STEP_LABELS = CHECKLIST.map(item => [item.key, item.done] as const);

interface Filters {
  trainee_id: string;
  start_date: string;
  end_date: string;
  limit: number;
  offset: number;
}

interface TraineeOption {
  trainee_id: number;
  full_name: string;
  is_active: boolean;
}

interface ChartPoint {
  t: number;
  bpm: number | null;
  elbow_angle: number | null;
}

export function HistoryPage() {
  const { isAdmin } = useAuth();
  const [sessions, setSessions] = useState<Session[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [filters, setFilters] = useState<Filters>({ trainee_id: '', start_date: '', end_date: '', limit: 50, offset: 0 });
  const [trainees, setTrainees] = useState<TraineeOption[]>([]);
  const [selected, setSelected] = useState<SessionWithDetails | null>(null);
  const [loadingDetailId, setLoadingDetailId] = useState<number | null>(null);
  const [settings, setSettings] = useState({ pass_mark_pct: 80, bpm_min: 100, bpm_max: 120, angle_threshold: 160 });

  const dateRangeInvalid = Boolean(filters.start_date && filters.end_date && filters.start_date > filters.end_date);

  const loadSessions = useCallback(async (quiet = false) => {
    if (dateRangeInvalid) return;
    if (!quiet) setLoading(true);
    try {
      const res = await api.getSessions({
        trainee_id: filters.trainee_id ? Number(filters.trainee_id) : undefined,
        start_date: localDayStartIso(filters.start_date),
        end_date: localDayEndIso(filters.end_date),
        limit: filters.limit,
        offset: filters.offset,
      });
      setSessions(res.sessions);
      setTotal(res.total ?? null);
    } catch (err) {
      setError(errorMessage(err, 'Failed to load sessions'));
    } finally {
      setLoading(false);
    }
  }, [filters, dateRangeInvalid]);

  useEffect(() => { void loadSessions(); }, [loadSessions]);
  useOnSessionsSynced(() => void loadSessions(true));

  useEffect(() => {
    // Include inactive trainees so their past sessions can still be found.
    api.getTrainees()
      .then(res => setTrainees(res.trainees.map(t => ({ trainee_id: t.trainee_id, full_name: t.full_name, is_active: t.is_active }))))
      .catch(() => undefined);
    api.getSettings()
      .then(res => setSettings({
        pass_mark_pct: res.settings.pass_mark_pct,
        bpm_min: res.settings.bpm_min,
        bpm_max: res.settings.bpm_max,
        angle_threshold: res.settings.angle_threshold,
      }))
      .catch(() => undefined);
  }, []);

  const setFilter = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    setFilters(previous => ({ ...previous, [key]: value, offset: 0 }));
  };

  const openDetails = async (session: Session) => {
    setLoadingDetailId(session.session_id);
    try {
      const res = await api.getSession(session.session_id);
      setSelected({ ...res.session, details: res.details });
    } catch (err) {
      setError(errorMessage(err, 'Failed to load session details'));
    } finally {
      setLoadingDetailId(null);
    }
  };

  const deleteSession = async (session: Session) => {
    const label = `${session.trainee_name ?? 'this trainee'} on ${formatDateTime(session.date_time)}`;
    if (!window.confirm(`Permanently delete the session for ${label}? Its compression data is deleted too. This cannot be undone.`)) return;
    try {
      await api.deleteSession(session.session_id);
      setSelected(current => (current?.session_id === session.session_id ? null : current));
      setNotice(`Deleted the session for ${label}.`);
      // Step back a page if this removed the last row on it.
      if (sessions.length === 1 && filters.offset > 0) {
        setFilters(previous => ({ ...previous, offset: Math.max(0, previous.offset - previous.limit) }));
      } else {
        await loadSessions(true);
      }
    } catch (err) {
      setError(errorMessage(err, 'Failed to delete session'));
    }
  };

  const filtered = Boolean(filters.trainee_id || filters.start_date || filters.end_date);
  const firstRow = filters.offset + 1;
  const lastRow = filters.offset + sessions.length;
  const hasNext = total !== null ? lastRow < total : sessions.length === filters.limit;

  return (
    <div>
      <Banner kind="error" onDismiss={() => setError('')}>{error}</Banner>
      <Banner kind="success" onDismiss={() => setNotice('')}>{notice}</Banner>

      <PageHeader title="Session History" subtitle="Review past CPR practice sessions" />

      <div className="filters-bar">
        <div className="filter-group">
          <label className="form-label" htmlFor="hist-trainee">Trainee</label>
          <select id="hist-trainee" className="form-select" value={filters.trainee_id} onChange={event => setFilter('trainee_id', event.target.value)}>
            <option value="">All trainees</option>
            {trainees.map(t => (
              <option key={t.trainee_id} value={t.trainee_id}>{t.full_name}{t.is_active ? '' : ' (inactive)'}</option>
            ))}
          </select>
        </div>
        <div className="filter-group">
          <label className="form-label" htmlFor="hist-start">From</label>
          <input type="date" id="hist-start" className="form-input" value={filters.start_date} max={filters.end_date || undefined} onChange={event => setFilter('start_date', event.target.value)} />
        </div>
        <div className="filter-group">
          <label className="form-label" htmlFor="hist-end">To</label>
          <input type="date" id="hist-end" className="form-input" value={filters.end_date} min={filters.start_date || undefined} onChange={event => setFilter('end_date', event.target.value)} />
        </div>
        <div className="filter-group">
          <label className="form-label" htmlFor="hist-limit">Per page</label>
          <select id="hist-limit" className="form-select" value={filters.limit} onChange={event => setFilter('limit', Number(event.target.value))}>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </select>
        </div>
      </div>

      {dateRangeInvalid && <Banner kind="warning">The "From" date is after the "To" date.</Banner>}

      <div className="card">
        <div className="card-body" style={{ padding: 0 }}>
          {loading ? (
            <div className="page-loading"><Spinner size={24} /> Loading sessions...</div>
          ) : sessions.length === 0 ? (
            <EmptyState icon={<CalendarIcon />} title="No sessions found">
              <p>{filtered ? 'No sessions match these filters.' : 'Start a live session to record CPR practice.'}</p>
            </EmptyState>
          ) : (
            <div className="table-container">
              <table className="table">
                <thead>
                  <tr>
                    <th>Date / time</th>
                    <th>Trainee</th>
                    <th>Organization</th>
                    <th>Duration</th>
                    <th>Compressions</th>
                    <th>Avg BPM</th>
                    <th>Elbow lock</th>
                    <th>Accuracy</th>
                    <th>Result</th>
                    <th style={{ width: isAdmin ? 100 : 60 }}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map(session => (
                    <tr key={session.session_id}>
                      <td>{formatDateTime(session.date_time)}</td>
                      <td>
                        {session.trainee_name}
                        {session.counts?.self_practice === 1 && <span className="badge badge-info self-badge" title="Recorded by the trainee on their own">Self-practice</span>}
                      </td>
                      <td>{session.organization || <span className="text-muted">—</span>}</td>
                      <td>{formatDuration(session.duration_sec)}</td>
                      <td>{session.total_compressions}</td>
                      <td>{formatNumber(session.avg_bpm)}</td>
                      <td>{formatNumber(session.elbow_lock_pct)}%</td>
                      <td>
                        <span className={`accuracy-value ${accuracyClass(session.accuracy_pct, settings.pass_mark_pct)}`}>
                          {formatNumber(session.accuracy_pct)}%
                        </span>
                      </td>
                      <td><ResultBadge result={session.result} /></td>
                      <td>
                        <div className="action-buttons">
                          <button
                            type="button"
                            className="btn btn-icon btn-secondary"
                            onClick={() => void openDetails(session)}
                            disabled={loadingDetailId !== null}
                            title="View details"
                            aria-label={`View details for ${session.trainee_name}, ${formatDateTime(session.date_time)}`}
                          >
                            {loadingDetailId === session.session_id ? <Spinner /> : <EyeIcon />}
                          </button>
                          {isAdmin && (
                            <button
                              type="button"
                              className="btn btn-icon btn-danger"
                              onClick={() => void deleteSession(session)}
                              title="Delete session"
                              aria-label={`Delete session for ${session.trainee_name}, ${formatDateTime(session.date_time)}`}
                            >
                              <TrashIcon />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {!loading && sessions.length > 0 && (
          <div className="pagination">
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setFilters(previous => ({ ...previous, offset: Math.max(0, previous.offset - previous.limit) }))}
              disabled={filters.offset === 0}
            >
              <ChevronLeftIcon /> Previous
            </button>
            <span className="pagination-info">
              {firstRow}–{lastRow}{total !== null ? ` of ${total}` : ''}
            </span>
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => setFilters(previous => ({ ...previous, offset: previous.offset + previous.limit }))}
              disabled={!hasNext}
            >
              Next <ChevronRightIcon />
            </button>
          </div>
        )}
      </div>

      {selected && (
        <SessionDetailModal
          session={selected}
          settings={settings}
          isAdmin={isAdmin}
          onDelete={() => void deleteSession(selected)}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function SessionDetailModal({
  session,
  settings,
  isAdmin,
  onDelete,
  onClose,
}: {
  session: SessionWithDetails;
  settings: { pass_mark_pct: number; bpm_min: number; bpm_max: number; angle_threshold: number };
  isAdmin: boolean;
  onDelete: () => void;
  onClose: () => void;
}) {
  // Detail timestamps are absolute (ms); plot them as seconds since the first compression.
  const points = useMemo<ChartPoint[]>(() => {
    const details: SessionDetailCreateRequest[] = session.details ?? [];
    if (details.length === 0) return [];
    const start = details[0].ts;
    return details.map(detail => ({
      t: Math.round((detail.ts - start) / 100) / 10,
      bpm: detail.bpm ?? null,
      elbow_angle: detail.elbow_angle ?? null,
    }));
  }, [session.details]);

  const bpmPoints = points.filter(point => point.bpm !== null);
  const anglePoints = points.filter(point => point.elbow_angle !== null);
  const counts = session.counts;
  const secondsLabel = (value: unknown) => `${Number(value).toFixed(0)} s`;

  return (
    <Modal
      title="Session Details"
      subtitle={<>{session.trainee_name} · {formatDateTime(session.date_time)}</>}
      onClose={onClose}
      size="lg"
      headerExtra={<ResultBadge result={session.result} />}
      actions={
        <>
          {isAdmin && (
            <button type="button" className="btn btn-danger" onClick={onDelete}>
              <TrashIcon /> Delete session
            </button>
          )}
          <button type="button" className="btn btn-primary" onClick={onClose}>Close</button>
        </>
      }
    >
      <div className="session-summary-grid">
        <SummaryCard label="Duration" value={formatDuration(session.duration_sec)} />
        <SummaryCard label="Compressions" value={String(session.total_compressions)} />
        <SummaryCard label="Correct" value={String(counts.correct)} tone="success" />
        <SummaryCard label="Incorrect" value={String(counts.incorrect)} tone="danger" />
        {counts.unscorable !== undefined && counts.unscorable > 0 && (
          <SummaryCard label="Elbow not visible" value={String(counts.unscorable)} />
        )}
        <SummaryCard label="Avg BPM" value={formatNumber(session.avg_bpm)} />
        <SummaryCard label="Elbow lock" value={`${formatNumber(session.elbow_lock_pct)}%`} />
        <SummaryCard
          label="Accuracy"
          value={`${formatNumber(session.accuracy_pct)}%`}
          tone={accuracyClass(session.accuracy_pct, settings.pass_mark_pct)}
        />
      </div>

      {(counts.hands_stacked_pct !== undefined || counts.breath_cycles !== undefined || counts.hands_only !== undefined) && (
        <p className="form-help" style={{ marginTop: -12, marginBottom: 12 }}>
          {counts.victim_type !== undefined && `${['Adult', 'Child', 'Infant'][counts.victim_type] ?? 'Adult'}, ${counts.rescuers ?? 1} rescuer${counts.rescuers === 2 ? 's' : ''} · `}
          {counts.hands_only === 1 ? 'Hands-only CPR' : `${counts.compressions_per_cycle ?? 30}:2 with breaths: ${counts.breath_cycles ?? 0} cycle(s) completed${counts.skipped_breaths ? `, breaths skipped ${counts.skipped_breaths}×` : ''}`}
          {counts.hands_stacked_pct !== undefined && ` · Hands stacked on ${counts.hands_stacked_pct.toFixed(0)}% of compressions`}
          {counts.aed_shocks ? ` · ${counts.aed_shocks} AED shock(s)` : ''}
          {counts.long_pauses ? ` · ${counts.long_pauses} pause(s) over 10 s` : ''}
          {counts.procedure_pct !== undefined && ` · Procedure followed: ${counts.procedure_pct.toFixed(0)}%`}
        </p>
      )}
      {(counts.fps !== undefined || counts.latency_ms !== undefined) && (
        <p className="form-help" style={{ marginTop: -12, marginBottom: 20 }}>
          Camera processing: {formatNumber(counts.fps)} frames/s, {formatNumber(counts.latency_ms)} ms per frame.
        </p>
      )}

      <div className="chart-card procedure-history-card">
        <h3>Adult CPR sequence (trainer-confirmed)</h3>
        <ul>
          {PROCEDURE_STEP_LABELS.map(([key, label]) => {
            const complete = session.procedure_steps?.[key];
            return (
              <li key={key} className={complete ? 'complete' : ''}>
                <span>{label}</span>
                <strong>{complete === undefined ? 'Not recorded' : complete ? 'Complete' : 'Incomplete'}</strong>
              </li>
            );
          })}
        </ul>
      </div>

      {points.length > 0 ? (
        <div className="detail-charts">
          <div className="chart-card">
            <h3>BPM over time</h3>
            <div className="chart-container" style={{ height: 250 }}>
              {bpmPoints.length === 0 ? <p className="text-muted">No BPM readings were recorded.</p> : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={bpmPoints} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <ReferenceArea y1={settings.bpm_min} y2={settings.bpm_max} fill="var(--success)" fillOpacity={0.08} />
                    <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={secondsLabel} tick={{ fontSize: 11 }} />
                    <YAxis domain={[60, 160]} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value) => [`${Number(value).toFixed(1)} BPM`, 'Rate']} labelFormatter={secondsLabel} />
                    <Line type="monotone" dataKey="bpm" stroke="var(--info)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
            <p className="form-help">Shaded band: target {settings.bpm_min}–{settings.bpm_max} BPM.</p>
          </div>

          <div className="chart-card">
            <h3>Elbow angle over time</h3>
            <div className="chart-container" style={{ height: 250 }}>
              {anglePoints.length === 0 ? <p className="text-muted">The elbow was not visible at any compression.</p> : (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={anglePoints} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                    <ReferenceLine y={settings.angle_threshold} stroke="var(--success)" strokeDasharray="4 4" />
                    <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={secondsLabel} tick={{ fontSize: 11 }} />
                    <YAxis domain={[90, 180]} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}°`, 'Angle']} labelFormatter={secondsLabel} />
                    <Line type="monotone" dataKey="elbow_angle" stroke="var(--primary)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
            <p className="form-help">Dashed line: lock threshold {settings.angle_threshold}°.</p>
          </div>
        </div>
      ) : (
        <p className="text-muted">No per-compression data was recorded for this session.</p>
      )}
    </Modal>
  );
}

function SummaryCard({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="summary-card">
      <span className="summary-label">{label}</span>
      <span className={`summary-value ${tone ?? ''}`}>{value}</span>
    </div>
  );
}

export default HistoryPage;
