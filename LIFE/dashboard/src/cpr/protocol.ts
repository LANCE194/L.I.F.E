/**
 * Adult CPR sequence used throughout L.I.F.E. (Live Session checklist, History, CPR Guide).
 * Based on the American Heart Association Guidelines for CPR and ECC (2025 update).
 * A training reference only; it does not replace hands-on certification.
 */

import type { ProcedureSteps } from '../api/types';

export const PROTOCOL_SOURCE = 'American Heart Association Guidelines for CPR and Emergency Cardiovascular Care (2025 update)';
export const EMERGENCY_NUMBER = '911';

export type StepKey = keyof ProcedureSteps;

export interface ChecklistItem {
  key: StepKey;
  /** Short instruction shown in the Live Session checklist. */
  label: string;
  /** Short past-tense label for History and reports. */
  done: string;
  /** Ticked automatically from camera data. */
  automatic?: boolean;
}

/** Trainer-confirmed checklist, in the order the steps are performed. */
export const CHECKLIST: ChecklistItem[] = [
  { key: 'scene_safe', label: 'Check that the scene is safe', done: 'Scene safety checked' },
  { key: 'response_checked', label: 'Tap the shoulder and shout "Are you OK?"', done: 'Responsiveness checked' },
  { key: 'breathing_checked', label: 'Check breathing (none, or only gasping = cardiac arrest)', done: 'Breathing checked' },
  { key: 'emergency_services_called', label: `Call ${EMERGENCY_NUMBER} and send someone for an AED`, done: `${EMERGENCY_NUMBER} called / AED requested` },
  { key: 'cpr_started', label: 'Start chest compressions (detected by the camera)', done: 'Compressions started', automatic: true },
  { key: 'cpr_continued', label: 'Continue 30:2 with breaths if trained, or hands-only', done: 'CPR continued (30:2 or hands-only)' },
  { key: 'aed_used', label: 'Use the AED as soon as it arrives', done: 'AED used' },
];

export const EMPTY_PROCEDURE_STEPS: ProcedureSteps = Object.fromEntries(CHECKLIST.map(item => [item.key, false])) as unknown as ProcedureSteps;

export interface GuideStep {
  title: string;
  points: string[];
  /** Checklist items this step covers. */
  keys: StepKey[];
}

export const ADULT_SEQUENCE: GuideStep[] = [
  {
    title: 'Check the scene and the person',
    keys: ['scene_safe', 'response_checked', 'breathing_checked'],
    points: [
      'Make sure the scene is safe.',
      'Tap the person\'s shoulder and shout "Are you OK?"',
      'If they do not respond and are not breathing, or are only gasping, treat it as cardiac arrest.',
    ],
  },
  {
    title: 'Call for help',
    keys: ['emergency_services_called'],
    points: [
      `Call ${EMERGENCY_NUMBER} (the Philippine emergency hotline), or have someone else call.`,
      'Send someone to get an AED (automated external defibrillator) if one is nearby.',
    ],
  },
  {
    title: 'Start chest compressions',
    keys: ['cpr_started'],
    points: [
      'Put the heel of one hand on the center of the chest, with the other hand on top. Keep your arms straight and elbows locked.',
      'Push hard, at least 5 cm (2 inches), and fast, at 100–120 compressions per minute.',
      'Let the chest fully recoil after each push, and keep interruptions to a minimum.',
    ],
  },
  {
    title: 'Add rescue breaths only if you are trained',
    keys: ['cpr_continued'],
    points: [
      'Continue cycles of 30 compressions to 2 breaths.',
      'If you are untrained or unwilling to give breaths, hands-only CPR (continuous compressions) is still very effective.',
      'Avoid giving too many breaths or breathing too forcefully.',
    ],
  },
  {
    title: 'Use an AED as soon as it arrives',
    keys: ['aed_used'],
    points: [
      'Turn it on, remove clothing covering the chest and attach the pads.',
      'Follow the voice prompts. If a shock is advised, say "Clear", press the shock button, and resume CPR immediately.',
      'If no shock is advised, resume CPR.',
    ],
  },
  {
    title: 'Keep going',
    keys: [],
    points: [
      'About 5 cycles of 30:2 take roughly 2 minutes. Then check the person and, with two rescuers, switch compressors (the length of a L.I.F.E. practice session).',
      'Continue until emergency responders take over, the person starts breathing normally or moves, or you are too exhausted to continue.',
    ],
  },
];

/** Compression-to-breath ratio by victim and number of rescuers. */
export const RATIO_TABLE: { victim: string; oneRescuer: string; twoRescuers: string }[] = [
  { victim: 'Adult', oneRescuer: '30:2', twoRescuers: '30:2' },
  { victim: 'Child', oneRescuer: '30:2', twoRescuers: '15:2' },
  { victim: 'Infant', oneRescuer: '30:2', twoRescuers: '15:2' },
];

export const CYCLE_FACTS = [
  'One cycle = 30 compressions + 2 breaths (ratio 30:2).',
  'About 5 cycles of 30:2 take roughly 2 minutes; then check the person and switch rescuers. (With 15:2, about 10 cycles.)',
  'Compression rate: 100–120 per minute.',
  'Repeat continuously until help arrives or the person shows signs of life.',
];

export const CHILD_INFANT_NOTES = [
  'Children and infants need changes to the adult sequence. With two rescuers, the ratio for a child is 15 compressions to 2 breaths.',
  'Compression depth and hand technique differ; infants are given compressions with two fingers or two thumbs.',
  'Breaths matter more for children, because cardiac arrest in children is often caused by breathing problems.',
  'L.I.F.E. evaluates adult CPR practice only.',
];

/** What the camera measures versus what the trainer must observe. */
export const MEASURED_BY_LIFE = [
  { item: 'Compression rate 100–120 per minute', measured: true },
  { item: 'Arms straight, elbows locked', measured: true },
  { item: 'Interruptions (pauses longer than 1.5 s start a new run)', measured: true },
  { item: 'Hands stacked, one on top of the other (finger tracking)', measured: true },
  { item: 'Cycles: breath prompt after 30 (or 15) compressions, progress toward about 5 cycles in 2 minutes', measured: true },
  { item: 'Depth of at least 5 cm', measured: false },
  { item: 'Full chest recoil', measured: false },
  { item: 'Hands exactly on the center of the chest', measured: false },
  { item: 'Quality of the rescue breaths (chest rise, not too forceful)', measured: false },
];
