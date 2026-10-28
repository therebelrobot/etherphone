/**
 * A voice that sounds one oscillator per note.
 *
 * Oscillators are the simplest useful instrument: a shape, a frequency, and a
 * connection. Both the plain-waveform voice and the wavetable voice are this
 * class with a different `configure`, which keeps the lifecycle — build on
 * change, stop on release, tear down on dispose — in one place.
 */
import { AUDIO } from "../../config/constants";
import { frequenciesKey } from "../voice";
import type { Voice } from "../voice";

/** How a bank builds its oscillators. */
export interface OscillatorBankOptions {
  /** Runs once, when the context arrives, before any oscillator is built. */
  readonly prepare?: (ctx: AudioContext) => void;
  /** Shapes each oscillator before it starts. */
  readonly configure: (oscillator: OscillatorNode) => void;
}

export class OscillatorBank implements Voice {
  private ctx: AudioContext | null = null;
  private destination: AudioNode | null = null;
  private oscillators: OscillatorNode[] = [];

  /** Frequency key of the currently sounding notes, for the change check. */
  private currentKey: string | null = null;

  /**
   * The shared vibrato: one LFO feeding every oscillator's `detune`.
   *
   * One LFO rather than one per note, so a chord shakes together — three
   * vibratos at slightly different phases is a chorus, not a vibrato. It runs
   * from the first request and its *depth* is the control, because starting and
   * stopping an oscillator to change a depth would click.
   */
  private vibratoLfo: OscillatorNode | null = null;
  private vibratoDepth: GainNode | null = null;

  constructor(private readonly options: OscillatorBankOptions) {}

  connect(ctx: AudioContext, destination: AudioNode): void {
    this.ctx = ctx;
    this.destination = destination;
    this.options.prepare?.(ctx);
  }

  play(freqs: number[]): boolean {
    if (!this.ctx || !this.destination || freqs.length === 0) return false;

    const key = frequenciesKey(freqs);
    if (key === this.currentKey) return true;

    this.silence();

    this.oscillators = freqs.map((freq) => {
      const oscillator = this.ctx!.createOscillator();
      this.options.configure(oscillator);
      oscillator.frequency.value = freq;
      oscillator.connect(this.destination!);
      // New notes join the vibrato that is already running, so a chord held
      // through a chord change does not change character mid-note.
      this.vibratoDepth?.connect(oscillator.detune);
      oscillator.start();
      return oscillator;
    });

    this.currentKey = key;
    return true;
  }

  release(): void {
    this.silence();
    this.currentKey = null;
  }

  /**
   * Slides the sounding oscillators to new frequencies.
   *
   * A note count that does not match the sounding notes cannot be reached by
   * retuning, so that falls back to a rebuild. Otherwise each oscillator is
   * ramped to its new pitch with a time constant, which is what turns a stream
   * of per-frame frequencies into a glide rather than a stutter.
   */
  retune(freqs: number[]): boolean {
    if (!this.ctx || freqs.length !== this.oscillators.length || freqs.length === 0) {
      return this.play(freqs);
    }

    const now = this.ctx.currentTime;

    freqs.forEach((freq, index) => {
      this.oscillators[index].frequency.setTargetAtTime(freq, now, AUDIO.glideSeconds);
    });

    this.currentKey = frequenciesKey(freqs);
    return true;
  }

  /**
   * Sets the vibrato width, in cents, and its rate.
   *
   * Depth is a gain on the LFO's output feeding `detune`, which is measured in
   * cents — so the number here *is* the width, with no conversion. Ramped rather
   * than set, so widening it mid-note is a swell instead of a step.
   */
  setVibrato(depthCents: number, rateHz: number): void {
    if (!this.ctx) return;

    const { lfo, depth } = this.ensureVibrato();
    const now = this.ctx.currentTime;

    depth.gain.setTargetAtTime(Math.max(0, depthCents), now, AUDIO.smoothingSeconds);
    lfo.frequency.setTargetAtTime(Math.max(0.1, rateHz), now, AUDIO.smoothingSeconds);
  }

  dispose(): void {
    this.release();
    this.stopVibrato();
    this.ctx = null;
    this.destination = null;
  }

  /** Builds the LFO on first use, and wires it to whatever is already sounding. */
  private ensureVibrato(): { lfo: OscillatorNode; depth: GainNode } {
    if (this.vibratoLfo && this.vibratoDepth) {
      return { lfo: this.vibratoLfo, depth: this.vibratoDepth };
    }

    const lfo = this.ctx!.createOscillator();
    const depth = this.ctx!.createGain();

    lfo.type = "sine";
    lfo.frequency.value = AUDIO.vibratoRateHz;
    depth.gain.value = 0;

    lfo.connect(depth);
    for (const oscillator of this.oscillators) depth.connect(oscillator.detune);
    lfo.start();

    this.vibratoLfo = lfo;
    this.vibratoDepth = depth;

    return { lfo, depth };
  }

  /** Tears the LFO down with the voice. */
  private stopVibrato(): void {
    if (this.vibratoLfo) {
      try {
        this.vibratoLfo.stop();
        this.vibratoLfo.disconnect();
      } catch {
        /* already stopped */
      }
    }

    this.vibratoDepth?.disconnect();
    this.vibratoLfo = null;
    this.vibratoDepth = null;
  }

  /** Stops and drops every oscillator without touching the context. */
  private silence(): void {
    for (const oscillator of this.oscillators) {
      try {
        oscillator.stop();
        oscillator.disconnect();
      } catch {
        /* already stopped */
      }
    }

    this.oscillators = [];
  }
}
