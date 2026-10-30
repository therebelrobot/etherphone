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

/** A sounding note: its oscillator, and the gain that fades it in and out. */
interface BankNote {
  readonly oscillator: OscillatorNode;
  readonly envelope: GainNode;
}

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
  private notes: BankNote[] = [];

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

    const now = this.ctx.currentTime;
    this.fadeOut(this.notes, now);
    this.notes = freqs.map((freq) => this.startNote(freq, now));

    this.currentKey = key;
    return true;
  }

  /**
   * Replaces the sounding notes at exactly `when`.
   *
   * The old notes fade from `when` rather than now, and the new ones swell in
   * there, so the handover happens on a sample rather than wherever the frame
   * landed. A time in the past means "as soon as possible", which is what a late
   * frame gets.
   */
  playAt(freqs: number[], when: number): boolean {
    if (!this.ctx || !this.destination || freqs.length === 0) return false;

    const key = frequenciesKey(freqs);
    if (key === this.currentKey) return true;

    const at = Math.max(when, this.ctx.currentTime);
    this.fadeOut(this.notes, at);
    this.notes = freqs.map((freq) => this.startNote(freq, at));

    this.currentKey = key;
    return true;
  }

  /**
   * Starts one sustained note at `at`, rising from silence.
   *
   * From silence, not at full level: an oscillator switched on at full level is a
   * step into the middle of a wave, and the step is a click.
   */
  private startNote(freq: number, at: number): BankNote {
    const ctx = this.ctx!;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();

    this.options.configure(oscillator);
    oscillator.frequency.value = freq;

    envelope.gain.setValueAtTime(0, at);
    envelope.gain.linearRampToValueAtTime(1, at + AUDIO.oscillatorAttackSeconds);

    oscillator.connect(envelope).connect(this.destination!);
    // New notes join the vibrato that is already running, so a chord held
    // through a chord change does not change character mid-note.
    this.vibratoDepth?.connect(oscillator.detune);
    oscillator.start(at);

    return { oscillator, envelope };
  }

  /** Fades notes out from `at` and retires them once they are silent. */
  private fadeOut(notes: readonly BankNote[], at: number): void {
    for (const { oscillator, envelope } of notes) {
      envelope.gain.cancelScheduledValues(at);
      // A time constant rather than a ramp to a value, because what the gain is
      // at `at` — mid-swell, perhaps — is not known here, and this starts from it.
      envelope.gain.setTargetAtTime(0, at, AUDIO.oscillatorReleaseSeconds / 4);

      try {
        oscillator.stop(at + AUDIO.oscillatorReleaseSeconds);
        oscillator.onended = () => {
          oscillator.disconnect();
          envelope.disconnect();
        };
      } catch {
        /* already stopped */
      }
    }
  }

  /**
   * Strikes each note through its own decaying envelope.
   *
   * The plucked oscillators are deliberately **not** tracked in
   * {@link notes}: they stop themselves, and a second pluck must be able
   * to overlap the first, which is the whole difference between a harp and a
   * series of staccato notes. Only the sustained bank is silenced, so switching
   * to a pluck still stops a held chord from ringing underneath it.
   */
  pluck(freqs: number[], decaySeconds: number = AUDIO.pluckDecaySeconds): boolean {
    if (!this.ctx || !this.destination || freqs.length === 0) return false;

    this.release();

    const now = this.ctx.currentTime;
    // Guarded rather than trusted: a caller asking for a zero-length decay would
    // make an exponential ramp of length zero, which is a click.
    const decay = Math.max(AUDIO.staccatoDecaySeconds / 4, decaySeconds);
    const end = now + decay;

    for (const freq of freqs) {
      const oscillator = this.ctx.createOscillator();
      const envelope = this.ctx.createGain();

      this.options.configure(oscillator);
      oscillator.frequency.value = freq;

      envelope.gain.setValueAtTime(0, now);
      envelope.gain.linearRampToValueAtTime(1, now + AUDIO.pluckAttackSeconds);
      envelope.gain.exponentialRampToValueAtTime(AUDIO.pluckFloor, end);

      oscillator.connect(envelope).connect(this.destination);
      this.vibratoDepth?.connect(oscillator.detune);

      oscillator.start(now);
      // A hair past the decay, so the ramp finishes before the node is retired.
      oscillator.stop(end + AUDIO.pluckStopPaddingSeconds);
      oscillator.onended = () => {
        oscillator.disconnect();
        envelope.disconnect();
      };
    }

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
    if (!this.ctx || freqs.length !== this.notes.length || freqs.length === 0) {
      return this.play(freqs);
    }

    const now = this.ctx.currentTime;

    freqs.forEach((freq, index) => {
      this.notes[index].oscillator.frequency.setTargetAtTime(freq, now, AUDIO.glideSeconds);
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
    for (const { oscillator } of this.notes) depth.connect(oscillator.detune);
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

  /** Fades out and drops every sustained note, without touching the context. */
  private silence(): void {
    if (this.ctx) this.fadeOut(this.notes, this.ctx.currentTime);
    this.notes = [];
  }
}
