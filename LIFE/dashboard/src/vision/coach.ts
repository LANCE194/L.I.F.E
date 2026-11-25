/**
 * L.I.F.E. Live Coaching Cue
 * Picks ONE short instruction from the latest tracking state and compressions.
 * Changes are debounced so the cue does not flicker between frames.
 */

import type { ScoredCompression } from './scoring';

export type CueKind = 'position' | 'arm' | 'begin' | 'resume' | 'elbows' | 'faster' | 'slower' | 'good';

export interface CoachCue {
  kind: CueKind;
  text: string;
  tone: 'good' | 'warn' | 'bad' | 'neutral';
}

export interface CoachInput {
  personVisible: boolean;
  armVisible: boolean;
  paused: boolean;
  recent: ScoredCompression[];
  currentBpm: number | null;
  bpmMin: number;
  bpmMax: number;
}

export const CUES: Record<CueKind, CoachCue> = {
  position: { kind: 'position', text: 'Step into view of the camera', tone: 'warn' },
  arm: { kind: 'arm', text: 'Turn so your arm is visible', tone: 'warn' },
  begin: { kind: 'begin', text: 'Start compressions', tone: 'neutral' },
  resume: { kind: 'resume', text: 'Resume compressions — keep pauses short', tone: 'warn' },
  elbows: { kind: 'elbows', text: 'Lock your elbows', tone: 'bad' },
  faster: { kind: 'faster', text: 'Push faster', tone: 'bad' },
  slower: { kind: 'slower', text: 'Slow down', tone: 'bad' },
  good: { kind: 'good', text: 'Good — keep going', tone: 'good' },
};

export function chooseCue(input: CoachInput): CoachCue {
  if (!input.personVisible) return CUES.position;
  if (!input.armVisible) return CUES.arm;
  // AHA: keep interruptions to a minimum. After compressions have started, a pause is a prompt to resume.
  if (input.paused) return input.recent.length > 0 ? CUES.resume : CUES.begin;

  const recent = input.recent.slice(-3);
  const unlocked = recent.filter(item => !item.elbowLocked).length;
  if (recent.length > 0 && unlocked >= Math.min(2, recent.length)) return CUES.elbows;

  if (input.currentBpm !== null) {
    if (input.currentBpm < input.bpmMin) return CUES.faster;
    if (input.currentBpm > input.bpmMax) return CUES.slower;
  }
  return CUES.good;
}

export class Coach {
  private current: CoachCue = CUES.begin;
  private lastChange = -Infinity;

  constructor(private readonly debounceMs = 1500) {}

  update(input: CoachInput, now: number): CoachCue {
    const candidate = chooseCue(input);
    if (candidate.kind !== this.current.kind && now - this.lastChange >= this.debounceMs) {
      this.current = candidate;
      this.lastChange = now;
    }
    return this.current;
  }

  reset(): void {
    this.current = CUES.begin;
    this.lastChange = -Infinity;
  }
}
