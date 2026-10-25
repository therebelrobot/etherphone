/**
 * Voicing tables.
 *
 * The right hand's finger count selects one of four voicings per mode. Keeping
 * the label and the note selection in one record means the on-screen readout and
 * the audio can never drift apart.
 */
import type { ChordTones } from "../types";

export interface Voicing {
  /** Finger count that selects this voicing, 1–4. */
  readonly index: number;
  /** Readout shown when this voicing is active. */
  readonly label: string;
  /** Frequencies to sound, picked from the chord's tone collection. */
  readonly notes: (tones: ChordTones) => number[];
}

/** Major mode: triads, inversions, major 7th, and dominant 7th. */
export const MAJOR_VOICINGS: readonly Voicing[] = [
  {
    index: 1,
    label: "Major",
    notes: ({ root, fifth, octaveRoot, octaveThird }) => [root, fifth, octaveRoot, octaveThird],
  },
  {
    index: 2,
    label: "Major 1st Inv",
    notes: ({ third, fifth, octaveRoot, octaveThird }) => [third, fifth, octaveRoot, octaveThird],
  },
  {
    index: 3,
    label: "Major 7th",
    notes: ({ root, third, fifth, maj7Tone }) => [root, third, fifth, maj7Tone],
  },
  {
    index: 4,
    label: "Dominant 7th",
    notes: ({ root, third, fifth, dom7Tone }) => [root, third, fifth, dom7Tone],
  },
];

/** Minor mode: triads, inversions, minor 7th, and diminished 7th. */
export const MINOR_VOICINGS: readonly Voicing[] = [
  {
    index: 1,
    label: "Minor",
    notes: ({ root, fifth, octaveRoot, octaveThird }) => [root, fifth, octaveRoot, octaveThird],
  },
  {
    index: 2,
    label: "Minor 1st Inv",
    notes: ({ third, fifth, octaveRoot, octaveThird }) => [third, fifth, octaveRoot, octaveThird],
  },
  {
    index: 3,
    label: "Minor 7th",
    notes: ({ root, third, fifth, dom7Tone }) => [root, third, fifth, dom7Tone],
  },
  {
    index: 4,
    label: "Diminished 7th",
    notes: ({ root, third, dim5Tone, dim7Tone }) => [root, third, dim5Tone, dim7Tone],
  },
];

/** The four voicings available in the current mode, in finger-count order. */
export function getVoicings(isMajorMode: boolean): readonly Voicing[] {
  return isMajorMode ? MAJOR_VOICINGS : MINOR_VOICINGS;
}

/** The voicing for a finger count, or `undefined` when no fingers are held. */
export function getVoicing(isMajorMode: boolean, qualityIndex: number): Voicing | undefined {
  return getVoicings(isMajorMode).find((voicing) => voicing.index === qualityIndex);
}

/** Readout label for a finger count, or `undefined` when none is held. */
export function getVoicingLabel(isMajorMode: boolean, qualityIndex: number): string | undefined {
  return getVoicing(isMajorMode, qualityIndex)?.label;
}

/**
 * Frequencies to sound for the current intent.
 *
 * Anything outside 1–4 falls back to the root-position triad, matching the
 * default case of the original finger-count switch.
 */
export function getSolidNotes(
  tones: ChordTones | null,
  qualityIndex: number,
  isMajorMode: boolean,
): number[] {
  if (!tones) return [];

  const voicings = getVoicings(isMajorMode);
  const voicing = getVoicing(isMajorMode, qualityIndex) ?? voicings[0];

  return voicing.notes(tones);
}
