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

  dispose(): void {
    this.release();
    this.ctx = null;
    this.destination = null;
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
