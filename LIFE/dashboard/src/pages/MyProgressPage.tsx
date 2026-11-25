/**
 * L.I.F.E. My Progress (trainee accounts)
 * A trainee's own sessions, accuracy trend and procedure results. Read-only.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type MyProgressResponse } from '../api/client';
import { useOnSessionsSynced } from '../hooks/useOutbox';
import { Banner, EmptyState, PageHeader, ResultBadge, Spinner } from '../components/ui';
import { CameraIcon, ChartIcon, HeartPulseIcon } from '../components/icons';
import { accuracyClass, errorMessage, formatDate, formatDateTime, formatDuration, formatNumber, formatShortDay } from '../utils/format';
import './MyProgressPage.css';

export function MyProgressPage() {
  const [data, setData] = useState<MyProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api.getMyProgress());
      setError('');
    } catch (err) {
      setError(errorMessage(err, 'Could not load your progress'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useOnSessionsSynced(() => void load());

  if (loading) return <div className="page-loading"><Spinner size={24} /> Loading your progress...</div>;

  const passMark = data?.pass_mark_pct ?? 80;
  const stats = data?.stats;
  const latest = data?.sessions[0];

  return (
    <div className="my-progress">
      <Banner kind="error" onDismiss={() => setError('')}>{error}</Banner>

      <PageHeader
        title={data ? `Hi, ${data.trainee.full_name.split(' ')[0]}` : 'My Progress'}
        subtitle={data ? `${data.trainee.organization ? `${data.trainee.organization} · ` : ''}Trainee since ${formatDate(data.trainee.date_registered)}` : undefined}
        actions={
          <>
            <Link to="/guide" className="btn btn-secondary"><HeartPulseIcon /> CPR Guide</Link>
            <Link to="/live" className="btn btn-primary"><CameraIcon /> Start practice</Link>
          </>
        }
      />

      {data && stats && stats.total_sessions === 0 && (
        <EmptyState icon={<ChartIcon />} title="No practice sessions yet">
          <p>Start a <Link to="/live">practice session</Link> with your camera, or wait for your trainer to record one. Review the <Link to="/guide">CPR Guide</Link> first.</p>
        </EmptyState>
      )}

      {data && stats && stats.total_sessions > 0 && (
        <>
          <div className="progress-tiles">
            <Tile label="Sessions" value={String(stats.total_sessions)} />
            <Tile label="Average accuracy" value={`${formatNumber(stats.avg_accuracy)}%`} tone={accuracyClass(stats.avg_accuracy, passMark)} />
            <Tile label="Best accuracy" value={`${formatNumber(stats.best_accuracy)}%`} tone={accuracyClass(stats.best_accuracy, passMark)} />
            <Tile label="Passed" value={`${stats.pass_rate}%`} hint={`Pass mark ${passMark}%`} />
            <Tile label="Average rate" value={`${formatNumber(stats.avg_bpm)}`} hint="Target 100–120 per min" />
          </div>

          {latest && (
            <div className="card latest-card">
              <div className="card-body">
                <strong>Latest session · {formatDateTime(latest.date_time)}</strong>
                <ResultBadge result={latest.result} />
                <span>Accuracy {formatNumber(latest.accuracy_pct)}% · Elbow lock {formatNumber(latest.elbow_lock_pct)}% · {formatNumber(latest.avg_bpm)} per min</span>
                {latest.counts.procedure_pct !== undefined && <span>Procedure followed {latest.counts.procedure_pct.toFixed(0)}%</span>}
                <span className="latest-tip">{tipFor(latest.avg_bpm, latest.elbow_lock_pct, latest.counts.procedure_pct)}</span>
              </div>
            </div>
          )}

          {data.progress.length > 1 && (
            <div className="card">
              <div className="card-header"><h2 className="card-title">Accuracy over your sessions</h2></div>
              <div className="card-body" style={{ height: 280 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.progress} margin={{ top: 8, right: 16, bottom: 4, left: -12 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#dde2ea" />
                    <XAxis dataKey="date" tickFormatter={value => formatShortDay(String(value))} tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
                    <ReferenceLine y={passMark} stroke="#1e8a4c" strokeDasharray="4 4" label={{ value: `Pass ${passMark}%`, fontSize: 11, position: 'insideTopRight' }} />
                    <Tooltip formatter={value => [`${Number(value).toFixed(1)}%`, 'Accuracy']} labelFormatter={value => formatDateTime(String(value))} />
                    <Line type="monotone" dataKey="accuracy" stroke="#0a2e56" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="card mt-4">
            <div className="card-header"><h2 className="card-title">My sessions</h2></div>
            <div className="card-body" style={{ padding: 0 }}>
              <div className="table-container">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Date</th><th>Duration</th><th>Compressions</th><th>Rate</th><th>Elbow lock</th><th>Accuracy</th><th>Procedure</th><th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.sessions.map(session => (
                      <tr key={session.session_id}>
                        <td>{formatDateTime(session.date_time)}</td>
                        <td>{formatDuration(session.duration_sec)}</td>
                        <td>{session.total_compressions}</td>
                        <td>{formatNumber(session.avg_bpm)}</td>
                        <td>{formatNumber(session.elbow_lock_pct)}%</td>
                        <td><span className={`accuracy-value ${accuracyClass(session.accuracy_pct, passMark)}`}>{formatNumber(session.accuracy_pct)}%</span></td>
                        <td>{session.counts.procedure_pct !== undefined ? `${session.counts.procedure_pct.toFixed(0)}%` : <span className="text-muted">—</span>}</td>
                        <td><ResultBadge result={session.result} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      <p className="form-help mt-3">
        L.I.F.E. is a training aid. Results confirm practice only and are not a CPR certification.
      </p>
    </div>
  );
}

function tipFor(bpm: number, elbowLockPct: number, procedurePct?: number): string {
  if (bpm > 0 && bpm < 100) return 'Tip: push a little faster, aiming for 100–120 compressions per minute.';
  if (bpm > 120) return 'Tip: slow down slightly, staying within 100–120 compressions per minute.';
  if (elbowLockPct < 80) return 'Tip: keep your arms straight and elbows locked, with your shoulders over your hands.';
  if (procedurePct !== undefined && procedurePct < 80) return 'Tip: follow every step in order, including 2 breaths after each cycle and short pauses.';
  return 'Great work. Keep practising to make it automatic.';
}

function Tile({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="progress-tile">
      <span className="progress-tile-label">{label}</span>
      <span className={`progress-tile-value ${tone ?? ''}`}>{value}</span>
      {hint && <span className="progress-tile-hint">{hint}</span>}
    </div>
  );
}

export default MyProgressPage;
