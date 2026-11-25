/**
 * L.I.F.E. Scoring
 * A compression is CORRECT only when the elbow is locked AND the local cadence is in range.
 *
 * Compressions that cannot be judged are UNSCORABLE (reported separately, excluded from the
 * accuracy denominator) instead of silently counting as wrong or right:
 *  - the arm was not visible at the moment of the compression, or
 *  - it was a lone compression with no neighbour to measure cadence from.
 * The first compression of each run is scored retroactively using the interval to the next one,
 * so starting (or restarting after a pause) does not cost the trainee a "Slow" compression.
 */

import { classifyBpm, type BpmClass, type CompressionPeak } from './cadence';
import type { ElbowState } from './angle';

export interface ScoringConfig {
  bpmMin: number;
  bpmMax: number;
}

export interface ScoredCompression {
  timestamp: number;
  bpm: number | null;
  cadence: BpmClass | null;
  elbowVisible: boolean;
  elbowAngle: number | null;
  elbowLocked: boolean;
  scorable: boolean;
  correct: boolean;
  /** Hands stacked at this compression (null = could not be judged). Not part of the score. */
  handsStacked?: boolean | null;
}

export interface ScoreSummary {
  totalCompressions: number;
  scorableCompressions: number;
  correctCompressions: number;
  unscorableCompressions: number;
  accuracyPct: number;
  avgBpm: number | null;
  elbowLockPct: number;
  slowCount: number;
  fastCount: number;
  unlockedCount: number;
}

/** Spec rule: correct iff elbow locked AND bpm within [bpmMin, bpmMax]. */
export function scoreCycle(elbowLocked: boolean, bpm: number | null, bpmMin = 100, bpmMax = 120): boolean {
  return Boolean(elbowLocked && bpm !== null && bpm >= bpmMin && bpm <= bpmMax);
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export class SessionScorer {
  private config: ScoringConfig;
  private scored: ScoredCompression[] = [];
  private pending: { peak: CompressionPeak; elbow: ElbowState | null } | null = null;

  constructor(config: Partial<ScoringConfig> = {}) {
    this.config = { bpmMin: config.bpmMin ?? 100, bpmMax: config.bpmMax ?? 120 };
  }

  private score(timestamp: number, bpm: number | null, elbow: ElbowState | null): ScoredCompression {
    const elbowVisible = Boolean(elbow?.visible);
    const elbowLocked = elbowVisible && Boolean(elbow?.locked);
    const scorable = elbowVisible && bpm !== null;
    const compression: ScoredCompression = {
      timestamp,
      bpm: bpm === null ? null : round1(bpm),
      cadence: bpm === null ? null : classifyBpm(bpm, this.config.bpmMin, this.config.bpmMax),
      elbowVisible,
      elbowAngle: elbowVisible && elbow?.smoothedAngle != null ? round1(elbow.smoothedAngle) : null,
      elbowLocked,
      scorable,
      correct: scorable && scoreCycle(elbowLocked, bpm, this.config.bpmMin, this.config.bpmMax),
    };
    this.scored.push(compression);
    return compression;
  }

  /**
   * Add a detected compression with the elbow state at its timestamp.
   * Returns the compressions scored by this call (0, 1 or 2 because of retroactive scoring).
   */
  add(peak: CompressionPeak, elbow: ElbowState | null): ScoredCompression[] {
    const out: ScoredCompression[] = [];

    if (peak.intervalMs === null) {
      // First compression of a run: wait for the next one to know its cadence.
      if (this.pending) out.push(this.score(this.pending.peak.timestamp, null, this.pending.elbow));
      this.pending = { peak, elbow };
      return out;
    }

    if (this.pending) {
      out.push(this.score(this.pending.peak.timestamp, 60000 / peak.intervalMs, this.pending.elbow));
      this.pending = null;
    }
    out.push(this.score(peak.timestamp, peak.bpm, elbow));
    return out;
  }

  /** Score a still-pending lone compression (call at session end). */
  flush(): ScoredCompression[] {
    if (!this.pending) return [];
    const result = this.score(this.pending.peak.timestamp, null, this.pending.elbow);
    this.pending = null;
    return [result];
  }

  summary(): ScoreSummary {
    const all = this.scored;
    const scorable = all.filter(item => item.scorable);
    const correct = scorable.filter(item => item.correct).length;
    const withBpm = all.filter(item => item.bpm !== null);
    const elbowVisible = all.filter(item => item.elbowVisible);
    const locked = elbowVisible.filter(item => item.elbowLocked).length;
    const pendingCount = this.pending ? 1 : 0;

    return {
      totalCompressions: all.length + pendingCount,
      scorableCompressions: scorable.length,
      correctCompressions: correct,
      unscorableCompressions: all.length - scorable.length,
      accuracyPct: scorable.length ? round1((correct / scorable.length) * 100) : 0,
      avgBpm: withBpm.length ? round1(withBpm.reduce((sum, item) => sum + (item.bpm as number), 0) / withBpm.length) : null,
      elbowLockPct: elbowVisible.length ? round1((locked / elbowVisible.length) * 100) : 0,
      slowCount: scorable.filter(item => item.cadence === 'Slow').length,
      fastCount: scorable.filter(item => item.cadence === 'Fast').length,
      unlockedCount: scorable.filter(item => !item.elbowLocked).length,
    };
  }

  compressions(): ScoredCompression[] {
    return [...this.scored];
  }

  /** The last `count` scorable compressions (newest last), for coaching. */
  recentScorable(count: number): ScoredCompression[] {
    return this.scored.filter(item => item.scorable).slice(-count);
  }

  setConfig(config: Partial<ScoringConfig>): void {
    this.config = { ...this.config, ...config };
  }

  reset(): void {
    this.scored = [];
    this.pending = null;
  }
}
