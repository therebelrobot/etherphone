import { describe, expect, it } from "vitest";
import type { TakeEvent } from "../types";
import { resolveTakeEvent, sameIntent } from "./take";

/** A tonic that is not one of the three the engine drops an octave. */
const C4 = 261.63;

const chord = (overrides: Partial<Extract<TakeEvent, { kind: "chord" }>> = {}) =>
  ({
    kind: "chord",
    beat: 0,
    volume: 0.8,
    tilt: 0,
    numeral: "I",
    isMajorMode: true,
    qualityIndex: 1,
    thumbDown: false,
    ...overrides,
  }) as TakeEvent;

const note = (overrides: Partial<Extract<TakeEvent, { kind: "note" }>> = {}) =>
  ({ kind: "note", beat: 0, volume: 0.5, tilt: 0, degree: 1, ...overrides }) as TakeEvent;

const rest = (): TakeEvent => ({ kind: "rest", beat: 0, volume: 0, tilt: 0 });

describe("resolveTakeEvent", () => {
  it("re-derives a chord from the current tonic, so the loop transposes", () => {
    const inC = resolveTakeEvent(chord(), C4);
    const inD = resolveTakeEvent(chord(), C4 * Math.pow(2, 2 / 12));

    expect(inC.notes[0]).toBeCloseTo(C4, 2);
    // Up a whole tone, so the whole voicing moves with the key.
    expect(inD.notes[0] / inC.notes[0]).toBeCloseTo(Math.pow(2, 2 / 12), 5);
  });

  it("drops a chord an octave when the thumb was in", () => {
    const up = resolveTakeEvent(chord({ thumbDown: false }), C4);
    const down = resolveTakeEvent(chord({ thumbDown: true }), C4);

    expect(down.notes[0]).toBeCloseTo(up.notes[0] / 2, 5);
  });

  it("sounds a mono degree at that degree's frequency", () => {
    const reading = resolveTakeEvent(note({ degree: 8 }), C4);

    expect(reading.notes).toHaveLength(1);
    expect(reading.notes[0]).toBeCloseTo(C4 * 2, 2);
  });

  it("carries the recorded expression through", () => {
    const reading = resolveTakeEvent(chord({ volume: 0.42, tilt: -0.5 }), C4);

    expect(reading.volume).toBeCloseTo(0.42, 6);
    expect(reading.tilt).toBeCloseTo(-0.5, 6);
  });

  it("resolves a rest to silence", () => {
    expect(resolveTakeEvent(rest(), C4).notes).toEqual([]);
  });
});

describe("sameIntent", () => {
  it("ignores beat, volume, and tilt", () => {
    expect(sameIntent(chord({ beat: 0, volume: 0.2 }), chord({ beat: 3, volume: 0.9 }))).toBe(true);
  });

  it("tells two different chords apart", () => {
    expect(sameIntent(chord({ numeral: "I" }), chord({ numeral: "V" }))).toBe(false);
    expect(sameIntent(chord({ isMajorMode: true }), chord({ isMajorMode: false }))).toBe(false);
    expect(sameIntent(chord({ qualityIndex: 1 }), chord({ qualityIndex: 3 }))).toBe(false);
  });

  it("tells two different notes apart, and notes from chords", () => {
    expect(sameIntent(note({ degree: 1 }), note({ degree: 2 }))).toBe(false);
    expect(sameIntent(note(), chord())).toBe(false);
  });

  it("treats every rest as the same rest", () => {
    expect(sameIntent(rest(), rest())).toBe(true);
  });
});
