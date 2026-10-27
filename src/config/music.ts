/**
 * Music-theory tables.
 *
 * Pure data: scales, interval offsets, and the colour palette the energy ribbon
 * draws from. The functions that consume these live in `src/music/`.
 */
import type { KeyName, Numeral } from "../types";

/**
 * Semitone offset of each scale degree from the tonic, measured in a major
 * scale. This stays fixed; what changes is which frequency counts as "zero".
 *
 * Degree VII sits a semitone *below* the tonic so the leading tone resolves up.
 */
export const DEGREE_SEMITONES: Record<number, number> = {
  1: 0,
  2: 2,
  3: 4,
  4: 5,
  5: 7,
  6: 9,
  7: -1,
};

/** Scale degree keyed by roman numeral. */
export const NUMERAL_TO_DEGREE: Record<Numeral, number> = {
  I: 1,
  II: 2,
  III: 3,
  IV: 4,
  V: 5,
  VI: 6,
  VII: 7,
};

/** The note names available at each scale degree, per selectable key. */
export const MAJOR_SCALE: Record<KeyName, readonly string[]> = {
  A: ["A", "B", "C#", "D", "E", "F#", "G#"],
  Bb: ["Bb", "C", "D", "Eb", "F", "G", "A"],
  B: ["B", "C#", "D#", "E", "F#", "G#", "A#"],
  C: ["C", "D", "E", "F", "G", "A", "B"],
  Db: ["Db", "Eb", "F", "Gb", "Ab", "Bb", "C"],
  D: ["D", "E", "F#", "G", "A", "B", "C#"],
  Eb: ["Eb", "F", "G", "Ab", "Bb", "C", "D"],
  E: ["E", "F#", "G#", "A", "B", "C#", "D#"],
  F: ["F", "G", "A", "Bb", "C", "D", "E"],
  Gb: ["Gb", "Ab", "Bb", "Cb", "Db", "Eb", "F"],
  G: ["G", "A", "B", "C", "D", "E", "F#"],
  Ab: ["Ab", "Bb", "C", "Db", "Eb", "F", "G"],
};

/**
 * Tonic frequencies, in Hz, that are halved before use so the instrument sits
 * in a comfortable register no matter which key is selected.
 */
export const OCTAVE_DOWN_TONICS: readonly number[] = [369.99, 392.0, 415.3];

/** Hue per scale degree, used by the energy ribbon. */
export const SCALE_COLORS: Record<Numeral, string> = {
  I: "232, 161, 61", // Tonic: golden sunset
  II: "210, 50, 120", // 2nd: purple-red
  III: "180, 40, 150", // 3rd: deep magenta
  IV: "240, 210, 40", // 4th: yellow
  V: "245, 120, 30", // 5th: orange
  VI: "230, 40, 40", // 6th: red
  VII: "100, 200, 250", // 7th: cyan
};

/** Muted grey used while no chord is playing. */
export const IDLE_COLOR_RGB = "150, 150, 150";

/** Fallback when a chord has no entry in the palette. */
export const DEFAULT_CHORD_COLOR_RGB = "232, 161, 61";
