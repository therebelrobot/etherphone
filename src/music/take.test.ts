import { describe, expect, it } from "vitest";
import type { TakeEvent } from "../types";
import { mergeTakes, resolveTakeEvent, sameIntent } from "./take";

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
    quality: "octave",
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

  it("replays the kind of chord it was played with", () => {
    // The take stores the quality id, so a recorded sus4 comes back a sus4. The
    // instrument used to store a finger count and rebuild the kind from it, which
    // could not survive a map edit: the same count would mean something else.
    const sus = resolveTakeEvent(chord({ quality: "sus4" }), C4);
    const octave = resolveTakeEvent(chord({ quality: "octave" }), C4);

    expect(sus.notes).not.toEqual(octave.notes);
    // A suspended fourth has no third, which is what makes it suspended.
    expect(sus.notes).toHaveLength(4);
    expect(octave.notes).toHaveLength(4);
    expect(sus.notes[1]).toBeCloseTo(C4 * Math.pow(2, 5 / 12), 5);
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
    expect(sameIntent(chord({ quality: "octave" }), chord({ quality: "add7" }))).toBe(false);
  });

  it("tells two different notes apart, and notes from chords", () => {
    expect(sameIntent(note({ degree: 1 }), note({ degree: 2 }))).toBe(false);
    expect(sameIntent(note(), chord())).toBe(false);
  });

  it("treats every rest as the same rest", () => {
    expect(sameIntent(rest(), rest())).toBe(true);
  });
});

describe("mergeTakes", () => {
  const chord = (beat: number, numeral: "I" | "V") => ({
    kind: "chord" as const,
    beat,
    volume: 0.5,
    tilt: 0,
    numeral,
    isMajorMode: true,
    quality: "octave",
  });

  const base = { bpm: 100, loopBeats: 8, events: [chord(0, "I"), chord(4, "V")] };

  it("adds the second pass to the first, in beat order", () => {
    const merged = mergeTakes(base, { ...base, events: [chord(2, "I")] });

    expect(merged.events.map((event) => event.beat)).toEqual([0, 2, 4]);
  });

  it("drops the added pass's rests, so an overdub never erases what it is not playing", () => {
    const withRest = {
      ...base,
      events: [{ kind: "rest" as const, beat: 2, volume: 0, tilt: 0 }],
    };

    const merged = mergeTakes(base, withRest);

    expect(merged.events).toHaveLength(2);
    expect(merged.events.map((event) => event.kind)).toEqual(["chord", "chord"]);
  });

  it("lets the newer pass win where both play on the same beat", () => {
    const merged = mergeTakes(base, { ...base, events: [chord(0, "V")] });

    expect(merged.events[0]).toMatchObject({ beat: 0, numeral: "V" });
    expect(merged.events).toHaveLength(2);
  });

  it("keeps the base take's grid, since that is what the layer plays against", () => {
    const merged = mergeTakes(base, { ...base, bpm: 140, loopBeats: 16 });

    expect(merged.bpm).toBe(100);
    expect(merged.loopBeats).toBe(8);
  });
});
