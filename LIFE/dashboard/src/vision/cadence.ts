/**
 * L.I.F.E. Cadence Detection
 * Timestamped wrist-height signal -> compression peaks -> local BPM.
 *
 * Design (replaces scipy.signal.find_peaks; validated with synthetic signals in tests):
 *  - Image y grows downward, so the bottom of each compression is a local MAXIMUM of y.
 *  - A candidate peak is decided only once a full prominence window (default ±300 ms) of data
 *    exists on both sides, so each decision is final and peaks are never re-scored.
 *  - Prominence and spacing are measured in milliseconds, not samples, so results do not
 *    depend on the camera frame rate.
 *  - BPM uses the median of the latest N intervals (default 4), so it reflects what the
 *    trainee is doing now and ignores a single missed/extra peak.
 *  - A gap longer than `pauseGapMs` (e.g. rescue breaths) starts a new run instead of dragging
 *    the BPM down for the next several seconds.
 */

export interface CadenceConfig {
  bufferDurationMs: number;
  minPeakDistanceMs: number;
  peakProminence: number;      // in normalized image units (fraction of frame height)
  prominenceWindowMs: number;
  bpmWindowIntervals: number;
  pauseGapMs: number;
  bpmMin: number;
  bpmMax: number;
}

export interface CompressionPeak {
  timestamp: number;
  /** Time since the previous compression in the same run, or null for the first of a run. */
  intervalMs: number | null;
  /** Local cadence including this compression, or null if it is the first of a run. */
  bpm: number | null;
}

export type BpmClass = 'Slow' | 'In Range' | 'Fast';

export interface Sample {
  t: number;
  y: number;
}

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** BPM from peak timestamps (mean interval) — kept for reference/tests. */
export function computeBpm(peakTimestamps: number[]): number | null {
  if (peakTimestamps.length < 2) return null;
  const intervals = peakTimestamps.slice(1).map((t, i) => (t - peakTimestamps[i]) / 1000);
  const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  return mean > 0 ? 60 / mean : null;
}

/**
 * Sub-frame peak time: vertex of the parabola through three samples around a local maximum.
 * Without this, peak times snap to whole frames (33 ms at 30 fps), which alone puts a single
 * BPM reading off by up to ~3 BPM at 110 BPM. The result stays between the outer samples.
 */
export function refinePeakTime(prev: Sample, peak: Sample, next: Sample): number {
  const t0 = prev.t - peak.t;
  const t2 = next.t - peak.t;
  const d0 = prev.y - peak.y;
  const d2 = next.y - peak.y;
  // Fit y - peak.y = a*u^2 + b*u through (t0, d0), (0, 0), (t2, d2), with u = t - peak.t.
  const denominator = t0 * t2 * (t0 - t2);
  if (denominator === 0) return peak.t;
  const a = (d0 * t2 - d2 * t0) / denominator;
  const b = (d2 * t0 * t0 - d0 * t2 * t2) / denominator;
  if (!(a < 0)) return peak.t; // not a proper maximum (flat top)
  const offset = -b / (2 * a);
  return peak.t + Math.max(t0, Math.min(t2, offset));
}

export function classifyBpm(bpm: number, min = 100, max = 120): BpmClass {
  if (bpm < min) return 'Slow';
  if (bpm > max) return 'Fast';
  return 'In Range';
}

export class CadenceDetector {
  private config: CadenceConfig;
  private buffer: Sample[] = [];
  private evaluatedUntil = -Infinity;
  private lastPeakAt: number | null = null;
  private intervals: number[] = [];

  constructor(config: Partial<CadenceConfig> = {}) {
    this.config = {
      bufferDurationMs: config.bufferDurationMs ?? 6000,
      minPeakDistanceMs: config.minPeakDistanceMs ?? 400,
      peakProminence: config.peakProminence ?? 0.02,
      prominenceWindowMs: config.prominenceWindowMs ?? 300,
      bpmWindowIntervals: config.bpmWindowIntervals ?? 4,
      pauseGapMs: config.pauseGapMs ?? 1500,
      bpmMin: config.bpmMin ?? 100,
      bpmMax: config.bpmMax ?? 120,
    };
  }

