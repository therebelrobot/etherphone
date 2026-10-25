/**
 * The synth voice.
 *
 * Signal chain: oscillators -> waveshaper -> lowpass filter -> master gain.
 * The waveshaper is left with a null curve, which is a pass-through; it exists
 * as a hook for adding drive later without rewiring anything.
 *
 * The context is only created in response to a user gesture, because browsers
 * refuse to start audio otherwise.
 */
import { AUDIO } from "../config/constants";
import type { Waveform } from "../types";

export class SynthEngine {
  private ctx: AudioContext | null = null;
  private filter: BiquadFilterNode | null = null;
  private waveShaper: WaveShaperNode | null = null;
  private masterGain: GainNode | null = null;
  private oscillators: OscillatorNode[] = [];
  private currentKey: string | null = null;
  private waveform: Waveform = "triangle";

  /**
   * Creates the audio graph on first call. Safe to call repeatedly, and safe to
   * call from a click handler.
   */
  ensureContext(): void {
    if (this.ctx) return;

    const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
    if (!AudioContextCtor) return;

    this.ctx = new AudioContextCtor();

    this.waveShaper = this.ctx.createWaveShaper();
    this.waveShaper.curve = null;
    this.waveShaper.oversample = "4x"; // Reduces aliasing harshness.

    this.filter = this.ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = AUDIO.filterBaseFrequency;
    this.filter.Q.value = AUDIO.filterBaseQ;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0;

    this.waveShaper.connect(this.filter);
    this.filter.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
  }

  /** Selects the oscillator shape, restarting the current notes if any. */
  setWaveform(waveform: Waveform): void {
    this.waveform = waveform;
    // Forces the next `playNotes` call to rebuild the oscillators.
    this.currentKey = null;
  }

  /** Smoothly sets the master gain, for use from the render loop. */
  updateVolume(volume01: number): void {
    if (!this.ctx || !this.masterGain) return;
    this.masterGain.gain.setTargetAtTime(
      volume01,
      this.ctx.currentTime,
      AUDIO.gainSmoothingSeconds,
    );
  }

  /** Ramps the master gain to a clamped level, for discrete changes. */
  setVolume(volume01: number): void {
    if (!this.ctx || !this.masterGain) return;
    const clamped = Math.max(0, Math.min(1, volume01));
    this.masterGain.gain.linearRampToValueAtTime(
      clamped,
      this.ctx.currentTime + AUDIO.volumeRampSeconds,
    );
  }

  /**
   * Maps a hand tilt of -1..1 onto the lowpass filter.
   *
   * Inward tilt lowers the cutoff and adds a woody resonance; outward tilt opens
   * the filter wide and spikes the resonance for a synthetic squelch.
   */
  updateFilterSweep(tiltFactor: number): void {
    if (!this.filter || !this.ctx) return;

    let targetFrequency: number = AUDIO.filterBaseFrequency;
    let targetQ: number = AUDIO.filterBaseQ;

    if (tiltFactor < 0) {
      const intensity = Math.abs(tiltFactor);
      targetFrequency = AUDIO.filterBaseFrequency - intensity * AUDIO.warmFrequencyDrop;
      targetQ = AUDIO.filterBaseQ + intensity * AUDIO.warmQBoost;
    } else if (tiltFactor > 0) {
      targetFrequency = AUDIO.filterBaseFrequency + tiltFactor * AUDIO.brightFrequencyRise;
      targetQ = AUDIO.filterBaseQ + tiltFactor * AUDIO.brightQBoost;
    }

    const now = this.ctx.currentTime;
    this.filter.frequency.setTargetAtTime(targetFrequency, now, AUDIO.smoothingSeconds);
    this.filter.Q.setTargetAtTime(targetQ, now, AUDIO.smoothingSeconds);
  }

  /**
   * Replaces the currently sounding chord. Calling this every frame with the
   * same frequencies is a no-op, so it is safe to drive from the render loop.
   */
  playNotes(freqs: number[]): void {
    if (!this.ctx || !this.waveShaper || freqs.length === 0) return;

    const key = freqs.map((freq) => freq.toFixed(1)).join(",");
    if (key === this.currentKey) return;

    this.oscillators.forEach((osc) => {
      try {
        osc.stop();
      } catch {
        /* already stopped */
      }
    });

    this.oscillators = freqs.map((freq) => {
      const osc = this.ctx!.createOscillator();
      osc.type = this.waveform;
      osc.frequency.value = freq;
      osc.connect(this.waveShaper!);
      osc.start();
      return osc;
    });

    this.currentKey = key;
  }

  /** Silences and tears down every voice. */
  stop(): void {
    this.setVolume(0);

    this.oscillators.forEach((osc) => {
      try {
        osc.stop();
        osc.disconnect();
      } catch {
        /* already stopped */
      }
    });

    this.oscillators = [];
    this.currentKey = null;
  }
}
