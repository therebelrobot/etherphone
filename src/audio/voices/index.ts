/**
 * Built-in voice registration.
 *
 * Importing this module populates the registry, in the order instruments should
 * appear in the picker: the synth family first (it is the original instrument),
 * then wavetables, then samples.
 *
 * This is the only file that has to change to add an instrument to the box. A
 * voice you load at runtime is registered the same way, from `app.ts`.
 */
import { BUNDLED_SAMPLES } from "../sampler";
import { registerVoice } from "../voice";
import { WAVETABLE_PRESETS } from "../wavetable";
import { createOscillatorVoice, OSCILLATOR_PRESETS } from "./oscillator-voice";
import { createPadVoice } from "./pad-voice";
import { createSamplerVoice } from "./sampler-voice";
import { createWavetableVoice } from "./wavetable-voice";

/** The instrument the app starts on. */
export const DEFAULT_VOICE_ID = "synth-warm";

function registerBuiltInVoices(): void {
  for (const preset of OSCILLATOR_PRESETS) {
    registerVoice({
      id: `synth-${preset.id}`,
      label: preset.label,
      kind: "oscillator",
      create: () => createOscillatorVoice(preset.waveform),
    });
  }

  // Last of the synth family: the one that sits back, for chords held a while.
  registerVoice({
    id: "synth-pad",
    label: "Soft Pad",
    kind: "oscillator",
    create: createPadVoice,
  });

  for (const preset of WAVETABLE_PRESETS) {
    registerVoice({
      id: `wavetable-${preset.id}`,
      label: preset.label,
      kind: "wavetable",
      create: () => createWavetableVoice(preset.spectrum),
    });
  }

  for (const sample of BUNDLED_SAMPLES) {
    registerVoice({
      id: `sample-${sample.id}`,
      label: sample.label,
      kind: "sampler",
      // The base URL is a prefix, not a root: a deploy under a sub-path still
      // finds its own samples.
      create: () =>
        createSamplerVoice({
          url: `${import.meta.env.BASE_URL}${sample.file}`,
          rootFrequency: sample.rootFrequency,
          loop: true,
        }),
    });
  }
}

registerBuiltInVoices();
