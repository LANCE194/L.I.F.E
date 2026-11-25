import { describe, expect, it } from 'vitest';
import { ALL_FIELDS, DEFAULT_SETTINGS, sanitizeSettings } from './settingsSchema';

describe('sanitizeSettings', () => {
  it('fills missing values with defaults', () => {
    const { settings, corrections } = sanitizeSettings({});
    expect(settings).toEqual(DEFAULT_SETTINGS);
    expect(settings.session_duration_sec).toBe(120);
    expect(corrections).toEqual([]);
  });

  it('keeps valid stored values', () => {
    const { settings, corrections } = sanitizeSettings({ session_duration_sec: 90, angle_threshold: 150 });
    expect(settings.session_duration_sec).toBe(90);
    expect(settings.angle_threshold).toBe(150);
    expect(corrections).toEqual([]);
  });

  it('replaces out-of-range values with the default and reports them', () => {
    const { settings, corrections } = sanitizeSettings({ session_duration_sec: 100000, smoothing_window: 2.5 });
    expect(settings.session_duration_sec).toBe(120);
    expect(settings.smoothing_window).toBe(5); // must be a whole number
    expect(corrections).toHaveLength(2);
    expect(corrections.some(note => note.includes('100000'))).toBe(true);
  });

  it('resets an inverted BPM range', () => {
    const { settings, corrections } = sanitizeSettings({ bpm_min: 115, bpm_max: 110 });
    expect([settings.bpm_min, settings.bpm_max]).toEqual([100, 120]);
    expect(corrections).toHaveLength(1);
  });

  it('defines a default inside every range', () => {
    for (const field of ALL_FIELDS) {
      expect(field.defaultValue).toBeGreaterThanOrEqual(field.min);
      expect(field.defaultValue).toBeLessThanOrEqual(field.max);
    }
  });
});
