import { describe, expect, it } from "vitest";
import { crossfadeForLoop, DEFAULT_SAMPLE_ROOT_HZ, playbackRateFor } from "./sampler";

describe("playbackRateFor", () => {
  it("plays the root pitch at unity rate", () => {
    expect(playbackRateFor(110, 110)).toBe(1);
  });

  it("doubles the rate for an octave up", () => {
    expect(playbackRateFor(220, DEFAULT_SAMPLE_ROOT_HZ)).toBe(2);
  });

  it("halves the rate for an octave down", () => {
    expect(playbackRateFor(55, DEFAULT_SAMPLE_ROOT_HZ)).toBe(0.5);
  });

  it("does not divide by zero when the root is nonsense", () => {
    expect(playbackRateFor(220, 0)).toBe(1);
    expect(playbackRateFor(220, -110)).toBe(1);
  });
});

describe("crossfadeForLoop", () => {
  it("starts the buffer at the sample that followed the loop end", () => {
    // A ramp makes the seam explicit: the value after the loop point is known.
    const samples = new Float32Array(Array.from({ length: 100 }, (_unused, i) => i));

    const loopLength = crossfadeForLoop(samples, 1000, 10);

    expect(loopLength).toBe(90);
    expect(samples[0]).toBeCloseTo(samples[loopLength], 5);
  });

  it("leaves the tail of the loop body untouched", () => {
    const samples = new Float32Array(Array.from({ length: 100 }, (_unused, i) => i));
    const original = Float32Array.from(samples);

    const loopLength = crossfadeForLoop(samples, 1000, 10);

    // Only the first `fade` samples, which are what meets the seam, are rewritten.
    for (let i = 10; i < loopLength; i += 1) {
      expect(samples[i]).toBe(original[i]);
    }
  });

  it("returns the whole buffer when there is no room for a fade", () => {
    const samples = new Float32Array([1]);

    expect(crossfadeForLoop(samples, 1000, 5)).toBe(1);
    expect(Array.from(samples)).toEqual([1]);
  });

  it("is still continuous when the fade is longer than the buffer allows", () => {
    const samples = new Float32Array(Array.from({ length: 40 }, (_unused, i) => i));

    // Asking for a fade longer than half the buffer clamps to half of it.
    const loopLength = crossfadeForLoop(samples, 1000, 1000);

    expect(loopLength).toBe(20);
    expect(samples[0]).toBeCloseTo(samples[loopLength], 5);
  });
});
