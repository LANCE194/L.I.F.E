/**
 * Step-by-step CPR flow for the Live Session (AHA 2025 adult sequence).
 * Pure functions so the 30:2 cycle and step logic can be unit-tested.
 */

import type { ProcedureSteps } from '../api/types';

export type CprMode = 'breaths' | 'hands-only';

export const COMPRESSIONS_PER_CYCLE = 30;

export type Victim = 'adult' | 'child' | 'infant';
export type Rescuers = 1 | 2;

/**
 * Compressions per cycle (always followed by 2 breaths):
 *   adult 30:2 with 1 or 2 rescuers; child and infant 30:2 with 1 rescuer, 15:2 with 2 rescuers.
 */
export function compressionsPerCycle(victim: Victim, rescuers: Rescuers): number {
  return victim !== 'adult' && rescuers === 2 ? 15 : 30;
}

/** About how many cycles fit in the 2 minutes before checking the person / switching rescuers. */
export function cyclesPerTwoMinutes(perCycle: number): number {
  return perCycle === 15 ? 10 : 5;
}
export const BREATHS_PER_CYCLE = 2;
/** A pause at least this long before compressions resume counts as the breaths being given. */
export const BREATH_PAUSE_MIN_MS = 1500;
/** AHA: keep interruptions short; after this the prompt asks to resume. */
export const BREATH_PAUSE_MAX_MS = 10_000;
/** Compressions past 30 without a pause: treat the breaths as skipped and start a new cycle. */
const SKIP_AFTER_EXTRA = 10;

export interface CycleState {
  cycleStart: number;          // total compressions when the current cycle began
  completedCycles: number;     // 30:2 cycles with a breath pause
  skippedBreaths: number;      // cycles where compressions continued without the breath pause
  longPauses: number;          // interruptions longer than 10 s before compressions resumed
  promptAt: number | null;     // time the "Give 2 breaths" prompt appeared
  promptCount: number;         // total compressions when it appeared
  lastTotal: number;
  lastChangeAt: number;        // time the compression count last increased
}

export const initialCycle = (now = 0): CycleState => ({
  cycleStart: 0, completedCycles: 0, skippedBreaths: 0, longPauses: 0, promptAt: null, promptCount: 0, lastTotal: 0, lastChangeAt: now,
});

/** Advance the 30:2 cycle from the latest compression count (call ~10 times per second). */
export function updateCycle(state: CycleState, total: number, now: number, mode: CprMode, perCycle = COMPRESSIONS_PER_CYCLE): CycleState {
  if (total <= state.lastTotal && mode === 'hands-only') return state;
  // Any interruption longer than 10 s (breaths, AED, hesitation) before compressions resume.
  const resumedAfterLongPause = total > state.lastTotal && state.lastTotal > 0 && now - state.lastChangeAt > BREATH_PAUSE_MAX_MS;

  if (mode === 'hands-only') {
    return { ...state, lastTotal: total, lastChangeAt: now, promptAt: null, longPauses: state.longPauses + (resumedAfterLongPause ? 1 : 0) };
  }

  let next = state;
  if (total > state.lastTotal) {
    const gap = now - state.lastChangeAt;
    next = { ...state, lastTotal: total, lastChangeAt: now, longPauses: state.longPauses + (resumedAfterLongPause ? 1 : 0) };
    if (state.promptAt !== null) {
      if (gap >= BREATH_PAUSE_MIN_MS) {
        // Compressions resumed after the breath pause: the new compression starts the next cycle.
        next = { ...next, completedCycles: state.completedCycles + 1, cycleStart: total - 1, promptAt: null };
      } else if (total - state.promptCount >= SKIP_AFTER_EXTRA) {
        next = { ...next, skippedBreaths: state.skippedBreaths + 1, cycleStart: total, promptAt: null };
      }
    }
  }

  if (next.promptAt === null && total - next.cycleStart >= perCycle) {
    next = { ...next, promptAt: now, promptCount: total };
  }
  return next;
}

/** Restart counting a cycle (e.g. after the AED pause); the 10 s resume limit counts from `now`. */
export function restartCycle(state: CycleState, total: number, now: number): CycleState {
  return { ...state, cycleStart: total, promptAt: null, lastTotal: total, lastChangeAt: now };
}

/** Compressions done past the end of the cycle while the breath prompt is showing. */
export function compressionsPastCycle(state: CycleState, total: number): number {
  return state.promptAt === null ? 0 : Math.max(0, total - state.promptCount);
}

export function compressionsInCycle(state: CycleState, total: number, perCycle = COMPRESSIONS_PER_CYCLE): number {
  return Math.min(perCycle, Math.max(0, total - state.cycleStart));
}

export function breathPromptOverdue(state: CycleState, now: number): boolean {
  return state.promptAt !== null && now - state.promptAt > BREATH_PAUSE_MAX_MS;
}

// ---------------- Steps ----------------

export type FlowPhase = 'Setup' | 'Ready' | 'Countdown' | 'In Progress' | 'Completed';

export interface FlowInput {
  phase: FlowPhase;
  steps: ProcedureSteps;
  breathPrompt: boolean;
  aedActive: boolean;
}

