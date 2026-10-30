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
import { countFingers, FINGER_BITS, shapeFromFingers } from "./gesture-map";
import { getQuality } from "./qualities";

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
 *
 * This one list is the source of both the default map and the poses the editor
 * offers, so a pose cannot be editable-but-unmapped or mapped-but-invisible.
 */
const DEFAULT_BANKS: readonly (readonly [Pose, string])[] = [
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
];

/** The poses the editor lists, in the order it lists them. */
export const EXPRESSION_POSES: readonly Pose[] = DEFAULT_BANKS.map(([pose]) => pose);

export const DEFAULT_EXPRESSION_MAP: ExpressionMap = {
  id: "standard",
  label: "Standard",
  description: "Four kinds bare-handed, four more with the thumb out.",
  qualities: posesFrom(DEFAULT_BANKS),
};

/** The quality a pose plays, or `null` when the pose is not in the map. */
export function qualityForPose(map: ExpressionMap, pose: HandShape): string | null {
  return map.qualities.get(pose) ?? null;
}

/** The shape a pose names, for reading a real hand against it. */
export function poseShape(pose: Pose): HandShape {
  return shapeFromFingers(pose);
}

/**
 * A pose in words: "2 fingers", "2 fingers + thumb".
 *
 * The count is of the four *long* fingers, because that is how a player counts a
 * hand — the thumb is the thing that is either out or not, not a sixth finger.
 */
export function describePose(pose: HandShape): string {
  const hasThumb = (pose & FINGER_BITS.thumb) !== 0;
  const fingers = countFingers(pose) - (hasThumb ? 1 : 0);

  if (fingers === 0) return hasThumb ? "Thumb out" : "Closed hand";

  const count = `${fingers} finger${fingers === 1 ? "" : "s"}`;

  return hasThumb ? `${count} + thumb` : count;
}

/**
 * The same map with one pose changed.
 *
 * A new map rather than a mutation, because the map is read every frame and the
 * drawing may be holding the previous one: replacing it wholesale means nothing
 * can observe a half-edited vocabulary.
 */
export function withPose(
  map: ExpressionMap,
  pose: HandShape,
  quality: string | null,
): ExpressionMap {
  const qualities = new Map(map.qualities);

  if (quality === null) qualities.delete(pose);
  else qualities.set(pose, quality);

  return { ...map, qualities };
}

/** The map as a string, for storage. Poses are keys, so it survives a reload. */
export function encodeExpressionMap(map: ExpressionMap): string {
  return JSON.stringify(
    Object.fromEntries([...map.qualities].map(([pose, id]) => [String(pose), id])),
  );
}

/**
 * Reads a stored map, or `null` when the text is not one.
 *
 * Entries that name a pose a hand cannot make, or a quality the catalogue does
 * not have, are dropped rather than rejected: storage outlives a catalogue, and
 * losing one pose is a smaller failure than losing the whole vocabulary. `null`
 * is reserved for text that is not a map at all, so the caller can tell "nothing
 * stored" from "stored and empty".
 */
export function decodeExpressionMap(text: string): ExpressionMap | null {
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;

  const qualities = new Map<HandShape, string>();

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const pose = Number(key);

    if (!Number.isInteger(pose) || pose < 0 || pose > 31) continue;
    if (typeof value !== "string" || getQuality(value) === undefined) continue;

    qualities.set(pose, value);
  }

  return { ...DEFAULT_EXPRESSION_MAP, qualities };
}
