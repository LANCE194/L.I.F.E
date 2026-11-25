/**
 * L.I.F.E. Feedback Panel
 * Live metrics during a session. All targets come from Settings, not hard-coded values.
 */

import type { SessionMetrics } from '../api/types';
import { formatDuration } from '../utils/format';
import { WarningIcon } from './icons';
import './FeedbackOverlay.css';

export type SessionPhase = 'Setup' | 'Ready' | 'Countdown' | 'In Progress' | 'Completed';

export interface FeedbackTargets {
  bpmMin: number;
  bpmMax: number;
  angleThreshold: number;
  passMark: number;
}

interface FeedbackOverlayProps {
  metrics: SessionMetrics;
  phase: SessionPhase;
  durationSec: number;
  targets: FeedbackTargets;
}

export function FeedbackOverlay({ metrics, phase, durationSec, targets }: FeedbackOverlayProps) {
  const { bpmMin, bpmMax, angleThreshold, passMark } = targets;
  const elapsedSec = metrics.elapsedSec;
  const progress = durationSec > 0 ? Math.min((elapsedSec / durationSec) * 100, 100) : 0;
  const remainingSec = Math.max(durationSec - elapsedSec, 0);
  const bpm = metrics.currentBpm;
  const scored = metrics.totalCompressions - metrics.unscorableCompressions;
  // Elbow lock % only exists once a compression happened with the elbow in view.
  const elbowJudged = metrics.totalCompressions > metrics.unscorableCompressions;

  const bpmState = bpm === null ? 'none' : bpm < bpmMin ? 'slow' : bpm > bpmMax ? 'fast' : 'ok';
  const bpmLabel = { none: 'Waiting for compressions', slow: 'Too slow', fast: 'Too fast', ok: 'In range' }[bpmState];
  const tone = (value: number, good: number) => (value >= good ? 'success' : value >= good - 20 ? 'warning' : 'danger');

  const statusClass = phase === 'In Progress' ? 'status-in-progress' : phase === 'Completed' ? 'status-completed' : 'status-waiting';

  return (
    <div className="feedback-panel">
      <div className={`status-header ${statusClass}`}>
        <span className="status-badge">{phase}</span>
      </div>

      <div className="feedback-metric timer-metric">
        <div className="feedback-metric-row">
          <span className="feedback-label">Time Remaining</span>
          <span className="feedback-value large timer-value">{formatDuration(remainingSec)}</span>
        </div>
        <div className="progress-bar" role="progressbar" aria-label="Session progress" aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
          <div className="progress-fill info" style={{ width: `${progress}%` }} />
        </div>
        <div className="feedback-metric-row">
          <span className="feedback-label">Elapsed</span>
          <span className="feedback-value">{formatDuration(elapsedSec)} / {formatDuration(durationSec)}</span>
        </div>
      </div>

      <div className="feedback-metric bpm-metric">
        <div className="feedback-metric-row">
          <span className="feedback-label">Cadence now (BPM)</span>
          <span className={`feedback-value large bpm-${bpmState}`}>{bpm === null ? '—' : Math.round(bpm)}</span>
        </div>
        <div className="feedback-metric-row">
          <span className={`feedback-label bpm-status ${bpmState}`}>{bpmLabel}</span>
          <span className="feedback-label">Target {bpmMin}–{bpmMax}</span>
        </div>
      </div>

      <div className="feedback-metric accuracy-metric">
        <div className="feedback-metric-row">
          <span className="feedback-label">Accuracy</span>
          {scored > 0
            ? <span className={`feedback-value large text-${tone(metrics.accuracyPct, passMark)}`}>{metrics.accuracyPct.toFixed(1)}%</span>
            : <span className="feedback-value large text-muted" title="Shown after the first scored compression">—</span>}
        </div>
        <div className="progress-bar">
          {scored > 0 && <div className={`progress-fill ${tone(metrics.accuracyPct, passMark)}`} style={{ width: `${Math.min(metrics.accuracyPct, 100)}%` }} />}
        </div>
        <div className="feedback-metric-row">
          <span className="feedback-label">{metrics.correctCompressions} of {scored} scored compressions correct</span>
          <span className="feedback-label">Pass ≥ {passMark}%</span>
        </div>
      </div>

      <div className="feedback-metric elbow-metric">
        <div className="feedback-metric-row">
          <span className="feedback-label">Elbow lock</span>
          {elbowJudged
            ? <span className={`feedback-value large text-${tone(metrics.elbowLockPct, 80)}`}>{metrics.elbowLockPct.toFixed(1)}%</span>
            : <span className="feedback-value large text-muted" title="Shown after the first compression with the elbow visible">—</span>}
        </div>
        <div className="progress-bar">
          {elbowJudged && <div className={`progress-fill ${tone(metrics.elbowLockPct, 80)}`} style={{ width: `${Math.min(metrics.elbowLockPct, 100)}%` }} />}
        </div>
        <div className="feedback-metric-row">
          <span className="feedback-label">Locked = angle ≥ {angleThreshold}°</span>
        </div>
      </div>

      <div className="feedback-metric count-metric">
        <div className="feedback-metric-row">
          <span className="feedback-label">Compressions</span>
          <span className="feedback-value large">{metrics.totalCompressions}</span>
        </div>
        <div className="compression-breakdown">
          <div className="breakdown-item correct">
            <span className="breakdown-label">Correct</span>
            <span className="breakdown-value">{metrics.correctCompressions}</span>
          </div>
          <div className="breakdown-item incorrect">
            <span className="breakdown-label">Incorrect</span>
            <span className="breakdown-value">{scored - metrics.correctCompressions}</span>
          </div>
          <div className="breakdown-item unscorable" title="The arm was not visible, so the compression could not be judged">
            <span className="breakdown-label">Not visible</span>
            <span className="breakdown-value">{metrics.unscorableCompressions}</span>
          </div>
        </div>
      </div>

      {phase === 'In Progress' && metrics.totalCompressions >= 10 && metrics.unscorableCompressions / metrics.totalCompressions > 0.3 && (
        <div className="warning-banner">
          <WarningIcon />
          <span>Many compressions could not be judged. Move the camera so the shoulder, elbow and wrist stay visible.</span>
        </div>
      )}
    </div>
  );
}

export default FeedbackOverlay;
