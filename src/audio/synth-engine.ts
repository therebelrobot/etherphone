/**
 * The synth engine.
 *
 * Signal chain: voice -> waveshaper -> lowpass filter -> master gain. The engine
 * owns everything in that chain except the voice itself, plus the `AudioContext`
 * everything is built against.
 *
 * What makes the noise is a separate concern, behind the `Voice` interface (see
 * `./voice.ts`). `playNotes` forwards frequencies to whichever voice is active
 * and never learns what kind it is, so swapping an oscillator for a wavetable or
 * a sample playback engine is a registry lookup rather than a rewrite here.
 *
 * The waveshaper is left with a null curve, which is a pass-through; it exists
 * as a hook for adding drive later without rewiring anything.
 *
 * The context is only created in response to a user gesture, because browsers
 * refuse to start audio otherwise.
 */
import { AUDIO, PROJECT_NAME } from "../config/constants";
import { frequenciesKey, getVoice } from "./voice";
import type { Voice, VoiceDefinition } from "./voice";

export class SynthEngine {
  private ctx: AudioContext | null = null;
  private filter: BiquadFilterNode | null = null;
  private waveShaper: WaveShaperNode | null = null;
  private masterGain: GainNode | null = null;

  private definition: VoiceDefinition | null = null;
  private voice: Voice | null = null;

  /** The vibrato depth last handed to the voice, so repeats are skipped. */
  private currentVibrato = 0;
  private currentKey: string | null = null;

  /**
   * Creates the audio graph on first call. Safe to call repeatedly, and safe to
   * call from a click handler.
   *
   * @param existing - A context to join instead of creating one. Layers must
   *   share the instrument's context: two contexts would mean two clocks, and
   *   a loop that drifts against the hand it was played with.
   */
  ensureContext(existing?: AudioContext): void {
    if (this.ctx) return;

    const AudioContextCtor = window.AudioContext ?? window.webkitAudioContext;
    const ctx = existing ?? (AudioContextCtor ? new AudioContextCtor() : null);
    if (!ctx) return;

    this.ctx = ctx;

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

    this.buildVoice();
  }

  /**
   * The audio context, or `null` before {@link ensureContext} has run.
   *
   * Exposed so decoded assets can be prepared against the same context the
   * instrument plays through.
   */
  get context(): AudioContext | null {
    return this.ctx;
  }

  /** The registered id of the instrument currently loaded, if any. */
  get instrumentId(): string | null {
    return this.definition?.id ?? null;
  }

  /**
   * Switches instruments.
   *
   * Unknown ids are ignored rather than thrown on: the picker is the only
   * caller, and a stale id after the markup changes should not take the
   * instrument down mid-session.
   */
  setInstrument(id: string): void {
    const definition = getVoice(id);
    if (!definition || definition.id === this.definition?.id) return;

    this.definition = definition;
    this.buildVoice();
  }

  /** Decodes an encoded audio file against the instrument's context. */
  async decode(encoded: ArrayBuffer): Promise<AudioBuffer> {
    if (!this.ctx) {
      throw new Error(`${PROJECT_NAME}: cannot decode audio before the context exists`);
    }

    return this.ctx.decodeAudioData(encoded);
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
   *
   * The chord is only remembered as settled once the voice confirms it is
   * sounding, so a voice that is still loading its samples is retried next frame
   * rather than being silently skipped.
   */
  playNotes(freqs: number[]): void {
    if (!this.ctx || !this.voice || freqs.length === 0) return;

    const key = frequenciesKey(freqs);
    if (key === this.currentKey) return;

    if (this.voice.play(freqs)) {
      this.currentKey = key;
    }
  }

  /**
   * Slides the sounding notes to new frequencies, for continuous pitch.
   *
   * Prefers the voice's own `retune`, which changes pitch without restarting the
   * note. A voice that cannot retune falls back to {@link playNotes}, so a glide
   * on such an instrument steps instead of sliding rather than going silent.
   */
  glideNotes(freqs: number[]): void {
    if (!this.ctx || !this.voice || freqs.length === 0) return;

    const key = frequenciesKey(freqs);
    if (key === this.currentKey) return;

    const settled = this.voice.retune ? this.voice.retune(freqs) : this.voice.play(freqs);

    if (settled) {
      this.currentKey = key;
    }
  }

  /**
   * Replaces the sounding notes at a precise context time.
   *
   * Used by the looper, whose events are known before they are due. A voice
   * without `playAt` falls back to `playNotes`, which is a frame early rather
   * than wrong.
   */
  playNotesAt(freqs: number[], when: number): void {
    if (!this.ctx || !this.voice || freqs.length === 0) return;

    const key = frequenciesKey(freqs);
    if (key === this.currentKey) return;

    if (this.voice.playAt) {
      if (this.voice.playAt(freqs, when)) this.currentKey = key;
      return;
    }

    this.playNotes(freqs);
  }

  /**
   * Strikes notes that decay on their own, for the harp style.
   *
   * A voice without `pluck` sustains instead, so the style still plays on a
   * sampler — it just sounds like a held note rather than a struck string.
   */
  pluckNotes(freqs: number[], decaySeconds?: number): void {
    if (!this.ctx || !this.voice || freqs.length === 0) return;

    if (this.voice.pluck) {
      this.voice.pluck(freqs, decaySeconds);
    } else {
      this.voice.play(freqs);
    }

    // Nothing is sustained, so there is no note to remember as current.
    this.currentKey = null;
  }

  /**
   * Re-strikes the sounding notes from the start.
   *
   * {@link playNotes} is deliberately a no-op when the frequencies have not
   * changed — that is what makes calling it every frame cheap — so a *repeat* of
   * the same note needs this instead. It is what re-articulation is: the note is
   * already current, and the player has asked to hear it struck again.
   */
  retrigger(freqs: number[]): void {
    if (!this.ctx || !this.voice || freqs.length === 0) return;

    this.voice.release();
    this.currentKey = null;
    this.playNotes(freqs);
  }

  /**
   * Sets how wide the sounding note's vibrato is.
   *
   * A voice is free not to have one — the same bargain `retune` makes — so an
   * instrument that cannot shake simply plays straight rather than failing.
   * Guarded on change because this is called every frame and an AudioParam does
   * not need sixty identical ramps a second.
   */
  setVibrato(depthCents: number, rateHz: number): void {
    if (!this.voice?.setVibrato) return;
    if (depthCents === this.currentVibrato) return;

    this.currentVibrato = depthCents;
    this.voice.setVibrato(depthCents, rateHz);
  }

  /** Silences and tears down every voice. */
  stop(): void {
    this.setVolume(0);
    this.voice?.release();
    this.currentKey = null;
  }

  /**
   * Swaps in the voice for the current definition.
   *
   * A no-op until the context exists, so the picker can be wired before the
   * start gate is clicked; {@link ensureContext} calls this once it has.
   */
  private buildVoice(): void {
    this.voice?.dispose();
    this.voice = null;
    this.currentKey = null;

    if (!this.ctx || !this.waveShaper || !this.definition) return;

    this.voice = this.definition.create();
    this.voice.connect(this.ctx, this.waveShaper);
  }
}
