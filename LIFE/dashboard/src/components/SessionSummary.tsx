/**
 * End-of-session summary: result, key metrics, the main issue to work on, a compression
 * timeline, and a comparison with the trainee's previous session.
 */

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Session } from '../api/types';
import type { ProcedureEvaluation } from '../cpr/flow';
import type { ScoredCompression, ScoreSummary } from '../vision/scoring';
import { formatDateTime, formatDuration } from '../utils/format';
import { CheckCircleIcon, AlertIcon } from './icons';

export interface SummaryData {
  traineeName: string;
  result: 'Pass' | 'Needs Improvement';
  resultIsProvisional: boolean;
  summary: ScoreSummary;
  durationSec: number;
  compressions: ScoredCompression[];
  startTimestamp: number;
  avgFps: number;
  previous: Session | null;
  procedureDone: number;
  procedureTotal: number;
  /** Share of compressions with the hands stacked (null = not measured). */
  handsStackedPct?: number | null;
  cprMode?: 'breaths' | 'hands-only';
  breathCycles?: number;
  compressionsPerCycle?: number;
  procedure?: ProcedureEvaluation;
}

export function mainIssue(summary: ScoreSummary): { text: string; tone: 'good' | 'bad' | 'neutral' } {
  const scored = summary.scorableCompressions;
  const misses = scored - summary.correctCompressions;
  if (summary.totalCompressions === 0) return { text: 'No compressions were detected.', tone: 'bad' };
  if (scored === 0) return { text: 'No compression could be judged — keep the arm visible to the camera.', tone: 'bad' };
  if (misses === 0) return { text: 'Every scored compression was correct. Excellent work!', tone: 'good' };

  const issues = [
    { count: summary.unlockedCount, text: 'elbows were bent' },
    { count: summary.slowCount, text: 'cadence was too slow' },
    { count: summary.fastCount, text: 'cadence was too fast' },
  ].sort((a, b) => b.count - a.count);
  const top = issues[0];
  return {
    text: `Main thing to work on: ${top.text} (${top.count} of ${misses} missed compression${misses === 1 ? '' : 's'}).`,
    tone: 'neutral',
  };
}

function Delta({ current, previous, unit = '' }: { current: number; previous: number | null | undefined; unit?: string }) {
  if (previous === null || previous === undefined) return null;
  const diff = Math.round((current - previous) * 10) / 10;
  if (diff === 0) return <span className="delta same">±0{unit}</span>;
  return <span className={`delta ${diff > 0 ? 'up' : 'down'}`}>{diff > 0 ? '+' : ''}{diff}{unit}</span>;
}

