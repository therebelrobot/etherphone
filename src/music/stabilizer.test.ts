import { describe, expect, it } from "vitest";
import type { ChordState } from "../types";
import { ChordStabilizer } from "./stabilizer";

function state(overrides: Partial<ChordState> = {}): ChordState {
  return { chord: "I", isMajorMode: true, qualityIndex: 1, thumbDown: false, ...overrides };
}

describe("ChordStabilizer", () => {
  it("holds nothing until a candidate has been steady long enough", () => {
    const stabilizer = new ChordStabilizer();

    expect(stabilizer.update(state(), 0)).toBeNull();
    expect(stabilizer.update(state(), 99)).toBeNull();
    expect(stabilizer.update(state(), 100)).toEqual(state());
  });

  it("ignores a brief dropout of the chord hand", () => {
    const stabilizer = new ChordStabilizer();
    stabilizer.update(state(), 0);
    expect(stabilizer.update(state(), 100)).toEqual(state());

    // 10ms later the hand is gone, well inside the flicker window.
    expect(stabilizer.update(null, 110)).toEqual(state());
  });

  it("commits a dropout once it outlasts the flicker window", () => {
    const stabilizer = new ChordStabilizer();
    stabilizer.update(state(), 0);
    stabilizer.update(state(), 100);

    // Past the flicker window the dropout becomes a candidate, but the hold
    // timer still has to run out before it is committed.
    expect(stabilizer.update(null, 200)).toEqual(state());
    expect(stabilizer.update(null, 300)).toBeNull();
  });

  it("requires a new chord to be held before switching", () => {
    const stabilizer = new ChordStabilizer();
    stabilizer.update(state(), 0);
    stabilizer.update(state(), 100);

    const next = state({ chord: "V" });
    expect(stabilizer.update(next, 200)).toEqual(state());
    expect(stabilizer.update(next, 299)).toEqual(state());
    expect(stabilizer.update(next, 300)).toEqual(next);
  });

  it("treats a changed voicing as a new chord", () => {
    const stabilizer = new ChordStabilizer();
    stabilizer.update(state(), 0);
    stabilizer.update(state(), 100);

    const louder = state({ qualityIndex: 3 });
    expect(stabilizer.update(louder, 150)).toEqual(state());
    expect(stabilizer.update(louder, 250)).toEqual(louder);
  });

  it("treats a thumb flip as a new chord", () => {
    const stabilizer = new ChordStabilizer();
    stabilizer.update(state(), 0);
    stabilizer.update(state(), 100);

    const dropped = state({ thumbDown: true });
    expect(stabilizer.update(dropped, 150)).toEqual(state());
    expect(stabilizer.update(dropped, 250)).toEqual(dropped);
  });

  it("forgets everything on reset", () => {
    const stabilizer = new ChordStabilizer();
    stabilizer.update(state(), 0);
    stabilizer.update(state(), 100);

    stabilizer.reset();

    expect(stabilizer.update(state(), 200)).toBeNull();
  });
});
