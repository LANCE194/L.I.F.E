/**
 * Step-by-step adult CPR (AHA 2025) for the Live Session.
 * Shows all six steps; the current one is expanded with its instructions and controls.
 */

import type { ProcedureSteps } from '../api/types';
import { ADULT_SEQUENCE, EMERGENCY_NUMBER } from '../cpr/protocol';
import { AED_STEPS, BREATHS_PER_CYCLE, canTick, cyclesPerTwoMinutes, type AedOutcome, type CprMode, type FlowPhase, type Rescuers, type Victim } from '../cpr/flow';
import type { HandsSnapshot } from '../vision/pipeline';
import { CheckCircleIcon } from './icons';
import { formatDuration } from '../utils/format';
import './CprStepper.css';

export interface CycleView {
  perCycle: number;
  inCycle: number;
  completed: number;
  skipped: number;
  prompt: 'none' | 'breaths' | 'overdue';
}

export interface AedView {
  active: boolean;
  step: number;          // 0..AED_STEPS.length (== length: waiting for the AED's decision)
  shocks: number;
  used: boolean;
}

interface CprStepperProps {
  phase: FlowPhase;
  current: number;
  steps: ProcedureSteps;
  onToggle: (key: keyof ProcedureSteps, value: boolean) => void;
  mode: CprMode;
  onModeChange: (mode: CprMode) => void;
  victim: Victim;
  onVictimChange: (victim: Victim) => void;
  rescuers: Rescuers;
  onRescuersChange: (rescuers: Rescuers) => void;
  cycle: CycleView;
  aed: AedView;
  onAedStart: () => void;
  onAedNext: () => void;
  onAedOutcome: (outcome: AedOutcome) => void;
  hands: HandsSnapshot | null;
  fingersOn: boolean;
  remainingSec: number;
}

function HandStatus({ hands, fingersOn }: { hands: HandsSnapshot | null; fingersOn: boolean }) {
  if (!hands || hands.stacked === null) {
    return <span className="hand-chip neutral">Hands: not visible{fingersOn ? '' : ' (finger tracking off)'}</span>;
  }
  return (
    <span className={`hand-chip ${hands.stacked ? 'good' : 'bad'}`}>
      {hands.stacked ? 'Hands stacked ✓' : 'Hands apart — put one hand on top of the other'}
      <small>{hands.source === 'hands' ? `${hands.handCount} hands, fingers tracked` : 'from wrist position'}</small>
    </span>
  );
}

