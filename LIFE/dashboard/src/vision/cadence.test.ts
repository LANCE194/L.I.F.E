import { describe, expect, it } from 'vitest';
import { CadenceDetector, classifyBpm, computeBpm, median, refinePeakTime, type CompressionPeak } from './cadence';
import { frameTimes, seededNoise, wristY } from './testUtils';

function run(detector: CadenceDetector, times: number[], y: (t: number) => number): CompressionPeak[] {
  return times.flatMap(t => detector.addSample(y(t), t));
}

describe('helpers', () => {
  it('computes the median of odd and even lists', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('computes BPM from peak timestamps', () => {
    expect(computeBpm([0, 500, 1000, 1500])).toBeCloseTo(120, 6);
    expect(computeBpm([0])).toBeNull();
  });

  it('refines a peak between frames to within a few milliseconds', () => {
    // True maximum of the 110 BPM sine is at 136.36 ms; frames are 33.3 ms apart.
    const y = (t: number) => wristY(t, 110);
    const at = (t: number) => ({ t, y: y(t) });
    const refined = refinePeakTime(at(100), at(133.33), at(166.67));
    expect(Math.abs(refined - 60000 / 110 / 4)).toBeLessThan(3);
    // Flat top: falls back to the sample time.
    expect(refinePeakTime({ t: 0, y: 1 }, { t: 33, y: 1 }, { t: 66, y: 1 })).toBe(33);
  });

  it('classifies cadence with inclusive bounds', () => {
    expect(classifyBpm(99.9)).toBe('Slow');
    expect(classifyBpm(100)).toBe('In Range');
    expect(classifyBpm(120)).toBe('In Range');
    expect(classifyBpm(120.1)).toBe('Fast');
    expect(classifyBpm(95, 90, 110)).toBe('In Range');
  });
});

describe('CadenceDetector on synthetic signals', () => {
  it.each([90, 110, 130])('measures %i BPM within ±2 BPM (30 fps, noisy)', bpm => {
    const noise = seededNoise(bpm);
    const detector = new CadenceDetector();
    const peaks = run(detector, frameTimes(0, 15000, 30), t => wristY(t, bpm) + 0.003 * noise());

    const expectedCount = (15000 / 60000) * bpm;
    expect(peaks.length).toBeGreaterThanOrEqual(Math.floor(expectedCount) - 2);
    expect(peaks.length).toBeLessThanOrEqual(Math.ceil(expectedCount));
    expect(detector.currentBpm()).not.toBeNull();
    expect(Math.abs((detector.currentBpm() as number) - bpm)).toBeLessThanOrEqual(2);
    // Every compression after the first carries a BPM, all close to the true rate.
    for (const peak of peaks.slice(1)) expect(Math.abs((peak.bpm as number) - bpm)).toBeLessThanOrEqual(3);
  });

  it.each([15, 24, 60])('gives the same cadence at %i fps (time-based windows)', fps => {
    const detector = new CadenceDetector();
    run(detector, frameTimes(0, 12000, fps), t => wristY(t, 110));
    expect(Math.abs((detector.currentBpm() as number) - 110)).toBeLessThanOrEqual(2);
  });

  it('marks the first compression of a run as having no BPM', () => {
    const detector = new CadenceDetector();
    const peaks = run(detector, frameTimes(0, 5000, 30), t => wristY(t, 110));
    expect(peaks[0]).toMatchObject({ intervalMs: null, bpm: null });
    expect(peaks[1].bpm).not.toBeNull();
  });

  it('ignores movement smaller than the prominence threshold', () => {
    const detector = new CadenceDetector({ peakProminence: 0.02 });
    const peaks = run(detector, frameTimes(0, 10000, 30), t => wristY(t, 110, 0.005));
    expect(peaks).toHaveLength(0);
  });

  it('does not double-count peaks closer than minPeakDistanceMs', () => {
    const detector = new CadenceDetector({ minPeakDistanceMs: 400 });
    // 200 BPM = 300 ms apart: at most every other peak can be accepted.
    const peaks = run(detector, frameTimes(0, 6000, 60), t => wristY(t, 200));
    for (let i = 1; i < peaks.length; i += 1) {
      expect(peaks[i].timestamp - peaks[i - 1].timestamp).toBeGreaterThanOrEqual(400);
    }
  });

  it('restarts the run after a pause so the first compressions afterwards are not "Slow"', () => {
    const detector = new CadenceDetector({ pauseGapMs: 1500 });
    const before = run(detector, frameTimes(0, 8000, 30), t => wristY(t, 110));
    // 4 s pause (rescue breaths): wrist held still.
    run(detector, frameTimes(8000, 4000, 30), () => 0.6);
    expect(detector.isPaused(12000)).toBe(true);
    const after = run(detector, frameTimes(12000, 6000, 30), t => wristY(t - 12000, 110));

    expect(before.length).toBeGreaterThan(10);
    expect(after[0].bpm).toBeNull(); // new run
    for (const peak of after.slice(1)) {
      expect(classifyBpm(peak.bpm as number)).toBe('In Range');
    }
  });

  it('follows a change of rate within a few compressions (latest-N window)', () => {
    const detector = new CadenceDetector({ bpmWindowIntervals: 4 });
    // 10 s at 90 BPM, then 10 s at 115 BPM with continuous phase.
    const phase90 = (t: number) => (90 * t) / 60000;
    const y = (t: number) => {
      const cycles = t < 10000 ? phase90(t) : phase90(10000) + (115 * (t - 10000)) / 60000;
      return 0.6 + 0.04 * Math.sin(2 * Math.PI * cycles);
    };
    const peaks = run(detector, frameTimes(0, 20000, 30), y);
    const afterChange = peaks.filter(peak => peak.timestamp > 10000);
    // By the 6th compression after the change the BPM reflects the new rate.
    expect(afterChange.length).toBeGreaterThan(8);
    expect(Math.abs((afterChange[5].bpm as number) - 115)).toBeLessThanOrEqual(3);
  });

  it('ignores out-of-order and non-finite samples', () => {
    const detector = new CadenceDetector();
    expect(detector.addSample(0.6, 100)).toEqual([]);
    expect(detector.addSample(0.7, 50)).toEqual([]);
    expect(detector.addSample(Number.NaN, 200)).toEqual([]);
  });
});
