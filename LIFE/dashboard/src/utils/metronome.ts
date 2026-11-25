/**
 * Offline metronome using the Web Audio API.
 * Clicks are scheduled ahead on the audio clock (lookahead scheduler), so timing stays exact
 * even when the page is busy running pose inference.
 */

const LOOKAHEAD_MS = 25;
const SCHEDULE_AHEAD_S = 0.12;

export class Metronome {
  private context: AudioContext | null = null;
  private timer: number | null = null;
  private nextClickTime = 0;
  private bpm = 110;
  private onBeat: ((beatTimeMs: number) => void) | null = null;

  get running(): boolean {
    return this.timer !== null;
  }

  setBpm(bpm: number): void {
    this.bpm = Math.min(200, Math.max(30, bpm));
  }

  /** Optional visual beat callback (called close to when each click is heard). */
  setOnBeat(callback: ((beatTimeMs: number) => void) | null): void {
    this.onBeat = callback;
  }

  async start(bpm?: number): Promise<void> {
    if (bpm) this.setBpm(bpm);
    if (this.timer !== null) return;
    if (!this.context) {
      const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioContextClass) return;
      this.context = new AudioContextClass();
    }
    if (this.context.state === 'suspended') await this.context.resume();
    this.nextClickTime = this.context.currentTime + 0.05;
    this.timer = window.setInterval(() => this.scheduler(), LOOKAHEAD_MS);
  }

  stop(): void {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  dispose(): void {
    this.stop();
    void this.context?.close();
    this.context = null;
  }

  private scheduler(): void {
    const context = this.context;
    if (!context) return;
    while (this.nextClickTime < context.currentTime + SCHEDULE_AHEAD_S) {
      this.click(this.nextClickTime);
      if (this.onBeat) {
        const delay = Math.max(0, (this.nextClickTime - context.currentTime) * 1000);
        const callback = this.onBeat;
        window.setTimeout(() => callback(performance.now()), delay);
      }
      this.nextClickTime += 60 / this.bpm;
    }
  }

  private click(time: number): void {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 1000;
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.4, time + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(time);
    oscillator.stop(time + 0.06);
  }
}