  /**
   * Add one wrist-height sample. Returns compressions confirmed by this sample (usually 0 or 1).
   */
  addSample(y: number, timestamp: number): CompressionPeak[] {
    if (!Number.isFinite(y) || !Number.isFinite(timestamp)) return [];

    const last = this.buffer[this.buffer.length - 1];
    if (last && timestamp <= last.t) return [];
    // Tracking dropped out: the signal is discontinuous, so start a fresh buffer.
    if (last && timestamp - last.t > this.config.pauseGapMs) this.resetSignal();

    this.buffer.push({ t: timestamp, y });
    const cutoff = timestamp - this.config.bufferDurationMs;
    while (this.buffer.length > 0 && this.buffer[0].t < cutoff) this.buffer.shift();

    return this.detect(timestamp);
  }

  private detect(newest: number): CompressionPeak[] {
    const { prominenceWindowMs, minPeakDistanceMs, peakProminence } = this.config;
    const samples = this.smoothed();
    const decideBefore = newest - prominenceWindowMs;
    const found: CompressionPeak[] = [];

    for (let i = 1; i < samples.length - 1; i += 1) {
      const { t, y } = samples[i];
      if (t <= this.evaluatedUntil) continue;
      if (t > decideBefore) break;
      this.evaluatedUntil = t;

      if (this.lastPeakAt !== null && t - this.lastPeakAt < minPeakDistanceMs) continue;
      // Local maximum (">=" on the left accepts the end of a flat top).
      if (!(y >= samples[i - 1].y && y > samples[i + 1].y)) continue;

      let leftMin = Infinity;
      let rightMin = Infinity;
      for (let j = i - 1; j >= 0 && t - samples[j].t <= prominenceWindowMs; j -= 1) leftMin = Math.min(leftMin, samples[j].y);
      for (let j = i + 1; j < samples.length && samples[j].t - t <= prominenceWindowMs; j += 1) rightMin = Math.min(rightMin, samples[j].y);
      if (!Number.isFinite(leftMin) || !Number.isFinite(rightMin)) continue;
      if (y - Math.max(leftMin, rightMin) < peakProminence) continue;

      const peakTime = refinePeakTime(samples[i - 1], samples[i], samples[i + 1]);
      if (this.lastPeakAt !== null && peakTime - this.lastPeakAt < minPeakDistanceMs) continue;
      found.push(this.acceptPeak(peakTime));
    }
    return found;
  }

  private acceptPeak(timestamp: number): CompressionPeak {
    let intervalMs: number | null = null;
    if (this.lastPeakAt !== null) {
      const gap = timestamp - this.lastPeakAt;
      if (gap > this.config.pauseGapMs) {
        this.intervals = []; // pause: start a new run
      } else {
        intervalMs = gap;
        this.intervals.push(gap);
        const keep = Math.max(1, Math.round(this.config.bpmWindowIntervals));
        while (this.intervals.length > keep) this.intervals.shift();
      }
    }
    this.lastPeakAt = timestamp;
    return { timestamp, intervalMs, bpm: this.currentBpm() };
  }

  /** 3-sample centered moving average to suppress landmark jitter. */
  private smoothed(): Sample[] {
    const out: Sample[] = new Array(this.buffer.length);
    for (let i = 0; i < this.buffer.length; i += 1) {
      const start = Math.max(0, i - 1);
      const end = Math.min(this.buffer.length - 1, i + 1);
      let sum = 0;
      for (let j = start; j <= end; j += 1) sum += this.buffer[j].y;
      out[i] = { t: this.buffer[i].t, y: sum / (end - start + 1) };
    }
    return out;
  }

  /** Cadence of the current run (median of the latest intervals), or null. */
  currentBpm(): number | null {
    if (this.intervals.length === 0) return null;
    return 60000 / median(this.intervals);
  }

  /** True when no compression has been seen for longer than the pause gap. */
  isPaused(now: number): boolean {
    return this.lastPeakAt === null || now - this.lastPeakAt > this.config.pauseGapMs;
  }

  /** Discard the signal buffer (e.g. landmark source changed) but keep compression history. */
  resetSignal(): void {
    this.buffer = [];
    this.evaluatedUntil = -Infinity;
  }

  reset(): void {
    this.resetSignal();
    this.lastPeakAt = null;
    this.intervals = [];
  }

  setConfig(config: Partial<CadenceConfig>): void {
    this.config = { ...this.config, ...config };
  }

  getConfig(): CadenceConfig {
    return { ...this.config };
  }
}
