/**
 * The expression hand's map: which pose plays which kind of chord.
 *
 * The chord hand answers *which* chord — a map from shape to scale degree. This is
 * the other half of the same idea, one hand over: a map from shape to *kind*. Both
 * are data and both are read the same way, so "one hand chooses the chord and the
 * other chooses the type" is two tables rather than a special case.
 *
 * Two things make this possible where the finger count alone could not:
 *
 * 1. **The pose is the whole shape, not a count.** Four long fingers give four
 *    poses; including the thumb gives eight, which is enough for a real vocabulary.
 * 2. **The thumb therefore stops being the octave gesture in Chords mode.** It
 *    cannot be both a pose and a modifier, and a pose buys more: it doubles the
 *    bank. Mono keeps thumb = octave, which is where it mattered (the bassline).
 *
 * The default map is built from **two banks**: bare-handed it is the four the
 * instrument has always sounded, unchanged, and thumb-out it is four more. So a
 * player who changes nothing hears nothing change, and a player who reaches for
 * the thumb finds the new chords rather than a surprise.
 */
import type { HandShape } from "../types";
import { shapeFromFingers } from "./gesture-map";

/**
 * Which fingers a pose holds up.
 *
 * Named rather than written as bitmask integers because a map has to be *read* to
 * be checked: `{ thumb: true, index: true }` is the pose a player can picture,
 * and `3` is not.
 */
export interface Pose {
  readonly thumb?: boolean;
  readonly index?: boolean;
  readonly middle?: boolean;
  readonly ring?: boolean;
  readonly pinky?: boolean;
}

export interface ExpressionMap {
  readonly id: string;
  readonly label: string;
  /** A one-line summary, shown as the picker option's tooltip. */
  readonly description: string;
  /** Pose to quality id. A pose that is absent plays nothing. */
  readonly qualities: ReadonlyMap<HandShape, string>;
}

/** Builds a map's poses from readable finger specs. */
function posesFrom(specs: readonly (readonly [Pose, string])[]): ReadonlyMap<HandShape, string> {
  return new Map(specs.map(([pose, quality]) => [shapeFromFingers(pose), quality]));
}

/**
 * The default vocabulary: the four the instrument already had, then four more.
 *
 * The first four are the *inherited* bank, deliberately identical to the voicings
 * one to four fingers used to select — so the default is not a new instrument
 * wearing the old one's clothes. The thumb bank is the new reach: the suspended
 * chords that were unexpressible before the tone table grew, plus the two added
 * ninths.
 */
export const DEFAULT_EXPRESSION_MAP: ExpressionMap = {
  id: "standard",
  label: "Standard",
  description: "Four kinds bare-handed, four more with the thumb out.",
  qualities: posesFrom([
    // Bare hand — what the instrument has always sounded, unchanged.
    [{ index: true }, "octave"],
    [{ index: true, middle: true }, "inv1"],
    [{ index: true, middle: true, ring: true }, "add7"],
    [{ index: true, middle: true, ring: true, pinky: true }, "seventh"],
    // Thumb out — the second bank, one more kind per count.
    [{ thumb: true, index: true }, "sus2"],
    [{ thumb: true, index: true, middle: true }, "sus4"],
    [{ thumb: true, index: true, middle: true, ring: true }, "add9"],
    [{ thumb: true, index: true, middle: true, ring: true, pinky: true }, "add7-9"],
  ]),
};

/** The quality a pose plays, or `null` when the pose is not in the map. */
export function qualityForPose(map: ExpressionMap, pose: HandShape): string | null {
  return map.qualities.get(pose) ?? null;
}
