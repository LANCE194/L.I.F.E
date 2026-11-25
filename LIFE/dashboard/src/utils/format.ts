/**
 * Shared date/number formatting. The API returns timestamps as ISO-8601 UTC ("...Z"),
 * so `new Date()` converts them to the viewer's local time correctly.
 */

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  // Plain "YYYY-MM-DD" values are calendar days (already local); parse them as local dates.
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatShortDay(value: string): string {
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00`) : new Date(value);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDuration(totalSeconds: number | null | undefined): string {
  const seconds = Math.max(0, Math.round(totalSeconds || 0));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function formatNumber(value: number | null | undefined, decimals = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  return value.toFixed(decimals);
}

export function accuracyClass(accuracy: number, passMark = 80): 'success' | 'warning' | 'danger' {
  if (accuracy >= passMark) return 'success';
  if (accuracy >= passMark - 20) return 'warning';
  return 'danger';
}

/** Start of a local calendar day ("YYYY-MM-DD" from an <input type="date">) as an ISO instant. */
export function localDayStartIso(day: string): string | undefined {
  if (!day) return undefined;
  return new Date(`${day}T00:00:00`).toISOString();
}

/** Exclusive end of a local calendar day: midnight at the start of the next day, as an ISO instant. */
export function localDayEndIso(day: string): string | undefined {
  if (!day) return undefined;
  const date = new Date(`${day}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return date.toISOString();
}

/** Today's local date as "YYYY-MM-DD". */
export function todayLocal(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
