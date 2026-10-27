/**
 * The sampler voice.
 *
 * One recording is pitched across the keyboard by playback rate: a chord note at
 * twice the recorded pitch plays at rate 2. Each note gets its own source and a
 * short gain envelope, because starting a buffer mid-waveform clicks and because
 * a released note needs to fade rather than cut.
 *
 * A sample can arrive two ways — decoded already, which is what happens when you
 * load a file, or as a URL to fetch, which is what the bundled ones use. Either
 * way the buffer is prepared the same way: looped recordings get a crossfade so
 * the loop point does not tick.
 */
import { AUDIO, PROJECT_NAME } from "../../config/constants";
import { crossfadeForLoop, DEFAULT_SAMPLE_ROOT_HZ, playbackRateFor } from "../sampler";
import { frequenciesKey } from "../voice";
import type { Voice } from "../voice";

/**
 * Loop point per recording, in seconds.
 *
 * A buffer is shared by every voice built from the same definition, so the
 * crossfade — which rewrites samples in place — must not run twice on it. This
 * remembers what the first pass worked out.
 */
const loopPoints = new WeakMap<AudioBuffer, number>();

export interface SamplerVoiceOptions {
  /** An already-decoded recording. Takes precedence over `url`. */
  readonly buffer?: AudioBuffer;
  /** Where to fetch the recording, if it is not decoded yet. */
  readonly url?: string;
  /** Pitch the recording is at, in Hz. Defaults to {@link DEFAULT_SAMPLE_ROOT_HZ}. */
  readonly rootFrequency?: number;
  /** Whether held notes should sustain by looping the recording. Defaults to `true`. */
  readonly loop?: boolean;
}

/** One sounding note: a source and the envelope that shapes it. */
interface SampledNote {
  readonly source: AudioBufferSourceNode;
  readonly gain: GainNode;
}

export class SamplerVoice implements Voice {
  private ctx: AudioContext | null = null;
  private destination: AudioNode | null = null;
  private buffer: AudioBuffer | null = null;

  /** Loop point in seconds, trimmed back by the crossfade. */
  private loopEndSeconds: number | null = null;

  private notes: SampledNote[] = [];
  private currentKey: string | null = null;

  private readonly url: string | null;
  private readonly rootFrequency: number;
  private readonly loop: boolean;

  constructor(options: SamplerVoiceOptions) {
    this.buffer = options.buffer ?? null;
    this.url = options.url ?? null;
    this.rootFrequency = options.rootFrequency ?? DEFAULT_SAMPLE_ROOT_HZ;
    this.loop = options.loop ?? true;
  }

  connect(ctx: AudioContext, destination: AudioNode): void {
    this.ctx = ctx;
    this.destination = destination;

    if (this.buffer) {
      this.prepareBuffer(this.buffer);
    } else if (this.url) {
      void this.loadFromUrl(this.url);
    }
  }

  play(freqs: number[]): boolean {
    // The recording may still be in flight; saying so lets the engine retry.
    if (!this.ctx || !this.destination || !this.buffer || freqs.length === 0) return false;

    const key = frequenciesKey(freqs);
    if (key === this.currentKey) return true;

    const now = this.ctx.currentTime;
    this.fadeOutAndStop(now, AUDIO.samplerReleaseSeconds);

    const buffer = this.buffer;
    this.notes = freqs.map((freq) => this.startNote(freq, buffer, now));
    this.currentKey = key;
    return true;
  }

  release(): void {
    this.fadeOutAndStop(this.ctx?.currentTime ?? 0, AUDIO.samplerReleaseSeconds);
    this.currentKey = null;
  }

  /**
   * Slides the sounding notes to new pitches by ramping their playback rates.
   *
   * Same contract as the oscillator banks: a note count that does not match
   * falls back to a rebuild, because there is nothing to retune.
   */
  retune(freqs: number[]): boolean {
    if (!this.ctx || freqs.length !== this.notes.length || freqs.length === 0) {
      return this.play(freqs);
    }

    const now = this.ctx.currentTime;

    freqs.forEach((freq, index) => {
      const rate = playbackRateFor(freq, this.rootFrequency);
      this.notes[index].source.playbackRate.setTargetAtTime(rate, now, AUDIO.glideSeconds);
    });

    this.currentKey = frequenciesKey(freqs);
    return true;
  }

  dispose(): void {
    this.release();
    this.ctx = null;
    this.destination = null;
    this.buffer = null;
    this.loopEndSeconds = null;
  }

  /** Fetches and decodes a bundled recording, once the context exists. */
  private async loadFromUrl(url: string): Promise<void> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }

      const encoded = await response.arrayBuffer();
      const ctx = this.ctx;
      if (!ctx) return;

      const decoded = await ctx.decodeAudioData(encoded);
      // The context is torn down when the voice is replaced mid-fetch.
      if (this.ctx !== ctx) return;

      this.prepareBuffer(decoded);
    } catch (error) {
      console.warn(`${PROJECT_NAME}: could not load sample "${url}"`, error);
    }
  }

  /** Records the loop point and applies the loop crossfade, if looping. */
  private prepareBuffer(buffer: AudioBuffer): void {
    this.buffer = buffer;
    this.loopEndSeconds = null;

    if (!this.loop) return;

    const known = loopPoints.get(buffer);
    if (known !== undefined) {
      this.loopEndSeconds = known;
      return;
    }

    let loopLength = buffer.length;
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      loopLength = crossfadeForLoop(
        buffer.getChannelData(channel),
        buffer.sampleRate,
        AUDIO.samplerLoopFadeMilliseconds,
      );
    }

    const loopEndSeconds = loopLength / buffer.sampleRate;
    loopPoints.set(buffer, loopEndSeconds);
    this.loopEndSeconds = loopEndSeconds;
  }

  /** Builds and starts one note, with an attack ramp. */
  private startNote(frequency: number, buffer: AudioBuffer, now: number): SampledNote {
    const ctx = this.ctx!;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRateFor(frequency, this.rootFrequency);

    if (this.loop) {
      source.loop = true;
      source.loopStart = 0;
      source.loopEnd = this.loopEndSeconds ?? buffer.duration;
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + AUDIO.samplerAttackSeconds);

    source.connect(gain);
    gain.connect(this.destination!);
    source.start(now);

    return { source, gain };
  }

  /** Ramps every sounding note to silence and schedules its source to stop. */
  private fadeOutAndStop(now: number, releaseSeconds: number): void {
    for (const note of this.notes) {
      note.gain.gain.cancelScheduledValues(now);
      note.gain.gain.linearRampToValueAtTime(0, now + releaseSeconds);

      try {
        note.source.stop(now + releaseSeconds + AUDIO.samplerStopPaddingSeconds);
      } catch {
        /* already stopped */
      }

      note.source.onended = () => note.gain.disconnect();
    }

    this.notes = [];
  }
}

/** Builds a voice that plays one recording across the keyboard. */
export function createSamplerVoice(options: SamplerVoiceOptions): Voice {
  return new SamplerVoice(options);
}
