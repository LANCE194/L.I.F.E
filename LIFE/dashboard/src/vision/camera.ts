/**
 * L.I.F.E. Camera Module
 * Webcam capture using getUserMedia
 */

import type { CameraDevice, CameraConfig } from '../api/types';

export interface CameraState {
  stream: MediaStream | null;
  video: HTMLVideoElement | null;
  devices: CameraDevice[];
  selectedDeviceId: string | null;
  isActive: boolean;
  error: string | null;
}

type CameraStateListener = (state: CameraState) => void;

/** Turn getUserMedia errors into instructions a trainer can act on. */
export function describeCameraError(err: unknown): string {
  const name = err instanceof DOMException || err instanceof Error ? err.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'Camera permission was denied. Click the camera icon in the address bar, allow access, then press "Retry camera".';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No camera was found. Connect a webcam and press "Retry camera".';
    case 'NotReadableError':
    case 'AbortError':
      return 'The camera is being used by another application (e.g. Zoom or Teams). Close it and press "Retry camera".';
    default:
      return err instanceof Error && err.message ? `Could not start the camera: ${err.message}` : 'Could not start the camera.';
  }
}

class CameraManager {
  private state: CameraState = {
    stream: null,
    video: null,
    devices: [],
    selectedDeviceId: null,
    isActive: false,
    error: null,
  };

  private listeners: Set<CameraStateListener> = new Set();
  private config: CameraConfig = {
    width: 1280,
    height: 720,
    frameRate: 30,
  };

  /**
   * Subscribe to camera state changes
   */
  subscribe(listener: CameraStateListener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    this.listeners.forEach(listener => listener(this.state));
  }

  private updateState(partial: Partial<CameraState>) {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  /**
   * Enumerate available video input devices
   */
  async enumerateDevices(): Promise<CameraDevice[]> {
    try {
      // Request permission first to get device labels
      if (!this.state.stream) {
        const permissionStream = await navigator.mediaDevices.getUserMedia({ video: true });
        permissionStream.getTracks().forEach(track => track.stop());
      }
    } catch {
      // Ignore - we just want to trigger permission prompt
    }

    const devices = await navigator.mediaDevices.enumerateDevices();
    const videoDevices = devices
      .filter(d => d.kind === 'videoinput')
      .map(d => ({
        deviceId: d.deviceId,
        label: d.label || `Camera ${d.deviceId.slice(0, 8)}`,
        kind: 'videoinput' as const,
      }));

    this.updateState({ devices: videoDevices });

    // Auto-select first device if none selected
    if (!this.state.selectedDeviceId && videoDevices.length > 0) {
      this.updateState({ selectedDeviceId: videoDevices[0].deviceId });
    }

    return videoDevices;
  }

  /**
   * Start camera with current configuration
   */
  async start(videoElement: HTMLVideoElement): Promise<MediaStream> {
    if (this.state.stream) {
      this.stop();
    }

    const deviceId = this.state.selectedDeviceId;
    const constraints: MediaStreamConstraints = {
      video: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        width: { ideal: this.config.width },
        height: { ideal: this.config.height },
        frameRate: { ideal: this.config.frameRate },
      },
      audio: false,
    };

    let stream: MediaStream | null = null;
    try {
      this.updateState({ error: null });

      stream = await navigator.mediaDevices.getUserMedia(constraints);

      this.updateState({
        stream,
        video: videoElement,
        isActive: true,
      });

      videoElement.srcObject = stream;
      await videoElement.play();

      return stream;
    } catch (err) {
      const error = describeCameraError(err);
      stream?.getTracks().forEach(track => track.stop());
      videoElement.srcObject = null;
      this.updateState({ stream: null, video: null, error, isActive: false });
      throw new Error(error);
    }
  }

  /**
   * Stop camera and release resources
   */
  stop(): void {
    if (this.state.stream) {
      this.state.stream.getTracks().forEach(track => track.stop());
    }

    if (this.state.video) {
      this.state.video.srcObject = null;
    }

    this.updateState({
      stream: null,
      video: null,
      isActive: false,
    });
  }

  /**
   * Switch to a different camera device
   */
  async switchDevice(deviceId: string): Promise<void> {
    this.updateState({ selectedDeviceId: deviceId });

    if (this.state.isActive && this.state.video) {
      await this.start(this.state.video);
    }
  }

  /**
   * Update camera configuration
   */
  setConfig(config: Partial<CameraConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): CameraConfig {
    return { ...this.config };
  }

  /**
   * Get current state
   */
  getState(): CameraState {
    return { ...this.state };
  }

  /**
   * Check if camera is supported
   */
  static isSupported(): boolean {
    return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  }

  /**
   * Get current video constraints being used
   */
  getVideoSettings(): MediaTrackSettings | null {
    if (!this.state.stream) return null;
    const track = this.state.stream.getVideoTracks()[0];
    return track ? track.getSettings() : null;
  }
}

// Singleton instance
export const camera = new CameraManager();

// React hook for camera
import { useState, useEffect, useCallback } from 'react';

export function useCamera() {
  const [state, setState] = useState<CameraState>(camera.getState());

  useEffect(() => {
    return camera.subscribe(setState);
  }, []);

  const start = useCallback(async (video: HTMLVideoElement) => {
    return camera.start(video);
  }, []);

  const stop = useCallback(() => {
    camera.stop();
  }, []);

  const switchDevice = useCallback(async (deviceId: string) => {
    return camera.switchDevice(deviceId);
  }, []);

  const enumerateDevices = useCallback(async () => {
    return camera.enumerateDevices();
  }, []);

  return {
    ...state,
    start,
    stop,
    switchDevice,
    enumerateDevices,
    setConfig: camera.setConfig.bind(camera),
    getConfig: camera.getConfig.bind(camera),
    isSupported: CameraManager.isSupported(),
  };
}