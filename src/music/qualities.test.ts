import { describe, expect, it } from "vitest";
import { getChordTones } from "./harmony";
import { getQuality, getQualityLabel, getQualityNotes, QUALITIES } from "./qualities";
import type { ChordTones } from "../types";

const SEMITONE = (semitones: number) => Math.pow(2, semitones / 12);
const TONIC = 220;

/** Tones for a I chord, so the numbers are easy to reason about. */
function tones(isMajorMode = true): ChordTones {
  const result = getChordTones("I", isMajorMode, TONIC);
  if (!result) throw new Error("expected tones");

  return result;
}

const notes = (id: string, isMajorMode = true) =>
  getQualityNotes(tones(isMajorMode), id, isMajorMode);

describe("getChordTones", () => {
  it("derives the intervals a quality needs, not just a triad's", () => {
    // The blocker behind "sus2 and sus4 cannot sound": a quality replaces the
    // third with a second or a fourth, and neither interval existed before.
    const { root } = tones();

    expect(tones().second).toBeCloseTo(root * SEMITONE(2));
    expect(tones().fourth).toBeCloseTo(root * SEMITONE(5));
    expect(tones().sixth).toBeCloseTo(root * SEMITONE(9));
    expect(tones().ninth).toBeCloseTo(root * SEMITONE(14));
  });

  it("keeps the ninth above the octave, so it colours rather than inverts", () => {
    const { root, octaveRoot, ninth } = tones();

    expect(ninth).toBeGreaterThan(octaveRoot);
    expect(ninth).toBeCloseTo(octaveRoot * SEMITONE(2));
    expect(ninth).toBeCloseTo(root * SEMITONE(14));
  });
});

describe("the inherited bank", () => {
  // These four must sound exactly what one to four fingers sounded before the map
  // existed, or the default becomes a new instrument wearing the old one's clothes.
  it("sounds the octave-doubled triad on its own", () => {
    const { root, fifth, octaveRoot, octaveThird } = tones();

    expect(notes("octave")).toEqual([root, fifth, octaveRoot, octaveThird]);
  });

  it("sounds the first inversion", () => {
    const { third, fifth, octaveRoot, octaveThird } = tones();

    expect(notes("inv1")).toEqual([third, fifth, octaveRoot, octaveThird]);
  });

  it("takes the seventh from the mode: major seventh over major, flat over minor", () => {
    // The instrument has always done this, and one interval cannot serve both.
    expect(notes("add7", true)).toContainEqual(tones(true).maj7Tone);
    expect(notes("add7", false)).toContainEqual(tones(false).dom7Tone);
  });

  it("follows the mode in shape for the seventh chord, not only in interval", () => {
    // A dominant seventh keeps the fifth; a diminished seventh replaces it with
    // the tritone. That is two chords, not one chord at two intervals.
    const major = notes("seventh", true);
    const minor = notes("seventh", false);

    expect(major).toEqual([
      tones(true).root,
      tones(true).third,
      tones(true).fifth,
      tones(true).dom7Tone,
    ]);
    expect(minor).toEqual([
      tones(false).root,
      tones(false).third,
      tones(false).dim5Tone,
      tones(false).dim7Tone,
    ]);
  });
});

describe("QUALITIES", () => {
  it("gives every quality a unique id and a label", () => {
    const ids = QUALITIES.map((quality) => quality.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(QUALITIES.every((quality) => quality.label.length > 0)).toBe(true);
  });

  it("sounds a sus2 with a second and no third", () => {
    expect(notes("sus2")).toContainEqual(tones().second);
    expect(notes("sus2")).not.toContainEqual(tones().third);
  });

  it("sounds a sus4 with a fourth and no third", () => {
    expect(notes("sus4")).toContainEqual(tones().fourth);
    expect(notes("sus4")).not.toContainEqual(tones().third);
  });

  it("makes a suspended chord the same in either mode, because it has no third", () => {
    // A suspended chord has no quality of its own — that is what it is for — so it
    // must not change when the chord hand's tilt flips major to minor.
    for (const id of ["sus2", "sus4"]) {
      expect(notes(id, true)).toEqual(notes(id, false));
    }
  });

  it("puts the ninth above the triad in add9 and add7+9", () => {
    const { root, third, fifth, ninth, maj7Tone } = tones();

    expect(notes("add9")).toEqual([root, third, fifth, ninth]);
    expect(notes("add7-9")).toEqual([root, third, fifth, maj7Tone, ninth]);
  });

  it("returns undefined for an id the map invented", () => {
    expect(getQuality("not-a-quality")).toBeUndefined();
    expect(getQualityLabel("not-a-quality")).toBeUndefined();
  });

  it("labels every quality it offers", () => {
    for (const quality of QUALITIES) {
      expect(getQualityLabel(quality.id)).toBe(quality.label);
    }
  });
});

describe("getQualityNotes", () => {
  it("plays nothing at all for an unknown id rather than falling back", () => {
    // A map naming a quality that does not exist is a mistake, and a fallback
    // would hide it: the mistake would surface as a wrong note under the player's
    // hands rather than as a note that is missing.
    expect(getQualityNotes(tones(), "not-a-quality", true)).toEqual([]);
  });

  it("plays nothing without a chord", () => {
    expect(getQualityNotes(null, "octave", true)).toEqual([]);
    expect(getQualityNotes(tones(), null, true)).toEqual([]);
  });
});
