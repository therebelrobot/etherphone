import { describe, expect, it } from "vitest";
import { getChordTones } from "./harmony";
import {
  getSolidNotes,
  getVoicing,
  getVoicingLabel,
  MAJOR_VOICINGS,
  MINOR_VOICINGS,
} from "./voicings";

const tones = getChordTones("I", true, 220)!;
const minorTones = getChordTones("I", false, 220)!;

describe("voicing tables", () => {
  it("offers four voicings per mode, numbered 1 to 4", () => {
    expect(MAJOR_VOICINGS.map((v) => v.index)).toEqual([1, 2, 3, 4]);
    expect(MINOR_VOICINGS.map((v) => v.index)).toEqual([1, 2, 3, 4]);
  });

  it("labels every voicing", () => {
    for (const voicing of [...MAJOR_VOICINGS, ...MINOR_VOICINGS]) {
      expect(voicing.label.length).toBeGreaterThan(0);
    }
  });
});

describe("getVoicingLabel", () => {
  it("names the active major voicing", () => {
    expect(getVoicingLabel(true, 1)).toBe("Major");
    expect(getVoicingLabel(true, 3)).toBe("Major 7th");
    expect(getVoicingLabel(true, 4)).toBe("Dominant 7th");
  });

  it("names the active minor voicing", () => {
    expect(getVoicingLabel(false, 3)).toBe("Minor 7th");
    expect(getVoicingLabel(false, 4)).toBe("Diminished 7th");
  });

  it("is undefined when no fingers are held", () => {
    expect(getVoicingLabel(true, 0)).toBeUndefined();
  });
});

describe("getVoicing", () => {
  it("finds a voicing by finger count", () => {
    expect(getVoicing(true, 2)?.label).toBe("Major 1st Inv");
    expect(getVoicing(false, 2)?.label).toBe("Minor 1st Inv");
  });

  it("is undefined out of range", () => {
    expect(getVoicing(true, 9)).toBeUndefined();
  });
});

describe("getSolidNotes", () => {
  it("is empty when there is no chord", () => {
    expect(getSolidNotes(null, 1, true)).toEqual([]);
  });

  it("sounds the root-position triad by default", () => {
    expect(getSolidNotes(tones, 1, true)).toEqual([
      tones.root,
      tones.fifth,
      tones.octaveRoot,
      tones.octaveThird,
    ]);
  });

  it("raises the third for the first inversion", () => {
    expect(getSolidNotes(tones, 2, true)).toEqual([
      tones.third,
      tones.fifth,
      tones.octaveRoot,
      tones.octaveThird,
    ]);
  });

  it("uses the major seventh in major mode", () => {
    expect(getSolidNotes(tones, 3, true)).toEqual([
      tones.root,
      tones.third,
      tones.fifth,
      tones.maj7Tone,
    ]);
  });

  it("uses the dominant seventh in major mode", () => {
    expect(getSolidNotes(tones, 4, true)).toEqual([
      tones.root,
      tones.third,
      tones.fifth,
      tones.dom7Tone,
    ]);
  });

  it("uses the dominant seventh for a minor seventh chord", () => {
    expect(getSolidNotes(minorTones, 3, false)).toEqual([
      minorTones.root,
      minorTones.third,
      minorTones.fifth,
      minorTones.dom7Tone,
    ]);
  });

  it("uses the tritone and diminished seventh in minor mode", () => {
    expect(getSolidNotes(minorTones, 4, false)).toEqual([
      minorTones.root,
      minorTones.third,
      minorTones.dim5Tone,
      minorTones.dim7Tone,
    ]);
  });

  it("falls back to the root position for an out-of-range finger count", () => {
    expect(getSolidNotes(tones, 0, true)).toEqual([
      tones.root,
      tones.fifth,
      tones.octaveRoot,
      tones.octaveThird,
    ]);
  });
});
