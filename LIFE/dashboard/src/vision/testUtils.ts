/**
 * Synthetic data for vision unit tests (not used by the app).
 */

import type { Landmark } from '../api/types';
import { ARM_LANDMARKS, type ArmSide } from './angle';

/** Deterministic pseudo-random numbers in [-1, 1] so noisy tests are repeatable. */
export function seededNoise(seed = 1): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return (state / 0xffffffff) * 2 - 1;
  };
}

/**
 * Wrist height for compressions at `bpm`: y = base + amplitude * sin(...).
 * Image y grows downward, so each maximum is the bottom of a compression.
 */
export function wristY(timeMs: number, bpm: number, amplitude = 0.04, base = 0.6): number {
  return base + amplitude * Math.sin((2 * Math.PI * bpm * timeMs) / 60000);
}

/** Feed samples at `fps` for `durationMs`, starting at `startMs`; returns frame timestamps. */
export function frameTimes(startMs: number, durationMs: number, fps: number): number[] {
  const step = 1000 / fps;
  const times: number[] = [];
  for (let t = startMs; t < startMs + durationMs; t += step) times.push(Math.round(t * 1000) / 1000);
  return times;
}

function blankPose(): Landmark[] {
  return Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
}

/**
 * A pose with one visible arm whose wrist is at height `wrist`. `bent` moves the elbow sideways,
 * giving an elbow angle of about 113° instead of 180°.
 */
export function armPose(side: ArmSide, wrist: number, { bent = false, visibility = 0.95, otherArmVisibility = 0.1 } = {}): Landmark[] {
  const pose = blankPose();
  const offset = wrist - 0.6; // the whole arm moves with the compression
  const arm = ARM_LANDMARKS[side];
  const other = ARM_LANDMARKS[side === 'left' ? 'right' : 'left'];
  pose[arm.shoulder] = { x: 0.5, y: 0.3 + offset, z: 0, visibility };
  pose[arm.elbow] = { x: bent ? 0.6 : 0.5, y: 0.45 + offset, z: 0, visibility };
  pose[arm.wrist] = { x: 0.5, y: wrist, z: 0, visibility };
  for (const index of [other.shoulder, other.elbow, other.wrist]) {
    pose[index] = { x: 0.4, y: 0.45, z: 0, visibility: otherArmVisibility };
  }
  return pose;
}
