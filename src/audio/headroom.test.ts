import { describe, expect, it } from "vitest";
import { FakeAudioContext } from "./fake-audio";
import { CHORD_PEAK, chordLevel, sharedOutput } from "./headroom";

/** The loudest a chord of waves at these frequencies gets, over a second. */
function peak(wave: (phase: number) => number, freqs: readonly number[], level: number): number {
  let loudest = 0;

  for (let i = 0; i < 48_000; i += 1) {
    const t = i / 48_000;
    const sum = freqs.reduce((total, freq) => total + wave(freq * t), 0);
    loudest = Math.max(loudest, Math.abs(sum * level));
  }

  return loudest;
}

const triangle = (phase: number) => {
  const p = phase - Math.floor(phase);
  return p < 0.25 ? 4 * p : p < 0.75 ? 2 - 4 * p : 4 * p - 4;
};
const sawtooth = (phase: number) => 2 * (phase - Math.floor(phase)) - 1;

/** The "Octave" kind on A: root, fifth, octave root, octave third. */
const A_OCTAVE = [220, 329.63, 440, 554.37];

describe("chordLevel", () => {
  it("keeps a chord under full scale at full volume, which is what it clipped past", () => {
    // The measurement that found the bug: unscaled, this chord peaks at over three
    // times full scale on a triangle and four on a sawtooth.
    expect(peak(triangle, A_OCTAVE, 1)).toBeGreaterThan(3);

    for (const wave of [triangle, sawtooth]) {
      expect(peak(wave, A_OCTAVE, chordLevel(A_OCTAVE.length))).toBeLessThanOrEqual(CHORD_PEAK);
    }
  });

  it("holds for any chord the instrument plays, however its waves line up", () => {
    // The worst case is every wave at its peak at once: n full-scale waves sum to n.
    for (let notes = 1; notes <= 6; notes += 1) {
      expect(notes * chordLevel(notes)).toBeLessThanOrEqual(1);
    }
  });

  it("leaves a single note as loud as it was", () => {
    expect(chordLevel(1)).toBe(1);
    expect(chordLevel(0)).toBe(1);
  });
});

describe("sharedOutput", () => {
  it("is one limiter per context, so it hears every engine at once", () => {
    const ctx = new FakeAudioContext();

    const first = sharedOutput(ctx.asContext);
    const second = sharedOutput(ctx.asContext);

    expect(second).toBe(first);
    expect(ctx.compressors).toHaveLength(1);
    expect(ctx.compressors[0].outputs).toEqual([ctx.destination]);
  });

  it("is a limiter, not a compressor: hard, fast, and just under full scale", () => {
    const ctx = new FakeAudioContext();
    sharedOutput(ctx.asContext);
    const [limiter] = ctx.compressors;

    expect(limiter.ratio.value).toBeGreaterThanOrEqual(20);
    expect(limiter.threshold.value).toBeLessThan(0);
    expect(limiter.threshold.value).toBeGreaterThan(-3);
    expect(limiter.attack.value).toBeLessThan(0.01);
  });
});
