import { describe, expect, it } from 'vitest';
import { analyzeHands, type Point2D } from './hands';
import type { Landmark } from '../api/types';

/** A simple 21-point hand: wrist at (cx, cy), knuckles and fingertips above it. */
function hand(cx: number, cy: number, size = 0.08): Point2D[] {
  const points: Point2D[] = [{ x: cx, y: cy }];
  for (let finger = 0; finger < 5; finger += 1) {
    const x = cx + (finger - 2) * size * 0.25;
    for (let joint = 1; joint <= 4; joint += 1) points.push({ x, y: cy - size * (joint / 3) });
  }
  return points;
}

function poseWithWrists(left: Point2D, right: Point2D, visibility = 0.9): Landmark[] {
  const pose: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0 }));
  pose[13] = { x: left.x, y: left.y - 0.15, z: 0, visibility };  // left elbow, forearm 0.15
  pose[15] = { ...left, z: 0, visibility };
  pose[14] = { x: right.x, y: right.y - 0.15, z: 0, visibility };
  pose[16] = { ...right, z: 0, visibility };
  return pose;
}

describe('analyzeHands', () => {
  it('detects stacked hands when two palms overlap', () => {
    const result = analyzeHands([hand(0.5, 0.6), hand(0.51, 0.61)], null);
    expect(result).toMatchObject({ handCount: 2, stacked: true, source: 'hands' });
  });

  it('detects separated hands', () => {
    const result = analyzeHands([hand(0.3, 0.6), hand(0.7, 0.6)], null);
    expect(result).toMatchObject({ handCount: 2, stacked: false, source: 'hands' });
  });

  it('falls back to the pose wrists when one hand hides the other', () => {
    const together = analyzeHands([hand(0.5, 0.6)], poseWithWrists({ x: 0.5, y: 0.6 }, { x: 0.52, y: 0.6 }));
    expect(together).toMatchObject({ handCount: 1, stacked: true, source: 'wrists' });
    const apart = analyzeHands([], poseWithWrists({ x: 0.4, y: 0.6 }, { x: 0.6, y: 0.6 }));
    expect(apart).toMatchObject({ stacked: false, source: 'wrists' });
  });

  it('cannot judge without hands or visible wrists', () => {
    expect(analyzeHands([], null)).toMatchObject({ stacked: null, source: null });
    expect(analyzeHands([], poseWithWrists({ x: 0.5, y: 0.6 }, { x: 0.5, y: 0.6 }, 0.2))).toMatchObject({ stacked: null });
  });
});
