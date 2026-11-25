/**
 * Trainee profile: summary statistics and accuracy across sessions (per-trainee progress).
 */

import { useEffect, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, type TraineeStatsResponse } from '../api/client';
import { errorMessage, formatDate, formatDuration } from '../utils/format';
import { Banner, Modal, Spinner } from './ui';

export function TraineeProfile({ traineeId, passMark, onClose }: { traineeId: number; passMark: number; onClose: () => void }) {
  const [data, setData] = useState<TraineeStatsResponse | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.getTraineeStats(traineeId)
      .then(setData)
      .catch(err => setError(errorMessage(err, 'Failed to load trainee progress')));
  }, [traineeId]);

  const stats = data?.stats;

  return (
    <Modal
      title={data?.trainee.full_name ?? 'Trainee'}
      subtitle={data ? `${data.trainee.organization || 'No organization'} · registered ${formatDate(data.trainee.date_registered)}` : undefined}
      size="lg"
      onClose={onClose}
    >
      <Banner kind="error">{error}</Banner>
      {!data && !error && <div className="page-loading"><Spinner size={24} /> Loading...</div>}
      {stats && (
        <>
          <div className="session-summary-grid">
            <div className="summary-card"><span className="summary-label">Sessions</span><span className="summary-value">{stats.total_sessions}</span></div>
            <div className="summary-card"><span className="summary-label">Avg accuracy</span><span className="summary-value">{stats.avg_accuracy.toFixed(1)}%</span></div>
            <div className="summary-card"><span className="summary-label">Best accuracy</span><span className="summary-value">{stats.best_accuracy.toFixed(1)}%</span></div>
            <div className="summary-card"><span className="summary-label">Pass rate</span><span className="summary-value">{stats.pass_rate}%</span></div>
            <div className="summary-card"><span className="summary-label">Avg BPM</span><span className="summary-value">{stats.avg_bpm.toFixed(1)}</span></div>
            <div className="summary-card"><span className="summary-label">Total compressions</span><span className="summary-value">{stats.total_compressions}</span></div>
            <div className="summary-card"><span className="summary-label">Avg duration</span><span className="summary-value">{formatDuration(stats.avg_duration)}</span></div>
          </div>

          {data.progress.length > 0 ? (
            <div className="chart-card">
              <h3>Accuracy by session</h3>
              <div style={{ width: '100%', height: 260 }}>
                <ResponsiveContainer>
                  <LineChart data={data.progress} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e0e0e0" />
                    <XAxis dataKey="session_number" tick={{ fontSize: 11 }} label={{ value: 'Session', position: 'insideBottom', offset: -4, fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} width={40} />
                    <ReferenceLine y={passMark} stroke="#1e8a4c" strokeDasharray="4 4" label={{ value: `Pass ${passMark}%`, fontSize: 11, position: 'insideTopRight' }} />
                    <Tooltip
                      formatter={(value: number) => [`${Number(value).toFixed(1)}%`, 'Accuracy']}
                      labelFormatter={(value, payload) => {
                        const point = payload?.[0]?.payload as { date?: string } | undefined;
                        return `Session ${value}${point?.date ? ` · ${formatDate(point.date)}` : ''}`;
                      }}
                    />
                    <Line type="monotone" dataKey="accuracy" stroke="#0a2e56" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          ) : (
            <p className="text-muted">No sessions recorded yet.</p>
          )}
        </>
      )}
    </Modal>
  );
}
