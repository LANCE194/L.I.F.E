import { describe, expect, it } from 'vitest';
import { SessionPipeline } from './pipeline';
import { chooseCue, Coach, CUES } from './coach';
import { armPose, frameTimes, wristY } from './testUtils';
import type { ArmSide } from './angle';

const FPS = 30;

function feed(
  pipeline: SessionPipeline,
  startMs: number,
  durationMs: number,
  options: { side?: ArmSide; bpm?: number; bent?: boolean; visibility?: number; otherArmVisibility?: number; noPerson?: boolean } = {}
) {
  const { side = 'left', bpm = 110, bent = false, visibility, otherArmVisibility, noPerson = false } = options;
  for (const t of frameTimes(startMs, durationMs, FPS)) {
    const landmarks = noPerson ? null : armPose(side, wristY(t, bpm), { bent, visibility, otherArmVisibility });
    pipeline.processFrame({ landmarks, timestamp: t, inferenceMs: 12 });
  }
}

describe('SessionPipeline (end to end on synthetic poses)', () => {
  it('becomes ready to start after the arm has been visible for 1 s', () => {
    const pipeline = new SessionPipeline();
    feed(pipeline, 0, 500, { bpm: 0 });
    expect(pipeline.snapshot().readyToStart).toBe(false);
    feed(pipeline, 500, 700, { bpm: 0 });
    expect(pipeline.snapshot()).toMatchObject({ readyToStart: true, side: 'left', armVisible: true });
  });

  it('scores locked-elbow compressions at 110 BPM as ~100% accurate', () => {
    const pipeline = new SessionPipeline();
    feed(pipeline, 0, 1500, { bpm: 0 });
    pipeline.startScoring();
    feed(pipeline, 1500, 20000);
    pipeline.stopScoring();

    const summary = pipeline.summary();
    expect(summary.totalCompressions).toBeGreaterThanOrEqual(34); // ~36 expected in 20 s
    expect(summary.accuracyPct).toBeGreaterThanOrEqual(95);
    expect(summary.elbowLockPct).toBe(100);
    expect(Math.abs((summary.avgBpm as number) - 110)).toBeLessThanOrEqual(2);
    expect(pipeline.snapshot().cue.kind).toBe('good');
  });

  it('scores bent-elbow compressions as incorrect and coaches "Lock your elbows"', () => {
    const pipeline = new SessionPipeline();
    feed(pipeline, 0, 1500, { bpm: 0, bent: true });
    pipeline.startScoring();
    feed(pipeline, 1500, 10000, { bent: true });

    const summary = pipeline.summary();
    expect(summary.totalCompressions).toBeGreaterThan(10);
    expect(summary.accuracyPct).toBe(0);
    expect(summary.elbowLockPct).toBe(0);
    expect(pipeline.snapshot().cue).toEqual(CUES.elbows);
  });

  it('coaches "Push faster" at 85 BPM', () => {
    const pipeline = new SessionPipeline();
    feed(pipeline, 0, 1500, { bpm: 0 });
    pipeline.startScoring();
    feed(pipeline, 1500, 10000, { bpm: 85 });
    expect(pipeline.snapshot().cue).toEqual(CUES.faster);
    expect(pipeline.summary().slowCount).toBeGreaterThan(5);
  });

  it('keeps the locked arm when the other arm briefly looks more visible', () => {
    const pipeline = new SessionPipeline();
    feed(pipeline, 0, 1500, { bpm: 0, side: 'left' });
    pipeline.startScoring();
    expect(pipeline.snapshot().side).toBe('left');
    // 500 ms where the right arm is clearer but the left is still visible enough.
    feed(pipeline, 1500, 500, { side: 'left', visibility: 0.6, otherArmVisibility: 0.99 });
    expect(pipeline.snapshot().side).toBe('left');
  });

  it('reports frame rate and inference latency for the session', () => {
    const pipeline = new SessionPipeline();
    feed(pipeline, 0, 1500, { bpm: 0 });
    pipeline.startScoring();
    feed(pipeline, 1500, 5000);
    const quality = pipeline.sessionQuality();
    expect(quality.avgFps).toBeCloseTo(30, 0);
    expect(quality.avgLatencyMs).toBe(12);
    expect(quality.framesWithPerson).toBe(quality.totalFrames);
  });

  it('counts frames without a person (used to reject invalid sessions)', () => {
    const pipeline = new SessionPipeline();
    pipeline.startScoring();
    feed(pipeline, 0, 3000, { noPerson: true });
    const quality = pipeline.sessionQuality();
    expect(quality.framesWithPerson).toBe(0);
    expect(pipeline.summary().totalCompressions).toBe(0);
    expect(pipeline.snapshot().cue).toEqual(CUES.position);
  });
});

describe('hand position', () => {
  it('records whether the hands were stacked at each compression', () => {
    const pipeline = new SessionPipeline();
    const stacked = { handCount: 2, stacked: true, source: 'hands' as const, hands: [] };
    const apart = { handCount: 2, stacked: false, source: 'hands' as const, hands: [] };
    const run = (start: number, duration: number, hands: typeof stacked) => {
      for (const t of frameTimes(start, duration, FPS)) {
        pipeline.processFrame({ landmarks: armPose('left', wristY(t, 110)), timestamp: t, inferenceMs: 12, hands });
      }
    };
    run(0, 1500, stacked);
    pipeline.startScoring();
    run(1500, 10000, stacked);
    run(11500, 10000, apart);
    const snapshot = pipeline.snapshot();
    expect(snapshot.hands.stacked).toBe(false);
    const pct = pipeline.handsStackedPct() as number;
    expect(pct).toBeGreaterThan(35);
    expect(pct).toBeLessThan(65);
    expect(pipeline.compressions().every(c => c.handsStacked === true || c.handsStacked === false)).toBe(true);
  });

  it('reports no hand percentage when hands were never judged', () => {
    const pipeline = new SessionPipeline();
    pipeline.startScoring();
    for (const t of frameTimes(0, 5000, FPS)) pipeline.processFrame({ landmarks: armPose('left', wristY(t, 110)), timestamp: t, inferenceMs: 12 });
    expect(pipeline.handsStackedPct()).toBeNull();
  });
});

describe('Coach', () => {
  const base = { personVisible: true, armVisible: true, paused: false, recent: [], currentBpm: 110, bpmMin: 100, bpmMax: 120 };

  it('prioritises position, then arm visibility, then pauses', () => {
    expect(chooseCue({ ...base, personVisible: false })).toEqual(CUES.position);
    expect(chooseCue({ ...base, armVisible: false })).toEqual(CUES.arm);
    expect(chooseCue({ ...base, paused: true })).toEqual(CUES.begin);
    const earlier = [{ timestamp: 0, bpm: 110, cadence: 'In Range' as const, elbowVisible: true, elbowAngle: 170, elbowLocked: true, scorable: true, correct: true }];
    expect(chooseCue({ ...base, paused: true, recent: earlier })).toEqual(CUES.resume);
    expect(chooseCue({ ...base, currentBpm: 90 })).toEqual(CUES.faster);
    expect(chooseCue({ ...base, currentBpm: 130 })).toEqual(CUES.slower);
    expect(chooseCue(base)).toEqual(CUES.good);
  });

  it('debounces cue changes', () => {
    const coach = new Coach(1500);
    expect(coach.update(base, 0).kind).toBe('good');
    expect(coach.update({ ...base, currentBpm: 90 }, 500).kind).toBe('good'); // too soon
    expect(coach.update({ ...base, currentBpm: 90 }, 1600).kind).toBe('faster');
  });
});
