/**
 * Physical model of a trainee seen by a laptop webcam, used to calibrate the default
 * detection settings (not used by the app itself).
 *
 * - Typical 720p laptop webcam: vertical field of view about 42 degrees, so the frame is
 *   0.77 x distance metres tall.
 * - During a compression the wrists and shoulders move down by the compression depth.
 * - Upper arm + forearm about 55 cm; a bent arm is modelled at an exact elbow angle.
 * - MediaPipe landmark jitter is modelled as Gaussian noise (fraction of the frame).
 */

import type { Landmark } from '../api/types';
import { SessionPipeline, type PipelineConfig } from './pipeline';

export const VERTICAL_FOV_DEG = 42;
const ARM_LENGTH_M = 0.55;

export function frameHeightM(distanceM: number): number {
  return 2 * distanceM * Math.tan((VERTICAL_FOV_DEG / 2) * (Math.PI / 180));
}

/** Seeded Gaussian noise (Box-Muller over a linear congruential generator). */
export function gaussian(seed: number): () => number {
  let state = seed >>> 0 || 1;
  const uniform = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return (state + 0.5) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(uniform())) * Math.cos(2 * Math.PI * uniform());
}

export interface TraineeScenario {
  distanceM: number;     // camera to trainee
  depthCm: number;       // compression depth (0 = no compressions)
  bpm: number;
  elbowDeg: number;      // 180 = straight
  noise: number;         // landmark jitter, fraction of frame height
  fps: number;
  durationS: number;
  swayAmplitude?: number; // slow body sway (fraction of frame), e.g. while standing still
  seed?: number;
}

/** Left-arm pose (side view) at time t for the scenario; the other arm is mostly hidden. */
export function scenarioPose(s: TraineeScenario, tMs: number, rand: () => number): Landmark[] {
  const frameH = frameHeightM(s.distanceM);
  const half = (s.depthCm / 100) / frameH / 2;
  const push = s.depthCm > 0 ? half * Math.sin((2 * Math.PI * s.bpm * tMs) / 60000) : 0;
  const sway = (s.swayAmplitude ?? 0) * Math.sin((2 * Math.PI * 0.3 * tMs) / 1000);
  const theta = (s.elbowDeg * Math.PI) / 180;
  const armSpan = (ARM_LENGTH_M * Math.sin(theta / 2)) / frameH;          // shoulder-wrist distance
  const elbowOffset = ((ARM_LENGTH_M / 2) * Math.cos(theta / 2)) / frameH; // sideways bend
  const wristY = 0.7 + push + sway;
  const n = () => rand() * s.noise;

  const pose: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.05 }));
  const set = (i: number, x: number, y: number, v = 0.95) => { pose[i] = { x: x + n(), y: y + n(), z: 0, visibility: v }; };
  set(11, 0.5, wristY - armSpan);                       // left shoulder
  set(13, 0.5 + elbowOffset, wristY - armSpan / 2);     // left elbow
  set(15, 0.5, wristY);                                 // left wrist
  set(23, 0.35, wristY - armSpan + 0.25 / frameH * 1.2 + sway); // left hip (torso visible)
  set(12, 0.48, wristY - armSpan, 0.3);                 // right shoulder, mostly hidden
  set(24, 0.34, wristY - armSpan + 0.3, 0.3);
  return pose;
}

export interface ScenarioResult {
  expected: number;
  detected: number;
  recall: number;
  bpmMae: number | null;
  lockedShare: number | null; // share of visible compressions classified as locked
}

export function runScenario(s: TraineeScenario, config: Partial<PipelineConfig> = {}): ScenarioResult {
  const pipeline = new SessionPipeline(config);
  const rand = gaussian(s.seed ?? 7);
  const step = 1000 / s.fps;
  let t = 0;
  for (; t < 1500; t += step) pipeline.processFrame({ landmarks: scenarioPose(s, t, rand), timestamp: t, inferenceMs: 10 });
  pipeline.startScoring();
  const end = t + s.durationS * 1000;
  for (; t < end; t += step) pipeline.processFrame({ landmarks: scenarioPose(s, t, rand), timestamp: t, inferenceMs: 10 });
  pipeline.stopScoring();

  const compressions = pipeline.compressions();
  const expected = s.depthCm > 0 ? Math.floor((s.bpm * s.durationS) / 60) : 0;
  const withBpm = compressions.filter(c => c.bpm !== null);
  const visible = compressions.filter(c => c.elbowVisible);
  return {
    expected,
    detected: compressions.length,
    recall: expected ? Math.min(1, compressions.length / expected) : compressions.length === 0 ? 1 : 0,
    bpmMae: withBpm.length ? withBpm.reduce((sum, c) => sum + Math.abs((c.bpm as number) - s.bpm), 0) / withBpm.length : null,
    lockedShare: visible.length ? visible.filter(c => c.elbowLocked).length / visible.length : null,
  };
}
