import { describe, expect, it } from 'vitest';
import { breathPromptOverdue, canTick, compressionsInCycle, compressionsPastCycle, compressionsPerCycle, currentStep, cyclesPerTwoMinutes, evaluateProcedure, initialCycle, restartCycle, tickInOrder, updateCycle, type CycleState } from './flow';
import { EMPTY_PROCEDURE_STEPS } from './protocol';

/** Feed compressions at 110 BPM (545 ms apart), sampling every 100 ms like the UI does. */
function compress(state: CycleState, from: number, count: number, startTime: number, mode: 'breaths' | 'hands-only' = 'breaths') {
  let s = state;
  let t = startTime;
  for (let i = 1; i <= count; i += 1) {
    t += 545;
    s = updateCycle(s, from + i, t, mode);
  }
  return { state: s, time: t, total: from + count };
}

describe('30:2 cycle', () => {
  it('prompts for 2 breaths after 30 compressions', () => {
    const { state, total } = compress(initialCycle(), 0, 29, 0);
    expect(state.promptAt).toBeNull();
    expect(compressionsInCycle(state, total)).toBe(29);
    const after = updateCycle(state, 30, 20000, 'breaths');
    expect(after.promptAt).toBe(20000);
    expect(compressionsInCycle(after, 30)).toBe(30);
  });

  it('counts a completed cycle when compressions resume after a breath pause', () => {
    let { state, time } = compress(initialCycle(), 0, 30, 0);
    expect(state.promptAt).not.toBeNull();
    time += 4000; // two breaths
    state = updateCycle(state, 31, time, 'breaths');
    expect(state.completedCycles).toBe(1);
    expect(state.promptAt).toBeNull();
    expect(compressionsInCycle(state, 31)).toBe(1); // the resumed compression starts cycle 2
  });

  it('treats breaths as skipped when compressions continue without a pause', () => {
    let { state, time } = compress(initialCycle(), 0, 30, 0);
    ({ state, time } = compress(state, 30, 10, time));
    expect(state.skippedBreaths).toBe(1);
    expect(state.completedCycles).toBe(0);
    expect(state.promptAt).toBeNull();
  });

  it('flags a breath pause longer than 10 seconds', () => {
    const { state, time } = compress(initialCycle(), 0, 30, 0);
    expect(breathPromptOverdue(state, time + 5000)).toBe(false);
    expect(breathPromptOverdue(state, time + 10500)).toBe(true);
  });

  it('never prompts in hands-only mode', () => {
    const { state } = compress(initialCycle(), 0, 60, 0, 'hands-only');
    expect(state.promptAt).toBeNull();
    expect(state.completedCycles).toBe(0);
  });

  it('restarts the cycle after the AED pause', () => {
    const { state, total, time } = compress(initialCycle(), 0, 18, 0);
    const restarted = restartCycle(state, total, time + 30000);
    expect(compressionsInCycle(restarted, total)).toBe(0);
  });
});

describe('ratio by victim and rescuers', () => {
  it('matches the ratio table', () => {
    expect(compressionsPerCycle('adult', 1)).toBe(30);
    expect(compressionsPerCycle('adult', 2)).toBe(30);
    expect(compressionsPerCycle('child', 1)).toBe(30);
    expect(compressionsPerCycle('child', 2)).toBe(15);
    expect(compressionsPerCycle('infant', 1)).toBe(30);
    expect(compressionsPerCycle('infant', 2)).toBe(15);
  });

  it('targets about 5 cycles of 30:2 (10 of 15:2) in 2 minutes', () => {
    expect(cyclesPerTwoMinutes(30)).toBe(5);
    expect(cyclesPerTwoMinutes(15)).toBe(10);
  });

  it('prompts for breaths after 15 compressions in 15:2', () => {
    let state = initialCycle();
    let t = 0;
    for (let i = 1; i <= 14; i += 1) { t += 545; state = updateCycle(state, i, t, 'breaths', 15); }
    expect(state.promptAt).toBeNull();
    state = updateCycle(state, 15, t + 545, 'breaths', 15);
    expect(state.promptAt).not.toBeNull();
    expect(compressionsInCycle(state, 15, 15)).toBe(15);
  });

  it('5 cycles of 30:2 at 110 per minute with 4 s breaths take about 2 minutes', () => {
    let state = initialCycle();
    let t = 0;
    let total = 0;
    while (state.completedCycles < 5) {
      total += 1; t += 545; state = updateCycle(state, total, t, 'breaths');
      if (state.promptAt !== null && state.promptCount === total) t += 4000; // two breaths
    }
    expect(t / 1000).toBeGreaterThan(95);
    expect(t / 1000).toBeLessThan(125);
  });
});

