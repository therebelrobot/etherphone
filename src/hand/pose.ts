/**
 * What a hand is doing, as data.
 *
 * Two shapes of the same idea. A {@link HandPoseSpec} is what a caller writes —
 * "index and middle up, palm to the camera" — with words where words are clearer
 * and every field optional. A {@link HandPose} is what the engine works in: every
 * value present and continuous, so two poses can be blended and a hand can be
 * caught half-way between them.
 *
 * The split is what lets the animator be dumb: it eases numbers, and never has to
 * know that "closed" is a word.
 */
import { FINGER_BITS } from "../music/gesture-map";
import type { FingerName, Handedness, HandShape } from "../types";

/** A digit: the four fingers, and the thumb. */
export type Digit = "thumb" | FingerName;

/** Every digit, thumb first, in the order MediaPipe numbers them. */
export const DIGITS: readonly Digit[] = ["thumb", "index", "middle", "ring", "pinky"];

/** The player's own hand, as anatomy has it — not as the mirrored screen shows it. */
export type HandSide = "left" | "right";

/**
 * Which of the player's hands MediaPipe means.
 *
 * Given the camera's frames unmirrored — which is how the instrument passes them —
 * MediaPipe's `Left` is the player's own left hand. (It has been since 0.10.5,
 * which swapped the labels; before that they named the hand as seen in a mirror.)
 * This is the one place that reading is assumed, so a drawing of "the left hand"
 * is the hand the instrument calls left.
 */
export function sideOf(handedness: Handedness): HandSide {
  return handedness === "Left" ? "left" : "right";
}

/**
 * How far a digit is folded.
 *
 * A number is the curl itself: `0` held straight, `1` folded fully into the palm.
 */
export type DigitState = "extended" | "closed" | "half" | number;

/**
 * Which way the hand faces.
 *
 * `palm` is the palm to the camera, the way the instrument reads a hand. A number
 * is a fraction of the half-turn between the two: `0.5` is the hand edge-on.
 */
export type Facing = "palm" | "back" | number;

/**
 * How far the hand leans, the way the instrument means tilt.
 *
 * Inward is the fingers leaning towards the body's middle — towards the other
 * hand — and outward away from it, so the same word is the same gesture on either
 * hand even though, on screen, the two lean opposite ways. A number runs -1
 * (fully outward) through 1 (fully inward); a full lean is {@link TILT_LEAN}.
 */
export type Tilt = "inward" | "upright" | "outward" | number;

/**
 * The lean of a full tilt, in radians.
 *
 * Thirty-five degrees: far enough that the instrument reads it decisively at the
 * distance a player stands from a webcam, and short of where a forearm leaning
 * over starts to strain.
 */
export const TILT_LEAN = (35 * Math.PI) / 180;

export interface HandPoseSpec {
  readonly hand?: HandSide;
  /**
   * Digit by digit. A digit left out is **closed**, so `{ index: "extended" }`
   * reads the way it is meant — pointing — rather than as one finger among four
   * open ones.
   */
  readonly fingers?: Partial<Record<Digit, DigitState>>;
  readonly facing?: Facing;
  /** How far the extended fingers fan apart, 0..1. */
  readonly spread?: number;
  /** The instrument's tilt: inward or outward, whichever hand it is. */
  readonly tilt?: Tilt;
  /**
   * In radians, clockwise on screen, on top of the tilt. For a lean that is about
   * the screen rather than the hand; most callers want {@link tilt}.
   */
  readonly roll?: number;
  /** In radians: positive tips the fingers towards the camera. */
  readonly pitch?: number;
}

export interface HandPose {
  readonly hand: HandSide;
  /** Per digit, 0 extended through 1 closed. */
  readonly curl: Readonly<Record<Digit, number>>;
  /** 0 is the palm to the camera, 1 the back. */
  readonly facing: number;
  readonly spread: number;
  /** -1 fully outward through 1 fully inward. */
  readonly tilt: number;
  readonly roll: number;
  readonly pitch: number;
}

/** A relaxed open hand — fingers a little apart, as a hand held up actually is. */
export const DEFAULT_SPREAD = 0.35;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function curlOf(state: DigitState | undefined): number {
  if (state === undefined || state === "closed") return 1;
  if (state === "extended") return 0;
  if (state === "half") return 0.5;
  return clamp01(state);
}

function tiltOf(tilt: Tilt | undefined): number {
  if (tilt === undefined || tilt === "upright") return 0;
  if (tilt === "inward") return 1;
  if (tilt === "outward") return -1;
  return Math.min(1, Math.max(-1, tilt));
}

/**
 * The whole lean on screen, in radians clockwise: the tilt turned the way its hand
 * turns, plus any roll.
 *
 * In the mirrored view a left hand is on the left, so leaning inward is leaning
 * right — clockwise — and a right hand's inward is the other way.
 */
export function screenRoll(pose: HandPose): number {
  const inward = pose.hand === "left" ? 1 : -1;
  return pose.tilt * TILT_LEAN * inward + pose.roll;
}

function facingOf(facing: Facing | undefined): number {
  if (facing === undefined || facing === "palm") return 0;
  if (facing === "back") return 1;
  return clamp01(facing);
}

/** Fills in a spec, so every value the engine reads is there. */
export function resolvePose(spec: HandPoseSpec = {}): HandPose {
  const fingers = spec.fingers ?? {};
  const curl = Object.fromEntries(DIGITS.map((digit) => [digit, curlOf(fingers[digit])])) as Record<
    Digit,
    number
  >;

  return {
    hand: spec.hand ?? "left",
    curl,
    facing: facingOf(spec.facing),
    spread: clamp01(spec.spread ?? DEFAULT_SPREAD),
    tilt: tiltOf(spec.tilt),
    roll: spec.roll ?? 0,
    pitch: spec.pitch ?? 0,
  };
}

/**
 * The spec for one of the instrument's hand shapes.
 *
 * This is the seam to the rest of the app: a gesture map speaks in shapes, and a
 * shape is exactly which digits are up.
 */
export function specFromShape(
  shape: HandShape,
  options: Omit<HandPoseSpec, "fingers"> = {},
): HandPoseSpec {
  const fingers = Object.fromEntries(
    DIGITS.map((digit) => [digit, shape & FINGER_BITS[digit] ? "extended" : "closed"]),
  ) as Record<Digit, DigitState>;

  return { ...options, fingers };
}

/** The shape a pose reads as: every digit more than half straight counts as up. */
export function shapeOfPose(pose: HandPose): HandShape {
  let shape = 0;

  for (const digit of DIGITS) {
    if (pose.curl[digit] < 0.5) shape |= FINGER_BITS[digit];
  }

  return shape;
}
