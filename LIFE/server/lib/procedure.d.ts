// Types for procedure.js (used by the dashboard parity test).
export const HANDS_STACKED_TARGET_PCT: number;
export const PROCEDURE_ITEMS: [string, string][];
export function procedureItems(session: {
  procedure_steps?: Record<string, boolean>;
  counts?: Record<string, number>;
  duration_sec?: number;
  total_compressions?: number;
}): Record<string, boolean | null>;
export function missedItems(session: Parameters<typeof procedureItems>[0]): string[];
