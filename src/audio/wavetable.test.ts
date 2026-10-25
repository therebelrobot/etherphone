import { describe, expect, it } from "vitest";
import { analyseCycle, fromAmplitudes, normaliseSpectrum, WAVETABLE_PRESETS } from "./wavetable";

/** One cycle of a sine, sampled `length` times. */
function sineCycle(length: number): Float32Array {
  const samples = new Float32Array(length);
  for (let n = 0; n < length; n += 1) {
    samples[n] = Math.sin((2 * Math.PI * n) / length);
  }
  return samples;
}

/** One cycle of a sawtooth, whose kth harmonic falls off as 1/k. */
function sawCycle(length: number): Float32Array {
  const samples = new Float32Array(length);
  const harmonics = 32;

  for (let n = 0; n < length; n += 1) {
    let value = 0;
    for (let k = 1; k <= harmonics; k += 1) {
      value += Math.sin((2 * Math.PI * k * n) / length) / k;
    }
    samples[n] = value;
  }

  return samples;
}

describe("fromAmplitudes", () => {
  it("puts every amplitude in the sine terms, with no cosine content", () => {
    const spectrum = fromAmplitudes([1, 0.5, 0.25]);

    expect(spectrum.imag).toEqual([0, 1, 0.5, 0.25]);
    expect(spectrum.real).toEqual([0, 0, 0, 0]);
  });

  it("leaves DC at zero", () => {
    for (const preset of WAVETABLE_PRESETS) {
      expect(preset.spectrum.real[0]).toBe(0);
      expect(preset.spectrum.imag[0]).toBe(0);
    }
  });
});

describe("normaliseSpectrum", () => {
  it("scales the loudest harmonic to one", () => {
    const normalised = normaliseSpectrum(fromAmplitudes([2, 1]), 16);

    expect(Math.max(...normalised.imag)).toBeCloseTo(1, 6);
    expect(normalised.imag[2]).toBeCloseTo(0.5, 6);
  });

  it("drops harmonics above the cap", () => {
    const normalised = normaliseSpectrum(fromAmplitudes([1, 1, 1, 1, 1, 1]), 2);

    expect(normalised.imag).toHaveLength(3); // DC plus two harmonics
  });

  it("survives a spectrum with nothing in it", () => {
    const normalised = normaliseSpectrum(fromAmplitudes([0, 0, 0]), 16);

    expect(normalised.imag.every((value) => value === 0)).toBe(true);
  });
});

describe("analyseCycle", () => {
  it("reads a pure sine as the fundamental alone", () => {
    const spectrum = analyseCycle(sineCycle(512), 32);

    expect(spectrum.imag[1]).toBeCloseTo(1, 4);
    expect(Math.abs(spectrum.imag[2])).toBeLessThan(0.001);
    expect(Math.abs(spectrum.real[1])).toBeLessThan(0.001);
  });

  it("recovers the 1/k falloff of a sawtooth", () => {
    const spectrum = analyseCycle(sawCycle(512), 8);

    expect(spectrum.imag[1]).toBeCloseTo(1, 4);
    expect(spectrum.imag[2]).toBeCloseTo(0.5, 3);
    expect(spectrum.imag[3]).toBeCloseTo(1 / 3, 3);
  });

  it("decimates a long cycle rather than truncating it", () => {
    // Sampled at every other point, one cycle is still exactly one cycle: had
    // this truncated, the second half of the waveform would be missing and the
    // spectrum would be smeared.
    const spectrum = analyseCycle(sineCycle(4096), 32);

    expect(spectrum.imag[1]).toBeCloseTo(1, 4);
    expect(Math.abs(spectrum.imag[2])).toBeLessThan(0.001);
  });

  it("never returns more harmonics than asked for", () => {
    expect(analyseCycle(sawCycle(256), 4).imag).toHaveLength(5);
  });
});

describe("bundled wavetables", () => {
  it("are uniquely identified and labelled", () => {
    const ids = WAVETABLE_PRESETS.map((preset) => preset.id);

    expect(new Set(ids).size).toBe(ids.length);

    for (const preset of WAVETABLE_PRESETS) {
      expect(preset.label.length).toBeGreaterThan(0);
    }
  });

  it("all describe a real waveform rather than silence", () => {
    for (const preset of WAVETABLE_PRESETS) {
      const loudest = Math.max(...preset.spectrum.imag.map(Math.abs));
      expect(loudest).toBeGreaterThan(0);
    }
  });
});
