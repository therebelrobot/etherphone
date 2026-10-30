import { describe, expect, it } from "vitest";
import type { ChordState } from "../types";
import { ChordStabilizer, DwellStabilizer } from "./stabilizer";

function state(overrides: Partial<ChordState> = {}): ChordState {
  return { chord: "I", isMajorMode: true, quality: "octave", ...overrides };
}

describe("DwellStabilizer", () => {
  it("commits nothing until the hold has elapsed", () => {
    const dwell = new DwellStabilizer<string>(100);

    expect(dwell.update("a", 0)).toBeNull();
    expect(dwell.update("a", 99)).toBeNull();
    expect(dwell.update("a", 100)).toBe("a");
  });

  it("restarts the hold when the value changes", () => {
    const dwell = new DwellStabilizer<string>(100);

    dwell.update("a", 0);
    expect(dwell.update("b", 50)).toBeNull();
    expect(dwell.update("b", 149)).toBeNull();
    expect(dwell.update("b", 150)).toBe("b");
  });

  it("keeps the committed value while a new one is still being held", () => {
    const dwell = new DwellStabilizer<string>(100);

    dwell.update("a", 0);
    expect(dwell.update("a", 100)).toBe("a");
    expect(dwell.update("b", 120)).toBe("a");
  });

  it("commits a null reading, which is how a control turns off", () => {
    const dwell = new DwellStabilizer<boolean>(100);

    dwell.update(true, 0);
    expect(dwell.update(true, 100)).toBe(true);
    expect(dwell.update(null, 150)).toBe(true);
    expect(dwell.update(null, 250)).toBeNull();
  });

  it("uses the supplied comparison, so rebuilt objects still count as unchanged", () => {
    interface Reading {
      readonly degree: number;
    }

    const dwell = new DwellStabilizer<Reading>(100, (a, b) => a?.degree === b?.degree);

    dwell.update({ degree: 1 }, 0);
    // A fresh object with the same value must not restart the hold.
    expect(dwell.update({ degree: 1 }, 100)).toEqual({ degree: 1 });
  });

  it("exposes the value being held before it commits", () => {
    const dwell = new DwellStabilizer<string>(100);

    dwell.update("a", 0);
    expect(dwell.pending).toBe("a");
  });

  it("forgets everything on reset", () => {
    const dwell = new DwellStabilizer<string>(100);

    dwell.update("a", 0);
    dwell.update("a", 100);

    dwell.reset();

    expect(dwell.pending).toBeNull();
    expect(dwell.update("a", 200)).toBeNull();
  });
});

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

  it("treats a changed kind as a new chord", () => {
    const stabilizer = new ChordStabilizer();
    stabilizer.update(state(), 0);
    stabilizer.update(state(), 100);

    const louder = state({ quality: "add7" });
    expect(stabilizer.update(louder, 150)).toEqual(state());
    expect(stabilizer.update(louder, 250)).toEqual(louder);
  });

  it("treats coming off the map as a new chord, which is how the hand goes silent", () => {
    // A pose nothing is mapped to is not a special case: it is a state change like
    // any other, and the held chord has to be released for it to take effect.
    const stabilizer = new ChordStabilizer();
    stabilizer.update(state(), 0);
    stabilizer.update(state(), 100);

    const silent = state({ quality: null });
    expect(stabilizer.update(silent, 150)).toEqual(state());
    expect(stabilizer.update(silent, 250)).toEqual(silent);
  });

  it("forgets everything on reset", () => {
    const stabilizer = new ChordStabilizer();
    stabilizer.update(state(), 0);
    stabilizer.update(state(), 100);

    stabilizer.reset();

    expect(stabilizer.update(state(), 200)).toBeNull();
  });
});