/** Index (0–5) of the step the trainee should be doing now. */
export function currentStep({ phase, steps, breathPrompt, aedActive }: FlowInput): number {
  if (phase === 'Completed') return 5;
  if (phase === 'In Progress' || phase === 'Countdown') {
    if (aedActive) return 4;
    if (breathPrompt) return 3;
    return 2;
  }
  if (!(steps.scene_safe && steps.response_checked && steps.breathing_checked)) return 0;
  if (!steps.emergency_services_called) return 1;
  return 2;
}

/** Steps confirmed before compressions, in the order they must be done. */
export const PRE_COMPRESSION_ORDER: (keyof ProcedureSteps)[] = ['scene_safe', 'response_checked', 'breathing_checked', 'emergency_services_called'];

export function preCompressionStepsDone(steps: ProcedureSteps): boolean {
  return PRE_COMPRESSION_ORDER.every(key => steps[key]);
}

/** A pre-compression item can be ticked only after every item before it. */
export function canTick(steps: ProcedureSteps, key: keyof ProcedureSteps): boolean {
  const index = PRE_COMPRESSION_ORDER.indexOf(key);
  return index <= 0 || PRE_COMPRESSION_ORDER.slice(0, index).every(previous => steps[previous]);
}

/** Tick or untick in order: unticking an item also unticks every item after it. */
export function tickInOrder(steps: ProcedureSteps, key: keyof ProcedureSteps, value: boolean): ProcedureSteps {
  const index = PRE_COMPRESSION_ORDER.indexOf(key);
  if (index < 0) return { ...steps, [key]: value };
  if (value) return canTick(steps, key) ? { ...steps, [key]: true } : steps;
  const next = { ...steps };
  for (const later of PRE_COMPRESSION_ORDER.slice(index)) next[later] = false;
  return next;
}

// ---------------- Procedure evaluation ----------------

export interface ProcedureItem {
  label: string;
  ok: boolean;
  detail?: string;
}

export interface ProcedureEvaluation {
  items: ProcedureItem[];
  followed: number;
  total: number;
  pct: number;
}

export interface ProcedureInput {
  steps: ProcedureSteps;
  mode: CprMode;
  perCycle: number;
  cycle: CycleState;
  totalCompressions: number;
  elapsedSec: number;
  aedUsed: boolean;
  handsStackedPct: number | null;
}

/** Hands count as correctly placed when stacked on at least this share of compressions. */
export const HANDS_STACKED_TARGET_PCT = 70;

/**
 * How closely the session followed the adult CPR procedure. Reported separately from the
 * compression accuracy score; items that do not apply (e.g. no AED arrived) are left out.
 */
export function evaluateProcedure(input: ProcedureInput): ProcedureEvaluation {
  const { steps, mode, perCycle, cycle, totalCompressions, elapsedSec, handsStackedPct } = input;
  const items: ProcedureItem[] = [
    { label: 'Checked that the scene is safe', ok: steps.scene_safe },
    { label: 'Checked responsiveness (tap and shout)', ok: steps.response_checked },
    { label: 'Checked breathing', ok: steps.breathing_checked },
    { label: 'Called 911 and sent for an AED before compressions', ok: steps.emergency_services_called },
    { label: 'Started chest compressions', ok: steps.cpr_started && totalCompressions > 0 },
  ];

  if (handsStackedPct !== null) {
    items.push({
      label: 'Hands stacked on the chest',
      ok: handsStackedPct >= HANDS_STACKED_TARGET_PCT,
      detail: `${handsStackedPct.toFixed(0)}% of compressions (target ${HANDS_STACKED_TARGET_PCT}%)`,
    });
  }

  if (mode === 'breaths') {
    const expected = cyclesPerTwoMinutes(perCycle) * Math.min(1, elapsedSec / 120);
    const minimum = Math.max(1, Math.floor(expected) - 1);
    items.push({
      label: `Gave 2 breaths after every ${perCycle} compressions`,
      ok: cycle.completedCycles >= 1 && cycle.skippedBreaths === 0,
      detail: `${cycle.completedCycles} cycle(s) completed${cycle.skippedBreaths ? `, breaths skipped ${cycle.skippedBreaths}×` : ''}`,
    });
    items.push({
      label: `Completed about ${cyclesPerTwoMinutes(perCycle)} cycles in 2 minutes`,
      ok: cycle.completedCycles >= minimum,
      detail: `${cycle.completedCycles} of about ${Math.round(expected)} expected for ${elapsedSec} s`,
    });
  } else {
    items.push({ label: 'Continuous compressions (hands-only)', ok: totalCompressions > 0 && cycle.longPauses === 0 });
  }

  items.push({
    label: 'Kept every pause under 10 seconds',
    ok: cycle.longPauses === 0,
    detail: cycle.longPauses ? `${cycle.longPauses} pause(s) longer than 10 s` : undefined,
  });

  if (input.aedUsed) {
    items.push({ label: 'Used the AED in order and resumed CPR', ok: steps.aed_used && cycle.longPauses === 0 });
  }

  const followed = items.filter(item => item.ok).length;
  return { items, followed, total: items.length, pct: items.length ? Math.round((followed / items.length) * 1000) / 10 : 0 };
}

// ---------------- AED ----------------

export const AED_STEPS = [
  'Turn the AED on',
  'Remove clothing covering the chest and attach the pads',
  'Stand clear while the AED analyses the heart rhythm',
] as const;

export type AedOutcome = 'shock' | 'no-shock';