export function CprStepper(props: CprStepperProps) {
  const { phase, current, steps, onToggle, mode, onModeChange, victim, rescuers, cycle, aed, hands, fingersOn, remainingSec } = props;
  const ratio = `${cycle.perCycle}:${BREATHS_PER_CYCLE}`;
  const targetCycles = cyclesPerTwoMinutes(cycle.perCycle);
  const live = phase === 'In Progress';
  const editable = phase === 'Ready' || phase === 'Setup';

  const done = [
    steps.scene_safe && steps.response_checked && steps.breathing_checked,
    steps.emergency_services_called,
    steps.cpr_started,
    steps.cpr_continued,
    steps.aed_used,
    phase === 'Completed',
  ];

  // Steps must be done in order: an item unlocks only after the items before it.
  const check = (key: keyof ProcedureSteps, label: string) => {
    const locked = !steps[key] && !canTick(steps, key);
    return (
      <label className={`stepper-check ${locked ? 'locked' : ''}`} title={locked ? 'Do the previous step first' : undefined}>
        <input type="checkbox" checked={steps[key]} disabled={!editable || locked} onChange={event => onToggle(key, event.target.checked)} />
        <span>{label}{locked && <small> (after the previous step)</small>}</span>
      </label>
    );
  };

  const controls = (index: number) => {
    switch (index) {
      case 0:
        return (
          <div className="stepper-controls">
            {check('scene_safe', 'Scene is safe')}
            {check('response_checked', 'Tapped the shoulder and shouted "Are you OK?" — no response')}
            {check('breathing_checked', 'Not breathing, or only gasping')}
          </div>
        );
      case 1:
        return <div className="stepper-controls">{check('emergency_services_called', `${EMERGENCY_NUMBER} called and someone sent for an AED`)}</div>;
      case 2:
        return (
          <div className="stepper-controls">
            <div className="hand-guide">
              <HandGuideIcon />
              <span>Heel of one hand on the <strong>center of the chest</strong>, other hand on top, fingers interlaced and lifted. Arms straight, shoulders over the hands.</span>
            </div>
            <HandStatus hands={hands} fingersOn={fingersOn} />
            {hands?.stackedPct !== null && hands?.stackedPct !== undefined && live && (
              <span className="stepper-muted">Hands stacked on {hands.stackedPct.toFixed(0)}% of compressions so far</span>
            )}
            {!live && phase !== 'Completed' && <span className="stepper-muted">Press <strong>Start compressions</strong> when ready. The camera checks rate and elbows; the trainer watches depth (at least 5 cm) and full recoil.</span>}
          </div>
        );
      case 3:
        return (
          <div className="stepper-controls">
            <div className="ratio-pickers">
              <label>
                <span>Victim</span>
                <select className="form-select" value={victim} disabled={live} onChange={event => props.onVictimChange(event.target.value as Victim)}>
                  <option value="adult">Adult</option>
                  <option value="child">Child</option>
                  <option value="infant">Infant</option>
                </select>
              </label>
              <label>
                <span>Rescuers</span>
                <select className="form-select" value={rescuers} disabled={live} onChange={event => props.onRescuersChange(Number(event.target.value) as Rescuers)}>
                  <option value={1}>1 rescuer</option>
                  <option value={2}>2 rescuers</option>
                </select>
              </label>
              <span className="ratio-badge" title="Compressions : breaths">{ratio}</span>
            </div>
            {victim !== 'adult' && (
              <span className="stepper-note">
                {victim === 'infant'
                  ? 'Infant CPR uses two fingers or two thumbs. L.I.F.E. scores adult technique, so the elbow and hand checks do not apply; use the counts for ratio practice.'
                  : 'Child CPR may use one or two hands and a shallower depth. L.I.F.E. scores adult technique; treat the elbow check as a guide.'}
              </span>
            )}
            <div className="mode-switch" role="radiogroup" aria-label="Breaths">
              <button type="button" role="radio" aria-checked={mode === 'breaths'} className={mode === 'breaths' ? 'on' : ''} onClick={() => onModeChange('breaths')}>
                {ratio} with breaths (trained)
              </button>
              <button type="button" role="radio" aria-checked={mode === 'hands-only'} className={mode === 'hands-only' ? 'on' : ''} onClick={() => onModeChange('hands-only')}>
                Hands-only
              </button>
            </div>
            {mode === 'breaths' ? (
              <>
                <div className="cycle-meter" aria-live="polite">
                  <div className="cycle-bar"><div style={{ width: `${(cycle.inCycle / cycle.perCycle) * 100}%` }} /></div>
                  <span><strong>{cycle.inCycle}</strong>/{cycle.perCycle} compressions · cycle {Math.min(cycle.completed + 1, targetCycles)} of about {targetCycles} in 2 minutes{cycle.skipped ? ` · breaths skipped ${cycle.skipped}×` : ''}</span>
                  <div className="cycle-dots" aria-label={`${cycle.completed} of about ${targetCycles} cycles completed`}>
                    {Array.from({ length: targetCycles }, (_, index) => (
                      <span key={index} className={index < cycle.completed ? 'done' : index === cycle.completed ? 'current' : ''} />
                    ))}
                    {cycle.completed > targetCycles && <small>+{cycle.completed - targetCycles}</small>}
                  </div>
                </div>
                {cycle.prompt !== 'none' && (
                  <div className={`breath-prompt ${cycle.prompt}`} role="status">
                    {cycle.prompt === 'overdue'
                      ? 'Resume compressions now — keep the pause under 10 seconds'
                      : `Give ${BREATHS_PER_CYCLE} breaths (about 1 second each, just enough to make the chest rise), then resume`}
                  </div>
                )}
              </>
            ) : (
              <span className="stepper-muted">Continuous compressions, no pauses for breaths.</span>
            )}
          </div>
        );
      case 4:
        if (!aed.active) {
          return (
            <div className="stepper-controls">
              <button type="button" className="btn btn-secondary btn-sm" onClick={props.onAedStart} disabled={!live}>
                AED has arrived
              </button>
              {aed.used && <span className="stepper-muted">AED used{aed.shocks ? ` · ${aed.shocks} shock${aed.shocks === 1 ? '' : 's'} delivered` : ''}</span>}
              {!live && !aed.used && <span className="stepper-muted">Available during the session.</span>}
            </div>
          );
        }
        return (
          <div className="stepper-controls">
            <ol className="aed-steps">
              {AED_STEPS.map((text, index) => (
                <li key={text} className={index < aed.step ? 'done' : index === aed.step ? 'current' : ''}>{text}</li>
              ))}
            </ol>
            {aed.step < AED_STEPS.length ? (
              <button type="button" className="btn btn-primary btn-sm" onClick={props.onAedNext}>Done — next</button>
            ) : (
              <div className="aed-decision">
                <button type="button" className="btn btn-danger btn-sm" onClick={() => props.onAedOutcome('shock')}>Shock advised: "Clear!" — shock given</button>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => props.onAedOutcome('no-shock')}>No shock advised</button>
              </div>
            )}
            <span className="stepper-muted">Resume CPR immediately after the shock or the no-shock message.</span>
          </div>
        );
      case 5:
        return (
          <div className="stepper-controls">
            <span className="stepper-muted">
              {phase === 'Completed'
                ? `2 minutes done (about ${targetCycles} cycles of ${ratio}): check the person${rescuers === 2 ? ' and switch compressors now' : ''}.`
                : live
                  ? `About ${targetCycles} cycles of ${ratio} in 2 minutes. ${rescuers === 2 ? 'Switch compressors' : 'Check the person'} in ${formatDuration(remainingSec)}.`
                  : 'Continue until responders take over, the person breathes normally or moves, or you are too exhausted.'}
            </span>
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <section className="cpr-stepper" aria-labelledby="cpr-stepper-title">
      <h3 id="cpr-stepper-title">Adult CPR, step by step <small>AHA 2025</small></h3>
      <ol>
        {ADULT_SEQUENCE.map((step, index) => {
          const state = index === current ? 'current' : done[index] ? 'done' : index < current ? 'missed' : 'upcoming';
          // Steps 4 and 5 stay open during the session (breath cycles, AED button); step 4 is also open
          // before the session so the trainer can choose 30:2 or hands-only.
          const open = index === current || (live && (index === 4 || index === 3)) || (phase === 'Ready' && index === 3);
          return (
            <li key={step.title} className={`stepper-step ${state}`} aria-current={index === current ? 'step' : undefined}>
              <div className="stepper-head">
                <span className="stepper-number">{done[index] && index !== current ? <CheckCircleIcon size={16} /> : index + 1}</span>
                <span className="stepper-title">{step.title}</span>
              </div>
              {open && (
                <div className="stepper-body">
                  {index === current && (
                    <ul className="stepper-points">{step.points.map(point => <li key={point}>{point}</li>)}</ul>
                  )}
                  {controls(index)}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function HandGuideIcon() {
  // Two stacked hands with interlaced fingers.
  return (
    <svg width="44" height="44" viewBox="0 0 48 48" aria-hidden="true" className="hand-guide-icon">
      <ellipse cx="24" cy="34" rx="15" ry="7" fill="rgba(168,22,56,0.12)" />
      <path d="M12 30c0-6 5-10 12-10s12 4 12 10c0 3-2 5-5 5H17c-3 0-5-2-5-5z" fill="#e3b657" stroke="#8a6420" strokeWidth="1.5" />
      <path d="M14 24c0-5 4-9 10-9s10 4 10 9" fill="none" stroke="#8a6420" strokeWidth="1.5" />
      {[16, 20, 24, 28, 32].map(x => <path key={x} d={`M${x} 22v-8`} stroke="#8a6420" strokeWidth="2.5" strokeLinecap="round" />)}
      <circle cx="24" cy="34" r="2.5" fill="#a81638" />
    </svg>
  );
}

export default CprStepper;
