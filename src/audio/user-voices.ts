/**
 * Instruments built from a file you load.
 *
 * A bundled instrument is written out ahead of time and registered once at
 * startup. A loaded one is assembled at runtime from whatever the file turned
 * out to be, and then goes through exactly the same registration path — which is
 * the point of the registry: the picker cannot tell the difference, and neither
 * can the engine.
 *
 * Ids are generated here rather than passed in so callers cannot collide with a
 * built-in, and so loading the same file twice yields two distinct instruments
 * instead of throwing on a duplicate.
 */
import { AUDIO } from "../config/constants";
import { DEFAULT_SAMPLE_ROOT_HZ } from "./sampler";
import { analyseCycle } from "./wavetable";
import type { VoiceDefinition } from "./voice";
import { createSamplerVoice } from "./voices/sampler-voice";
import { createWavetableVoice } from "./voices/wavetable-voice";

/** One counter per kind, so the ids read as "the first wavetable you loaded". */
const sequences = new Map<string, number>();

/** Mints an id that cannot collide with a built-in or an earlier load. */
function nextId(kind: string): string {
  const next = (sequences.get(kind) ?? 0) + 1;
  sequences.set(kind, next);
  return `${kind}-user-${next}`;
}

/** Builds a wavetable instrument from one cycle of a sampled waveform. */
export function defineUserWavetable(label: string, samples: Float32Array): VoiceDefinition {
  const spectrum = analyseCycle(samples, AUDIO.wavetableMaxHarmonics);

  return {
    id: nextId("wavetable"),
    label,
    kind: "wavetable",
    create: () => createWavetableVoice(spectrum),
  };
}

/**
 * Builds a sampled instrument from a decoded recording.
 *
 * One recording is stretched across the whole range, so the pitch it was
 * recorded at matters — everything is transposed relative to it. It is assumed
 * rather than detected: `rootFrequency` is A2 by default, matching the
 * instrument's own tonic, and a sample recorded at another pitch is heard
 * transposed by the interval between the two.
 */
export function defineUserSample(
  label: string,
  buffer: AudioBuffer,
  rootFrequency: number = DEFAULT_SAMPLE_ROOT_HZ,
): VoiceDefinition {
  return {
    id: nextId("sample"),
    label,
    kind: "sampler",
    create: () => createSamplerVoice({ buffer, rootFrequency, loop: true }),
  };
}
