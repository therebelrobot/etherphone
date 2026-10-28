/**
 * Harmony: turning a roman numeral plus a tonic into names and frequencies.
 *
 * These functions are pure — they take the tuning as an argument rather than
 * reading module state — so they can be tested and reused directly.
 */
import {
  DEGREE_SEMITONES,
  MAJOR_SCALE,
  NUMERAL_TO_DEGREE,
  OCTAVE_DOWN_TONICS,
} from "../config/music";
import type { ChordNumeral, ChordTones, KeyName, Numeral } from "../types";

const SEMITONES_PER_OCTAVE = 12;

/** Converts a semitone offset into a frequency multiplier. */
export function semitoneRatio(semitones: number): number {
  return Math.pow(2, semitones / SEMITONES_PER_OCTAVE);
}

/**
 * The tonic as the instrument actually tunes it.
 *
 * The three sharpest keys are dropped an octave to keep the range playable,
 * which is a property of the instrument rather than of any one voice.
 */
export function getPlayableTonic(tonicFrequency: number): number {
  return OCTAVE_DOWN_TONICS.includes(tonicFrequency) ? tonicFrequency / 2 : tonicFrequency;
}

/** The written note at a given scale degree of a key. */
export function getScaleNoteName(keyName: KeyName, degree: number): string {
  return MAJOR_SCALE[keyName][degree - 1];
}

/**
 * The frequency of a scale degree, relative to the selected tonic.
 *
 * Degrees are tuned in equal temperament from the major scale, so degree VII
 * lands a semitone below the tonic.
 */
export function getDegreeFrequency(degree: number, tonicFrequency: number): number {
  const semitones = DEGREE_SEMITONES[degree];

  return getPlayableTonic(tonicFrequency) * semitoneRatio(semitones);
}

/** Human-readable chord name, e.g. `Cm` for a minor tonic. */
export function getChordDisplayName(
  numeral: ChordNumeral | null,
  isMajorMode: boolean,
  keyName: KeyName,
): string {
  if (!numeral) return "";

  const degree = NUMERAL_TO_DEGREE[numeral.toUpperCase() as Numeral];
  if (!degree) return "";

  const root = getScaleNoteName(keyName, degree);
  return isMajorMode ? root : `${root}m`;
}

/**
 * Every frequency the voicing tables need, derived from one chord root.
 *
 * `dim5Tone` is the tritone used by the diminished seventh chord.
 */
export function getChordTones(
  numeral: ChordNumeral | null,
  isMajorMode: boolean,
  tonicFrequency: number,
): ChordTones | null {
  if (!numeral) return null;

  const degree = NUMERAL_TO_DEGREE[numeral.toUpperCase() as Numeral];
  if (!degree) return null;

  const root = getDegreeFrequency(degree, tonicFrequency);

  const thirdSemitones = isMajorMode ? 4 : 3;
  const fifthSemitones = 7; // Perfect fifth for all first-position modes.
  const maj7Semitones = 11;
  const dom7Semitones = 10;
  const dim7Semitones = 9;
  const dim5Semitones = 6;
  const secondSemitones = 2;
  const fourthSemitones = 5;
  const sixthSemitones = 9;
  const ninthSemitones = 14;

  const third = root * semitoneRatio(thirdSemitones);
  const fifth = root * semitoneRatio(fifthSemitones);

  return {
    root,
    third,
    fifth,
    octaveRoot: root * 2,
    octaveThird: third * 2,
    maj7Tone: root * semitoneRatio(maj7Semitones),
    dom7Tone: root * semitoneRatio(dom7Semitones),
    dim7Tone: root * semitoneRatio(dim7Semitones),
    dim5Tone: root * semitoneRatio(dim5Semitones),
    second: root * semitoneRatio(secondSemitones),
    fourth: root * semitoneRatio(fourthSemitones),
    sixth: root * semitoneRatio(sixthSemitones),
    ninth: root * semitoneRatio(ninthSemitones),
  };
}
