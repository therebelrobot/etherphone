import { describe, expect, it } from "vitest";
import { MONO_OCTAVE_SPAN, MONO_PITCH_BOTTOM_Y, MONO_PITCH_TOP_Y } from "../config/constants";
import {
  degreePositionAtHeight,
  frequencyAtPosition,
  frequencyForDegree,
  MonoReader,
  monoNoteLabel,
  monoNumeral,
  PITCH_SPAN_DEGREES,
} from "./mono";

/** A tonic that is not one of the three the engine drops an octave. */
const C4 = 261.63;

/** The height that puts the pitch hand on a given degree position. */
function heightForPosition(position: number): number {
  const travelled = (position - 1) / PITCH_SPAN_DEGREES;
  return MONO_PITCH_TOP_Y + (1 - travelled) * (MONO_PITCH_BOTTOM_Y - MONO_PITCH_TOP_Y);
}

describe("frequencyForDegree", () => {
  it("matches the tonic at the first degree", () => {
    expect(frequencyForDegree(1, C4)).toBeCloseTo(C4, 2);
  });

  it("counts past the seventh as octaves rather than wrapping", () => {
    expect(frequencyForDegree(8, C4)).toBeCloseTo(C4 * 2, 2);
    expect(frequencyForDegree(15, C4)).toBeCloseTo(C4 * 4, 2);
  });

  it("keeps the leading tone a semitone below the next tonic", () => {
    const leadingTone = frequencyForDegree(7, C4);
    const nextTonic = frequencyForDegree(8, C4);

    expect(nextTonic / leadingTone).toBeCloseTo(Math.pow(2, 1 / 12), 5);
  });

  it("spans the configured octave range across the whole band", () => {
    expect(PITCH_SPAN_DEGREES).toBe(7 * MONO_OCTAVE_SPAN);
    expect(frequencyForDegree(1 + PITCH_SPAN_DEGREES, C4)).toBeCloseTo(
      C4 * Math.pow(2, MONO_OCTAVE_SPAN),
      2,
    );
  });

  it("rises at every step, so a sweep is a scale run and not a sawtooth", () => {
    // Regression: the chord table tunes degree VII a semitone *below* the tonic,
    // so reusing it here would drop an octave at every seventh step of a sweep.
    for (let degree = 1; degree < PITCH_SPAN_DEGREES; degree += 1) {
      expect(
        frequencyForDegree(degree + 1, C4),
        `degree ${degree} -> ${degree + 1}`,
      ).toBeGreaterThan(frequencyForDegree(degree, C4));
    }
  });
});

describe("degreePositionAtHeight", () => {
  it("is the lowest degree at the bottom of the band", () => {
    expect(degreePositionAtHeight(MONO_PITCH_BOTTOM_Y)).toBeCloseTo(1);
  });

  it("is the highest degree at the top of the band", () => {
    expect(degreePositionAtHeight(MONO_PITCH_TOP_Y)).toBeCloseTo(1 + PITCH_SPAN_DEGREES);
  });

  it("rises as the hand rises", () => {
    expect(degreePositionAtHeight(0.2)).toBeGreaterThan(degreePositionAtHeight(0.8));
  });

  it("clamps beyond the band rather than running off the scale", () => {
    expect(degreePositionAtHeight(0)).toBeCloseTo(1 + PITCH_SPAN_DEGREES);
    expect(degreePositionAtHeight(1)).toBeCloseTo(1);
  });
});

describe("frequencyAtPosition", () => {
  it("agrees with the degree frequency on a whole position", () => {
    expect(frequencyAtPosition(4, C4)).toBeCloseTo(frequencyForDegree(4, C4), 5);
  });

  it("lands a semitone up at the midpoint between two scale degrees", () => {
    // A whole tone's midpoint, geometrically, is the semitone between them.
    expect(frequencyAtPosition(1.5, C4)).toBeCloseTo(C4 * Math.pow(2, 1 / 12), 2);
  });

  it("stays between the degrees it sits between", () => {
    const value = frequencyAtPosition(1.4, C4);

    expect(value).toBeGreaterThan(frequencyForDegree(1, C4));
    expect(value).toBeLessThan(frequencyForDegree(2, C4));
  });
});

