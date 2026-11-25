/**
 * L.I.F.E. Hand and finger tracking (MediaPipe Hand Landmarker, local model + WASM).
 *
 * Used for the AHA hand position: heel of one hand on the center of the chest, the other hand
 * on top. It reports whether the hands are stacked and gives 21 finger landmarks per hand for
 * the overlay. It runs at a lower rate than pose tracking (about 8 times per second) so the
 * compression timing, which comes from pose tracking, keeps its full frame rate.
 *
 * Hand position is reported separately and does not change the accuracy score.
 */

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';
import type { Landmark } from '../api/types';

export const HAND_MODEL_PATH = '/mediapipe/models/hand_landmarker.task';
const WASM_PATH = '/mediapipe/wasm';
export const HAND_INTERVAL_MS = 120;
/** Hand results older than this are not used (the hands may have moved). */
export const HAND_RESULT_MAX_AGE_MS = 400;

export interface Point2D {
  x: number;
  y: number;
}

export interface HandsAnalysis {
  /** Hands found by the hand model (0–2). */
  handCount: number;
  /** Hands on top of each other; null when it cannot be judged. */
  stacked: boolean | null;
  /** Which evidence decided `stacked`. */
  source: 'hands' | 'wrists' | null;
  /** Finger landmarks per hand (21 points each), for drawing. */
  hands: Point2D[][];
}

export const NO_HANDS: HandsAnalysis = { handCount: 0, stacked: null, source: null, hands: [] };

const PALM_POINTS = [0, 5, 9, 13, 17];
export const FINGER_TIPS = [4, 8, 12, 16, 20];

const distance = (a: Point2D, b: Point2D) => Math.hypot(a.x - b.x, a.y - b.y);

function palmCenter(hand: Point2D[]): Point2D {
  const points = PALM_POINTS.map(index => hand[index]);
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
}

/** Wrist to middle-finger knuckle: a size reference that scales with distance to the camera. */
function palmSize(hand: Point2D[]): number {
  return distance(hand[0], hand[9]);
}

/**
 * Decide whether the hands are stacked.
 *  1. Two hands found: their palm centers must be within about one palm length.
 *  2. Otherwise (from the side one hand often hides the other): the two pose wrists must be
 *     within 40% of a forearm length of each other.
 */
export function analyzeHands(hands: Point2D[][], poseLandmarks: Landmark[] | null, visibilityThreshold = 0.5): HandsAnalysis {
  const valid = hands.filter(hand => hand.length >= 21);

  if (valid.length >= 2) {
    const [a, b] = valid;
    const size = (palmSize(a) + palmSize(b)) / 2;
    const stacked = size > 0 && distance(palmCenter(a), palmCenter(b)) <= size * 1.0;
    return { handCount: valid.length, stacked, source: 'hands', hands: valid };
  }

  if (poseLandmarks) {
    const left = poseLandmarks[15];
    const right = poseLandmarks[16];
    const visible = (point?: Landmark) => Boolean(point) && (point!.visibility ?? 0) >= visibilityThreshold;
    if (visible(left) && visible(right)) {
      // Forearm length of whichever arm is more visible.
      const forearms = [
        [poseLandmarks[13], left],
        [poseLandmarks[14], right],
      ].filter(([elbow]) => visible(elbow)).map(([elbow, wrist]) => distance(elbow, wrist));
      const forearm = forearms.length ? Math.max(...forearms) : 0;
      if (forearm > 0) {
        return { handCount: valid.length, stacked: distance(left, right) <= forearm * 0.4, source: 'wrists', hands: valid };
      }
    }
  }

  return { handCount: valid.length, stacked: null, source: null, hands: valid };
}

class HandTracker {
  private landmarker: HandLandmarker | null = null;
  private loading: Promise<void> | null = null;
  private lastRunAt = -Infinity;
  private lastTimestamp = 0;
  private latest: { hands: Point2D[][]; at: number } = { hands: [], at: -Infinity };
  private failed = false;

  get isLoaded(): boolean {
    return this.landmarker !== null;
  }

  get unavailable(): boolean {
    return this.failed;
  }

  initialize(): Promise<void> {
    if (this.landmarker) return Promise.resolve();
    if (this.loading) return this.loading;
    this.loading = (async () => {
      const vision = await FilesetResolver.forVisionTasks(WASM_PATH);
      const options = {
        baseOptions: { modelAssetPath: HAND_MODEL_PATH },
        runningMode: 'VIDEO' as const,
        numHands: 2,
        minHandDetectionConfidence: 0.4,
        minHandPresenceConfidence: 0.4,
        minTrackingConfidence: 0.4,
      };
      try {
        this.landmarker = await HandLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'GPU' } });
      } catch {
        this.landmarker = await HandLandmarker.createFromOptions(vision, { ...options, baseOptions: { ...options.baseOptions, delegate: 'CPU' } });
      }
    })().catch(error => {
      this.failed = true;
      this.loading = null;
      console.error('Hand tracking unavailable:', error);
    });
    return this.loading;
  }

  /** Run hand detection if it is due; always returns the latest (possibly older) result. */
  update(frame: HTMLVideoElement | HTMLCanvasElement, timestamp: number): { hands: Point2D[][]; at: number } {
    if (!this.landmarker || timestamp - this.lastRunAt < HAND_INTERVAL_MS) return this.latest;
    this.lastRunAt = timestamp;
    const ts = Math.max(Math.round(timestamp), this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    try {
      const result = this.landmarker.detectForVideo(frame, ts);
      this.latest = { hands: result.landmarks.map(hand => hand.map(p => ({ x: p.x, y: p.y }))), at: timestamp };
    } catch (error) {
      console.error('Hand detection error:', error);
    }
    return this.latest;
  }

  reset(): void {
    this.latest = { hands: [], at: -Infinity };
    this.lastRunAt = -Infinity;
  }
}

export const handTracker = new HandTracker();
export const HAND_CONNECTIONS = HandLandmarker.HAND_CONNECTIONS;
