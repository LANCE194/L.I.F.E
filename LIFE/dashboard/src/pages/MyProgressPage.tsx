/**
 * L.I.F.E. My Progress (trainee accounts)
 * A trainee's own sessions (trainer-supervised and self-practice), accuracy trend, leaderboard
 * place and procedure results, with downloads of their own data and certificates.
 */

import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, downloadBlob, type MyProgressResponse } from '../api/client';
import { useOnSessionsSynced } from '../hooks/useOutbox';
import { Banner, DownloadMenu, EmptyState, Kpi, ResultBadge, Spinner } from '../components/ui';
import {
  CameraIcon, ChartIcon, CheckCircleIcon, DownloadIcon, HeartPulseIcon, HistoryIcon, MedalIcon, PulseIcon, SparkleIcon, TrophyIcon,
} from '../components/icons';
import { accuracyClass, errorMessage, formatDate, formatDateTime, formatDuration, formatNumber, formatShortDay, todayLocal } from '../utils/format';
import './MyProgressPage.css';

export function MyProgressPage() {
  const [data, setData] = useState<MyProgressResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [certificateFor, setCertificateFor] = useState<number | null>(null);

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

  const downloadCertificate = async (sessionId: number) => {
    setCertificateFor(sessionId);
    try {
      downloadBlob(await api.getMyCertificatePdf(sessionId), `certificate_session_${sessionId}.pdf`);
    } catch (err) {
      setError(errorMessage(err, 'Could not create the certificate'));
    } finally {
      setCertificateFor(null);
    }
  };

  if (loading) return <div className="page-loading"><Spinner size={24} /> Loading your progress...</div>;

  const passMark = data?.pass_mark_pct ?? 80;
  const stats = data?.stats;
  const latest = data?.sessions[0];
  const ranking = data?.ranking ?? null;
  const firstName = data?.trainee.full_name.split(' ')[0] ?? '';
  const stamp = todayLocal();
  const selfCount = data?.sessions.filter(session => session.counts.self_practice === 1).length ?? 0;

  return (
    <div className="my-progress">
      <Banner kind="error" onDismiss={() => setError('')}>{error}</Banner>

      <section className="hero">
        <div className="hero-text">
          <div className="hero-eyebrow">My CPR training</div>
          <h2 className="hero-title">{data ? `Welcome back, ${firstName}` : 'My Progress'}</h2>
          <p className="hero-subtitle">
            {data ? `${data.trainee.organization ? `${data.trainee.organization} · ` : ''}Trainee since ${formatDate(data.trainee.date_registered)}` : ''}
          </p>
          <div className="hero-stats">
            <div>
              <div className="hero-stat-value">{ranking ? `#${ranking.rank}` : '—'}</div>
              <div className="hero-stat-label">{ranking ? `of ${ranking.total_ranked} on the leaderboard` : 'not ranked yet'}</div>
            </div>
            <div><div className="hero-stat-value">{stats?.total_sessions ?? 0}</div><div className="hero-stat-label">sessions recorded</div></div>
            <div><div className="hero-stat-value">{(stats?.total_compressions ?? 0).toLocaleString('en-US')}</div><div className="hero-stat-label">compressions</div></div>
          </div>
        </div>
        <div className="hero-actions">
          <Link to="/live" className="btn btn-gold btn-lg"><CameraIcon /> Start practice</Link>
          <Link to="/leaderboard" className="btn btn-secondary btn-lg"><TrophyIcon /> Leaderboard</Link>
        </div>
      </section>

      <div className="progress-toolbar">
        <div>
          <h2 className="section-title">Your results</h2>
          <p className="section-subtitle">Every session you practise is saved, shown to your trainer and counted on the leaderboard.</p>
        </div>
        <div className="header-actions">
          <Link to="/guide" className="btn btn-secondary"><HeartPulseIcon /> CPR Guide</Link>
          <DownloadMenu
            label="Download my data"
            onError={setError}
            options={[
              { key: 'json', title: 'Personal backup (JSON)', description: 'Profile, results and every compression recorded', run: async () => downloadBlob(await api.exportMyData('json'), `life_my_data_${stamp}.json`) },
              { key: 'pdf', title: 'Progress report (PDF)', description: 'Summary and session table, ready to print', run: async () => downloadBlob(await api.exportMyData('pdf'), `life_my_progress_${stamp}.pdf`) },
              { key: 'csv', title: 'Sessions (CSV)', description: 'One row per session, for Excel or Sheets', run: async () => downloadBlob(await api.exportMyData('csv'), `life_my_sessions_${stamp}.csv`) },
            ]}
          />
        </div>
      </div>

      {data && stats && stats.total_sessions === 0 && (
        <div className="card">
          <EmptyState icon={<ChartIcon />} title="No practice sessions yet">
            <p>Start a <Link to="/live">practice session</Link> with your camera, or wait for your trainer to record one. Review the <Link to="/guide">CPR Guide</Link> first.</p>
          </EmptyState>
        </div>
      )}

      {data && stats && stats.total_sessions > 0 && (
        <>
          <div className="kpi-grid">
            <Kpi label="Average accuracy" value={`${formatNumber(stats.avg_accuracy)}%`} valueTone={accuracyClass(stats.avg_accuracy, passMark)} icon={<CheckCircleIcon size={18} />} tone="success" hint={`Pass mark ${passMark}%`} />
            <Kpi label="Best accuracy" value={`${formatNumber(stats.best_accuracy)}%`} valueTone={accuracyClass(stats.best_accuracy, passMark)} icon={<SparkleIcon size={18} />} tone="gold" hint="Your personal best" />
            <Kpi label="Sessions passed" value={`${stats.pass_rate}%`} icon={<MedalIcon size={18} />} tone="accent" hint={`${stats.total_sessions} session${stats.total_sessions === 1 ? '' : 's'} · ${selfCount} self-practice`} />
            <Kpi label="Average rate" value={formatNumber(stats.avg_bpm)} icon={<PulseIcon size={18} />} tone="warning" hint="Target 100–120 per min" />
          </div>

          {latest && (
            <div className="card latest-card">
              <div className="card-body">
                <div className="latest-head">
                  <div>
                    <div className="latest-label">Latest session</div>
                    <strong>{formatDateTime(latest.date_time)}</strong>
                  </div>
                  <ResultBadge result={latest.result} />
                </div>
                <div className="latest-metrics">
                  <span><strong>{formatNumber(latest.accuracy_pct)}%</strong> accuracy</span>
                  <span><strong>{formatNumber(latest.elbow_lock_pct)}%</strong> elbow lock</span>
                  <span><strong>{formatNumber(latest.avg_bpm)}</strong> per min</span>
                  {latest.counts.procedure_pct !== undefined && <span><strong>{latest.counts.procedure_pct.toFixed(0)}%</strong> procedure</span>}
                </div>
                <div className="latest-tip"><SparkleIcon size={16} /> {tipFor(latest.avg_bpm, latest.elbow_lock_pct, latest.counts.procedure_pct)}</div>
              </div>
            </div>
          )}

          {data.progress.length > 1 && (
            <div className="card">
              <div className="card-header">
                <div>
                  <h2 className="card-title"><ChartIcon size={18} /> Accuracy over your sessions</h2>
                  <div className="card-subtitle">Dashed line: pass mark</div>
                </div>
              </div>
              <div className="card-body" style={{ height: 290 }}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={data.progress} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e7ef" vertical={false} />
                    <XAxis dataKey="date" tickFormatter={value => formatShortDay(String(value))} tick={{ fontSize: 11, fill: '#5b6880' }} axisLine={false} tickLine={false} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: '#5b6880' }} axisLine={false} tickLine={false} width={48} unit="%" />
                    <ReferenceLine y={passMark} stroke="#15803d" strokeDasharray="4 4" label={{ value: `Pass ${passMark}%`, fontSize: 11, fill: '#15803d', position: 'insideTopRight' }} />
                    <Tooltip formatter={value => [`${Number(value).toFixed(1)}%`, 'Accuracy']} labelFormatter={value => formatDateTime(String(value))} />
                    <Line type="monotone" dataKey="accuracy" stroke="#0a2e56" strokeWidth={2.5} dot={{ r: 3.5, fill: '#0a2e56' }} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          <div className="card mt-4">
            <div className="card-header">
              <div>
                <h2 className="card-title"><HistoryIcon size={18} /> My sessions</h2>
                <div className="card-subtitle">Trainer-supervised and self-practice sessions</div>
              </div>
            </div>
            <div className="card-body flush">
              <div className="table-container">
                <table className="table nowrap-table">
                  <thead>
                    <tr>
                      <th>Date</th><th>Type</th><th>Duration</th><th>Compressions</th><th>Rate</th><th>Elbow lock</th><th>Accuracy</th><th>Procedure</th><th>Result</th><th aria-label="Certificate" />
                    </tr>
                  </thead>
                  <tbody>
                    {data.sessions.map(session => (
                      <tr key={session.session_id}>
                        <td>{formatDateTime(session.date_time)}</td>
                        <td>
                          {session.counts.self_practice === 1
                            ? <span className="badge badge-info">Self-practice</span>
                            : <span className="badge badge-neutral">Supervised</span>}
                        </td>
                        <td>{formatDuration(session.duration_sec)}</td>
                        <td>{session.total_compressions}</td>
                        <td>{formatNumber(session.avg_bpm)}</td>
                        <td>{formatNumber(session.elbow_lock_pct)}%</td>
                        <td><span className={`accuracy-value ${accuracyClass(session.accuracy_pct, passMark)}`}>{formatNumber(session.accuracy_pct)}%</span></td>
                        <td>{session.counts.procedure_pct !== undefined ? `${session.counts.procedure_pct.toFixed(0)}%` : <span className="text-muted">—</span>}</td>
                        <td><ResultBadge result={session.result} /></td>
                        <td>
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            onClick={() => void downloadCertificate(session.session_id)}
                            disabled={certificateFor !== null}
                            title="Certificate of Practice Completion (PDF)"
                          >
                            {certificateFor === session.session_id ? <Spinner size={14} /> : <DownloadIcon size={14} />} Certificate
                          </button>
                        </td>
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
  if (bpm > 0 && bpm < 100) return 'Push a little faster, aiming for 100–120 compressions per minute.';
  if (bpm > 120) return 'Slow down slightly, staying within 100–120 compressions per minute.';
  if (elbowLockPct < 80) return 'Keep your arms straight and elbows locked, with your shoulders over your hands.';
  if (procedurePct !== undefined && procedurePct < 80) return 'Follow every step in order, including 2 breaths after each cycle and short pauses.';
  return 'Great work. Keep practising to make it automatic.';
}

export default MyProgressPage;