describe("MonoReader", () => {
  it("reports nothing without a pitch hand", () => {
    expect(new MonoReader().update(null, "quantised", C4)).toBeNull();
  });

  it("snaps to the nearest degree when quantised", () => {
    const reading = new MonoReader().update(heightForPosition(1.4), "quantised", C4);

    expect(reading?.degree).toBe(1);
    expect(reading?.frequency).toBeCloseTo(frequencyForDegree(1, C4), 5);
  });

  it("drops the whole reading an octave when the thumb asks for it", () => {
    // The bassline case: the same hand positions, one register lower.
    const reading = new MonoReader().update(heightForPosition(1.4), "quantised", C4, true);

    expect(reading?.frequency).toBeCloseTo(frequencyForDegree(1, C4) / 2, 5);
    // The degree is unchanged: it is the register that moved, not the note.
    expect(reading?.degree).toBe(1);
  });

  it("drops a glide too, so the octave control does not break the slide", () => {
    const plain = new MonoReader().update(heightForPosition(1.4), "glide", C4);
    const dropped = new MonoReader().update(heightForPosition(1.4), "glide", C4, true);

    expect(dropped?.frequency).toBeCloseTo((plain?.frequency ?? 0) / 2, 5);
  });

  it("is unchanged when the thumb is not extended", () => {
    const plain = new MonoReader().update(heightForPosition(1.4), "quantised", C4, false);

    expect(plain?.frequency).toBeCloseTo(frequencyForDegree(1, C4), 5);
  });

  it("slides between degrees when gliding", () => {
    const reading = new MonoReader().update(heightForPosition(1.4), "glide", C4);

    expect(reading?.frequency).toBeGreaterThan(frequencyForDegree(1, C4));
    expect(reading?.frequency).toBeLessThan(frequencyForDegree(2, C4));
  });

  it("marks the first reading as a new degree, and a held hand as not", () => {
    const reader = new MonoReader();

    expect(reader.update(0.9, "harp", C4)?.isNewDegree).toBe(true);
    expect(reader.update(0.9, "harp", C4)?.isNewDegree).toBe(false);
    expect(reader.update(0.5, "harp", C4)?.isNewDegree).toBe(true);
  });

  it("plucks again after a reset, even on the same degree", () => {
    const reader = new MonoReader();

    reader.update(0.9, "harp", C4);
    expect(reader.update(0.9, "harp", C4)?.isNewDegree).toBe(false);

    reader.reset();
    expect(reader.update(0.9, "harp", C4)?.isNewDegree).toBe(true);
  });

  it("forgets the degree when the hand drops, so the next note is fresh", () => {
    const reader = new MonoReader();

    reader.update(0.9, "harp", C4);
    expect(reader.update(null, "harp", C4)).toBeNull();
    expect(reader.update(0.9, "harp", C4)?.isNewDegree).toBe(true);
  });

  it("reads the octave the degree sits in", () => {
    const reader = new MonoReader();

    expect(reader.update(heightForPosition(1), "quantised", C4)?.octave).toBe(0);
    expect(reader.update(heightForPosition(8), "quantised", C4)?.octave).toBe(1);
    expect(reader.update(heightForPosition(15), "quantised", C4)?.octave).toBe(2);
  });
});

describe("monoNoteLabel", () => {
  it("names the note without an octave marker at the tonic's own octave", () => {
    expect(monoNoteLabel({ frequency: 0, degree: 1, octave: 0, isNewDegree: true }, "C")).toBe("C");
  });

  it("marks the octaves above the tonic", () => {
    expect(monoNoteLabel({ frequency: 0, degree: 8, octave: 1, isNewDegree: true }, "C")).toBe(
      "C +1",
    );
    expect(monoNoteLabel({ frequency: 0, degree: 15, octave: 2, isNewDegree: true }, "C")).toBe(
      "C +2",
    );
  });

  it("follows the selected key", () => {
    expect(monoNoteLabel({ frequency: 0, degree: 1, octave: 0, isNewDegree: true }, "A")).toBe("A");
    expect(monoNoteLabel({ frequency: 0, degree: 3, octave: 0, isNewDegree: true }, "A")).toBe(
      "C#",
    );
  });
});

describe("monoNumeral", () => {
  it("wraps the degree back onto a roman numeral for the ribbon's hue", () => {
    expect(monoNumeral({ frequency: 0, degree: 1, octave: 0, isNewDegree: true })).toBe("I");
    expect(monoNumeral({ frequency: 0, degree: 7, octave: 0, isNewDegree: true })).toBe("VII");
    expect(monoNumeral({ frequency: 0, degree: 8, octave: 1, isNewDegree: true })).toBe("I");
  });
});
