/**
 * Wavetables as harmonic spectra.
 *
 * A wavetable is a single cycle of a waveform. Web Audio plays one through a
 * `PeriodicWave`, which is defined as a sum of sines and cosines rather than as
 * a table of samples:
 *
 *     x(t) = Σ  real[k]·cos(k·ωt) + imag[k]·sin(k·ωt)
 *
 * So a "wavetable" here is a pair of coefficient arrays, one per harmonic. That
 * is the whole reason this module is pure: analysis, presets, and normalisation
 * are arithmetic on numbers, with no `AudioContext` involved. Turning a spectrum
 * into a `PeriodicWave` is the voice's job, and the only part that needs a
 * browser.
 *
 * Harmonic `k = 0` is DC and is always zeroed: a constant offset is a click
 * waiting to happen, never a timbre.
 */
import { AUDIO } from "../config/constants";

/** Cosine and sine coefficients, indexed by harmonic number. */
export interface HarmonicSpectrum {
  /** Cosine terms. Index 0 is DC and is always 0. */
  readonly real: readonly number[];
  /** Sine terms: a pure sine fundamental is `imag[1] = 1` and nothing else. */
  readonly imag: readonly number[];
}

/** Highest harmonic index a built-in spectrum reaches, before the analysis cap. */
const PRESET_HARMONICS = 16;

/**
 * Builds a sine-only spectrum from a list of harmonic amplitudes.
 *
 * `amplitudes[0]` is the fundamental, `amplitudes[1]` the second harmonic, and
 * so on. Sine-only is the intuitive way to author a table and is enough for
 * every preset here; the analyser below fills in phase as well, so a loaded
 * file keeps the shape it was drawn with.
 */
export function fromAmplitudes(amplitudes: readonly number[]): HarmonicSpectrum {
  const real: number[] = [0];
  const imag: number[] = [0];

  for (let k = 0; k < amplitudes.length; k += 1) {
    real.push(0);
    imag.push(amplitudes[k]);
  }

  return { real, imag };
}

/** Truncates a spectrum to `harmonicCount` harmonics and renormalises it. */
export function normaliseSpectrum(
  spectrum: HarmonicSpectrum,
  harmonicCount: number,
): HarmonicSpectrum {
  // `limit` is exclusive, so it is one past the last harmonic we keep.
  const limit = Math.min(harmonicCount + 1, spectrum.real.length, spectrum.imag.length);

  const real = spectrum.real.slice(0, limit);
  const imag = spectrum.imag.slice(0, limit);
  real[0] = 0;
  imag[0] = 0;

  let peak = 0;
  for (let k = 1; k < limit; k += 1) {
    peak = Math.max(peak, Math.abs(real[k]), Math.abs(imag[k]));
  }

  if (peak > 0) {
    for (let k = 1; k < limit; k += 1) {
      real[k] /= peak;
      imag[k] /= peak;
    }
  }

  return { real, imag };
}

/**
 * Reads the harmonic content of one cycle of a sampled waveform.
 *
 * This is a discrete Fourier transform, deliberately literal: one pass over the
 * samples per harmonic, computing the sine and cosine projections. It runs once
 * per loaded file, on at most {@link AUDIO.wavetableAnalysisSamples} samples, so
 * an FFT would be more machinery than the job needs.
 *
 * The input is assumed to be a single cycle. A file holding many cycles will
 * analyse as a smeared, bell-like spectrum rather than the intended timbre, so
 * wavetable files must be exported as one cycle.
 */
export function analyseCycle(samples: Float32Array, harmonicCount: number): HarmonicSpectrum {
  const limit = Math.max(1, Math.min(harmonicCount, AUDIO.wavetableMaxHarmonics));

  // Long files are decimated rather than truncated: the whole cycle matters, and
  // the samples are already band-limited by the recording.
  const stride = Math.max(1, Math.ceil(samples.length / AUDIO.wavetableAnalysisSamples));
  const cycle: number[] = [];
  for (let i = 0; i < samples.length; i += stride) {
    cycle.push(samples[i]);
  }

  const length = cycle.length;
  const real: number[] = [0];
  const imag: number[] = [0];

  for (let k = 1; k <= limit; k += 1) {
    let cosine = 0;
    let sine = 0;

    for (let n = 0; n < length; n += 1) {
      const angle = (2 * Math.PI * k * n) / length;
      cosine += cycle[n] * Math.cos(angle);
      sine += cycle[n] * Math.sin(angle);
    }

    real.push((2 * cosine) / length);
    imag.push((2 * sine) / length);
  }

  return normaliseSpectrum({ real, imag }, limit);
}

/** A named built-in wavetable. */
export interface WavetablePreset {
  readonly id: string;
  readonly label: string;
  readonly spectrum: HarmonicSpectrum;
}

/**
 * The bundled wavetables.
 *
 * Authoring these as amplitudes rather than as `.wav` files is intentional: the
 * numbers *are* the timbre, they are diffable, and they cost the bundle nothing.
 * Files are how you bring your own, and those arrive through the analyser.
 */
export const WAVETABLE_PRESETS: readonly WavetablePreset[] = [
  {
    id: "hollow",
    label: "Hollow (odd harmonics)",
    // Odd harmonics only, rolled off quickly: the clarinet trick.
    spectrum: fromAmplitudes(
      Array.from({ length: PRESET_HARMONICS }, (_unused, index) => {
        const harmonic = index + 1;
        return harmonic % 2 === 1 ? 1 / harmonic ** 2 : 0;
      }),
    ),
  },
  {
    id: "organ",
    label: "Drawbar Organ",
    spectrum: fromAmplitudes([1, 0.7, 0.2, 0.5, 0, 0.3, 0, 0.25, 0, 0, 0, 0.15]),
  },
  {
    id: "glass",
    label: "Glass",
    // Sparse, widely spaced partials, like struck glass.
    spectrum: fromAmplitudes([1, 0, 0, 0.55, 0, 0, 0, 0.3, 0, 0, 0, 0, 0, 0, 0, 0.2]),
  },
];
