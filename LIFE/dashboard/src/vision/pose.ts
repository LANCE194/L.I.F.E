/**
 * L.I.F.E. Pose Detection (MediaPipe Tasks Vision, VIDEO mode, fully local model + WASM).
 *
 * Frames are processed in a requestVideoFrameCallback loop (requestAnimationFrame fallback).
 * Each frame's landmarks go straight to a callback — no React state per frame — and the
 * skeleton overlay is drawn in the same callback.
 */

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { Landmark } from '../api/types';
import { ARM_LANDMARKS, type ArmSide } from './angle';
import { mapVideoPointToCanvas, prepareInferenceFrame } from './inferenceFrame';
import { analyzeHands, handTracker, FINGER_TIPS, HAND_CONNECTIONS, HAND_RESULT_MAX_AGE_MS, NO_HANDS, type HandsAnalysis } from './hands';

export const POSE_MODEL_PATH = '/mediapipe/models/pose_landmarker.task';
export const WASM_PATH = '/mediapipe/wasm';

export interface PoseFrame {
  landmarks: Landmark[] | null;
  timestamp: number;
  inferenceMs: number;
  /** Hand position and finger landmarks (latest hand result, at most a few frames old). */
  hands: HandsAnalysis;
}

export interface OverlayState {
  side: ArmSide | null;
  elbowLocked: boolean;
  armVisible: boolean;
  visibilityThreshold: number;
}

type FrameCallback = (frame: PoseFrame) => void;

const CORE_LANDMARKS = [11, 12, 23, 24];
/** Thumb, index, middle, ring, little finger. */
const FINGERTIP_COLORS = ['#ff3b5c', '#e3b657', '#3ddc84', '#4fc3f7', '#ce93d8'];

/** Treat a detection as a person only when the torso is reasonably visible. */
export function selectPerson(candidates: Landmark[][], minVisibility = 0.3): Landmark[] | null {
  for (const landmarks of candidates) {
    const core = CORE_LANDMARKS.map(index => landmarks[index]?.visibility ?? 0);
    const visibleCore = core.filter(value => value >= 0.25);
    if (visibleCore.length >= 2 && visibleCore.reduce((a, b) => a + b, 0) / visibleCore.length >= minVisibility) {
      return landmarks;
    }
  }
  return null;
}

class PoseManager {
  private landmarker: PoseLandmarker | null = null;
  private loading: Promise<void> | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private onFrame: FrameCallback | null = null;
  private overlay: () => OverlayState = () => ({ side: null, elbowLocked: false, armVisible: false, visibilityThreshold: 0.5 });
  private rafId: number | null = null;
  private rvfcId: number | null = null;
  private lastMediaTime = -1;
  private lastTimestamp = 0;
  private lastLandmarks: Landmark[] | null = null;
  private lastHands: HandsAnalysis = NO_HANDS;
  private handsEnabled = true;

  get isLoaded(): boolean {
    return this.landmarker !== null;
  }

  /** Finger tracking can be turned off on slow computers; the wrist-based hand check still works. */
  setHandsEnabled(enabled: boolean): void {
    this.handsEnabled = enabled;
    if (enabled) void handTracker.initialize();
    else handTracker.reset();
  }

