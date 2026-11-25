/**
 * L.I.F.E. Camera View
 * Webcam preview + skeleton overlay. Feeds every frame into the vision pipeline and reports
 * throttled snapshots (~10 per second) to the parent.
 */

import { useEffect, useRef, useState } from 'react';
import { camera, useCamera } from '../vision/camera';
import { pose } from '../vision/pose';
import type { SessionPipeline, PipelineSnapshot } from '../vision/pipeline';
import type { CameraConfig } from '../api/types';
import { CameraIcon, RefreshIcon } from './icons';
import './CameraView.css';

export interface CameraStatus {
  modelReady: boolean;
  cameraOn: boolean;
  error: string | null;
}

interface CameraViewProps {
  enabled: boolean;
  pipeline: SessionPipeline;
  config: CameraConfig;
  angleThreshold: number;
  showCue: boolean;
  /** A step prompt (e.g. "Give 2 breaths") shown instead of the coaching cue. */
  cueOverride?: { text: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } | null;
  onSnapshot?: (snapshot: PipelineSnapshot) => void;
  onStatusChange?: (status: CameraStatus) => void;
}

const SNAPSHOT_INTERVAL_MS = 100;

export function CameraView({ enabled, pipeline, config, angleThreshold, showCue, cueOverride, onSnapshot, onStatusChange }: CameraViewProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [modelReady, setModelReady] = useState(pose.isLoaded);
  const [modelError, setModelError] = useState<string | null>(null);
  const [cameraOn, setCameraOn] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  const [snapshot, setSnapshot] = useState<PipelineSnapshot | null>(null);
  const [showDevices, setShowDevices] = useState(false);
  const { error: cameraError, devices, selectedDeviceId, switchDevice, enumerateDevices } = useCamera();

  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;
  const onStatusRef = useRef(onStatusChange);
  onStatusRef.current = onStatusChange;

  // Load the pose model once.
  useEffect(() => {
    let cancelled = false;
    pose.initialize()
      .then(() => { if (!cancelled) setModelReady(true); })
      .catch(error => { if (!cancelled) setModelError(error instanceof Error ? error.message : String(error)); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    camera.setConfig(config);
  }, [config]);

  // Camera + per-frame processing.
  useEffect(() => {
    const video = videoRef.current;
    if (!enabled || !modelReady || !video) return;

    let cancelled = false;
    (async () => {
      try {
        await camera.start(video);
        if (cancelled) return;
        setCameraOn(true);
        pose.start(video, canvasRef.current, frame => pipeline.processFrame(frame), () => pipeline.overlayState());
        void enumerateDevices().catch(() => undefined);
      } catch {
        // camera.start already published a friendly error through useCamera().
        if (!cancelled) setCameraOn(false);
      }
    })();

    return () => {
      cancelled = true;
      pose.stop();
      camera.stop();
      setCameraOn(false);
    };
  }, [enabled, modelReady, pipeline, retryKey, enumerateDevices]);

  // Throttled snapshots for the UI.
  useEffect(() => {
    if (!cameraOn) {
      setSnapshot(null);
      return;
    }
    const interval = window.setInterval(() => {
      const next = pipeline.snapshot();
      setSnapshot(next);
      onSnapshotRef.current?.(next);
    }, SNAPSHOT_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [cameraOn, pipeline]);

  const error = modelError ?? (enabled ? cameraError : null);
  useEffect(() => {
    onStatusRef.current?.({ modelReady, cameraOn, error });
  }, [modelReady, cameraOn, error]);

  const handleDeviceChange = async (deviceId: string) => {
    setShowDevices(false);
    try {
      await switchDevice(deviceId);
    } catch {
      // error is shown through useCamera()
    }
  };

  const cue = cueOverride ?? snapshot?.cue;
  const placeholder = !enabled
    ? 'Select a trainee to turn on the camera'
    : modelError
      ? null
      : !modelReady
        ? 'Loading the local body-tracking model...'
        : !cameraOn && !cameraError
          ? 'Starting camera...'
          : null;

  return (
    <div className="camera-container">
      <video ref={videoRef} className="camera-video" muted playsInline aria-label="Camera preview" />
      <canvas ref={canvasRef} className="camera-overlay" aria-hidden="true" />

      {placeholder && (
        <div className="camera-placeholder">
          <CameraIcon size={64} />
          <p>{placeholder}</p>
        </div>
      )}

      {error && (
        <div className="camera-error" role="alert">
          <p>{error}</p>
          {!modelError && (
            <div className="camera-error-actions">
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setRetryKey(key => key + 1)}>
                <RefreshIcon /> Retry camera
              </button>
              {devices.length > 1 && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowDevices(true)}>
                  Choose camera
                </button>
              )}
            </div>
          )}
        </div>
      )}

      {cameraOn && snapshot && (
        <>
          <div className="tracking-status" aria-live="polite">
            <span className={`status-dot ${snapshot.personVisible ? (snapshot.armVisible ? 'ok' : 'warn') : 'bad'}`} />
            {!snapshot.personVisible
              ? 'No person detected'
              : !snapshot.armVisible
                ? 'Arm not visible'
                : `Tracking ${snapshot.side} arm`}
            <span className="fps">{snapshot.fps} FPS · {snapshot.latencyMs} ms</span>
          </div>

          {devices.length > 1 && (
            <button type="button" className="camera-switch btn btn-sm btn-secondary" onClick={() => setShowDevices(true)}>
              <CameraIcon /> Camera
            </button>
          )}

          <div className={`elbow-angle-indicator ${snapshot.elbowLocked ? 'locked' : ''}`}>
            <strong>Elbow: {snapshot.elbowAngle === null ? '--' : `${snapshot.elbowAngle}°`}</strong>
            <span>Target ≥ {angleThreshold}° (arms straight)</span>
          </div>

          {showCue && cue && (
            <div className={`coach-cue tone-${cue.tone}`} role="status" aria-live="assertive">
              {cue.text}
            </div>
          )}
        </>
      )}

      {showDevices && devices.length > 1 && (
        <div className="device-selector-overlay" onClick={() => setShowDevices(false)}>
          <div className="device-selector" role="dialog" aria-label="Select camera" onClick={event => event.stopPropagation()}>
            <h4>Select Camera</h4>
            {devices.map(device => (
              <button
                type="button"
                key={device.deviceId}
                className={`device-option ${selectedDeviceId === device.deviceId ? 'selected' : ''}`}
                onClick={() => void handleDeviceChange(device.deviceId)}
              >
                {device.label}
              </button>
            ))}
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowDevices(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
