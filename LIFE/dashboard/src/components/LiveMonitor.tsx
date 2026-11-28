/**
 * Live session monitor: polls /api/live every 2.5 s so a trainer on another screen can follow
 * the session in progress (spec: Live status read every 2–3 seconds).
 */

import { useEffect, useState } from 'react';
import { api, type LiveStatus } from '../api/client';
import { formatDuration } from '../utils/format';
import { PulseIcon } from './icons';

const POLL_MS = 2500;
const STALE_AFTER_MS = 10_000;

export function LiveMonitor({ bpmMin = 100, bpmMax = 120 }: { bpmMin?: number; bpmMax?: number }) {
  const [live, setLive] = useState<LiveStatus | null>(null);
  const [unreachable, setUnreachable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await api.getLiveStatus();
        if (!cancelled) {
          setLive(res.live);
          setUnreachable(false);
        }
      } catch {
        if (!cancelled) setUnreachable(true);
      }
    };
    void poll();
    const interval = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const updatedAt = live?.updated_at ? new Date(live.updated_at).getTime() : 0;
  const stale = live?.status === 'In Progress' && Date.now() - updatedAt > STALE_AFTER_MS;
  const status = unreachable ? 'Server unreachable' : stale ? 'Disconnected' : live?.status ?? 'Waiting';
  const active = live?.status === 'In Progress' && !stale && !unreachable;
  const bpmOk = live ? live.bpm >= bpmMin && live.bpm <= bpmMax : false;

  return (
    <div className="card live-monitor">
      <div className="card-header">
        <div>
          <h2 className="card-title"><PulseIcon /> Live session monitor {active && <span className="live-dot" aria-hidden="true" />}</h2>
          <div className="card-subtitle">Trainer sessions and trainee practice, updated every few seconds</div>
        </div>
        <span className={`badge badge-dot ${active ? 'badge-success' : stale || unreachable ? 'badge-warning' : 'badge-neutral'}`}>{active ? 'Live' : status}</span>
      </div>
      <div className="card-body">
        {!active && live?.status !== 'Completed' ? (
          <p className="text-muted">No session is running. When a trainer starts a Live Session, or a trainee starts Practice on their own account, its progress appears here automatically.</p>
        ) : (
          <>
            <p className="live-monitor-trainee"><strong>{live?.trainee_name ?? 'Trainee'}</strong>{live?.status === 'Completed' && ' — last session completed'}</p>
            <div className="live-monitor-grid">
              <div><span className="summary-label">Accuracy</span><span className="summary-value">{(live?.accuracy_pct ?? 0).toFixed(1)}%</span></div>
              <div>
                <span className="summary-label">Cadence</span>
                <span className={`summary-value ${live && live.bpm ? (bpmOk ? 'text-success' : 'text-danger') : ''}`}>{live?.bpm ? Math.round(live.bpm) : '—'}</span>
              </div>
              <div><span className="summary-label">Elbow lock</span><span className="summary-value">{(live?.elbow_lock_pct ?? 0).toFixed(1)}%</span></div>
              <div><span className="summary-label">Compressions</span><span className="summary-value">{live?.compressions ?? 0}</span></div>
              <div><span className="summary-label">Elapsed</span><span className="summary-value">{formatDuration(live?.elapsed_sec)}</span></div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
