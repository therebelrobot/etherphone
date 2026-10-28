/**
 * Chord qualities, as a catalogue.
 *
 * A *quality* is which of a chord's tones to sound: a plain triad, the same chord
 * doubled an octave up, a seventh added, a suspended second in place of the third.
 * It is the "what kind of chord" axis, as distinct from the *degree* axis — which
 * numeral, I or II or V — and from the *voicing* axis, which is about register and
 * inversion. They are three different questions and a map can answer each.
 *
 * These entries exist so the instrument can *sound* these chords. Nothing selects
 * them by pose yet: that is stage 2 of RFC #19, where the expression hand's map
 * names one of these ids per pose. Keeping the notes here rather than in the
 * gesture layer is what lets the catalogue be tested without a camera.
 *
 * Every entry reads its frequencies from {@link ChordTones}, so a quality is a
 * selection of intervals and never arithmetic of its own — the same reason the
 * existing voicing tables do. `third` already carries the mode (major or minor),
 * and the suspended qualities do not use it at all, so they are mode-independent
 * by construction rather than by a second table.
 */
import type { ChordTones } from "../types";

export interface Quality {
  /** Stable id: what a map's slot stores and what a share link carries. */
  readonly id: string;
  /** Readout label. */
  readonly label: string;
  /** Frequencies to sound, picked from the chord's tone collection. */
  readonly notes: (tones: ChordTones) => number[];
}

/**
 * The proposed default set.
 *
 * Seven, matching the seven poses the expression hand can make reliably: one to
 * five fingers, and the two rock signs. The set itself is an open question in RFC
 * #19 — this table is the shape it would take, and changing the contents is a data
 * edit rather than a redesign.
 *
 * "Octave" is the octave-doubled triad and "simple" is the plain triad without the
 * doubling: that is how the instrument's first voicing already behaves, so the
 * pair costs nothing to keep and gives a player the register choice as a *type*
 * rather than as a second setting.
 */
export const QUALITIES: readonly Quality[] = [
  {
    id: "simple",
    label: "Simple",
    notes: ({ root, third, fifth }) => [root, third, fifth],
  },
  {
    id: "octave",
    label: "Octave",
    notes: ({ root, fifth, octaveRoot, octaveThird }) => [root, fifth, octaveRoot, octaveThird],
  },
  {
    id: "add7",
    label: "Add 7",
    notes: ({ root, third, fifth, maj7Tone }) => [root, third, fifth, maj7Tone],
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
