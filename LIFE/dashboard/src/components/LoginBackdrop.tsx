/**
 * Moving background for the sign-in screens.
 *  - If src/assets/login-bg.mp4 (or .webm) exists at build time, it plays as a muted loop.
 *  - Otherwise an animated CPR scene is drawn on a canvas (offline, no video file needed).
 * Respects "reduce motion" (a still frame) and offers a pause button that is remembered.
 */

import { useEffect, useRef, useState } from 'react';
import { usePreference } from '../hooks/usePreference';
import { createSceneState, drawScene } from '../utils/loginScene';
import { PlayIcon } from './icons';
import './LoginBackdrop.css';

// Resolved at build time: no request is made when no video has been added.
const videoModules = import.meta.glob('../assets/login-bg.{mp4,webm}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;
const VIDEO_URL = Object.values(videoModules)[0] ?? null;

const FRAME_MS = 1000 / 30;

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

export function LoginBackdrop() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [paused, setPaused] = usePreference('life_login_bg_paused', false);
  const [reduced] = useState(prefersReducedMotion);
  const [videoFailed, setVideoFailed] = useState(false);
  const useVideo = Boolean(VIDEO_URL) && !videoFailed;
  const still = paused || reduced;

  // Canvas scene.
  useEffect(() => {
    if (useVideo) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const state = createSceneState();
    let raf = 0;
    let start = performance.now();
    let last = 0;
    let frozenAt = 3.2; // a representative moment for the still frame (mid-compression)

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
    };

    const render = (t: number) => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      // After the tab was hidden, don't try to catch up on missed ECG samples.
      if (t - state.lastSampleT > 2) state.lastSampleT = Math.max(0, t - 2);
      drawScene(ctx, canvas.width, canvas.height, t, state, dpr);
    };

    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      if (now - last < FRAME_MS) return;
      last = now;
      render((now - start) / 1000);
    };

    const drawStill = () => {
      // Pre-fill the ECG trace so the still frame looks complete.
      for (let t = Math.max(0, frozenAt - 6); t <= frozenAt; t += 1 / 30) render(t);
    };

    resize();
    if (still) {
      drawStill();
    } else {
      start = performance.now() - frozenAt * 1000;
      raf = requestAnimationFrame(loop);
    }

    const onResize = () => {
      resize();
      if (still) drawStill();
    };
    window.addEventListener('resize', onResize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      frozenAt = 0;
    };
  }, [useVideo, still]);

  // Video: pause/resume with the control.
  useEffect(() => {
    const video = videoRef.current;
    if (!useVideo || !video) return;
    if (still) video.pause();
    else void video.play().catch(() => undefined);
  }, [useVideo, still]);

  return (
    <div className="login-backdrop">
      {useVideo ? (
        <video
          ref={videoRef}
          className="login-backdrop-media"
          src={VIDEO_URL ?? undefined}
          autoPlay={!still}
          muted
          loop
          playsInline
          preload="auto"
          aria-hidden="true"
          onError={() => setVideoFailed(true)}
        />
      ) : (
        <canvas ref={canvasRef} className="login-backdrop-media" aria-hidden="true" />
      )}
      <div className="login-backdrop-shade" aria-hidden="true" />
      {!reduced && (
        <button
          type="button"
          className="login-backdrop-toggle"
          onClick={() => setPaused(!paused)}
          aria-pressed={paused}
          title={paused ? 'Play background animation' : 'Pause background animation'}
        >
          {paused ? <PlayIcon size={14} /> : <PauseGlyph />}
          <span>{paused ? 'Play background' : 'Pause background'}</span>
        </button>
      )}
    </div>
  );
}

function PauseGlyph() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  );
}

export default LoginBackdrop;
