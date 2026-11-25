/**
 * Calibration settings: labels, allowed ranges and defaults.
 * Single source of truth for the dashboard; must match SETTING_RULES in
 * server/routes/settings.js (the server enforces the same ranges).
 */

import type { Settings } from '../api/types';

export type SettingKey = keyof Settings;

export interface FieldSpec {
  key: SettingKey;
  label: string;
  min: number;
  max: number;
  step: number;
  integer?: boolean;
  defaultValue: number;
  help: string;
}

export const SETTING_GROUPS: { title: string; description: string; fields: FieldSpec[] }[] = [
  {
    title: 'Pose detection',
    description: 'Elbow angle and landmark visibility',
    fields: [
      { key: 'angle_threshold', label: 'Elbow lock threshold (°)', min: 120, max: 180, step: 1, defaultValue: 160, help: 'An elbow at or above this angle counts as locked.' },
      { key: 'smoothing_window', label: 'Smoothing window (frames)', min: 1, max: 20, step: 1, integer: true, defaultValue: 5, help: 'Moving-average window for the elbow angle.' },
      { key: 'visibility_threshold', label: 'Visibility threshold', min: 0.1, max: 1, step: 0.05, defaultValue: 0.5, help: 'Landmarks less visible than this are ignored.' },
    ],
  },
  {
    title: 'Cadence detection',
    description: 'Compression detection and the target rate',
    fields: [
      { key: 'min_peak_distance_ms', label: 'Min time between compressions (ms)', min: 200, max: 1000, step: 10, integer: true, defaultValue: 400, help: 'Peaks closer together than this are merged.' },
      { key: 'peak_prominence', label: 'Peak prominence', min: 0.002, max: 0.2, step: 0.001, defaultValue: 0.02, help: 'Minimum wrist movement (fraction of frame height) that counts as a compression.' },
      { key: 'bpm_window_intervals', label: 'BPM from last N compressions', min: 2, max: 10, step: 1, integer: true, defaultValue: 4, help: 'How many recent intervals the live BPM uses. Lower reacts faster; higher is steadier.' },
      { key: 'bpm_min', label: 'Target rate: min BPM', min: 60, max: 120, step: 1, integer: true, defaultValue: 100, help: 'Lower bound of the "In range" cadence.' },
      { key: 'bpm_max', label: 'Target rate: max BPM', min: 100, max: 160, step: 1, integer: true, defaultValue: 120, help: 'Upper bound of the "In range" cadence.' },
    ],
  },
  {
    title: 'Session',
    description: 'Timer, pass mark and metronome',
    fields: [
      { key: 'session_duration_sec', label: 'Session length (seconds)', min: 30, max: 600, step: 10, integer: true, defaultValue: 120, help: 'Length of the session timer.' },
      { key: 'pass_mark_pct', label: 'Pass mark (%)', min: 50, max: 100, step: 1, defaultValue: 80, help: 'Minimum accuracy for a "Pass".' },
      { key: 'metronome_bpm', label: 'Metronome speed (BPM)', min: 80, max: 140, step: 1, integer: true, defaultValue: 110, help: 'Click rate when the metronome is turned on during a session.' },
    ],
  },
  {
    title: 'Camera',
    description: 'Requested webcam capture (the camera may pick the nearest supported mode)',
    fields: [
      { key: 'camera_width', label: 'Width (px)', min: 320, max: 1920, step: 1, integer: true, defaultValue: 1280, help: 'Requested capture width.' },
      { key: 'camera_height', label: 'Height (px)', min: 240, max: 1080, step: 1, integer: true, defaultValue: 720, help: 'Requested capture height.' },
      { key: 'camera_framerate', label: 'Frame rate (FPS)', min: 15, max: 60, step: 1, integer: true, defaultValue: 30, help: 'Requested frames per second.' },
    ],
  },
];

export const ALL_FIELDS = SETTING_GROUPS.flatMap(group => group.fields);

export function rangeError(field: FieldSpec, value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return 'Enter a number.';
  if (field.integer && !Number.isInteger(value)) return 'Enter a whole number.';
  if (value < field.min || value > field.max) return `Must be between ${field.min} and ${field.max}.`;
  return '';
}

export function parseInput(text: string): number | undefined {
  if (text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

/** Default value of every setting. */
export const DEFAULT_SETTINGS = Object.fromEntries(ALL_FIELDS.map(field => [field.key, field.defaultValue])) as unknown as Settings;

export interface SanitizedSettings {
  settings: Settings;
  /** Human-readable notes for stored values that were out of range and replaced by defaults. */
  corrections: string[];
}

/**
 * Settings safe to run a session with: missing values get defaults, and stored values outside
 * the allowed range (e.g. from an older version or a manual database edit) are replaced by the
 * default instead of being used as-is.
 */
export function sanitizeSettings(stored: Partial<Settings> | null | undefined): SanitizedSettings {
  const settings = { ...DEFAULT_SETTINGS };
  const corrections: string[] = [];
  for (const field of ALL_FIELDS) {
    const value = stored?.[field.key];
    if (value === undefined || value === null) continue;
    const number = Number(value);
    if (rangeError(field, number)) {
      corrections.push(`${field.label}: saved value ${value} is outside ${field.min}–${field.max}, using ${field.defaultValue}`);
    } else {
      settings[field.key] = number;
    }
  }
  if (settings.bpm_min >= settings.bpm_max) {
    corrections.push(`Target rate: min ${settings.bpm_min} is not below max ${settings.bpm_max}, using ${DEFAULT_SETTINGS.bpm_min}–${DEFAULT_SETTINGS.bpm_max}`);
    settings.bpm_min = DEFAULT_SETTINGS.bpm_min;
    settings.bpm_max = DEFAULT_SETTINGS.bpm_max;
  }
  return { settings, corrections };
}
