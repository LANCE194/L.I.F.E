/**
 * L.I.F.E. Elbow Angle
 * Shoulder–elbow–wrist angle with moving-average smoothing and lock detection.
 *
 * Accuracy rules:
 *  - When the arm is not visible, the elbow is reported as NOT visible (never as "locked"),
 *    and the smoothing buffer is cleared after a short gap so stale angles are not reused.
 *  - A short history of per-frame states lets the scorer read the elbow state at the exact
 *    moment of each compression peak instead of when the peak was detected.
 */

import type { Landmark } from '../api/types';

export type ArmSide = 'left' | 'right';

export const ARM_LANDMARKS: Record<ArmSide, { shoulder: number; elbow: number; wrist: number }> = {
  left: { shoulder: 11, elbow: 13, wrist: 15 },
  right: { shoulder: 12, elbow: 14, wrist: 16 },
};

export interface AngleConfig {
  threshold: number;          // degrees at/above which the elbow counts as locked (default 160)
  smoothingWindow: number;    // moving-average window in frames (default 5)
  visibilityThreshold: number;
  gapResetMs: number;         // clear smoothing after the arm is invisible this long
}

export interface ElbowState {
  timestamp: number;
  visible: boolean;
  rawAngle: number | null;
  smoothedAngle: number | null;
  locked: boolean;
}

/**
 * Angle ABC at point B in degrees, or null for degenerate input.
 */
export function calcAngle(a: Pick<Landmark, 'x' | 'y'>, b: Pick<Landmark, 'x' | 'y'>, c: Pick<Landmark, 'x' | 'y'>): number | null {
  const baX = a.x - b.x;
  const baY = a.y - b.y;
  const bcX = c.x - b.x;
  const bcY = c.y - b.y;

  const magBA = Math.hypot(baX, baY);
  const magBC = Math.hypot(bcX, bcY);
  if (magBA === 0 || magBC === 0 || !Number.isFinite(magBA) || !Number.isFinite(magBC)) return null;

  const cosine = Math.max(-1, Math.min(1, (baX * bcX + baY * bcY) / (magBA * magBC)));
  return (Math.acos(cosine) * 180) / Math.PI;
}

/** Raw elbow angle for one arm, or null if any of its three landmarks is not visible enough. */
export function getElbowAngle(landmarks: Landmark[], side: ArmSide, visibilityThreshold = 0.5): number | null {
  const indices = ARM_LANDMARKS[side];
  const shoulder = landmarks[indices.shoulder];
  const elbow = landmarks[indices.elbow];
  const wrist = landmarks[indices.wrist];
  if (!shoulder || !elbow || !wrist) return null;
  if ((shoulder.visibility ?? 0) < visibilityThreshold ||
      (elbow.visibility ?? 0) < visibilityThreshold ||
      (wrist.visibility ?? 0) < visibilityThreshold) {
    return null;
  }
  return calcAngle(shoulder, elbow, wrist);
}

/** Mean visibility of an arm's shoulder, elbow and wrist (0..1). */
export function armVisibility(landmarks: Landmark[], side: ArmSide): number {
  const indices = ARM_LANDMARKS[side];
  return (
    (landmarks[indices.shoulder]?.visibility ?? 0) +
    (landmarks[indices.elbow]?.visibility ?? 0) +
    (landmarks[indices.wrist]?.visibility ?? 0)
  ) / 3;
}

const HISTORY_MS = 2000;

export class ElbowDetector {
  private config: AngleConfig;
  private window: number[] = [];
  private lastVisibleAt: number | null = null;
  private history: ElbowState[] = [];

  constructor(config: Partial<AngleConfig> = {}) {
    this.config = {
      threshold: config.threshold ?? 160,
      smoothingWindow: config.smoothingWindow ?? 5,
      visibilityThreshold: config.visibilityThreshold ?? 0.5,
      gapResetMs: config.gapResetMs ?? 300,
    };
  }

  process(landmarks: Landmark[] | null, side: ArmSide, timestamp: number): ElbowState {
    const rawAngle = landmarks ? getElbowAngle(landmarks, side, this.config.visibilityThreshold) : null;
    let state: ElbowState;

    if (rawAngle === null) {
      if (this.lastVisibleAt === null || timestamp - this.lastVisibleAt > this.config.gapResetMs) {
        this.window = [];
      }
      state = { timestamp, visible: false, rawAngle: null, smoothedAngle: null, locked: false };
    } else {
      this.lastVisibleAt = timestamp;
      this.window.push(rawAngle);
      while (this.window.length > Math.max(1, Math.round(this.config.smoothingWindow))) this.window.shift();
      const smoothedAngle = this.window.reduce((sum, value) => sum + value, 0) / this.window.length;
      state = {
        timestamp,
        visible: true,
        rawAngle,
        smoothedAngle,
        locked: smoothedAngle >= this.config.threshold,
      };
    }

    this.history.push(state);
    while (this.history.length > 0 && timestamp - this.history[0].timestamp > HISTORY_MS) this.history.shift();
    return state;
  }

  /** Per-frame state closest to `timestamp` (within maxDistanceMs), or null. */
  stateAt(timestamp: number, maxDistanceMs = 150): ElbowState | null {
    let best: ElbowState | null = null;
    let bestDistance = Infinity;
    for (const state of this.history) {
      const distance = Math.abs(state.timestamp - timestamp);
      if (distance < bestDistance) {
        best = state;
        bestDistance = distance;
      }
    }
    return best && bestDistance <= maxDistanceMs ? best : null;
  }

  setConfig(config: Partial<AngleConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): AngleConfig {
    return { ...this.config };
  }

  reset(): void {
    this.window = [];
    this.history = [];
    this.lastVisibleAt = null;
  }
}
