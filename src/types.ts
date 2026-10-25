/**
 * Shared vocabulary for Etherphone.
 *
 * These types describe how the modules talk to one another: hands arrive as
 * MediaPipe landmarks, get reduced to a musical *intent* (a chord plus a
 * voicing), and that intent is turned into frequencies and pixels.
 */
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

/** Which hand MediaPipe believes it is looking at. */
export type Handedness = "Left" | "Right";

/** The landmark list for a single detected hand. */
export type Hand = NormalizedLandmark[];

/** Fingers used for chord and voicing recognition. The thumb is handled separately. */
export type FingerName = "index" | "middle" | "ring" | "pinky";

/** Left-hand tilt picks the mode: inward is major, outward is minor. */
export type ChordMode = "major" | "minor";

/** Roman-numeral scale degrees as produced by chord recognition. */
export type Numeral = "I" | "II" | "III" | "IV" | "V" | "VI" | "VII";

/** A numeral whose case carries the mode: `I` is major, `i` is minor. */
export type ChordNumeral = Numeral | Lowercase<Numeral>;

/** The twelve selectable tonic keys. */
export type KeyName = "A" | "Bb" | "B" | "C" | "Db" | "D" | "Eb" | "E" | "F" | "Gb" | "G" | "Ab";

/** Oscillator shapes exposed by the tone selector. */
export type Waveform = "triangle" | "sawtooth" | "square";

/** The complete musical intent for a frame, after temporal stabilisation. */
export interface ChordState {
  readonly chord: ChordNumeral;
  readonly isMajorMode: boolean;
  readonly qualityIndex: number;
  readonly thumbDown: boolean;
}

/** Every frequency the harmony engine can derive from a single chord root. */
export interface ChordTones {
  readonly root: number;
  readonly third: number;
  readonly fifth: number;
  readonly octaveRoot: number;
  readonly octaveThird: number;
  readonly maj7Tone: number;
  readonly dom7Tone: number;
  readonly dim7Tone: number;
  readonly dim5Tone: number;
}

/** A source rectangle that crops a video to match a destination aspect ratio. */
export interface CoverRect {
  readonly sx: number;
  readonly sy: number;
  readonly sWidth: number;
  readonly sHeight: number;
}
