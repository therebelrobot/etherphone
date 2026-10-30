/**
 * Chord qualities, as a catalogue.
 *
 * A *quality* is which of a chord's tones to sound: a plain triad, the same chord
 * doubled an octave up, a seventh added, a suspended second in place of the third.
 * It is the "what kind of chord" axis, as distinct from the *degree* axis — which
 * numeral, I or II or V — and from the *voicing* axis, which is about register and
 * inversion. They are three different questions and a map can answer each.
 *
 * These entries exist so the instrument can *sound* these chords: a map names one
 * of these ids per pose, and {@link getQualityNotes} is what turns that into
 * frequencies. Keeping the notes here rather than in the gesture layer is what
 * lets the catalogue be tested without a camera.
 *
 * Every entry reads its frequencies from {@link ChordTones}, so a quality is a
 * selection of intervals and never arithmetic of its own. `third` already carries
 * the mode, and the suspended qualities do not use it at all, so they are
 * mode-independent by construction rather than by a second table.
 */
import type { ChordTones } from "../types";

export interface Quality {
  /** Stable id: what a map's slot stores and what a share link carries. */
  readonly id: string;
  /** Readout label. */
  readonly label: string;
  /**
   * Frequencies to sound, picked from the chord's tone collection.
   *
   * @param isMajorMode - Which mode the chord hand is in. Only the inherited
   *   seventh chords need it: a seventh is a major seventh over a major triad and
   *   a flat seventh over a minor one, so a single interval cannot serve both.
   */
  readonly notes: (tones: ChordTones, isMajorMode: boolean) => number[];
}

/**
 * The catalogue, in two banks.
 *
 * The first four are **inherited** — they are exactly what the instrument has
 * always sounded on one to four fingers, so a player who changes nothing hears
 * nothing change. The rest are the qualities a pose map can now reach, including
 * the suspended chords that were unexpressible before the tone table grew.
 *
 * They are one list rather than two tables because a *type* is one question: which
 * of a chord's tones to sound. Inversion is a register question and belongs to the
 * same list for the same reason — `inv1` is here not because it is new but because
 * it is a selection of tones like any other.
 */
export const QUALITIES: readonly Quality[] = [
  {
    id: "octave",
    label: "Octave",
    notes: ({ root, fifth, octaveRoot, octaveThird }) => [root, fifth, octaveRoot, octaveThird],
  },
  {
    id: "inv1",
    label: "1st Inv",
    notes: ({ third, fifth, octaveRoot, octaveThird }) => [third, fifth, octaveRoot, octaveThird],
  },
  {
    id: "add7",
    label: "Add 7",
    notes: ({ root, third, fifth, maj7Tone, dom7Tone }, isMajorMode) => [
      root,
      third,
      fifth,
      isMajorMode ? maj7Tone : dom7Tone,
    ],
  },
  {
    id: "seventh",
    label: "7th",
    // The one entry whose *shape* follows the mode: a dominant seventh keeps the
    // fifth, a diminished seventh replaces it with the tritone.
    notes: ({ root, third, fifth, dim5Tone, dom7Tone, dim7Tone }, isMajorMode) =>
      isMajorMode ? [root, third, fifth, dom7Tone] : [root, third, dim5Tone, dim7Tone],
  },
  {
    id: "simple",
    label: "Simple",
    notes: ({ root, third, fifth }) => [root, third, fifth],
  },
  {
    id: "add9",
    label: "Add 9",
    notes: ({ root, third, fifth, ninth }) => [root, third, fifth, ninth],
  },
  {
    id: "add7-9",
    label: "Add 7+9",
    notes: ({ root, third, fifth, maj7Tone, ninth }) => [root, third, fifth, maj7Tone, ninth],
  },
  {
    id: "sus2",
    label: "Sus 2",
    // The second stands in for the third, so there is no third to make major or
    // minor: a suspended chord has no quality of its own, which is the point of it.
    notes: ({ root, second, fifth, octaveRoot }) => [root, second, fifth, octaveRoot],
  },
  {
    id: "sus4",
    label: "Sus 4",
    notes: ({ root, fourth, fifth, octaveRoot }) => [root, fourth, fifth, octaveRoot],
  },
];

/** A quality by id, or `undefined` when the map names one that does not exist. */
export function getQuality(id: string): Quality | undefined {
  return QUALITIES.find((quality) => quality.id === id);
}

/** The readout label for a quality id, or `undefined` when it is not one. */
export function getQualityLabel(id: string): string | undefined {
  return getQuality(id)?.label;
}

/**
 * What a quality id sounds against a chord.
 *
 * An id the catalogue does not know gives silence rather than a fallback triad:
 * a map naming a quality that does not exist is a mistake, and sounding something
 * else would hide it — the mistake would become a wrong note under the player's
 * hands rather than a note that is missing.
 */
export function getQualityNotes(
  tones: ChordTones | null,
  id: string | null,
  isMajorMode: boolean,
): number[] {
  if (!tones || id === null) return [];

  return getQuality(id)?.notes(tones, isMajorMode) ?? [];
}
