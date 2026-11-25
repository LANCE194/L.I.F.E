import { describe, expect, it } from 'vitest';
import { ElbowDetector, armVisibility, calcAngle, getElbowAngle } from './angle';
import { armPose } from './testUtils';

describe('calcAngle', () => {
  it('returns 90° for a right angle', () => {
    expect(calcAngle({ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(90, 6);
  });

  it('returns 180° for a straight line', () => {
    expect(calcAngle({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 })).toBeCloseTo(180, 6);
  });

  it('returns 45° and is symmetric in its outer points', () => {
    const a = { x: 1, y: 0 };
    const b = { x: 0, y: 0 };
    const c = { x: 1, y: 1 };
    expect(calcAngle(a, b, c)).toBeCloseTo(45, 6);
    expect(calcAngle(c, b, a)).toBeCloseTo(45, 6);
  });

  it('returns null when a point coincides with the vertex', () => {
    expect(calcAngle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
    expect(calcAngle({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBeNull();
  });

  it('returns null for non-finite input', () => {
    expect(calcAngle({ x: Number.NaN, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });
});

describe('getElbowAngle', () => {
  it('measures a straight arm as ~180° and a bent arm as ~113°', () => {
    expect(getElbowAngle(armPose('left', 0.6), 'left')).toBeCloseTo(180, 3);
    expect(getElbowAngle(armPose('left', 0.6, { bent: true }), 'left')).toBeCloseTo(112.6, 1);
  });

  it('returns null when any arm landmark is below the visibility threshold', () => {
    const pose = armPose('right', 0.6, { visibility: 0.4 });
    expect(getElbowAngle(pose, 'right', 0.5)).toBeNull();
    expect(getElbowAngle(pose, 'right', 0.3)).not.toBeNull();
  });

  it('reports arm visibility as the mean of shoulder, elbow and wrist', () => {
    expect(armVisibility(armPose('left', 0.6, { visibility: 0.9 }), 'left')).toBeCloseTo(0.9, 6);
  });
});

describe('ElbowDetector', () => {
  it('never reports a hidden elbow as locked', () => {
    const detector = new ElbowDetector({ threshold: 160 });
    for (let t = 0; t < 200; t += 33) expect(detector.process(armPose('left', 0.6), 'left', t).locked).toBe(true);
    const hidden = detector.process(armPose('left', 0.6, { visibility: 0.1 }), 'left', 233);
    expect(hidden).toMatchObject({ visible: false, locked: false, smoothedAngle: null });
    expect(detector.process(null, 'left', 266).locked).toBe(false);
  });

  it('clears the smoothing window after a visibility gap longer than gapResetMs', () => {
    const detector = new ElbowDetector({ smoothingWindow: 5, gapResetMs: 300 });
    for (let t = 0; t <= 132; t += 33) detector.process(armPose('left', 0.6), 'left', t); // ~180°
    detector.process(null, 'left', 300);
    detector.process(null, 'left', 500); // 368 ms since last visible -> reset
    const after = detector.process(armPose('left', 0.6, { bent: true }), 'left', 533);
    expect(after.smoothedAngle).toBeCloseTo(112.6, 1); // not averaged with the stale 180° values
  });

  it('keeps the smoothing window across a brief dropout', () => {
    const detector = new ElbowDetector({ smoothingWindow: 5, gapResetMs: 300 });
    for (let t = 0; t <= 132; t += 33) detector.process(armPose('left', 0.6), 'left', t);
    detector.process(null, 'left', 165);
    const after = detector.process(armPose('left', 0.6, { bent: true }), 'left', 198);
    // Window now holds four ~180° values and one ~112.6° value.
    expect(after.smoothedAngle).toBeCloseTo((4 * 180 + 112.6) / 5, 0);
  });

  it('applies the configured lock threshold', () => {
    const detector = new ElbowDetector({ threshold: 110, smoothingWindow: 1 });
    expect(detector.process(armPose('left', 0.6, { bent: true }), 'left', 0).locked).toBe(true);
    detector.setConfig({ threshold: 120 });
    expect(detector.process(armPose('left', 0.6, { bent: true }), 'left', 33).locked).toBe(false);
  });

  it('looks up the frame state nearest a timestamp', () => {
    const detector = new ElbowDetector({ smoothingWindow: 1 });
    detector.process(armPose('left', 0.6), 'left', 1000);
    detector.process(armPose('left', 0.6, { bent: true }), 'left', 1033);
    detector.process(armPose('left', 0.6), 'left', 1066);
    expect(detector.stateAt(1030)?.locked).toBe(false);
    expect(detector.stateAt(1070)?.locked).toBe(true);
    expect(detector.stateAt(2000)).toBeNull(); // too far from any frame
  });
});