export function SessionSummary({ data, bpmMin, bpmMax }: { data: SummaryData; bpmMin: number; bpmMax: number }) {
  const { summary, previous } = data;
  const issue = mainIssue(summary);
  const timeline = data.compressions
    .filter(item => item.bpm !== null)
    .map(item => ({
      t: Math.round(((item.timestamp - data.startTimestamp) / 1000) * 10) / 10,
      bpm: item.bpm,
      locked: item.elbowLocked ? item.bpm : null,
      bent: item.elbowVisible && !item.elbowLocked ? item.bpm : null,
    }));
  const yMax = Math.max(bpmMax + 20, ...timeline.map(point => (point.bpm ?? 0) + 5));
  const yMin = Math.min(bpmMin - 20, ...timeline.map(point => (point.bpm ?? 999) - 5));

  return (
    <div className="session-summary-v2">
      <div className={`result-badge ${data.result === 'Pass' ? 'result-pass' : 'result-fail'}`}>
        {data.result === 'Pass' ? <CheckCircleIcon size={20} /> : <AlertIcon size={20} />}
        {data.result}
        {data.resultIsProvisional && <small> (provisional — not yet saved to server)</small>}
      </div>

      <p className={`summary-issue tone-${issue.tone}`}>{issue.text}</p>

      <div className="session-summary">
        <div className="summary-item">
          <span className="summary-label">Accuracy</span>
          <span className="summary-value">{summary.accuracyPct.toFixed(1)}%</span>
          <Delta current={summary.accuracyPct} previous={previous?.accuracy_pct} unit="%" />
        </div>
        <div className="summary-item">
          <span className="summary-label">Avg BPM</span>
          <span className="summary-value">{summary.avgBpm?.toFixed(1) ?? '—'}</span>
          {summary.avgBpm !== null && <Delta current={summary.avgBpm} previous={previous?.avg_bpm || null} />}
        </div>
        <div className="summary-item">
          <span className="summary-label">Elbow Lock</span>
          <span className="summary-value">{summary.elbowLockPct.toFixed(1)}%</span>
          <Delta current={summary.elbowLockPct} previous={previous?.elbow_lock_pct} unit="%" />
        </div>
        <div className="summary-item">
          <span className="summary-label">Compressions</span>
          <span className="summary-value">{summary.totalCompressions}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Correct</span>
          <span className="summary-value">{summary.correctCompressions}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Not visible</span>
          <span className="summary-value">{summary.unscorableCompressions}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Duration</span>
          <span className="summary-value">{formatDuration(data.durationSec)}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">CPR steps</span>
          <span className="summary-value">{data.procedureDone}/{data.procedureTotal}</span>
        </div>
        <div className="summary-item">
          <span className="summary-label">Hands stacked</span>
          <span className="summary-value">{data.handsStackedPct === null || data.handsStackedPct === undefined ? '—' : `${data.handsStackedPct.toFixed(0)}%`}</span>
        </div>
        {data.cprMode && (
          <div className="summary-item">
            <span className="summary-label">{data.cprMode === 'breaths' ? `${data.compressionsPerCycle ?? 30}:2 cycles` : 'Mode'}</span>
            <span className="summary-value">{data.cprMode === 'breaths' ? data.breathCycles ?? 0 : 'Hands-only'}</span>
          </div>
        )}
      </div>

      {data.procedure && (
        <div className="procedure-result">
          <div className="procedure-result-head">
            <strong>Procedure followed</strong>
            <span className={`badge ${data.procedure.pct >= 80 ? 'badge-success' : data.procedure.pct >= 50 ? 'badge-warning' : 'badge-danger'}`}>
              {data.procedure.followed}/{data.procedure.total} steps · {data.procedure.pct.toFixed(0)}%
            </span>
          </div>
          <ul>
            {data.procedure.items.map(item => (
              <li key={item.label} className={item.ok ? 'ok' : 'missed'}>
                <span aria-hidden="true">{item.ok ? '✓' : '✗'}</span>
                <span>{item.label}{item.detail && <small> — {item.detail}</small>}</span>
              </li>
            ))}
          </ul>
          <p className="procedure-note">The procedure result is shown separately; Pass or Needs Improvement is based on compression accuracy.</p>
        </div>
      )}

      {previous && (
        <p className="summary-previous">
          Compared with the previous session on {formatDateTime(previous.date_time)} ({previous.accuracy_pct.toFixed(1)}% accuracy).
        </p>
      )}

      {timeline.length > 1 && (
        <div className="summary-chart">
          <h3>Compression timeline</h3>
          <p className="form-help">Green band = target {bpmMin}–{bpmMax} BPM. Green dots = elbows locked, red dots = elbows bent.</p>
          <div style={{ width: '100%', height: 220 }}>
            <ResponsiveContainer>
              <ComposedChart data={timeline} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#dde2ea" />
                <ReferenceArea y1={bpmMin} y2={bpmMax} fill="#1e8a4c" fillOpacity={0.12} />
                <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']} tickFormatter={value => `${Math.round(value)}s`} tick={{ fontSize: 11 }} />
                <YAxis domain={[Math.floor(yMin), Math.ceil(yMax)]} tick={{ fontSize: 11 }} width={40} />
                <Tooltip
                  formatter={(value: number, name: string) => [`${Number(value).toFixed(0)} BPM`, name === 'bpm' ? 'Cadence' : name === 'locked' ? 'Locked' : 'Bent']}
                  labelFormatter={value => `${value}s`}
                />
                <Line type="monotone" dataKey="bpm" stroke="#1f5f99" strokeWidth={2} dot={false} isAnimationActive={false} />
                <Scatter dataKey="locked" fill="#1e8a4c" isAnimationActive={false} />
                <Scatter dataKey="bent" fill="#a81638" isAnimationActive={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {data.avgFps > 0 && data.avgFps < 15 && (
        <p className="form-help">Camera processing averaged {data.avgFps} FPS, which is low; cadence may be less accurate on this computer.</p>
      )}
    </div>
  );
}
