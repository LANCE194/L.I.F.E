/**
 * L.I.F.E. Vision Pipeline
 * Runs synchronously for every camera frame (outside React):
 *   landmarks -> arm side lock -> elbow angle -> wrist signal -> cadence peaks -> scoring -> coaching.
 * React reads throttled snapshots via snapshot().
 */

import type { Landmark } from '../api/types';
import { ElbowDetector, armVisibility, ARM_LANDMARKS, type ArmSide } from './angle';
import { CadenceDetector } from './cadence';
import { SessionScorer, type ScoredCompression, type ScoreSummary } from './scoring';
import { Coach, type CoachCue, CUES } from './coach';
import { NO_HANDS, type HandsAnalysis } from './hands';

export interface PipelineConfig {
  angleThreshold: number;
  smoothingWindow: number;
  visibilityThreshold: number;
  minPeakDistanceMs: number;
  peakProminence: number;
  bpmMin: number;
  bpmMax: number;
  bpmWindowIntervals: number;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  angleThreshold: 160,
  smoothingWindow: 5,
  visibilityThreshold: 0.5,
  minPeakDistanceMs: 400,
  peakProminence: 0.02,
  bpmMin: 100,
  bpmMax: 120,
  bpmWindowIntervals: 4,
};

export interface FrameInput {
  landmarks: Landmark[] | null;
  timestamp: number;    // ms, monotonic (frame capture/presentation time)
  inferenceMs: number;  // time spent in pose inference for this frame
  hands?: HandsAnalysis;
}

export interface HandsSnapshot {
  handCount: number;
  stacked: boolean | null;
  source: HandsAnalysis['source'];
  /** Share of compressions (with a hand reading) where the hands were stacked; null if none. */
  stackedPct: number | null;
}

export interface PipelineSnapshot {
  scoring: boolean;
  personVisible: boolean;
  side: ArmSide | null;
  armVisible: boolean;
  elbowAngle: number | null;
  elbowLocked: boolean;
  currentBpm: number | null;
  summary: ScoreSummary;
  fps: number;
  latencyMs: number;
  cue: CoachCue;
  /** Person and arm have been continuously visible long enough to start. */
  readyToStart: boolean;
  hands: HandsSnapshot;
}

export interface SessionQuality {
  avgFps: number;
  avgLatencyMs: number;
  framesWithPerson: number;
  totalFrames: number;
}

const SIDE_SWITCH_AFTER_MS = 1000;
const HANDS_HISTORY_MS = 3000;
const READY_AFTER_MS = 1000;
const VISIBILITY_EMA = 0.15;

export class SessionPipeline {
  private config: PipelineConfig;
  private elbow: ElbowDetector;
  private cadence: CadenceDetector;
  private scorer: SessionScorer;
  private coach = new Coach();

  private scoring = false;
  private side: ArmSide | null = null;
  private sideLocked = false;
  private sideEma: Record<ArmSide, number> = { left: 0, right: 0 };
  private armMissingSince: number | null = null;
  private signalSource: 'wrist' | 'shoulder' | null = null;

  private visibleSince: number | null = null;
  private lastFrame: { personVisible: boolean; armVisible: boolean; angle: number | null; locked: boolean; timestamp: number } =
    { personVisible: false, armVisible: false, angle: null, locked: false, timestamp: 0 };

  private frameTimes: number[] = [];
  private latencyEma = 0;
  private quality = { frames: 0, framesWithPerson: 0, latencySum: 0, firstAt: 0, lastAt: 0 };
  private cue: CoachCue = CUES.begin;
  private hands: HandsAnalysis = NO_HANDS;
  private handsHistory: { t: number; stacked: boolean | null }[] = [];

  constructor(config: Partial<PipelineConfig> = {}) {
    this.config = { ...DEFAULT_PIPELINE_CONFIG, ...config };
    this.elbow = new ElbowDetector();
    this.cadence = new CadenceDetector();
    this.scorer = new SessionScorer();
    this.applyConfig();
  }

  setConfig(config: Partial<PipelineConfig>): void {
    this.config = { ...this.config, ...config };
    this.applyConfig();
  }

  getConfig(): PipelineConfig {
    return { ...this.config };
  }

  private applyConfig(): void {
    const c = this.config;
    this.elbow.setConfig({ threshold: c.angleThreshold, smoothingWindow: c.smoothingWindow, visibilityThreshold: c.visibilityThreshold });
    this.cadence.setConfig({
      minPeakDistanceMs: c.minPeakDistanceMs,
      peakProminence: c.peakProminence,
      bpmMin: c.bpmMin,
      bpmMax: c.bpmMax,
      bpmWindowIntervals: c.bpmWindowIntervals,
    });
    this.scorer.setConfig({ bpmMin: c.bpmMin, bpmMax: c.bpmMax });
  }

