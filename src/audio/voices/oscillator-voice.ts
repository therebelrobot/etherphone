/**
 * The plain-waveform voice family.
 *
 * Each preset is a labelled `Waveform`, and every one is registered as its own
 * instrument. That is deliberate: "Warm Synth" and "Bright Synth" are not a
 * setting on one instrument, they are two instruments, which means the picker
 * lists what you can play rather than asking you to configure it.
 */
import type { Waveform } from "../../types";
import type { Voice } from "../voice";
import { OscillatorBank } from "./bank";

/** A named built-in waveform. */
export interface OscillatorPreset {
  readonly id: string;
  readonly label: string;
  readonly waveform: Waveform;
}

export const OSCILLATOR_PRESETS: readonly OscillatorPreset[] = [
  { id: "warm", label: "Warm Synth", waveform: "triangle" },
  { id: "bright", label: "Bright Synth", waveform: "sawtooth" },
  { id: "retro", label: "Retro Synth", waveform: "square" },
];

/** Builds a voice that sounds one plain oscillator per note. */
export function createOscillatorVoice(waveform: Waveform): Voice {
  return new OscillatorBank({
    configure: (oscillator) => {
      oscillator.type = waveform;
    },
  });
}
