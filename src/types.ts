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

/**
 * Which fingers a hand is holding up, as a bitmask over
 * [thumb, index, middle, ring, pinky] — so a shape is a single number in 0..31.
 *
 * Collapsing the hand to one number is what lets a gesture vocabulary be a
 * lookup table rather than a chain of conditions.
 */
export type HandShape = number;

/**
 * A gesture vocabulary: which hand shape plays which scale degree.
 *
 * `shapes` is the whole truth for classification. A `null` target means the
 * shape deliberately plays nothing, which is how a map removes a degree it does
 * not want — or builds in a rest.
 */
export interface GestureMap {
  readonly id: string;
  readonly label: string;
  /** A one-line summary, shown as the picker option's tooltip. */
  readonly description: string;
  readonly shapes: ReadonlyMap<HandShape, ChordNumeral | null>;
  /** Whether hand tilt picks major/minor, or the numeral's own case is kept. */
  readonly tiltPicksMode: boolean;
  /**
   * A shape that arms a transposition instead of playing.
   *
   * The next chord made after it is shifted up a degree and the arming clears,
   * so one shape reaches the whole scale without a second vocabulary. `null`
   * (or absent) means the map has no modifier.
   */
  readonly transposeShape?: HandShape | null;
}

/** One row of a map's cheat sheet: a shape, the degree it reaches, and what it plays. */
export interface GestureRow {
  readonly shape: HandShape;
  readonly numeral: ChordNumeral;
  /** The scale degree, 1–7, used to pick the note name for the current key. */
  readonly degree: number;
}

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

/**
 * Which strategy turns a frame's intent into sound.
 *
 * The instrument used to assume every frame was a chord. A mode is that
 * assumption made explicit, so a lead line (and, later, a drum kit) can be
 * addressed through the same path rather than a parallel one.
 */
export type InstrumentMode = "chord" | "mono";

/**
 * How the mono voice reads the pitch hand.
 *
 * - `quantised` — the nearest scale degree, sustained, legato between degrees.
 * - `glide` — a continuous pitch, sliding between degrees.
 * - `harp` — the nearest degree, plucked afresh on entering one, so a sweep
 *   across the frame plays a harp-like run.
 */
export type MonoStyle = "quantised" | "glide" | "harp";

/** The mono voice's reading of one frame. */
export interface MonoReading {
  /** The pitch to sound, in Hz. */
  readonly frequency: number;
  /** The scale degree reached: 1-based, counted past the seventh. */
  readonly degree: number;
  /** Whole octaves above the tonic, for the readout. */
  readonly octave: number;
  /**
   * True when the pitch hand has just entered this degree.
   *
   * The harp style plucks on this edge and lets the note ring between edges;
   * the other styles sound continuously and ignore it.
   */
  readonly isNewDegree: boolean;
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

/**
 * What the looper is doing.
 *
 * `armed` is the count-in: the recording has not begun, it is waiting for the
 * next bar line so the loop starts in time rather than wherever a hand happened
 * to be.
 */
export type LooperState = "idle" | "armed" | "recording" | "playing";

/** One captured moment of a performance, positioned in the loop. */
export type TakeEvent = ChordTakeEvent | NoteTakeEvent | RestTakeEvent;

interface TakeEventBase {
  /** Where in the loop the event lands, in beats from the loop's start. */
  readonly beat: number;
  /** Master volume when it was played, 0..1. */
  readonly volume: number;
  /** Filter tilt when it was played, -1..1. */
  readonly tilt: number;
}

/** A chord the left hand was holding. */
export interface ChordTakeEvent extends TakeEventBase {
  readonly kind: "chord";
  readonly numeral: ChordNumeral;
  readonly isMajorMode: boolean;
  readonly qualityIndex: number;
  readonly thumbDown: boolean;
}

/** A single note, from the mono voice. */
export interface NoteTakeEvent extends TakeEventBase {
  readonly kind: "note";
  /** Scale degree, counted past the seventh. */
  readonly degree: number;
}

/** Silence: the hands were not playing. */
export interface RestTakeEvent extends TakeEventBase {
  readonly kind: "rest";
}

/**
 * A recorded performance.
 *
 * A take stores musical *intent* — the chord that was held, or the degree the
 * mono voice reached — not frequencies, and not audio. That keeps it a handful
 * of numbers that can be re-resolved against whatever key is selected, so
 * changing the key transposes the loop. It is also the position the umbrella
 * RFC takes: record what was meant, replay it through the same pipeline, and a
 * take sounds exactly like the take.
 */
export interface Take {
  /** Tempo the take was recorded at. */
  readonly bpm: number;
  /** Loop length, in beats. */
  readonly loopBeats: number;
  readonly events: readonly TakeEvent[];
}

/** A source rectangle that crops a video to match a destination aspect ratio. */
export interface CoverRect {
  readonly sx: number;
  readonly sy: number;
  readonly sWidth: number;
  readonly sHeight: number;
}

/** A point in canvas pixels. */
export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

/** One option of the gesture menu, placed on the canvas. */
export interface RadialSlot {
  readonly id: string;
  readonly label: string;
  /** Direction from the menu's centre, in radians. */
  readonly angle: number;
  readonly x: number;
  readonly y: number;
}