  /** Begin scoring: locks the arm side that has been most visible during the preview. */
  startScoring(): void {
    this.handsHistory = [];
    this.scorer.reset();
    this.cadence.reset();
    this.elbow.reset();
    this.coach.reset();
    this.signalSource = null;
    this.armMissingSince = null;
    this.side = this.sideEma.left >= this.sideEma.right ? 'left' : 'right';
    this.sideLocked = true;
    this.quality = { frames: 0, framesWithPerson: 0, latencySum: 0, firstAt: 0, lastAt: 0 };
    this.scoring = true;
  }

  /** Stop scoring and score any pending lone compression. */
  stopScoring(): ScoredCompression[] {
    this.scoring = false;
    this.sideLocked = false;
    return this.scorer.flush();
  }

  reset(): void {
    this.scoring = false;
    this.sideLocked = false;
    this.side = null;
    this.sideEma = { left: 0, right: 0 };
    this.visibleSince = null;
    this.scorer.reset();
    this.cadence.reset();
    this.elbow.reset();
    this.coach.reset();
    this.frameTimes = [];
    this.latencyEma = 0;
    this.cue = CUES.begin;
    this.hands = NO_HANDS;
    this.handsHistory = [];
  }

  processFrame(input: FrameInput): ScoredCompression[] {
    const { landmarks, timestamp, inferenceMs } = input;
    this.trackPerformance(timestamp, inferenceMs, Boolean(landmarks));
    this.hands = input.hands ?? NO_HANDS;
    this.handsHistory.push({ t: timestamp, stacked: this.hands.stacked });
    while (this.handsHistory.length > 0 && timestamp - this.handsHistory[0].t > HANDS_HISTORY_MS) this.handsHistory.shift();

    const { visibilityThreshold } = this.config;
    const personVisible = Boolean(landmarks);
    let newlyScored: ScoredCompression[] = [];

    if (landmarks) {
      this.sideEma.left += VISIBILITY_EMA * (armVisibility(landmarks, 'left') - this.sideEma.left);
      this.sideEma.right += VISIBILITY_EMA * (armVisibility(landmarks, 'right') - this.sideEma.right);
    }
    this.updateSide(landmarks, timestamp);

    const side = this.side;
    const elbowState = side ? this.elbow.process(landmarks, side, timestamp) : null;
    const armVisible = Boolean(elbowState?.visible);

    if (personVisible && armVisible) {
      this.visibleSince ??= timestamp;
    } else {
      this.visibleSince = null;
    }

    if (this.scoring && landmarks && side) {
      const signal = this.wristSignal(landmarks, side, visibilityThreshold);
      if (signal) {
        if (signal.source !== this.signalSource) {
          this.cadence.resetSignal(); // never mix wrist and shoulder heights in one signal
          this.signalSource = signal.source;
        }
        for (const peak of this.cadence.addSample(signal.y, timestamp)) {
          const scored = this.scorer.add(peak, this.elbow.stateAt(peak.timestamp));
          for (const compression of scored) compression.handsStacked = this.handsAt(compression.timestamp);
          newlyScored = newlyScored.concat(scored);
        }
      }
    }

    this.lastFrame = {
      personVisible,
      armVisible,
      angle: elbowState?.smoothedAngle ?? null,
      locked: Boolean(elbowState?.locked),
      timestamp,
    };

    this.cue = this.coach.update({
      personVisible,
      armVisible,
      paused: this.cadence.isPaused(timestamp),
      recent: this.scorer.recentScorable(3),
      currentBpm: this.cadence.currentBpm(),
      bpmMin: this.config.bpmMin,
      bpmMax: this.config.bpmMax,
    }, timestamp);

    return newlyScored;
  }

  /** Hand reading nearest a compression (within 400 ms), or null. */
  private handsAt(timestamp: number): boolean | null {
    let best: { t: number; stacked: boolean | null } | null = null;
    for (const entry of this.handsHistory) {
      if (entry.stacked === null) continue;
      if (!best || Math.abs(entry.t - timestamp) < Math.abs(best.t - timestamp)) best = entry;
    }
    return best && Math.abs(best.t - timestamp) <= 400 ? best.stacked : null;
  }

  /** Share of compressions with a hand reading where the hands were stacked. */
  handsStackedPct(): number | null {
    const judged = this.scorer.compressions().filter(c => c.handsStacked === true || c.handsStacked === false);
    if (judged.length === 0) return null;
    return Math.round((judged.filter(c => c.handsStacked).length / judged.length) * 1000) / 10;
  }

