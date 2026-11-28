/**
 * L.I.F.E. Dashboard
 * Welcome banner with quick actions, headline figures, live session monitor, top-5 leaderboard,
 * accuracy trend and recent sessions. Statistics count every session by default (trainer-
 * supervised and trainee self-practice); the scope switch narrows them. Refreshes automatically
 * when a session is saved and every minute.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, XAxis, YAxis, ReferenceLine } from 'recharts';
import { api, downloadBlob, type DashboardResponse, type SessionScope, type Settings } from '../api/client';
import { useAuth } from '../hooks/useAuth';
import { useOnSessionsSynced } from '../hooks/useOutbox';
import { useChoicePreference } from '../hooks/usePreference';
import { LiveMonitor } from '../components/LiveMonitor';
import { AccuracyBar, Banner, EmptyState, Kpi, Person, ResultBadge, SCOPE_DESCRIPTION, ScopeSwitch } from '../components/ui';
import {
  ArrowRightIcon, CalendarIcon, CameraIcon, CheckCircleIcon, DatabaseIcon, HistoryIcon, PlusIcon, PulseIcon, TrophyIcon, UsersIcon,
} from '../components/icons';
import { accuracyClass, errorMessage, formatDateTime, formatDuration, formatNumber, formatShortDay, todayLocal } from '../utils/format';
import './DashboardPage.css';

const REFRESH_MS = 60_000;
const SCOPES = ['all', 'supervised', 'self'] as const;

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

export function DashboardPage() {
  const { user, isAdmin } = useAuth();
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [settings, setSettings] = useState<Partial<Settings>>({});
  const [error, setError] = useState('');
  const [scope, setScope] = useChoicePreference<SessionScope>('life_dashboard_scope', 'all', SCOPES);
  const [backingUp, setBackingUp] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.getDashboardStats(scope));
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Failed to load dashboard'));
    }
  }, [scope]);

  useEffect(() => {
    void load();
    const interval = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [load]);

  useEffect(() => {
    api.getSettings().then(res => setSettings(res.settings)).catch(() => undefined);
  }, []);

  useOnSessionsSynced(() => void load());

  const downloadBackup = async () => {
    setBackingUp(true);
    try {
      downloadBlob(await api.downloadBackup(), `life_backup_${todayLocal()}.db`);
    } catch (err) {
      setError(errorMessage(err, 'Backup download failed'));
    } finally {
      setBackingUp(false);
    }
  };

  const passMark = settings.pass_mark_pct ?? 80;
  const stats = data?.stats;
  const supervisedCount = stats ? stats.total_sessions - stats.self_practice_sessions : 0;

  return (
    <div>
      <Banner kind="error" onDismiss={() => setError('')}>{error}</Banner>

      <section className="hero">
        <div className="hero-text">
          <div className="hero-eyebrow">AI-assisted CPR training</div>
          <h2 className="hero-title">{greeting()}, {user?.username ?? 'trainer'}</h2>
          <p className="hero-subtitle">
            Real-time elbow-lock and compression-rate coaching from a single webcam, following the 2025 AHA adult CPR sequence.
          </p>
          {stats && (
            <div className="hero-stats">
              <div><div className="hero-stat-value">{stats.total_sessions}</div><div className="hero-stat-label">sessions recorded</div></div>
              <div><div className="hero-stat-value">{stats.total_compressions.toLocaleString('en-US')}</div><div className="hero-stat-label">compressions analysed</div></div>
              <div><div className="hero-stat-value">{stats.trainee_count}</div><div className="hero-stat-label">active trainees</div></div>
            </div>
          )}
        </div>
        <div className="hero-actions">
          <Link to="/live" className="btn btn-gold btn-lg"><CameraIcon /> Start live session</Link>
          <Link to="/trainees" className="btn btn-secondary btn-lg"><PlusIcon /> Add trainee</Link>
          {isAdmin && (
            <button type="button" className="btn btn-secondary btn-lg" onClick={() => void downloadBackup()} disabled={backingUp}>
              <DatabaseIcon /> {backingUp ? 'Preparing...' : 'Download backup'}
            </button>
          )}
        </div>
      </section>

      <LiveMonitor bpmMin={settings.bpm_min} bpmMax={settings.bpm_max} />

      <div className="section-bar">
        <div>
          <h2 className="section-title">Performance overview</h2>
          <p className="section-subtitle">Figures, trend and top 5 count {SCOPE_DESCRIPTION[scope]}.</p>
        </div>
        <ScopeSwitch value={scope} onChange={setScope} />
      </div>

      {!data && !error && (
        <div className="kpi-grid six" aria-hidden="true">
          {Array.from({ length: 6 }, (_, index) => <div key={index} className="kpi skeleton" style={{ height: 116 }} />)}
        </div>
      )}

      {data && stats && (
        <>
          <div className="kpi-grid six">
            <Kpi label="Active trainees" value={stats.trainee_count} icon={<UsersIcon size={18} />} tone="primary" hint="Registered and active" />
            <Kpi label="Sessions today" value={stats.sessions_today} icon={<CalendarIcon size={18} />} tone="info" hint="Local calendar day" />
            <Kpi
              label="Total sessions"
              value={stats.total_sessions}
              icon={<HistoryIcon size={18} />}
              tone="gold"
              hint={scope === 'all' ? `${supervisedCount} supervised · ${stats.self_practice_sessions} self-practice` : SCOPE_DESCRIPTION[scope]}
            />
            <Kpi
              label="Average accuracy"
              value={`${stats.avg_accuracy.toFixed(1)}%`}
              valueTone={stats.total_sessions ? accuracyClass(stats.avg_accuracy, passMark) : undefined}
              icon={<CheckCircleIcon size={18} />}
              tone="success"
              hint={`Pass mark ${passMark}%`}
            />
            <Kpi label="Pass rate" value={`${stats.pass_rate}%`} icon={<TrophyIcon size={18} />} tone="accent" hint="Sessions at or above the pass mark" />
            <Kpi label="Average rate" value={stats.avg_bpm.toFixed(1)} icon={<PulseIcon size={18} />} tone="warning" hint={`Target ${settings.bpm_min ?? 100}–${settings.bpm_max ?? 120} per min`} />
          </div>

          <div className="dashboard-grid">
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title"><TrophyIcon size={18} /> Top 5 trainees</h2>
                  <div className="card-subtitle">By average accuracy</div>
                </div>
                <Link to="/leaderboard" className="btn btn-ghost btn-sm">Full leaderboard <ArrowRightIcon size={14} /></Link>
              </div>
              <div className="card-body flush">
                {data.top5.length === 0 ? (
                  <EmptyState icon={<TrophyIcon />} title="No rankings yet"><p>Complete sessions to see the top performers.</p></EmptyState>
                ) : (
                  <ol className="top5-list">
                    {data.top5.map((trainee, index) => (
                      <li key={trainee.trainee_id}>
                        <span className={`rank-badge ${index < 3 ? `rank-${index + 1}` : ''}`}>{trainee.rank ?? index + 1}</span>
                        <Person
                          name={trainee.full_name}
                          meta={`${trainee.organization || 'Independent'} · ${trainee.session_count} session${trainee.session_count === 1 ? '' : 's'}`}
                        />
                        <AccuracyBar value={trainee.avg_accuracy} tone={accuracyClass(trainee.avg_accuracy, passMark)} />
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title"><PulseIcon size={18} /> Accuracy trend</h2>
                  <div className="card-subtitle">Daily average, last 30 days</div>
                </div>
              </div>
              <div className="card-body">
                {data.accuracy_trend.length === 0 ? (
                  <EmptyState icon={<PulseIcon />} title="No trend data"><p>Sessions from the last 30 days appear here.</p></EmptyState>
                ) : (
                  <div className="chart-container" style={{ height: 280 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.accuracy_trend} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
                        <defs>
                          <linearGradient id="accuracyGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#16457a" stopOpacity={0.28} />
                            <stop offset="95%" stopColor="#16457a" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e2e7ef" vertical={false} />
                        <XAxis dataKey="date" tickFormatter={formatShortDay} tick={{ fontSize: 11, fill: '#5b6880' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#5b6880' }} axisLine={false} tickLine={false} width={48} unit="%" />
                        <ReferenceLine y={passMark} stroke="#15803d" strokeDasharray="4 4" label={{ value: `Pass ${passMark}%`, fontSize: 11, fill: '#15803d', position: 'insideTopRight' }} />
                        <Tooltip
                          formatter={(value: number) => [`${Number(value).toFixed(1)}%`, 'Accuracy']}
                          labelFormatter={value => formatShortDay(String(value))}
                        />
                        <Area type="monotone" dataKey="avg_accuracy" stroke="#0a2e56" fillOpacity={1} fill="url(#accuracyGradient)" strokeWidth={2.5} dot={{ r: 3, fill: '#0a2e56' }} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="card mt-4">
            <div className="card-header">
              <div>
                <h2 className="card-title"><HistoryIcon size={18} /> Recent sessions</h2>
                <div className="card-subtitle">Latest activity from trainers and trainees</div>
              </div>
              <Link to="/history" className="btn btn-ghost btn-sm">All sessions <ArrowRightIcon size={14} /></Link>
            </div>
            <div className="card-body flush">
              {data.recent_sessions.length === 0 ? (
                <EmptyState icon={<HistoryIcon />} title="No sessions yet"><p>Start a live session to record CPR practice.</p></EmptyState>
              ) : (
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Trainee</th><th>Date / time</th><th>Duration</th>
                        <th>Compressions</th><th>Avg BPM</th><th>Accuracy</th><th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_sessions.map(session => (
                        <tr key={session.session_id}>
                          <td>
                            <Person
                              name={session.trainee_name ?? `Trainee ${session.trainee_id}`}
                              meta={session.organization || 'Independent'}
                              badge={session.counts?.self_practice === 1
                                ? <span className="badge badge-info self-badge" title="Recorded by the trainee on the Practice page">Self-practice</span>
                                : <span className="badge badge-neutral self-badge" title="Run by a trainer">Supervised</span>}
                            />
                          </td>
                          <td className="text-muted">{formatDateTime(session.date_time)}</td>
                          <td>{formatDuration(session.duration_sec)}</td>
                          <td>{session.total_compressions}</td>
                          <td>{formatNumber(session.avg_bpm)}</td>
                          <td>
                            <span className={`accuracy-value ${accuracyClass(session.accuracy_pct, passMark)}`}>
                              {session.accuracy_pct.toFixed(1)}%
                            </span>
                          </td>
                          <td><ResultBadge result={session.result} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default DashboardPage;
