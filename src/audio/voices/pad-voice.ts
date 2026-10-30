/**
 * A pad: a soft, sustained bed of a chord.
 *
 * Each note is two sawtooth waves a few cents apart, so the pair drifts slowly in
 * and out of phase — a chorus, which is what makes a pad sound like a pad rather
 * than an organ. Both go through one gentle lowpass that rounds off the
 * sawtooth's buzz, and every note swells in and fades out, so changing chords is
 * a crossfade rather than a cut.
 *
 * A voice of its own rather than an oscillator bank, because a bank is one
 * oscillator per note straight to the output, and a pad is neither.
 */
import { AUDIO } from "../../config/constants";
import { frequenciesKey } from "../voice";
import type { Voice } from "../voice";

interface PadNote {
  readonly oscillators: readonly OscillatorNode[];
  readonly envelope: GainNode;
}

export class PadVoice implements Voice {
  private ctx: AudioContext | null = null;
  private filter: BiquadFilterNode | null = null;
  private notes: PadNote[] = [];
  private currentKey: string | null = null;

  /** One LFO for the chord's vibrato, as the oscillator banks have. */
  private vibratoLfo: OscillatorNode | null = null;
  private vibratoDepth: GainNode | null = null;

  connect(ctx: AudioContext, destination: AudioNode): void {
    this.ctx = ctx;

    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = AUDIO.padCutoffHz;
    this.filter.Q.value = AUDIO.padQ;
    this.filter.connect(destination);
  }

  play(freqs: number[]): boolean {
    if (!this.ctx) return false;
    return this.playAt(freqs, this.ctx.currentTime);
  }

  playAt(freqs: number[], when: number): boolean {
    if (!this.ctx || !this.filter || freqs.length === 0) return false;

    const key = frequenciesKey(freqs);
    if (key === this.currentKey) return true;

    const at = Math.max(when, this.ctx.currentTime);
    this.fadeOut(this.notes, at);
    this.notes = freqs.map((freq) => this.startNote(freq, at));

    this.currentKey = key;
    return true;
  }

  retune(freqs: number[]): boolean {
    if (!this.ctx || freqs.length !== this.notes.length || freqs.length === 0) {
      return this.play(freqs);
    }

    const now = this.ctx.currentTime;

    freqs.forEach((freq, index) => {
      for (const oscillator of this.notes[index].oscillators) {
        oscillator.frequency.setTargetAtTime(freq, now, AUDIO.glideSeconds);
      }
    });

    this.currentKey = frequenciesKey(freqs);
    return true;
  }

  setVibrato(depthCents: number, rateHz: number): void {
    if (!this.ctx) return;

    const { lfo, depth } = this.ensureVibrato();
    const now = this.ctx.currentTime;

    depth.gain.setTargetAtTime(Math.max(0, depthCents), now, AUDIO.smoothingSeconds);
    lfo.frequency.setTargetAtTime(Math.max(0.1, rateHz), now, AUDIO.smoothingSeconds);
  }

  release(): void {
    if (this.ctx) this.fadeOut(this.notes, this.ctx.currentTime);
    this.notes = [];
    this.currentKey = null;
  }

  dispose(): void {
    this.release();

    if (this.vibratoLfo) {
      try {
        this.vibratoLfo.stop();
      } catch {
        /* already stopped */
      }
      this.vibratoLfo.disconnect();
    }
    this.vibratoDepth?.disconnect();
    this.vibratoLfo = null;
    this.vibratoDepth = null;
    this.ctx = null;
  }

  /**
   * Starts one note at `at`: the detuned pair, swelling in from silence.
   *
   * Each oscillator is at half level, so a note peaks where one full-scale wave
   * would — the engine's chord level can then treat a pad note like any other.
   */
  private startNote(freq: number, at: number): PadNote {
    const ctx = this.ctx!;
    const envelope = ctx.createGain();

    envelope.gain.setValueAtTime(0, at);
    envelope.gain.setTargetAtTime(1, at, AUDIO.padAttackSeconds);
    envelope.connect(this.filter!);

    const oscillators = [-AUDIO.padDetuneCents, AUDIO.padDetuneCents].map((cents) => {
      const oscillator = ctx.createOscillator();
      const half = ctx.createGain();

      oscillator.type = "sawtooth";
      oscillator.frequency.value = freq;
      oscillator.detune.value = cents;
      half.gain.value = 0.5;

      oscillator.connect(half).connect(envelope);
      this.vibratoDepth?.connect(oscillator.detune);
      oscillator.start(at);

      return oscillator;
    });

    return { oscillators, envelope };
  }

  /** Fades notes out from `at`, and retires them once the fade has all but gone. */
  private fadeOut(notes: readonly PadNote[], at: number): void {
    for (const { oscillators, envelope } of notes) {
      envelope.gain.cancelScheduledValues(at);
      envelope.gain.setTargetAtTime(0, at, AUDIO.padReleaseSeconds);

      // Five time constants is under one percent of the level: inaudible, so the
      // oscillators can stop there without a click.
      const end = at + AUDIO.padReleaseSeconds * 5;

      for (const oscillator of oscillators) {
        try {
          oscillator.stop(end);
        } catch {
          /* already stopped */
        }
      }

      oscillators[0].onended = () => {
        for (const oscillator of oscillators) oscillator.disconnect();
        envelope.disconnect();
      };
    }
  }

  private ensureVibrato(): { lfo: OscillatorNode; depth: GainNode } {
    if (this.vibratoLfo && this.vibratoDepth) {
      return { lfo: this.vibratoLfo, depth: this.vibratoDepth };
    }

    const ctx = this.ctx!;
    const lfo = ctx.createOscillator();
    const depth = ctx.createGain();

    lfo.type = "sine";
    lfo.frequency.value = AUDIO.vibratoRateHz;
    depth.gain.value = 0;
    lfo.connect(depth);

    for (const { oscillators } of this.notes) {
      for (const oscillator of oscillators) depth.connect(oscillator.detune);
    }
    lfo.start();

    this.vibratoLfo = lfo;
    this.vibratoDepth = depth;

    return { lfo, depth };
  }
}

export function createPadVoice(): Voice {
  return new PadVoice();
}
