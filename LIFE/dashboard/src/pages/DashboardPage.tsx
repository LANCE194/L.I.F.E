/**
 * L.I.F.E. Dashboard
 * Live session monitor, summary stats, top-5 leaderboard, accuracy trend and recent sessions.
 * Refreshes automatically when a session is saved and every minute.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, XAxis, YAxis } from 'recharts';
import { api, type DashboardResponse, type Settings } from '../api/client';
import { useOnSessionsSynced } from '../hooks/useOutbox';
import { LiveMonitor } from '../components/LiveMonitor';
import { Banner, EmptyState, ResultBadge } from '../components/ui';
import { CalendarIcon, ChartIcon, CheckCircleIcon, HistoryIcon, PulseIcon, UsersIcon } from '../components/icons';
import { accuracyClass, errorMessage, formatDateTime, formatDuration, formatNumber, formatShortDay } from '../utils/format';
import './DashboardPage.css';

const REFRESH_MS = 60_000;

export function DashboardPage() {
  const [data, setData] = useState<DashboardResponse | null>(null);
  const [settings, setSettings] = useState<Partial<Settings>>({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api.getDashboardStats());
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Failed to load dashboard'));
    }
  }, []);

  useEffect(() => {
    void load();
    api.getSettings().then(res => setSettings(res.settings)).catch(() => undefined);
    const interval = window.setInterval(() => void load(), REFRESH_MS);
    return () => window.clearInterval(interval);
  }, [load]);

  useOnSessionsSynced(() => void load());

  const passMark = settings.pass_mark_pct ?? 80;

  return (
    <div>
      <Banner kind="error" onDismiss={() => setError('')}>{error}</Banner>

      <LiveMonitor bpmMin={settings.bpm_min} bpmMax={settings.bpm_max} />

      {data && (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon primary"><UsersIcon size={24} /></div>
              <div className="stat-content">
                <div className="stat-value">{data.stats.trainee_count}</div>
                <div className="stat-label">Active Trainees</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon info"><CalendarIcon size={24} /></div>
              <div className="stat-content">
                <div className="stat-value">{data.stats.sessions_today}</div>
                <div className="stat-label">Sessions Today</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon success"><CheckCircleIcon size={24} /></div>
              <div className="stat-content">
                <div className="stat-value">{data.stats.avg_accuracy.toFixed(1)}%</div>
                <div className="stat-label">Avg Accuracy</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-icon warning"><PulseIcon size={24} /></div>
              <div className="stat-content">
                <div className="stat-value">{data.stats.avg_bpm.toFixed(1)}</div>
                <div className="stat-label">Avg BPM</div>
              </div>
            </div>
          </div>
          <p className="stats-scope-note">Session figures, the trend and the top 5 count trainer-supervised sessions only; trainee self-practice is listed in Recent Sessions and History but not counted.</p>

          <div className="dashboard-grid">
            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Top 5 Leaderboard <small className="card-title-note">supervised sessions</small></h2>
                <Link to="/leaderboard" className="btn btn-secondary btn-sm">View All</Link>
              </div>
              <div className="card-body">
                {data.top5.length === 0 ? (
                  <EmptyState icon={<ChartIcon />} title="No data yet"><p>Complete sessions to see the leaderboard</p></EmptyState>
                ) : (
                  <div className="table-container">
                    <table className="table">
                      <thead>
                        <tr><th>Rank</th><th>Trainee</th><th>Organization</th><th>Avg Accuracy</th><th>Best</th><th>Sessions</th></tr>
                      </thead>
                      <tbody>
                        {data.top5.map((trainee, index) => (
                          <tr key={trainee.trainee_id}>
                            <td><span className={`rank-badge rank-${index + 1}`}>#{index + 1}</span></td>
                            <td><strong>{trainee.full_name}</strong></td>
                            <td>{trainee.organization || '—'}</td>
                            <td>
                              <span className={`accuracy-value ${accuracyClass(trainee.avg_accuracy, passMark)}`}>
                                {trainee.avg_accuracy.toFixed(1)}%
                              </span>
                            </td>
                            <td>{trainee.best_accuracy.toFixed(1)}%</td>
                            <td>{trainee.session_count}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            <div className="card">
              <div className="card-header">
                <h2 className="card-title">Accuracy Trend (30 Days) <small className="card-title-note">supervised sessions</small></h2>
              </div>
              <div className="card-body">
                {data.accuracy_trend.length === 0 ? (
                  <EmptyState icon={<PulseIcon />} title="No trend data"><p>Complete sessions over multiple days to see trends</p></EmptyState>
                ) : (
                  <div className="chart-container" style={{ height: 300 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={data.accuracy_trend}>
                        <defs>
                          <linearGradient id="accuracyGradient" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#0a2e56" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#0a2e56" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#dde2ea" />
                        <XAxis dataKey="date" tickFormatter={formatShortDay} tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={40} />
                        <Tooltip
                          formatter={(value: number) => [`${Number(value).toFixed(1)}%`, 'Accuracy']}
                          labelFormatter={value => formatShortDay(String(value))}
                        />
                        <Area type="monotone" dataKey="avg_accuracy" stroke="#0a2e56" fillOpacity={1} fill="url(#accuracyGradient)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="card mt-4">
            <div className="card-header">
              <h2 className="card-title">Recent Sessions</h2>
              <Link to="/history" className="btn btn-secondary btn-sm">View All</Link>
            </div>
            <div className="card-body">
              {data.recent_sessions.length === 0 ? (
                <EmptyState icon={<HistoryIcon />} title="No sessions yet"><p>Start a live session to record CPR practice</p></EmptyState>
              ) : (
                <div className="table-container">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Date/Time</th><th>Trainee</th><th>Organization</th><th>Duration</th>
                        <th>Compressions</th><th>Avg BPM</th><th>Accuracy</th><th>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recent_sessions.map(session => (
                        <tr key={session.session_id}>
                          <td>{formatDateTime(session.date_time)}</td>
                          <td>
                            {session.trainee_name}
                            {session.counts?.self_practice === 1 && <span className="badge badge-info self-badge" title="Recorded by the trainee on their own; not included in the statistics">Self-practice</span>}
                          </td>
                          <td>{session.organization || '—'}</td>
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
