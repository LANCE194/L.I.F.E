import { describe, expect, it } from 'vitest';
import { SessionScorer, scoreCycle } from './scoring';
import type { ElbowState } from './angle';
import type { CompressionPeak } from './cadence';

const locked: ElbowState = { timestamp: 0, visible: true, rawAngle: 170, smoothedAngle: 170, locked: true };
const bent: ElbowState = { timestamp: 0, visible: true, rawAngle: 130, smoothedAngle: 130, locked: false };
const hidden: ElbowState = { timestamp: 0, visible: false, rawAngle: null, smoothedAngle: null, locked: false };

/** Peaks `intervalMs` apart; the first of the run has no interval or BPM. */
function peaks(count: number, intervalMs: number, start = 0): CompressionPeak[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: start + i * intervalMs,
    intervalMs: i === 0 ? null : intervalMs,
    bpm: i === 0 ? null : 60000 / intervalMs,
  }));
}

describe('scoreCycle', () => {
  it('requires a locked elbow AND an in-range BPM', () => {
    expect(scoreCycle(true, 110)).toBe(true);
    expect(scoreCycle(true, 100)).toBe(true);
    expect(scoreCycle(true, 120)).toBe(true);
    expect(scoreCycle(false, 110)).toBe(false);
    expect(scoreCycle(true, 99)).toBe(false);
    expect(scoreCycle(true, 121)).toBe(false);
    expect(scoreCycle(true, null)).toBe(false);
    expect(scoreCycle(true, 95, 90, 110)).toBe(true);
  });
});

describe('SessionScorer', () => {
  it('scores a clean run at 110 BPM as 100% (first compression scored retroactively)', () => {
    const scorer = new SessionScorer();
    for (const peak of peaks(10, 545)) scorer.add(peak, locked);
    const summary = scorer.summary();
    expect(summary).toMatchObject({ totalCompressions: 10, scorableCompressions: 10, correctCompressions: 10, accuracyPct: 100, elbowLockPct: 100 });
    expect(scorer.compressions()[0].bpm).toBeCloseTo(110.1, 1);
  });

  it('holds the first compression until the next one arrives', () => {
    const scorer = new SessionScorer();
    const [first, second] = peaks(2, 545);
    expect(scorer.add(first, locked)).toHaveLength(0);
    expect(scorer.add(second, locked)).toHaveLength(2);
  });

  it('counts compressions with a hidden elbow as unscorable, not wrong and not locked', () => {
    const scorer = new SessionScorer();
    const run = peaks(6, 545);
    run.forEach((peak, i) => scorer.add(peak, i < 3 ? locked : hidden));
    const summary = scorer.summary();
    expect(summary.unscorableCompressions).toBe(3);
    expect(summary.scorableCompressions).toBe(3);
    expect(summary.accuracyPct).toBe(100);
    expect(summary.elbowLockPct).toBe(100); // hidden elbows are excluded from the lock percentage
    expect(scorer.compressions().slice(3).every(c => !c.elbowLocked && c.elbowAngle === null)).toBe(true);
  });

  it('marks bent elbows and slow or fast cadence as incorrect', () => {
    const scorer = new SessionScorer();
    for (const peak of peaks(5, 545)) scorer.add(peak, bent);        // in range, bent
    for (const peak of peaks(5, 750, 10000)) scorer.add(peak, locked); // 80 BPM
    for (const peak of peaks(5, 400, 20000)) scorer.add(peak, locked); // 150 BPM
    const summary = scorer.summary();
    expect(summary.correctCompressions).toBe(0);
    expect(summary.unlockedCount).toBe(5);
    expect(summary.slowCount).toBe(5);
    expect(summary.fastCount).toBe(5);
    expect(summary.accuracyPct).toBe(0);
  });

  it('scores a lone compression as unscorable when flushed at session end', () => {
    const scorer = new SessionScorer();
    scorer.add(peaks(1, 545)[0], locked);
    expect(scorer.summary().totalCompressions).toBe(1);
    const [lone] = scorer.flush();
    expect(lone).toMatchObject({ scorable: false, bpm: null });
    expect(scorer.summary()).toMatchObject({ totalCompressions: 1, scorableCompressions: 0, accuracyPct: 0 });
  });

  it('uses the configured BPM range', () => {
    const scorer = new SessionScorer({ bpmMin: 70, bpmMax: 90 });
    for (const peak of peaks(4, 750)) scorer.add(peak, locked); // 80 BPM
    expect(scorer.summary().accuracyPct).toBe(100);
  });
});
