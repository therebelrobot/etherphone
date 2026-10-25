import { describe, expect, it } from "vitest";
import {
  getChordDisplayName,
  getChordTones,
  getDegreeFrequency,
  getScaleNoteName,
} from "./harmony";

const SEMITONE = (n: number): number => Math.pow(2, n / 12);

describe("getScaleNoteName", () => {
  it("reads the written note for a degree of a key", () => {
    expect(getScaleNoteName("C", 1)).toBe("C");
    expect(getScaleNoteName("C", 5)).toBe("G");
    expect(getScaleNoteName("Gb", 3)).toBe("Bb");
  });
});

describe("getDegreeFrequency", () => {
  it("returns the tonic for degree I", () => {
    expect(getDegreeFrequency(1, 220)).toBeCloseTo(220);
  });

  it("tunes the fifth seven semitones up", () => {
    expect(getDegreeFrequency(5, 220)).toBeCloseTo(220 * SEMITONE(7));
  });

  it("drops the three sharpest keys an octave", () => {
    expect(getDegreeFrequency(1, 392)).toBeCloseTo(196);
  });

  it("puts the leading tone a semitone below the tonic", () => {
    expect(getDegreeFrequency(7, 220)).toBeCloseTo(220 * SEMITONE(-1));
  });
});

describe("getChordDisplayName", () => {
  it("returns an empty string for no chord", () => {
    expect(getChordDisplayName(null, true, "C")).toBe("");
  });

  it("names a major chord after its root", () => {
    expect(getChordDisplayName("I", true, "C")).toBe("C");
  });

  it("appends m for a minor chord", () => {
    expect(getChordDisplayName("I", false, "C")).toBe("Cm");
  });

  it("follows the numeral to the right scale degree", () => {
    expect(getChordDisplayName("VI", true, "C")).toBe("A");
    expect(getChordDisplayName("vii", false, "C")).toBe("Bm");
  });
});

describe("getChordTones", () => {
  it("returns null for no chord", () => {
    expect(getChordTones(null, true, 220)).toBeNull();
  });

  it("builds a major triad", () => {
    const tones = getChordTones("I", true, 220);
    expect(tones).not.toBeNull();
    expect(tones!.root).toBeCloseTo(220);
    expect(tones!.third).toBeCloseTo(220 * SEMITONE(4));
    expect(tones!.fifth).toBeCloseTo(220 * SEMITONE(7));
    expect(tones!.octaveThird).toBeCloseTo(220 * SEMITONE(4) * 2);
  });

  it("builds a minor triad a semitone lower on the third", () => {
    const tones = getChordTones("I", false, 220);
    expect(tones!.third).toBeCloseTo(220 * SEMITONE(3));
  });

  it("exposes every seventh and the diminished fifth", () => {
    const tones = getChordTones("I", true, 220)!;
    expect(tones.maj7Tone).toBeCloseTo(220 * SEMITONE(11));
    expect(tones.dom7Tone).toBeCloseTo(220 * SEMITONE(10));
    expect(tones.dim7Tone).toBeCloseTo(220 * SEMITONE(9));
    expect(tones.dim5Tone).toBeCloseTo(220 * SEMITONE(6));
    expect(tones.octaveRoot).toBeCloseTo(440);
  });

  it("transposes with the selected degree", () => {
    const tonic = getChordTones("I", true, 220)!;
    const fifthDegree = getChordTones("V", true, 220)!;
    expect(fifthDegree.root).toBeCloseTo(tonic.fifth);
    expect(fifthDegree.root).toBeCloseTo(220 * SEMITONE(7));
  });
});
