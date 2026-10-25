/**
 * The wavetable voice.
 *
 * A wavetable is played through a `PeriodicWave`, which is the one piece of this
 * voice that needs an `AudioContext`: the spectrum itself is authored or
 * analysed as plain numbers. Building the wave once in `prepare` means every
 * oscillator in the chord shares it.
 */
import { AUDIO } from "../../config/constants";
import type { Voice } from "../voice";
import { normaliseSpectrum } from "../wavetable";
import type { HarmonicSpectrum } from "../wavetable";
import { OscillatorBank } from "./bank";

/** Builds a voice that sounds one wavetable oscillator per note. */
export function createWavetableVoice(spectrum: HarmonicSpectrum): Voice {
  const normalised = normaliseSpectrum(spectrum, AUDIO.wavetableMaxHarmonics);

  let wave: PeriodicWave | null = null;

  return new OscillatorBank({
    prepare: (ctx) => {
      wave = ctx.createPeriodicWave(
        Float32Array.from(normalised.real),
        Float32Array.from(normalised.imag),
      );
    },
    configure: (oscillator) => {
      // `prepare` always runs first; the sine is a fallback that cannot sound wrong.
      if (wave) oscillator.setPeriodicWave(wave);
      else oscillator.type = "sine";
    },
  });
}