describe('currentStep', () => {
  const base = { phase: 'Ready' as const, steps: { ...EMPTY_PROCEDURE_STEPS }, breathPrompt: false, aedActive: false };

  it('walks through the steps before compressions', () => {
    expect(currentStep(base)).toBe(0);
    const checked = { ...base.steps, scene_safe: true, response_checked: true, breathing_checked: true };
    expect(currentStep({ ...base, steps: checked })).toBe(1);
    expect(currentStep({ ...base, steps: { ...checked, emergency_services_called: true } })).toBe(2);
  });

  it('follows compressions, breaths and the AED during the session', () => {
    const live = { ...base, phase: 'In Progress' as const };
    expect(currentStep(live)).toBe(2);
    expect(currentStep({ ...live, breathPrompt: true })).toBe(3);
    expect(currentStep({ ...live, breathPrompt: true, aedActive: true })).toBe(4);
    expect(currentStep({ ...live, phase: 'Completed' })).toBe(5);
  });
});

describe('proper order', () => {
  it('allows the pre-compression steps only in order', () => {
    let steps = { ...EMPTY_PROCEDURE_STEPS };
    expect(canTick(steps, 'response_checked')).toBe(false);
    expect(tickInOrder(steps, 'breathing_checked', true)).toEqual(steps); // out of order: ignored
    steps = tickInOrder(steps, 'scene_safe', true);
    steps = tickInOrder(steps, 'response_checked', true);
    steps = tickInOrder(steps, 'breathing_checked', true);
    steps = tickInOrder(steps, 'emergency_services_called', true);
    expect(steps.emergency_services_called).toBe(true);
  });

  it('unticking an earlier step clears the later ones', () => {
    let steps = { ...EMPTY_PROCEDURE_STEPS, scene_safe: true, response_checked: true, breathing_checked: true, emergency_services_called: true };
    steps = tickInOrder(steps, 'response_checked', false);
    expect(steps).toMatchObject({ scene_safe: true, response_checked: false, breathing_checked: false, emergency_services_called: false });
  });

  it('counts compressions done past the end of the cycle', () => {
    const { state } = compress(initialCycle(), 0, 30, 0);
    expect(compressionsPastCycle(state, 30)).toBe(0);
    expect(compressionsPastCycle(state, 33)).toBe(3);
  });

  it('counts pauses longer than 10 seconds', () => {
    let { state, time } = compress(initialCycle(), 0, 30, 0);
    state = updateCycle(state, 31, time + 12000, 'breaths');
    expect(state.longPauses).toBe(1);
    expect(state.completedCycles).toBe(1);
    let hands = compress(initialCycle(), 0, 20, 0, 'hands-only');
    hands = { ...hands, state: updateCycle(hands.state, 21, hands.time + 11000, 'hands-only') };
    expect(hands.state.longPauses).toBe(1);
  });
});

describe('evaluateProcedure', () => {
  const allSteps = { ...EMPTY_PROCEDURE_STEPS, scene_safe: true, response_checked: true, breathing_checked: true, emergency_services_called: true, cpr_started: true, cpr_continued: true };

  it('scores a correctly performed 2-minute 30:2 session as 100%', () => {
    const cycle = { ...initialCycle(), completedCycles: 5 };
    const result = evaluateProcedure({ steps: allSteps, mode: 'breaths', perCycle: 30, cycle, totalCompressions: 150, elapsedSec: 120, aedUsed: false, handsStackedPct: 92 });
    expect(result.pct).toBe(100);
    expect(result.items.every(item => item.ok)).toBe(true);
  });

  it('flags skipped steps, skipped breaths, too few cycles, long pauses and hands apart', () => {
    const cycle = { ...initialCycle(), completedCycles: 2, skippedBreaths: 1, longPauses: 1 };
    const steps = { ...allSteps, scene_safe: false, emergency_services_called: false };
    const result = evaluateProcedure({ steps, mode: 'breaths', perCycle: 30, cycle, totalCompressions: 120, elapsedSec: 120, aedUsed: false, handsStackedPct: 40 });
    const failed = result.items.filter(item => !item.ok).map(item => item.label);
    expect(failed).toEqual(expect.arrayContaining([
      'Checked that the scene is safe',
      'Called 911 and sent for an AED before compressions',
      'Hands stacked on the chest',
      'Gave 2 breaths after every 30 compressions',
      'Completed about 5 cycles in 2 minutes',
      'Kept every pause under 10 seconds',
    ]));
    expect(result.pct).toBeLessThan(50);
  });

  it('leaves out items that do not apply', () => {
    const result = evaluateProcedure({ steps: allSteps, mode: 'hands-only', perCycle: 30, cycle: initialCycle(), totalCompressions: 200, elapsedSec: 120, aedUsed: false, handsStackedPct: null });
    expect(result.items.some(item => item.label.startsWith('Hands stacked'))).toBe(false);
    expect(result.items.some(item => item.label.startsWith('Used the AED'))).toBe(false);
    expect(result.pct).toBe(100);
  });
});