  /** Load the model once (GPU delegate with CPU fallback). Safe to call repeatedly. */
  initialize(modelPath = POSE_MODEL_PATH): Promise<void> {
    if (this.landmarker) return Promise.resolve();
    if (this.loading) return this.loading;

    this.loading = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
      const options = {
        baseOptions: { modelAssetPath: modelPath },
        runningMode: 'VIDEO' as const,
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
      };
      try {
        this.landmarker = await PoseLandmarker.createFromOptions(vision, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: 'GPU' },
        });
      } catch {
        this.landmarker = await PoseLandmarker.createFromOptions(vision, {
          ...options,
          baseOptions: { ...options.baseOptions, delegate: 'CPU' },
        });
      }
      // Finger tracking loads in the background; pose tracking never waits for it.
      if (this.handsEnabled) void handTracker.initialize();
    })().catch(error => {
      this.loading = null;
      throw new Error(`Could not load the body-tracking model: ${error instanceof Error ? error.message : String(error)}`);
    });

    return this.loading;
  }

  start(video: HTMLVideoElement, canvas: HTMLCanvasElement | null, onFrame: FrameCallback, overlay?: () => OverlayState): void {
    if (!this.landmarker) throw new Error('Body tracking is not loaded yet');
    this.stop();
    this.video = video;
    this.canvas = canvas;
    this.onFrame = onFrame;
    if (overlay) this.overlay = overlay;
    this.schedule();
  }

  stop(): void {
    if (this.rafId !== null) cancelAnimationFrame(this.rafId);
    if (this.rvfcId !== null && this.video?.cancelVideoFrameCallback) this.video.cancelVideoFrameCallback(this.rvfcId);
    this.rafId = null;
    this.rvfcId = null;
    this.video = null;
    this.onFrame = null;
    this.lastMediaTime = -1;
    this.lastLandmarks = null;
    this.lastHands = NO_HANDS;
    handTracker.reset();
    if (this.canvas) this.canvas.getContext('2d')?.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.canvas = null;
  }

  private schedule(): void {
    const video = this.video;
    if (!video) return;
    if (typeof video.requestVideoFrameCallback === 'function') {
      this.rvfcId = video.requestVideoFrameCallback((now, metadata) => {
        this.rvfcId = null;
        // captureTime is the camera's own timestamp when available (most accurate for cadence).
        const frameTime = (metadata as VideoFrameCallbackMetadata & { captureTime?: number }).captureTime ?? now;
        this.process(frameTime, metadata.mediaTime);
        this.schedule();
      });
    } else {
      this.rafId = requestAnimationFrame(now => {
        this.rafId = null;
        this.process(now, video.currentTime);
        this.schedule();
      });
    }
  }

  private process(frameTime: number, mediaTime: number): void {
    const video = this.video;
    const landmarker = this.landmarker;
    if (!video || !landmarker || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
    if (mediaTime === this.lastMediaTime) return;
    this.lastMediaTime = mediaTime;

    // detectForVideo requires strictly increasing timestamps.
    const timestamp = Math.max(frameTime, this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;

    let landmarks: Landmark[] | null = null;
    const frame = prepareInferenceFrame(video);
    const started = performance.now();
    try {
      const result = landmarker.detectForVideo(frame, Math.round(timestamp));
      landmarks = selectPerson(result.landmarks as Landmark[][]);
    } catch (error) {
      console.error('Pose detection error:', error);
    }
    const inferenceMs = performance.now() - started;

    let handPoints: { x: number; y: number }[][] = [];
    if (this.handsEnabled && handTracker.isLoaded) {
      const latest = handTracker.update(frame, timestamp);
      if (timestamp - latest.at <= HAND_RESULT_MAX_AGE_MS) handPoints = latest.hands;
    }
    const hands = analyzeHands(handPoints, landmarks, this.overlay().visibilityThreshold);

    this.lastLandmarks = landmarks;
    this.lastHands = hands;
    this.onFrame?.({ landmarks, timestamp, inferenceMs, hands });
    this.draw();
  }

  private draw(): void {
    const canvas = this.canvas;
    const video = this.video;
    if (!canvas || !video) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.round((canvas.clientWidth || video.videoWidth) * pixelRatio);
    const height = Math.round((canvas.clientHeight || video.videoHeight) * pixelRatio);
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const landmarks = this.lastLandmarks;
    if (!landmarks || !video.videoWidth) return;
    const { side, elbowLocked, armVisible, visibilityThreshold } = this.overlay();

    ctx.save();
    // Mirror to match the mirrored video preview.
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);

    const point = (landmark: Landmark) => mapVideoPointToCanvas(video, canvas, landmark.x, landmark.y);
    const visible = (landmark?: Landmark) => Boolean(landmark) && (landmark!.visibility ?? 0) > visibilityThreshold * 0.7;

    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.55)';
    ctx.lineWidth = 2 * pixelRatio;
    ctx.beginPath();
    for (const connection of PoseLandmarker.POSE_CONNECTIONS) {
      const start = landmarks[connection.start];
      const end = landmarks[connection.end];
      if (connection.start < 11 || connection.end < 11) continue; // skip face lines
      if (visible(start) && visible(end)) {
        const a = point(start);
        const b = point(end);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
    }
    ctx.stroke();

    // Highlight the tracked arm: green when locked, red when bent.
    if (side && armVisible) {
      const arm = ARM_LANDMARKS[side];
      const joints = [landmarks[arm.shoulder], landmarks[arm.elbow], landmarks[arm.wrist]];
      ctx.strokeStyle = elbowLocked ? '#3ddc84' : '#ff3b5c';
      ctx.lineWidth = 6 * pixelRatio;
      ctx.beginPath();
      joints.forEach((joint, index) => {
        const p = point(joint);
        if (index === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      for (const joint of joints) {
        const p = point(joint);
        ctx.beginPath();
        ctx.arc(p.x, p.y, 6 * pixelRatio, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    this.drawHands(ctx, video, canvas, pixelRatio);
    ctx.restore();
  }

  /** Finger skeletons: gold when the hands are stacked, white otherwise; colored fingertips. */
  private drawHands(ctx: CanvasRenderingContext2D, video: HTMLVideoElement, canvas: HTMLCanvasElement, pixelRatio: number): void {
    const { hands, stacked } = this.lastHands;
    if (hands.length === 0) return;
    const point = (p: { x: number; y: number }) => mapVideoPointToCanvas(video, canvas, p.x, p.y);
    ctx.lineWidth = 2.5 * pixelRatio;
    ctx.strokeStyle = stacked ? '#e3b657' : 'rgba(255, 255, 255, 0.85)';
    for (const hand of hands) {
      ctx.beginPath();
      for (const { start, end } of HAND_CONNECTIONS) {
        const a = point(hand[start]);
        const b = point(hand[end]);
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
      }
      ctx.stroke();
      FINGER_TIPS.forEach((tip, index) => {
        const p = point(hand[tip]);
        ctx.fillStyle = FINGERTIP_COLORS[index];
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4 * pixelRatio, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }
}

export const pose = new PoseManager();
