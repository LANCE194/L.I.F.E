/**
 * Calibration of the default detection settings on a physical model of a trainee seen by a
 * laptop webcam (calibrationModel.ts). These tests lock in the operating envelope so that a
 * change to the defaults cannot silently reduce detection quality.
 *
 * Operating envelope (what the guide asks for): camera 1.5-2.5 m away, side view, 20-30 fps,
 * compressions 4-6 cm deep at 90-130 per minute, landmark jitter up to 0.6% of the frame.
 *
 * Results that informed the defaults (5 seeds x 20 s, jitter 0.6%):
 *   peak prominence 0.02 (old):  2.5 m / 4 cm detected 39-56%; 15 fps detected 47%.
 *   peak prominence 0.012 + 70 ms smoothing (new): 94-100% at 20-30 fps; 78-91% at 15 fps;
 *   false compressions while standing still: 0-1 per 100 s.
 */

import { describe, expect, it } from 'vitest';
import { runScenario, type TraineeScenario } from './calibrationModel';
import { DEFAULT_PIPELINE_CONFIG } from './pipeline';
import { SMOOTHING_HALF_WINDOW_MS } from './cadence';
import { DEFAULT_SETTINGS } from '../utils/settingsSchema';

const base: TraineeScenario = { distanceM: 2, depthCm: 5, bpm: 110, elbowDeg: 175, noise: 0.006, fps: 30, durationS: 20 };
const seeds = [1, 2, 3];
const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;
const run = (overrides: Partial<TraineeScenario>) => seeds.map(seed => runScenario({ ...base, ...overrides, seed }));

describe('calibrated defaults', () => {
  it('are the same in the app, the settings page and the pipeline', () => {
    expect(DEFAULT_PIPELINE_CONFIG.peakProminence).toBe(0.012);
    expect(DEFAULT_SETTINGS.peak_prominence).toBe(0.012);
    expect(SMOOTHING_HALF_WINDOW_MS).toBe(70);
    expect(DEFAULT_SETTINGS.angle_threshold).toBe(DEFAULT_PIPELINE_CONFIG.angleThreshold);
    expect(DEFAULT_SETTINGS.smoothing_window).toBe(DEFAULT_PIPELINE_CONFIG.smoothingWindow);
    expect(DEFAULT_SETTINGS.min_peak_distance_ms).toBe(DEFAULT_PIPELINE_CONFIG.minPeakDistanceMs);
  });
});

describe('compression detection in the operating envelope', () => {
  it.each([
    [1.5, 4], [1.5, 6], [2, 4], [2, 5], [2.5, 4], [2.5, 5], [2.5, 6],
  ])('detects >= 93%% at %s m with %s cm compressions (20 and 30 fps)', (distanceM, depthCm) => {
    for (const fps of [20, 30]) {
      expect(average(run({ distanceM, depthCm, fps }).map(r => r.recall))).toBeGreaterThanOrEqual(0.93);
    }
  });

  it.each([90, 100, 110, 120, 130])('measures %s per minute within 3 per minute on average', bpm => {
    for (const fps of [20, 30]) {
      const results = run({ bpm, fps, noise: 0.004 });
      expect(average(results.map(r => r.recall))).toBeGreaterThanOrEqual(0.95);
      expect(average(results.map(r => r.bpmMae as number))).toBeLessThanOrEqual(3);
    }
  });

  it('still detects most compressions on a slow 15 fps camera', () => {
    expect(average(run({ fps: 15, distanceM: 2, depthCm: 5 }).map(r => r.recall))).toBeGreaterThanOrEqual(0.85);
  });

  it('does not invent compressions while the trainee is still (jitter and sway)', () => {
    for (const fps of [15, 20, 30]) {
      const falseAlarms = run({ depthCm: 0, fps, noise: 0.006, swayAmplitude: 0.01 }).reduce((sum, r) => sum + r.detected, 0);
      expect(falseAlarms).toBeLessThanOrEqual(1); // over 60 s
    }
  });
});

describe('elbow lock classification (threshold 160 degrees, smoothing 5 frames)', () => {
  // Measured: 10 or more degrees from the threshold is classified correctly >= 97% of the time;
  // 5 degrees away >= 94% (camera jitter); within 2-3 degrees it is ambiguous (2D camera limit).
  it.each([[180, 0.97], [172, 0.97], [165, 0.94]])('classifies %s degrees as locked (>= %s)', (elbowDeg, minimum) => {
    for (const distanceM of [2, 2.5]) {
      expect(average(run({ elbowDeg, distanceM }).map(r => r.lockedShare as number))).toBeGreaterThanOrEqual(minimum);
    }
  });

  it.each([[155, 0.06], [150, 0.03], [140, 0.03]])('classifies %s degrees as bent (locked <= %s)', (elbowDeg, maximum) => {
    for (const distanceM of [2, 2.5]) {
      expect(average(run({ elbowDeg, distanceM }).map(r => r.lockedShare as number))).toBeLessThanOrEqual(maximum);
    }
  });
});
