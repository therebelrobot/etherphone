/**
 * Gesture maps: the hand-shape vocabulary as data.
 *
 * The instrument used to hard-code its mapping — a finger-count table plus two
 * special-cased rock signs inside `classifyChord`. Here the same idea becomes a
 * lookup: a shape is a bitmask over [thumb, index, middle, ring, pinky], and a
 * map is a table from that shape to a scale degree. `classifyChord` does the
 * lookup; nothing in this module touches landmarks or audio, so every preset is
 * plain data that a test can enumerate.
 */
import { NUMERAL_TO_DEGREE } from "../config/music";
import type { ChordNumeral, GestureMap, GestureRow, HandShape, Numeral } from "../types";

/** Bit value for each finger, in the order a shape is read. */
export const FINGER_BITS = {
  thumb: 1,
  index: 2,
  middle: 4,
  ring: 8,
  pinky: 16,
} as const;

/** A finger name, as used by {@link FINGER_BITS}. */
type FingerKey = keyof typeof FINGER_BITS;

/** Every shape a hand can make: `0` (no fingers) through `31` (all five). */
export const ALL_SHAPES: readonly HandShape[] = Array.from({ length: 32 }, (_, shape) => shape);

/** Composes a shape from per-finger flags. */
export function shapeFromFingers(fingers: Partial<Record<FingerKey, boolean>>): HandShape {
  let shape = 0;

  for (const [finger, bit] of Object.entries(FINGER_BITS) as [FingerKey, number][]) {
    if (fingers[finger]) shape |= bit;
  }

  return shape;
}

/** How many fingers a shape holds up. */
export function countFingers(shape: HandShape): number {
  let count = 0;

  for (const bit of Object.values(FINGER_BITS)) {
    if (shape & bit) count += 1;
  }

  return count;
}

/**
 * Builds the vocabulary the instrument inherited: the *number* of extended
 * fingers picks the degree, so any single finger plays I and any two play II.
 *
 * `specials` are shapes that win over the count rule, which is how the two rock
 * signs reach VI and VII even though they hold up two and three fingers.
 */
function countMap(
  byCount: Readonly<Record<number, ChordNumeral>>,
  specials: readonly (readonly [HandShape, ChordNumeral])[] = [],
): ReadonlyMap<HandShape, ChordNumeral | null> {
  const shapes = new Map<HandShape, ChordNumeral | null>();

  for (const shape of ALL_SHAPES) {
    shapes.set(shape, byCount[countFingers(shape)] ?? null);
  }

  for (const [shape, numeral] of specials) {
    shapes.set(shape, numeral);
  }

  return shapes;
}

/** The shape the original instrument calls the submediant: index + pinky. */
const ROCK_SIGN = shapeFromFingers({ index: true, pinky: true });
/** The leading-tone variant: the rock sign with the thumb out too. */
const ROCK_SIGN_THUMB = shapeFromFingers({ thumb: true, index: true, pinky: true });

/**
 * Today's mapping, exactly: finger count reaches I–V and the rock signs reach
 * VI and VII. This is the default, so an existing player's hands keep working.
 */
export const CLASSIC_GESTURE_MAP: GestureMap = {
  id: "classic",
  label: "Classic",
  description: "The inherited vocabulary: finger count picks I–V, the rock signs reach VI and VII.",
  shapes: countMap({ 1: "I", 2: "II", 3: "III", 4: "IV", 5: "V" }, [
    [ROCK_SIGN, "VI"],
    [ROCK_SIGN_THUMB, "VII"],
  ]),
  tiltPicksMode: true,
};

/**
 * Three chords, the three primary triads. One to three fingers, no special
 * shapes, and four or five fingers play nothing — so the degrees a player is not
 * using cannot fire by accident.
 */
export const TRIAD_GESTURE_MAP: GestureMap = {
  id: "triad",
  label: "Triad",
  description:
    "Three chords only — I, IV, and V — one to three fingers. Four or more play nothing.",
  shapes: countMap({ 1: "I", 2: "IV", 3: "V" }),
  tiltPicksMode: true,
};

/**
 * The five pentatonic degrees. Reachable by finger count alone, so it needs no
 * rock sign — which is also the shape some players cannot make.
 */
export const PENTATONIC_GESTURE_MAP: GestureMap = {
  id: "pentatonic",
  label: "Pentatonic",
  description: "The five pentatonic degrees, one to five fingers, no special shapes.",
  shapes: countMap({ 1: "I", 2: "II", 3: "III", 4: "V", 5: "VI" }),
  tiltPicksMode: true,
};

/** Every preset, in picker order. Classic is first and is the default. */
export const GESTURE_MAPS: readonly GestureMap[] = [
  CLASSIC_GESTURE_MAP,
  TRIAD_GESTURE_MAP,
  PENTATONIC_GESTURE_MAP,
];

/** The map a player gets before choosing, and the fallback for an unknown id. */
export const DEFAULT_GESTURE_MAP_ID = CLASSIC_GESTURE_MAP.id;

/** Resolves a map by id, falling back to the default rather than throwing. */
export function getGestureMap(id: string): GestureMap {
  return GESTURE_MAPS.find((map) => map.id === id) ?? CLASSIC_GESTURE_MAP;
}

/** The scale degree a numeral sits on, ignoring the case that carries the mode. */
export function degreeOf(numeral: ChordNumeral): number {
  return NUMERAL_TO_DEGREE[numeral.toUpperCase() as Numeral];
}

/**
 * The cheat-sheet rows for a map: one per degree, in scale order, drawn from the
 * simplest shape that reaches it.
 *
 * Collapsing to the simplest shape is what keeps the guide to seven rows for the
 * classic count-based map, which really holds thirty-two entries.
 */
export function getGestureRows(map: GestureMap): GestureRow[] {
  const simplest = new Map<ChordNumeral, HandShape>();

  for (const [shape, numeral] of map.shapes) {
    if (numeral === null) continue;

    const current = simplest.get(numeral);
    if (current === undefined || isSimplerThan(shape, current)) {
      simplest.set(numeral, shape);
    }
  }

  return [...simplest.entries()]
    .map(([numeral, shape]) => ({ numeral, shape, degree: degreeOf(numeral) }))
    .sort((a, b) => a.degree - b.degree);
}

/** Fewer fingers wins; ties go to the lower bitmask, so the choice is stable. */
function isSimplerThan(a: HandShape, b: HandShape): boolean {
  const difference = countFingers(a) - countFingers(b);
  return difference !== 0 ? difference < 0 : a < b;
}

/** The keycap emoji for a finger count; `0` reads as an explicit "nothing". */
const COUNT_GLYPHS = ["—", "1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣"] as const;

/**
 * The emoji or label that depicts a shape in the guide.
 *
 * The presets are count-based, so a count reads exactly as it should: "two
 * fingers", whichever two they are. The two rock signs are shapes rather than
 * counts, so they are named first.
 */
export function describeShape(shape: HandShape): string {
  if (shape === ROCK_SIGN) return "🤘";
  if (shape === ROCK_SIGN_THUMB) return "🤟";

  return COUNT_GLYPHS[countFingers(shape)];
}
