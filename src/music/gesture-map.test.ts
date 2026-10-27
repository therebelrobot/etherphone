import { describe, expect, it } from "vitest";
import type { ChordNumeral, HandShape } from "../types";
import {
  ALL_SHAPES,
  CLASSIC_GESTURE_MAP,
  countFingers,
  DEFAULT_GESTURE_MAP_ID,
  describeShape,
  FINGER_BITS,
  GESTURE_MAPS,
  getGestureMap,
  getGestureRows,
  PENTATONIC_GESTURE_MAP,
  shapeFromFingers,
  TRIAD_GESTURE_MAP,
} from "./gesture-map";

/**
 * The mapping this feature replaces, transcribed from the version of
 * `classifyChord` that hard-coded it. Classic is asserted to agree with it on
 * every one of the thirty-two shapes, so "nothing changes for existing players"
 * is a test rather than a claim.
 */
function legacyNumeral(shape: HandShape): ChordNumeral | null {
  const thumb = Boolean(shape & FINGER_BITS.thumb);
  const index = Boolean(shape & FINGER_BITS.index);
  const middle = Boolean(shape & FINGER_BITS.middle);
  const ring = Boolean(shape & FINGER_BITS.ring);
  const pinky = Boolean(shape & FINGER_BITS.pinky);

  if (index && pinky && !middle && !ring && !thumb) return "VI";
  if (index && pinky && !middle && !ring && thumb) return "VII";

  const count = [thumb, index, middle, ring, pinky].filter(Boolean).length;
  return (
    ({ 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V" } as Record<number, ChordNumeral>)[count] ?? null
  );
}

describe("shapeFromFingers", () => {
  it("is zero when nothing is extended", () => {
    expect(shapeFromFingers({})).toBe(0);
  });

  it("gives each finger its own bit", () => {
    expect(shapeFromFingers({ thumb: true })).toBe(1);
    expect(shapeFromFingers({ index: true })).toBe(2);
    expect(shapeFromFingers({ pinky: true })).toBe(16);
  });

  it("composes several fingers", () => {
    expect(shapeFromFingers({ index: true, pinky: true })).toBe(18);
    expect(shapeFromFingers({ thumb: true, index: true, middle: true })).toBe(7);
  });
});

describe("countFingers", () => {
  it("counts set bits", () => {
    expect(countFingers(0)).toBe(0);
    expect(countFingers(31)).toBe(5);
    expect(countFingers(shapeFromFingers({ index: true, pinky: true }))).toBe(2);
  });
});

describe("CLASSIC_GESTURE_MAP", () => {
  it("reproduces the inherited rule for every shape", () => {
    for (const shape of ALL_SHAPES) {
      expect(CLASSIC_GESTURE_MAP.shapes.get(shape), `shape ${shape}`).toBe(legacyNumeral(shape));
    }
  });

  it("is the default", () => {
    expect(DEFAULT_GESTURE_MAP_ID).toBe(CLASSIC_GESTURE_MAP.id);
    expect(getGestureMap("nope")).toBe(CLASSIC_GESTURE_MAP);
  });
});

describe("TRIAD_GESTURE_MAP", () => {
  it("reaches I, IV, and V with one to three fingers", () => {
    expect(TRIAD_GESTURE_MAP.shapes.get(shapeFromFingers({ index: true }))).toBe("I");
    expect(TRIAD_GESTURE_MAP.shapes.get(shapeFromFingers({ index: true, middle: true }))).toBe(
      "IV",
    );
    expect(
      TRIAD_GESTURE_MAP.shapes.get(shapeFromFingers({ index: true, middle: true, ring: true })),
    ).toBe("V");
  });

  it("plays nothing with four or five fingers", () => {
    expect(
      TRIAD_GESTURE_MAP.shapes.get(
        shapeFromFingers({ index: true, middle: true, ring: true, pinky: true }),
      ),
    ).toBeNull();
    expect(TRIAD_GESTURE_MAP.shapes.get(31)).toBeNull();
  });

  it("needs no special shapes, so a closed hand is silent", () => {
    expect(TRIAD_GESTURE_MAP.shapes.get(0)).toBeNull();
    expect(TRIAD_GESTURE_MAP.shapes.get(shapeFromFingers({ index: true, pinky: true }))).toBe("IV");
  });
});

describe("PENTATONIC_GESTURE_MAP", () => {
  it("maps one to five fingers onto the pentatonic degrees", () => {
    const byCount = [1, 2, 3, 4, 5].map((count) => {
      const shape = ALL_SHAPES.find((candidate) => countFingers(candidate) === count);
      return PENTATONIC_GESTURE_MAP.shapes.get(shape ?? -1);
    });

    expect(byCount).toEqual(["I", "II", "III", "V", "VI"]);
  });
});

describe("getGestureRows", () => {
  it("gives the classic map its seven rows, in scale order", () => {
    expect(getGestureRows(CLASSIC_GESTURE_MAP).map((row) => row.numeral)).toEqual([
      "I",
      "II",
      "III",
      "IV",
      "V",
      "VI",
      "VII",
    ]);
  });

  it("uses the simplest shape that reaches each degree", () => {
    const rows = getGestureRows(CLASSIC_GESTURE_MAP);
    const tonic = rows.find((row) => row.numeral === "I");

    // One finger reaches I under the count rule, so the row shows a count, not
    // one of the thirty-two-entry table's wider shapes.
    expect(tonic && countFingers(tonic.shape)).toBe(1);
  });

  it("carries the scale degree for the note readout", () => {
    expect(getGestureRows(CLASSIC_GESTURE_MAP).map((row) => row.degree)).toEqual([
      1, 2, 3, 4, 5, 6, 7,
    ]);
  });

  it("shrinks with a smaller map", () => {
    expect(getGestureRows(TRIAD_GESTURE_MAP).map((row) => row.numeral)).toEqual(["I", "IV", "V"]);
  });
});

describe("describeShape", () => {
  it("names the two rock signs", () => {
    expect(describeShape(shapeFromFingers({ index: true, pinky: true }))).toBe("🤘");
    expect(describeShape(shapeFromFingers({ thumb: true, index: true, pinky: true }))).toBe("🤟");
  });

  it("uses the keycap for a plain finger count", () => {
    expect(describeShape(shapeFromFingers({ index: true }))).toBe("1️⃣");
    expect(describeShape(31)).toBe("5️⃣");
  });

  it("counts the fingers of a shape that is not one of the presets", () => {
    // Thumb + middle is not a preset shape, but "two fingers" is still the truth.
    expect(describeShape(shapeFromFingers({ thumb: true, middle: true }))).toBe("2️⃣");
  });

  it("shows an explicit nothing for a closed hand", () => {
    expect(describeShape(0)).toBe("—");
  });
});

describe("GESTURE_MAPS", () => {
  it("has unique ids", () => {
    const ids = GESTURE_MAPS.map((map) => map.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every preset a non-empty cheat sheet", () => {
    for (const map of GESTURE_MAPS) {
      expect(getGestureRows(map).length, map.id).toBeGreaterThan(0);
    }
  });
});
