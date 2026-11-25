/**
 * L.I.F.E. Live Session Page
 *
 * Flow: select trainee -> camera preview (Ready) -> 3-2-1 countdown -> In Progress -> Completed.
 * The camera runs during Ready so the trainee can get into position before the timer starts,
 * and Start is only enabled once a person and the tracked arm are visible.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type ProcedureSteps, type Session, type Settings, type Trainee } from '../api/client';
import { useOutbox } from '../hooks/useOutbox';
import { useAuth } from '../hooks/useAuth';
import { useChoicePreference, usePreference } from '../hooks/usePreference';
import { CameraView, type CameraStatus } from '../components/CameraView';
import { FeedbackOverlay, type SessionPhase } from '../components/FeedbackOverlay';
import { SessionSummary, type SummaryData } from '../components/SessionSummary';
import { Banner, Modal } from '../components/ui';
import { CheckCircleIcon, CloseIcon, HistoryIcon, PlayIcon, RefreshIcon, StopIcon, VolumeIcon, VolumeOffIcon } from '../components/icons';
import { SessionPipeline, type PipelineSnapshot } from '../vision/pipeline';
import { Metronome } from '../utils/metronome';
import { errorMessage, formatDuration } from '../utils/format';
import type { SessionMetrics } from '../api/types';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../utils/settingsSchema';
import { CHECKLIST as PROCEDURE_STEP_ITEMS, EMPTY_PROCEDURE_STEPS } from '../cpr/protocol';
import {
  AED_STEPS, breathPromptOverdue, compressionsInCycle, compressionsPastCycle, compressionsPerCycle, currentStep, evaluateProcedure, initialCycle,
  preCompressionStepsDone, restartCycle, tickInOrder, updateCycle,
  type AedOutcome, type CprMode, type CycleState, type Rescuers, type Victim,
} from '../cpr/flow';
import { CprStepper, type AedView } from '../components/CprStepper';
import { pose } from '../vision/pose';
import './LiveSessionPage.css';

const COUNTDOWN_SECONDS = 3;
const LIVE_UPDATE_MS = 2000;
const MIN_PERSON_FRAME_RATIO = 0.5;

type SaveState =
  | { kind: 'saving' }
  | { kind: 'saved' }
  | { kind: 'queued'; message: string }
  | { kind: 'rejected'; message: string }
  | { kind: 'invalid'; message: string };

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(target.closest('input, select, textarea, button, a, [contenteditable="true"], [role="dialog"]'));
}

export function LiveSessionPage() {
  const navigate = useNavigate();
  const { saveSession } = useOutbox();
  // Trainee accounts practise as themselves: no trainee picker, own profile only.
  const { isTrainee } = useAuth();

  const [trainees, setTrainees] = useState<Trainee[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [settingCorrections, setSettingCorrections] = useState<string[]>([]);
  const [selectedTraineeId, setSelectedTraineeId] = useState<number | null>(null);
  const [phase, setPhase] = useState<SessionPhase>('Setup');
  const [countdown, setCountdown] = useState<number | null>(null);
  const [snapshot, setSnapshot] = useState<PipelineSnapshot | null>(null);
  const [cameraStatus, setCameraStatus] = useState<CameraStatus>({ modelReady: false, cameraOn: false, error: null });
  const [elapsedSec, setElapsedSec] = useState(0);
  const [procedureSteps, setProcedureSteps] = useState<ProcedureSteps>({ ...EMPTY_PROCEDURE_STEPS });
  const [summaryData, setSummaryData] = useState<SummaryData | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [saveState, setSaveState] = useState<SaveState | null>(null);
  const [metronomeOn, setMetronomeOn] = usePreference('life_metronome', false);
  const [voiceOn, setVoiceOn] = usePreference('life_voice_cues', false);
  const [beat, setBeat] = useState(false);
  const [fingersOn, setFingersOn] = usePreference('life_finger_tracking', true);
  const [breathsMode, setBreathsMode] = usePreference('life_cpr_breaths', true);
  const cprMode: CprMode = breathsMode ? 'breaths' : 'hands-only';
  const [victim, setVictim] = useChoicePreference<Victim>('life_cpr_victim', 'adult', ['adult', 'child', 'infant']);
  const [rescuerChoice, setRescuerChoice] = useChoicePreference<'1' | '2'>('life_cpr_rescuers', '1', ['1', '2']);
  const rescuers: Rescuers = rescuerChoice === '2' ? 2 : 1;
  const perCycle = compressionsPerCycle(victim, rescuers);
  const perCycleRef = useRef(perCycle);
  perCycleRef.current = perCycle;
  const [cycle, setCycle] = useState<CycleState>(() => initialCycle());
  const [aed, setAed] = useState<AedView>({ active: false, step: 0, shocks: 0, used: false });
  const [skipPreSteps, setSkipPreSteps] = useState(false);
  const [resumeCueUntil, setResumeCueUntil] = useState(0);
  const cycleRef = useRef(cycle);
  cycleRef.current = cycle;
  const aedRef = useRef(aed);
  aedRef.current = aed;
  const cprModeRef = useRef(cprMode);
  cprModeRef.current = cprMode;

  const pipeline = useMemo(() => new SessionPipeline(), []);
  const metronome = useMemo(() => new Metronome(), []);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const snapshotRef = useRef<PipelineSnapshot | null>(null);
  const startTimeRef = useRef(0);
  const countdownTimerRef = useRef<number | null>(null);
  const clientSessionIdRef = useRef<string | null>(null);
  const previousSessionRef = useRef<Session | null>(null);
  const procedureRef = useRef(procedureSteps);
  procedureRef.current = procedureSteps;
  const selectedTraineeRef = useRef<number | null>(null);
  selectedTraineeRef.current = selectedTraineeId;

  const selectedTrainee = trainees.find(trainee => trainee.trainee_id === selectedTraineeId) ?? null;
  const durationSec = settings.session_duration_sec;

  // ---- Load trainees and settings ----
  useEffect(() => {
    (async () => {
      try {
        if (isTrainee) {
          const [mine, settingsRes] = await Promise.all([api.getMyProgress(), api.getSettings()]);
          const me: Trainee = {
            trainee_id: mine.trainee.trainee_id,
            full_name: mine.trainee.full_name,
            organization: mine.trainee.organization,
            notes: null,
            consent_given: Boolean(mine.trainee.consent_given),
            is_active: mine.trainee.is_active !== false,
            date_registered: mine.trainee.date_registered,
          };
          setTrainees([me]);
          setSelectedTraineeId(me.trainee_id);
          previousSessionRef.current = mine.sessions[0] ?? null;
          const { settings: safe, corrections } = sanitizeSettings(settingsRes.settings);
          setSettings(safe);
          setSettingCorrections(corrections);
          return;
        }
        const [traineesRes, settingsRes] = await Promise.all([
          api.getTrainees({ is_active: true }),
          api.getSettings(),
        ]);
        setTrainees(traineesRes.trainees);
        const { settings: safe, corrections } = sanitizeSettings(settingsRes.settings);
        setSettings(safe);
        setSettingCorrections(corrections);
      } catch (err) {
        setError(errorMessage(err, 'Failed to load trainees and settings'));
      } finally {
        setLoading(false);
      }
    })();
  }, [isTrainee]);

  useEffect(() => {
    pipeline.setConfig({
      angleThreshold: settings.angle_threshold,
      smoothingWindow: settings.smoothing_window,
      visibilityThreshold: settings.visibility_threshold,
      minPeakDistanceMs: settings.min_peak_distance_ms,
      peakProminence: settings.peak_prominence,
      bpmMin: settings.bpm_min,
      bpmMax: settings.bpm_max,
      bpmWindowIntervals: settings.bpm_window_intervals,
    });
    metronome.setBpm(settings.metronome_bpm);
  }, [settings, pipeline, metronome]);

  const cameraConfig = useMemo(() => ({
    width: settings.camera_width,
    height: settings.camera_height,
    frameRate: settings.camera_framerate,
  }), [settings.camera_width, settings.camera_height, settings.camera_framerate]);

  // ---- Trainee selection ----
  useEffect(() => {
    previousSessionRef.current = null;
    if (!selectedTraineeId) {
      setPhase('Setup');
      return;
    }
    setPhase(current => (current === 'Setup' ? 'Ready' : current));
    if (isTrainee) return; // the previous session came with the trainee's own progress
    api.getSessions({ trainee_id: selectedTraineeId, limit: 1 })
      .then(res => { previousSessionRef.current = res.sessions[0] ?? null; })
      .catch(() => undefined);
  }, [selectedTraineeId, isTrainee]);

  const handleSnapshot = useCallback((next: PipelineSnapshot) => {
    snapshotRef.current = next;
    setSnapshot(next);
    if (phaseRef.current !== 'In Progress') return;
    const total = next.summary.totalCompressions;
    if (total > 0 && !procedureRef.current.cpr_started) {
      setProcedureSteps(steps => ({ ...steps, cpr_started: true }));
    }
    // 30:2 cycle (paused while the AED is in use).
    if (!aedRef.current.active) {
      const updated = updateCycle(cycleRef.current, total, performance.now(), cprModeRef.current, perCycleRef.current);
      if (updated !== cycleRef.current) {
        cycleRef.current = updated;
        setCycle(updated);
      }
      const continued = cprModeRef.current === 'breaths' ? updated.completedCycles >= 1 : total >= perCycleRef.current;
      if (continued && !procedureRef.current.cpr_continued) {
        setProcedureSteps(steps => ({ ...steps, cpr_continued: true }));
      }
    }
  }, []);

  // Finger tracking on/off (the wrist-based hand check works either way).
  useEffect(() => {
    pose.setHandsEnabled(fingersOn);
  }, [fingersOn]);

  // ---- AED (step 5) ----
  const startAed = () => setAed(current => ({ ...current, active: true, step: 0 }));
  const nextAedStep = () => setAed(current => ({ ...current, step: Math.min(current.step + 1, AED_STEPS.length) }));
  const finishAed = (outcome: AedOutcome) => {
    setAed(current => ({ ...current, active: false, step: 0, used: true, shocks: current.shocks + (outcome === 'shock' ? 1 : 0) }));
    setProcedureSteps(steps => ({ ...steps, aed_used: true }));
    const total = snapshotRef.current?.summary.totalCompressions ?? 0;
    const restarted = restartCycle(cycleRef.current, total, performance.now());
    cycleRef.current = restarted;
    setCycle(restarted);
    setResumeCueUntil(performance.now() + 4000);
  };

  // ---- Metronome ----
  useEffect(() => {
    metronome.setOnBeat(() => {
      setBeat(true);
      window.setTimeout(() => setBeat(false), 90);
    });
    return () => metronome.dispose();
  }, [metronome]);

  useEffect(() => {
    const shouldPlay = metronomeOn && (phase === 'Countdown' || phase === 'In Progress');
    if (shouldPlay) void metronome.start(settings.metronome_bpm);
    else metronome.stop();
  }, [metronomeOn, phase, metronome, settings.metronome_bpm]);

  // ---- Spoken cues ----
  // Step prompts (breaths, AED, resume) take priority over the posture/rate coaching cue.
  const now = performance.now();
  const breathPrompt = phase === 'In Progress' && cprMode === 'breaths' && cycle.promptAt !== null && !aed.active;
  const breathOverdue = breathPrompt && breathPromptOverdue(cycle, now);
  const cueOverride = phase !== 'In Progress'
    ? null
    : aed.active
      ? { text: aed.step < AED_STEPS.length ? `AED: ${AED_STEPS[aed.step]}` : 'AED: follow the voice prompt (shock or no shock)', tone: 'warn' as const }
      : now < resumeCueUntil
        ? { text: 'Resume CPR now', tone: 'bad' as const }
        : breathPrompt && compressionsPastCycle(cycle, snapshot?.summary.totalCompressions ?? 0) >= 3
          ? { text: 'Stop — give 2 breaths now', tone: 'bad' as const }
        : breathOverdue
          ? { text: 'Resume compressions now', tone: 'bad' as const }
          : breathPrompt
            ? { text: `${perCycle} done: give 2 breaths`, tone: 'neutral' as const }
            : null;
  const spokenText = cueOverride?.text ?? snapshot?.cue.text;
  useEffect(() => {
    if (!voiceOn || phase !== 'In Progress' || !spokenText || !('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(spokenText.replace(/[\u2014:]/g, ','));
    utterance.rate = 1.1;
    window.speechSynthesis.speak(utterance);
  }, [spokenText, voiceOn, phase]);

  // Re-render while a time-based prompt is showing (resume cue, 10 s breath limit).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (phase !== 'In Progress' || (!breathPrompt && resumeCueUntil === 0)) return;
    const timer = window.setInterval(() => {
      setTick(value => value + 1);
      setResumeCueUntil(value => (value !== 0 && performance.now() > value ? 0 : value));
    }, 500);
    return () => window.clearInterval(timer);
  }, [phase, breathPrompt, resumeCueUntil]);

  // ---- Session lifecycle ----
  const clearCountdown = () => {
    if (countdownTimerRef.current !== null) window.clearInterval(countdownTimerRef.current);
    countdownTimerRef.current = null;
    setCountdown(null);
  };

  const beginSession = useCallback(() => {
    pipeline.startScoring();
    startTimeRef.current = performance.now();
    clientSessionIdRef.current = crypto.randomUUID();
    setElapsedSec(0);
    setProcedureSteps(steps => ({ ...steps, cpr_started: false, cpr_continued: false, aed_used: false }));
    const fresh = initialCycle(performance.now());
    cycleRef.current = fresh;
    setCycle(fresh);
    setAed({ active: false, step: 0, shocks: 0, used: false });
    setSummaryData(null);
    setSaveState(null);
    setPhase('In Progress');
  }, [pipeline]);

  const startCountdown = useCallback(() => {
    if (phaseRef.current !== 'Ready' || countdownTimerRef.current !== null) return;
    setError('');
    setPhase('Countdown');
    let remaining = COUNTDOWN_SECONDS;
    setCountdown(remaining);
    countdownTimerRef.current = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearCountdown();
        beginSession();
      } else {
        setCountdown(remaining);
      }
    }, 1000);
  }, [beginSession]);

  const finishSession = useCallback(async (reason: 'timer' | 'stopped' | 'camera-error') => {
    if (phaseRef.current !== 'In Progress') return;
    phaseRef.current = 'Completed';
    setPhase('Completed');
    pipeline.stopScoring();
    if ('speechSynthesis' in window) window.speechSynthesis.cancel();

    const traineeId = selectedTraineeRef.current!;
    const trainee = trainees.find(item => item.trainee_id === traineeId);
    const summary = pipeline.summary();
    const quality = pipeline.sessionQuality();
    const compressions = pipeline.compressions();
    const handsPct = pipeline.handsStackedPct();
    const procedure = evaluateProcedure({
      steps: { ...procedureRef.current, cpr_started: procedureRef.current.cpr_started || summary.totalCompressions > 0 },
      mode: cprModeRef.current,
      perCycle: perCycleRef.current,
      cycle: cycleRef.current,
      totalCompressions: summary.totalCompressions,
      elapsedSec: Math.min(durationSec, Math.round((performance.now() - startTimeRef.current) / 1000)),
      aedUsed: aedRef.current.used,
      handsStackedPct: handsPct,
    });
    const elapsed = Math.min(durationSec, Math.round((performance.now() - startTimeRef.current) / 1000));
    setElapsedSec(elapsed);
    const steps = { ...procedureRef.current, cpr_started: procedureRef.current.cpr_started || summary.totalCompressions > 0 };
    const provisionalResult = summary.accuracyPct >= settings.pass_mark_pct ? 'Pass' : 'Needs Improvement';

    const data: SummaryData = {
      traineeName: trainee?.full_name ?? 'Trainee',
      result: provisionalResult,
      resultIsProvisional: true,
      summary,
      durationSec: elapsed,
      compressions,
      startTimestamp: startTimeRef.current,
      avgFps: quality.avgFps,
      previous: previousSessionRef.current,
      procedureDone: Object.values(steps).filter(Boolean).length,
      procedureTotal: PROCEDURE_STEP_ITEMS.length,
      handsStackedPct: handsPct,
      cprMode: cprModeRef.current,
      breathCycles: cycleRef.current.completedCycles,
      compressionsPerCycle: perCycleRef.current,
      procedure,
    };
    setSummaryData(data);
    setShowSummary(true);

    const personRatio = quality.totalFrames ? quality.framesWithPerson / quality.totalFrames : 0;
    const invalidReason = reason === 'camera-error'
      ? 'The camera stopped during the session.'
      : quality.totalFrames === 0 || personRatio < MIN_PERSON_FRAME_RATIO
        ? 'The trainee was out of view for most of the session.'
        : summary.totalCompressions === 0
          ? 'No compressions were detected.'
          : summary.scorableCompressions === 0
            ? 'The elbow was not visible at any compression, so none could be scored.'
            : null;

    if (invalidReason) {
      setSaveState({ kind: 'invalid', message: `${invalidReason} This session was not saved, so it will not affect history or the leaderboard.` });
      void api.resetLiveStatus().catch(() => undefined);
      return;
    }

    setSaveState({ kind: 'saving' });
    const timeOrigin = performance.timeOrigin;
    const outcome = await saveSession({
      client_session_id: clientSessionIdRef.current ?? crypto.randomUUID(),
      trainee_id: traineeId,
      duration_sec: elapsed,
      total_compressions: summary.totalCompressions,
      avg_bpm: summary.avgBpm ?? 0,
      elbow_lock_pct: summary.elbowLockPct,
      accuracy_pct: summary.accuracyPct,
      counts: {
        correct: summary.correctCompressions,
        incorrect: summary.scorableCompressions - summary.correctCompressions,
        total: summary.totalCompressions,
        unscorable: summary.unscorableCompressions,
        fps: quality.avgFps,
        latency_ms: quality.avgLatencyMs,
        hands_only: cprModeRef.current === 'hands-only' ? 1 : 0,
        compressions_per_cycle: perCycleRef.current,
        rescuers,
        victim_type: victim === 'adult' ? 0 : victim === 'child' ? 1 : 2,
        breath_cycles: cycleRef.current.completedCycles,
        skipped_breaths: cycleRef.current.skippedBreaths,
        aed_shocks: aedRef.current.shocks,
        long_pauses: cycleRef.current.longPauses,
        procedure_pct: procedure.pct,
        ...(handsPct !== null ? { hands_stacked_pct: handsPct } : {}),
      },
      procedure_steps: steps,
      details: compressions.slice(0, 2000).map(item => ({
        ts: Math.round(timeOrigin + item.timestamp),
        bpm: item.bpm,
        elbow_angle: item.elbowAngle,
        elbow_locked: item.elbowLocked,
      })),
    });

    if (outcome.status === 'saved') {
      setSummaryData(current => current && { ...current, result: outcome.session.result, resultIsProvisional: false });
      setSaveState({ kind: 'saved' });
    } else if (outcome.status === 'queued') {
      setSaveState({ kind: 'queued', message: `${outcome.reason} The session is stored on this computer and will upload automatically.` });
    } else if (outcome.status === 'failed') {
      setSaveState({ kind: 'rejected', message: `This session could not be saved: ${outcome.reason} This browser also blocked local storage (for example a private window), so it could not be kept for a later upload. Use a normal browser window for sessions.` });
    } else {
      setSaveState({ kind: 'rejected', message: `The server did not accept this session: ${outcome.reason} It is kept on this computer — fix the problem, then retry it from the "unsynced" badge at the top.` });
    }
  }, [pipeline, trainees, durationSec, settings.pass_mark_pct, saveSession, rescuers, victim]);

  const finishRef = useRef(finishSession);
  finishRef.current = finishSession;

  const resetFlow = () => {
    const fresh = initialCycle();
    cycleRef.current = fresh;
    setCycle(fresh);
    setAed({ active: false, step: 0, shocks: 0, used: false });
    setSkipPreSteps(false);
    setResumeCueUntil(0);
  };

  const cancelSession = useCallback(() => {
    if (phaseRef.current === 'In Progress' &&
        !window.confirm('Cancel this session? Nothing will be saved.')) {
      return;
    }
    clearCountdown();
    pipeline.stopScoring();
    pipeline.reset();
    setProcedureSteps({ ...EMPTY_PROCEDURE_STEPS });
    setElapsedSec(0);
    resetFlow();
    setPhase(selectedTraineeRef.current ? 'Ready' : 'Setup');
    void api.resetLiveStatus().catch(() => undefined);
  }, [pipeline]);

  const newSession = () => {
    setShowSummary(false);
    setSummaryData(null);
    setSaveState(null);
    setProcedureSteps({ ...EMPTY_PROCEDURE_STEPS });
    setElapsedSec(0);
    resetFlow();
    pipeline.reset();
    setPhase(selectedTraineeId ? 'Ready' : 'Setup');
  };

  // Session timer.
  useEffect(() => {
    if (phase !== 'In Progress') return;
    const interval = window.setInterval(() => {
      const elapsed = Math.floor((performance.now() - startTimeRef.current) / 1000);
      setElapsedSec(Math.min(elapsed, durationSec));
      if (elapsed >= durationSec) void finishRef.current('timer');
    }, 250);
    return () => window.clearInterval(interval);
  }, [phase, durationSec]);

  // Camera failure during a session ends it (and it is not saved).
  useEffect(() => {
    if (phase === 'In Progress' && cameraStatus.error) void finishRef.current('camera-error');
  }, [phase, cameraStatus.error]);

  // Live status for the dashboard monitor.
  useEffect(() => {
    if (phase !== 'In Progress') return;
    const send = () => {
      const snap = snapshotRef.current;
      const traineeId = selectedTraineeRef.current;
      if (!snap || !traineeId) return;
      void api.updateLiveStatus({
        trainee_id: traineeId,
        status: 'In Progress',
        accuracy_pct: snap.summary.accuracyPct,
        bpm: snap.currentBpm ?? snap.summary.avgBpm ?? 0,
        elbow_lock_pct: snap.summary.elbowLockPct,
        compressions: snap.summary.totalCompressions,
        elapsed_sec: Math.floor((performance.now() - startTimeRef.current) / 1000),
      }).catch(() => undefined);
    };
    send();
    const interval = window.setInterval(send, LIVE_UPDATE_MS);
    return () => window.clearInterval(interval);
  }, [phase]);

  // Warn before leaving during a session; clean up on unmount.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (phaseRef.current === 'In Progress' || phaseRef.current === 'Countdown') {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      if (countdownTimerRef.current !== null) window.clearInterval(countdownTimerRef.current);
      if (phaseRef.current === 'In Progress') void api.resetLiveStatus().catch(() => undefined);
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    };
  }, []);

  const consentMissing = Boolean(selectedTrainee && !selectedTrainee.consent_given);
  const readyChecks = [
    { label: 'Body-tracking model loaded', ok: cameraStatus.modelReady },
    { label: 'Camera on', ok: cameraStatus.cameraOn },
    { label: 'Trainee in view', ok: Boolean(snapshot?.personVisible) },
    { label: 'Shoulder, elbow and wrist visible', ok: Boolean(snapshot?.readyToStart) },
  ];
  const preStepsDone = preCompressionStepsDone(procedureSteps);
  const canStart = phase === 'Ready' && !consentMissing && readyChecks.every(check => check.ok) && (preStepsDone || skipPreSteps);
  const stepIndex = currentStep({ phase, steps: procedureSteps, breathPrompt, aedActive: aed.active });

  // Space: start / stop (ignored while typing or when a control has focus).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || event.repeat || isTypingTarget(event.target)) return;
      if (phaseRef.current === 'Ready' && canStart) {
        event.preventDefault();
        startCountdown();
      } else if (phaseRef.current === 'In Progress') {
        event.preventDefault();
        void finishRef.current('stopped');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [canStart, startCountdown]);

  if (loading) return <div className="page-loading">Loading session...</div>;

  const summary = snapshot?.summary;
  const metrics: SessionMetrics = {
    totalCompressions: phase === 'Ready' || phase === 'Setup' ? 0 : summary?.totalCompressions ?? 0,
    correctCompressions: phase === 'Ready' || phase === 'Setup' ? 0 : summary?.correctCompressions ?? 0,
    unscorableCompressions: phase === 'Ready' || phase === 'Setup' ? 0 : summary?.unscorableCompressions ?? 0,
    accuracyPct: phase === 'Ready' || phase === 'Setup' ? 0 : summary?.accuracyPct ?? 0,
    avgBpm: summary?.avgBpm ?? null,
    currentBpm: phase === 'In Progress' ? snapshot?.currentBpm ?? null : null,
    elbowLockPct: phase === 'Ready' || phase === 'Setup' ? 0 : summary?.elbowLockPct ?? 0,
    elapsedSec,
  };
  if (phase === 'Completed' && summaryData) {
    metrics.totalCompressions = summaryData.summary.totalCompressions;
    metrics.correctCompressions = summaryData.summary.correctCompressions;
    metrics.unscorableCompressions = summaryData.summary.unscorableCompressions;
    metrics.accuracyPct = summaryData.summary.accuracyPct;
    metrics.elbowLockPct = summaryData.summary.elbowLockPct;
    metrics.currentBpm = summaryData.summary.avgBpm;
  }

  const sessionActive = phase === 'Countdown' || phase === 'In Progress';

  return (
    <div className="live-session-page">
      <Banner kind="error" onDismiss={() => setError('')}>{error}</Banner>
      {!isTrainee && settingCorrections.length > 0 && (
        <Banner kind="warning" onDismiss={() => setSettingCorrections([])}>
          Some saved settings are invalid, so defaults are used for this session:
          <ul className="banner-list">{settingCorrections.map(item => <li key={item}>{item}</li>)}</ul>
          An admin can correct them on the <Link to="/settings">Settings</Link> page.
        </Banner>
      )}

      <div className="session-header">
        {isTrainee ? (
          <div className="trainee-selector self-practice-label">
            <span className="form-label">Self-practice</span>
            <strong>{selectedTrainee?.full_name ?? 'Loading...'}</strong>
            <small>Your results are saved to My Progress and your trainer can see them.</small>
          </div>
        ) : (
        <div className="trainee-selector">
          <label className="form-label" htmlFor="trainee-select">Trainee</label>
          <select
            id="trainee-select"
            className="form-select"
            value={selectedTraineeId ?? ''}
            onChange={event => setSelectedTraineeId(event.target.value ? Number(event.target.value) : null)}
            disabled={sessionActive}
          >
            <option value="">Choose a trainee...</option>
            {trainees.map(trainee => (
              <option key={trainee.trainee_id} value={trainee.trainee_id}>
                {trainee.full_name}{trainee.organization ? ` (${trainee.organization})` : ''}{trainee.consent_given ? '' : ' — consent pending'}
              </option>
            ))}
          </select>
        </div>
        )}

        <div className="session-toggles">
          <button
            type="button"
            className="toggle-chip"
            aria-pressed={metronomeOn}
            onClick={() => setMetronomeOn(!metronomeOn)}
            title="Audible beat to help keep the target cadence"
          >
            <span className={`metronome-beat ${beat && metronomeOn ? 'on' : ''}`} aria-hidden="true" />
            Metronome {settings.metronome_bpm} BPM
          </button>
          <button
            type="button"
            className="toggle-chip"
            aria-pressed={voiceOn}
            onClick={() => setVoiceOn(!voiceOn)}
            title="Speak the coaching cue aloud"
          >
            {voiceOn ? <VolumeIcon /> : <VolumeOffIcon />} Voice cues
          </button>
          <button
            type="button"
            className="toggle-chip"
            aria-pressed={fingersOn}
            onClick={() => setFingersOn(!fingersOn)}
            title="Track hands and fingers to check hand position (turn off on slow computers)"
          >
            Finger tracking
          </button>
          <span className="session-duration">Duration {formatDuration(durationSec)}</span>
        </div>
      </div>

      {!isTrainee && trainees.length === 0 && (
        <Banner kind="info">No active trainees yet. <Link to="/trainees">Add a trainee</Link> to start a session.</Banner>
      )}
      {consentMissing && (
        <Banner kind="warning">
          {isTrainee
            ? <>Your consent has not been recorded yet. Ask your trainer to record it, then you can practise here.</>
            : <>{selectedTrainee?.full_name} has no recorded consent. Record consent on the <Link to="/trainees">Trainees</Link> page before starting a session.</>}
        </Banner>
      )}

      <div className="live-session-layout">
        <div className="camera-section">
          <div className="camera-stage">
            <CameraView
              enabled={Boolean(selectedTraineeId)}
              pipeline={pipeline}
              config={cameraConfig}
              angleThreshold={settings.angle_threshold}
              showCue={phase === 'In Progress'}
              cueOverride={cueOverride}
              onSnapshot={handleSnapshot}
              onStatusChange={setCameraStatus}
            />
            {countdown !== null && (
              <div className="countdown-overlay" aria-live="assertive">
                <div className="countdown-number" key={countdown}>{countdown}</div>
                <div className="countdown-label">Get ready</div>
              </div>
            )}
          </div>

          {phase === 'Ready' && (
            <div className="readiness" aria-live="polite">
              <strong>Before you start</strong>
              <ul>
                {readyChecks.map(check => (
                  <li key={check.label} className={check.ok ? 'ok' : 'pending'}>
                    {check.ok ? <CheckCircleIcon /> : <span aria-hidden="true">○</span>} {check.label}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="session-controls">
            {(phase === 'Setup' || phase === 'Ready') && (
              <button
                type="button"
                className="btn btn-success btn-lg"
                onClick={startCountdown}
                disabled={!canStart}
                style={{ minWidth: 180 }}
              >
                <PlayIcon /> Start compressions
              </button>
            )}
            {phase === 'Ready' && !preStepsDone && !skipPreSteps && (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setSkipPreSteps(true)} title="Practice compressions only. Steps 1 and 2 will count as not done in the procedure result.">
                Skip to compressions
              </button>
            )}
            {phase === 'Countdown' && (
              <button type="button" className="btn btn-secondary btn-lg" onClick={cancelSession}>
                <CloseIcon /> Cancel Countdown
              </button>
            )}
            {phase === 'In Progress' && (
              <>
                <button type="button" className="btn btn-danger btn-lg" onClick={() => void finishSession('stopped')} style={{ minWidth: 180 }}>
                  <StopIcon /> Stop &amp; Score
                </button>
                <button type="button" className="btn btn-secondary btn-lg" onClick={cancelSession}>
                  <CloseIcon /> Cancel
                </button>
              </>
            )}
            {phase === 'Completed' && (
              <>
                <button type="button" className="btn btn-primary btn-lg" onClick={newSession} style={{ minWidth: 180 }}>
                  <RefreshIcon /> New Session
                </button>
                {summaryData && (
                  <button type="button" className="btn btn-secondary btn-lg" onClick={() => setShowSummary(true)}>
                    View Summary
                  </button>
                )}
              </>
            )}
          </div>

          <div className="keyboard-hint">
            {phase === 'In Progress'
              ? <>Press <kbd>Space</kbd> to stop and score</>
              : phase === 'Ready'
                ? (preStepsDone || skipPreSteps
                  ? <>Press <kbd>Space</kbd> to start when all checks are green</>
                  : <>Complete steps 1 and 2 below, then start compressions</>)
                : null}
          </div>

          {phase !== 'Setup' && (
            <CprStepper
              phase={phase}
              current={stepIndex}
              steps={procedureSteps}
              onToggle={(key, value) => setProcedureSteps(steps => tickInOrder(steps, key, value))}
              mode={cprMode}
              victim={victim}
              onVictimChange={setVictim}
              rescuers={rescuers}
              onRescuersChange={value => setRescuerChoice(value === 2 ? '2' : '1')}
              onModeChange={mode => {
                setBreathsMode(mode === 'breaths');
                const total = snapshotRef.current?.summary.totalCompressions ?? 0;
                const restarted = restartCycle(cycleRef.current, total, performance.now());
                cycleRef.current = restarted;
                setCycle(restarted);
              }}
              cycle={{
                perCycle,
                inCycle: compressionsInCycle(cycle, phase === 'In Progress' ? snapshot?.summary.totalCompressions ?? 0 : 0, perCycle),
                completed: cycle.completedCycles,
                skipped: cycle.skippedBreaths,
                prompt: breathOverdue ? 'overdue' : breathPrompt ? 'breaths' : 'none',
              }}
              aed={aed}
              onAedStart={startAed}
              onAedNext={nextAedStep}
              onAedOutcome={finishAed}
              hands={snapshot?.hands ?? null}
              fingersOn={fingersOn}
              remainingSec={Math.max(0, durationSec - elapsedSec)}
            />
          )}
        </div>

        <div className="feedback-section">
          <FeedbackOverlay
            metrics={metrics}
            phase={phase}
            durationSec={durationSec}
            targets={{
              bpmMin: settings.bpm_min,
              bpmMax: settings.bpm_max,
              angleThreshold: settings.angle_threshold,
              passMark: settings.pass_mark_pct,
            }}
          />
        </div>
      </div>

      {showSummary && summaryData && (
        <Modal
          title="Session Complete"
          subtitle={summaryData.traineeName}
          size="lg"
          onClose={() => setShowSummary(false)}
          actions={
            <>
              <button type="button" className="btn btn-secondary" onClick={() => navigate(isTrainee ? '/my-progress' : '/history')}>
                <HistoryIcon /> {isTrainee ? 'My Progress' : 'View History'}
              </button>
              <button type="button" className="btn btn-primary" onClick={newSession} autoFocus>
                <RefreshIcon /> New Session
              </button>
            </>
          }
        >
          {saveState?.kind === 'saving' && <Banner kind="info">Saving session...</Banner>}
          {saveState?.kind === 'saved' && <Banner kind="success">Session saved.</Banner>}
          {saveState?.kind === 'queued' && <Banner kind="warning">{saveState.message}</Banner>}
          {saveState?.kind === 'rejected' && <Banner kind="error">{saveState.message}</Banner>}
          {saveState?.kind === 'invalid' && <Banner kind="warning">{saveState.message}</Banner>}
          <SessionSummary data={summaryData} bpmMin={settings.bpm_min} bpmMax={settings.bpm_max} />
        </Modal>
      )}
    </div>
  );
}

export default LiveSessionPage;
