/**
 * The voice seam.
 *
 * `SynthEngine` owns everything shared: the `AudioContext`, the waveshaper, the
 * lowpass filter, and the master gain. A *voice* owns only what it takes to turn
 * a list of frequencies into sound. It is handed the node to connect into and
 * does the rest itself.
 *
 * That split is what makes instruments pluggable. The engine's `playNotes` knows
 * nothing about oscillators, wavetables, or samples — it forwards frequencies to
 * whichever voice is active. Adding an instrument means writing a `Voice` and
 * registering a definition for it; the engine never changes.
 *
 * This module is pure: no Web Audio objects are constructed here, only
 * described. That keeps the registry testable without a browser.
 */

/** Coarse grouping, used to sort and label the instrument picker. */
export type VoiceKind = "oscillator" | "wavetable" | "sampler";

/** Heading shown for each kind in the instrument picker. */
export const VOICE_KIND_LABELS: Record<VoiceKind, string> = {
  oscillator: "Oscillator",
  wavetable: "Wavetable",
  sampler: "Sampler",
};

/**
 * A note-producing subsystem.
 *
 * Lifecycle: `connect` once, then `play` whenever the intent changes, `release`
 * when the instrument falls silent, and `dispose` when the voice is replaced.
 * Implementations must treat a repeated `play` with the same frequencies as a
 * no-op: the render loop calls it every animation frame.
 */
export interface Voice {
  /** Builds the internal graph into `destination`. Called once, after the context exists. */
  connect(ctx: AudioContext, destination: AudioNode): void;
  /**
   * Replaces the sounding notes, and reports whether they are now sounding.
   *
   * Returning `false` is how a voice says "not yet" — a sampler whose recording
   * is still loading, for instance. The engine does not remember the request as
   * settled, so it tries again on the next frame, which is why this is cheaper
   * than it sounds. A repeated call with the same frequencies must still be a
   * no-op once it has returned `true`.
   */
  play(freqs: number[]): boolean;
  /** Silences every sounding note, leaving the graph connected. */
  release(): void;
  /** Releases and tears down the graph. The voice is not reused afterwards. */
  dispose(): void;
}

/** How a voice is described, listed in the picker, and constructed. */
export interface VoiceDefinition {
  /** Stable identifier, used as the picker's option value and by `setInstrument`. */
  readonly id: string;
  /** Shown in the instrument picker. */
  readonly label: string;
  readonly kind: VoiceKind;
  /**
   * Builds a fresh voice. Called on every instrument change, so a voice instance
   * belongs to exactly one active run.
   *
   * Deliberately context-free: a definition can be registered before the
   * `AudioContext` exists, which lets the picker be populated at startup.
   */
  readonly create: () => Voice;
}

const registry = new Map<string, VoiceDefinition>();

/**
 * Adds a voice to the registry.
 *
 * Registration order is the order instruments appear in the picker, and a
 * duplicate id is rejected rather than silently replacing a built-in.
 */
export function registerVoice(definition: VoiceDefinition): void {
  if (definition.id.length === 0) {
    throw new Error("Gesture Synth: a voice definition needs a non-empty id");
  }

  if (registry.has(definition.id)) {
    throw new Error(`Gesture Synth: a voice with id "${definition.id}" is already registered`);
  }

  registry.set(definition.id, definition);
}

/** Every registered voice, in registration order. */
export function listVoices(): readonly VoiceDefinition[] {
  return Array.from(registry.values());
}

/** Looks up a voice by id, or `undefined` when nothing is registered under it. */
export function getVoice(id: string): VoiceDefinition | undefined {
  return registry.get(id);
}

/**
 * The cache key for a set of frequencies.
 *
 * Voices rebuild their nodes only when the notes actually change, so a chord
 * that holds steady across frames — the common case for a gesture instrument —
 * costs nothing. Frequencies are rounded to a tenth of a hertz: fine enough that
 * no audible change is lost, coarse enough that float noise is not a "change".
 */
export function frequenciesKey(freqs: readonly number[]): string {
  return freqs.map((freq) => freq.toFixed(1)).join(",");
}