  private updateSide(landmarks: Landmark[] | null, timestamp: number): void {
    const threshold = this.config.visibilityThreshold;
    if (!this.sideLocked) {
      // Preview: follow the more visible arm, with hysteresis to avoid flicker.
      if (this.side === null) {
        if (Math.max(this.sideEma.left, this.sideEma.right) > 0) this.side = this.sideEma.left >= this.sideEma.right ? 'left' : 'right';
      } else {
        const other: ArmSide = this.side === 'left' ? 'right' : 'left';
        if (this.sideEma[other] > this.sideEma[this.side] + 0.1) this.side = other;
      }
      return;
    }

    // Scoring: keep the locked arm unless it has been invisible for a while and the other arm is visible.
    if (!landmarks || !this.side) return;
    const current = this.side;
    if (armVisibility(landmarks, current) >= threshold) {
      this.armMissingSince = null;
      return;
    }
    this.armMissingSince ??= timestamp;
    const other: ArmSide = current === 'left' ? 'right' : 'left';
    if (timestamp - this.armMissingSince > SIDE_SWITCH_AFTER_MS && armVisibility(landmarks, other) >= threshold) {
      this.side = other;
      this.armMissingSince = null;
      this.elbow.reset();
      this.cadence.resetSignal();
      this.signalSource = null;
    }
  }

  private wristSignal(landmarks: Landmark[], side: ArmSide, threshold: number): { y: number; source: 'wrist' | 'shoulder' } | null {
    const wrist = landmarks[ARM_LANDMARKS[side].wrist];
    if (wrist && (wrist.visibility ?? 0) >= threshold) return { y: wrist.y, source: 'wrist' };
    const shoulder = landmarks[ARM_LANDMARKS[side].shoulder];
    if (shoulder && (shoulder.visibility ?? 0) >= threshold) return { y: shoulder.y, source: 'shoulder' };
    return null;
  }

  private trackPerformance(timestamp: number, inferenceMs: number, hasPerson: boolean): void {
    this.frameTimes.push(timestamp);
    while (this.frameTimes.length > 30) this.frameTimes.shift();
    this.latencyEma = this.latencyEma === 0 ? inferenceMs : this.latencyEma + 0.1 * (inferenceMs - this.latencyEma);

    if (this.scoring) {
      const q = this.quality;
      if (q.frames === 0) q.firstAt = timestamp;
      q.frames += 1;
      q.lastAt = timestamp;
      q.latencySum += inferenceMs;
      if (hasPerson) q.framesWithPerson += 1;
    }
  }

  private currentFps(): number {
    const times = this.frameTimes;
    if (times.length < 2) return 0;
    const span = times[times.length - 1] - times[0];
    return span > 0 ? ((times.length - 1) * 1000) / span : 0;
  }

  sessionQuality(): SessionQuality {
    const q = this.quality;
    const span = q.lastAt - q.firstAt;
    return {
      avgFps: span > 0 ? Math.round((((q.frames - 1) * 1000) / span) * 10) / 10 : 0,
      avgLatencyMs: q.frames ? Math.round((q.latencySum / q.frames) * 10) / 10 : 0,
      framesWithPerson: q.framesWithPerson,
      totalFrames: q.frames,
    };
  }

  compressions(): ScoredCompression[] {
    return this.scorer.compressions();
  }

  summary(): ScoreSummary {
    return this.scorer.summary();
  }

  /** Cheap per-frame state for drawing the overlay. */
  overlayState(): { side: ArmSide | null; elbowLocked: boolean; armVisible: boolean; visibilityThreshold: number } {
    return {
      side: this.side,
      elbowLocked: this.lastFrame.locked,
      armVisible: this.lastFrame.armVisible,
      visibilityThreshold: this.config.visibilityThreshold,
    };
  }

  snapshot(): PipelineSnapshot {
    const frame = this.lastFrame;
    return {
      scoring: this.scoring,
      personVisible: frame.personVisible,
      side: this.side,
      armVisible: frame.armVisible,
      elbowAngle: frame.angle === null ? null : Math.round(frame.angle),
      elbowLocked: frame.locked,
      currentBpm: this.cadence.currentBpm(),
      summary: this.scorer.summary(),
      fps: Math.round(this.currentFps()),
      latencyMs: Math.round(this.latencyEma),
      cue: this.cue,
      readyToStart: this.visibleSince !== null && frame.timestamp - this.visibleSince >= READY_AFTER_MS,
      hands: {
        handCount: this.hands.handCount,
        stacked: this.hands.stacked,
        source: this.hands.source,
        stackedPct: this.handsStackedPct(),
      },
    };
  }
}
