import { describe, expect, it } from "vitest";
import { getChordTones } from "./harmony";
import { getQuality, getQualityLabel, QUALITIES } from "./qualities";
import type { ChordTones } from "../types";

const SEMITONE = (semitones: number) => Math.pow(2, semitones / 12);
const TONIC = 220;

/** Tones for a major-mode I chord, so the numbers are easy to reason about. */
function tones(isMajorMode = true): ChordTones {
  const result = getChordTones("I", isMajorMode, TONIC);
  if (!result) throw new Error("expected tones");

  return result;
}

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

describe("QUALITIES", () => {
  it("gives every quality a unique id and a label", () => {
    const ids = QUALITIES.map((quality) => quality.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(QUALITIES.every((quality) => quality.label.length > 0)).toBe(true);
  });

  it("sounds a sus2 with a second and no third", () => {
    const notes = getQuality("sus2")?.notes(tones()) ?? [];

    expect(notes).toContainEqual(tones().second);
    expect(notes).not.toContainEqual(tones().third);
  });

  it("sounds a sus4 with a fourth and no third", () => {
    const notes = getQuality("sus4")?.notes(tones()) ?? [];

    expect(notes).toContainEqual(tones().fourth);
    expect(notes).not.toContainEqual(tones().third);
  });

  it("makes a suspended chord the same in either mode, because it has no third", () => {
    // A suspended chord has no quality of its own — that is what it is for — so it
    // must not change when the chord hand's tilt flips major to minor.
    for (const id of ["sus2", "sus4"]) {
      expect(getQuality(id)?.notes(tones(true))).toEqual(getQuality(id)?.notes(tones(false)));
    }
  });

  it("lets the mode move the third for the qualities that have one", () => {
    expect(getQuality("add7")?.notes(tones(false))).toContainEqual(tones(false).third);
    expect(getQuality("add7")?.notes(tones(false))).not.toEqual(
      getQuality("add7")?.notes(tones(true)),
    );
  });

  it("puts the ninth above the triad in add9 and add7+9", () => {
    const { third, fifth, ninth, maj7Tone } = tones();

    expect(getQuality("add9")?.notes(tones())).toEqual([tones().root, third, fifth, ninth]);
    expect(getQuality("add7-9")?.notes(tones())).toEqual([
      tones().root,
      third,
      fifth,
      maj7Tone,
      ninth,
    ]);
  });

  it("keeps the octave type as the octave-doubled triad", () => {
    // The instrument's first voicing, so the type costs nothing to keep: the same
    // four notes at two registers.
    const { root, fifth, octaveRoot, octaveThird } = tones();

    expect(getQuality("octave")?.notes(tones())).toEqual([root, fifth, octaveRoot, octaveThird]);
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
