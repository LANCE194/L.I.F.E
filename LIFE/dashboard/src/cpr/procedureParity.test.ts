/**
 * The server rebuilds each saved session's procedure checklist for the exports
 * (server/lib/procedure.js). It must agree with what the app showed the trainee
 * (evaluateProcedure), item by item, for every kind of session.
 */
import { describe, expect, it } from 'vitest';
import { evaluateProcedure, initialCycle, type CprMode } from './flow';
import type { ProcedureSteps } from '../api/types';
import { PROCEDURE_ITEMS, procedureItems } from '../../../server/lib/procedure.js';

function random(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

describe('procedure checklist: server export matches the app', () => {
  it('gives the same items and score for 2000 random sessions', () => {
    const rand = random(7);
    const pick = <T,>(values: T[]) => values[Math.floor(rand() * values.length)];
    for (let i = 0; i < 2000; i += 1) {
      const steps: ProcedureSteps = {
        scene_safe: rand() < 0.8, response_checked: rand() < 0.8, breathing_checked: rand() < 0.8,
        emergency_services_called: rand() < 0.8, cpr_started: rand() < 0.9, cpr_continued: rand() < 0.5, aed_used: rand() < 0.3,
      };
      const mode: CprMode = rand() < 0.7 ? 'breaths' : 'hands-only';
      const perCycle = pick([30, 15]);
      const totalCompressions = pick([0, 12, 90, 214, 240]);
      const elapsedSec = pick([20, 60, 95, 120]);
      const cycle = { ...initialCycle(), completedCycles: pick([0, 1, 3, 4, 5, 9, 10]), skippedBreaths: pick([0, 0, 1, 2]), longPauses: pick([0, 0, 1]) };
      const handsStackedPct = rand() < 0.2 ? null : Math.round(rand() * 100);
      const stepsSaved = { ...steps, cpr_started: steps.cpr_started || totalCompressions > 0 };

      const app = evaluateProcedure({ steps: stepsSaved, mode, perCycle, cycle, totalCompressions, elapsedSec, aedUsed: steps.aed_used, handsStackedPct });

      // What LiveSessionPage saves for this session.
      const server = procedureItems({
        procedure_steps: stepsSaved,
        duration_sec: elapsedSec,
        total_compressions: totalCompressions,
        counts: {
          hands_only: mode === 'hands-only' ? 1 : 0,
          compressions_per_cycle: perCycle,
          breath_cycles: cycle.completedCycles,
          skipped_breaths: cycle.skippedBreaths,
          long_pauses: cycle.longPauses,
          ...(handsStackedPct !== null ? { hands_stacked_pct: handsStackedPct } : {}),
        },
      });
      const serverList = PROCEDURE_ITEMS.map(([key]) => server[key]).filter((value): value is boolean => value !== null);

      expect(serverList).toEqual(app.items.map(item => item.ok));
      const pct = Math.round((serverList.filter(Boolean).length / serverList.length) * 1000) / 10;
      expect(pct).toBe(app.pct);
    }
  });
});
