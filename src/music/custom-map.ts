/**
 * A gesture map the player builds themselves.
 *
 * RFC #8 asks for a *Custom* map the player can edit. The important design call
 * is that a custom map is **seven slots, not thirty-two**: one per finger count,
 * plus the two rock signs. That is the whole vocabulary the presets use, it is
 * the set of shapes a hand can actually make deliberately, and it means an
 * editor is seven choices rather than thirty-two — which is what makes it
 * playable by gesture at all.
 *
 * The seven slots also make the map small enough to encode as a short string.
 * That one string is the storage format, the shareable URL, and the thing you
 * paste to a friend — rather than three formats that drift.
 */
import { ALL_SHAPES, countFingers, ROCK_SIGN, ROCK_SIGN_THUMB } from "./gesture-map";
import type { ChordNumeral, GestureMap, HandShape } from "../types";

/** The id the custom map is chosen by. */
export const CUSTOM_MAP_ID = "custom";

/** What the picker calls it. */
export const CUSTOM_MAP_LABEL = "Custom";

/**
 * What a shape does: play a degree, play nothing, or *arm* a transposition.
 *
 * The modifier is a slot target rather than a separate setting, because a
 * shape's job is exactly what a slot decides and a second place to say it would
 * be a second place to disagree. It is also what makes it reachable by gesture
 * without inventing a picker for thirty-two shapes.
 */
export type SlotTarget = ChordNumeral | null | "modifier";

/** The seven things a custom map decides. */
export interface CustomMapSlots {
  /** What one to five fingers do, in order. `null` means nothing. */
  readonly byCount: readonly SlotTarget[];
  readonly rockSign: SlotTarget;
  readonly rockSignThumb: SlotTarget;
}

/** One editable slot, as the editor lists it. */
export interface CustomMapSlot {
  readonly id: string;
  readonly label: string;
  /** The shape that stands for the slot, used for the cheat sheet. */
  readonly shape: HandShape;
  readonly read: (slots: CustomMapSlots) => SlotTarget;
  readonly write: (slots: CustomMapSlots, target: SlotTarget) => CustomMapSlots;
}

const SLOT_IDS = ["count-1", "count-2", "count-3", "count-4", "count-5", "rock", "rock-thumb"];

/**
 * The seven slots, in the order a player meets them: easiest shapes first.
 *
 * The two rock signs go last because they are the ones that need a particular
 * hand, and a player editing a map for a hand that cannot make them should reach
 * them after the five counts rather than before.
 */
export const CUSTOM_MAP_SLOTS: readonly CustomMapSlot[] = [
  ...[1, 2, 3, 4, 5].map((count, index) => ({
    id: SLOT_IDS[index],
    label: `${count} finger${count === 1 ? "" : "s"}`,
    shape: ALL_SHAPES.filter((shape) => countFingers(shape) === count)[0] ?? 0,
    read: (slots: CustomMapSlots) => slots.byCount[index] ?? null,
    write: (slots: CustomMapSlots, target: SlotTarget): CustomMapSlots => {
      const byCount = [...slots.byCount];
      byCount[index] = target;
      return { ...slots, byCount };
    },
  })),
  {
    id: SLOT_IDS[5],
    label: "Rock sign",
    shape: ROCK_SIGN,
    read: (slots) => slots.rockSign,
    write: (slots, numeral) => ({ ...slots, rockSign: numeral }),
  },
  {
    id: SLOT_IDS[6],
    label: "Rock + thumb",
    shape: ROCK_SIGN_THUMB,
    read: (slots) => slots.rockSignThumb,
    write: (slots, numeral) => ({ ...slots, rockSignThumb: numeral }),
  },
];

/** How the editor names a slot's target. */
export function describeSlotTarget(target: SlotTarget): string {
  if (target === null) return "—";
  if (target === "modifier") return "Modifier";
  return target;
}

/** Every slot silent: the map a player starts from before choosing anything. */
export const EMPTY_SLOTS: CustomMapSlots = {
  byCount: [null, null, null, null, null],
  rockSign: null,
  rockSignThumb: null,
};

/**
 * Builds the playable map from the seven slots.
 *
 * Counts are expanded across every shape with that count, exactly as the presets
 * do, so *any* two fingers is "two fingers" — the forgiving behaviour the
 * presets already have, kept for the map the player builds.
 */
export function customMapFromSlots(slots: CustomMapSlots): GestureMap {
  const shapes = new Map<HandShape, ChordNumeral | null>();
  const played = (target: SlotTarget): ChordNumeral | null =>
    target === "modifier" ? null : target;

  for (const shape of ALL_SHAPES) {
    shapes.set(shape, played(slots.byCount[countFingers(shape) - 1] ?? null));
  }

  // The two named shapes win over the count rule, which is what makes them
  // reachable at all: both are *two-finger* shapes.
  shapes.set(ROCK_SIGN, played(slots.rockSign));
  shapes.set(ROCK_SIGN_THUMB, played(slots.rockSignThumb));

  // At most one shape can be the modifier, and the first slot set to it wins —
  // two transposing shapes would be ambiguous about which armed what.
  const modifier = CUSTOM_MAP_SLOTS.find((slot) => slot.read(slots) === "modifier");

  return {
    id: CUSTOM_MAP_ID,
    label: CUSTOM_MAP_LABEL,
    description: "Your own map: seven shapes, whatever they should do.",
    shapes,
    tiltPicksMode: true,
    transposeShape: modifier ? modifier.shape : null,
  };
}

/**
 * Reads an existing map back into slots.
 *
 * This is how the editor starts from a preset: pick Triad, choose Custom, and
 * the seven slots arrive holding Triad's decisions. A map whose shapes disagree
 * within a count cannot be represented, and does not need to be — every map the
 * instrument builds is count-consistent, and a hand-written one is normalised to
 * the first shape of each count.
 */
export function slotsFromMap(map: GestureMap): CustomMapSlots {
  const firstWithCount = (count: number): HandShape | undefined =>
    ALL_SHAPES.find((shape) => countFingers(shape) === count);

  // A shape that plays nothing but is the map's modifier reads back as the
  // modifier, not as silence — otherwise editing a map would quietly disarm it.
  const target = (shape: HandShape | undefined): SlotTarget => {
    if (shape === undefined) return null;
    if (map.transposeShape !== null && shape === map.transposeShape) return "modifier";
    return map.shapes.get(shape) ?? null;
  };

  const byCount = [1, 2, 3, 4, 5].map((count) => target(firstWithCount(count)));

  return {
    byCount,
    rockSign: target(ROCK_SIGN),
    rockSignThumb: target(ROCK_SIGN_THUMB),
  };
}

// ---------------------------------------------------------------------------
// Encoding
// ---------------------------------------------------------------------------

/**
 * One character per slot: `0` for nothing, `1`–`7` for I–VII, `a`–`g` for i–vii.
 *
 * Seven characters, so the whole map fits in a URL fragment and in
 * `localStorage` without either being a special case. Upper and lower case carry
 * the mode because the numeral already does — a map that cannot express "this
 * shape is minor" would lose half of what the presets do.
 */
const CODE_BY_NUMERAL: Record<string, string> = {
  I: "1",
  II: "2",
  III: "3",
  IV: "4",
  V: "5",
  VI: "6",
  VII: "7",
  i: "a",
  ii: "b",
  iii: "c",
  iv: "d",
  v: "e",
  vi: "f",
  vii: "g",
};

const NUMERAL_BY_CODE = new Map(
  Object.entries(CODE_BY_NUMERAL).map(([numeral, code]) => [code, numeral as ChordNumeral]),
);

/**
 * The code for a slot that arms a transposition instead of playing.
 *
 * A letter rather than a digit, so the string stays seven characters and the
 * existing length check keeps working — only the alphabet grew.
 */
const MODIFIER_CODE = "m";

/** Writes a map's seven decisions as a short string. */
export function encodeCustomMap(slots: CustomMapSlots): string {
  const codes = [...slots.byCount, slots.rockSign, slots.rockSignThumb].map((target) => {
    if (target === null) return "0";
    if (target === "modifier") return MODIFIER_CODE;
    return CODE_BY_NUMERAL[target] ?? "0";
  });

  return codes.join("");
}

/** Reads a map back from {@link encodeCustomMap}, or `null` if it is not one. */
export function decodeCustomMap(text: string): CustomMapSlots | null {
  const trimmed = text.trim();
  if (trimmed.length !== SLOT_IDS.length) return null;

  const targets = [...trimmed].map((code) => {
    if (code === "0") return null;
    if (code === MODIFIER_CODE) return "modifier";
    return NUMERAL_BY_CODE.get(code) ?? null;
  });

  // An unknown character could have been read as "nothing", which would
  // silently change the map. Refusing is the only honest answer.
  const everyCodeKnown = [...trimmed].every(
    (code) => code === "0" || code === MODIFIER_CODE || NUMERAL_BY_CODE.has(code),
  );
  if (!everyCodeKnown) return null;

  return {
    byCount: targets.slice(0, 5),
    rockSign: targets[5] ?? null,
    rockSignThumb: targets[6] ?? null,
  };
}

/**
 * The fragment that shares a map, e.g. `#map=1450000`.
 *
 * A URL fragment rather than a query string because the map is entirely a
 * client-side thing: nothing needs to see it, and a fragment is never sent to a
 * server. It is the "shareable URL" #8 asks for without adding a storage format
 * on top of the one `localStorage` already uses.
 */
export function hashForCustomMap(slots: CustomMapSlots): string {
  return `#map=${encodeCustomMap(slots)}`;
}

/** Reads a map out of a URL hash, or `null` when there is not one. */
export function slotsFromHash(hash: string): CustomMapSlots | null {
  const match = /(?:^#|&)map=([0-9a-gm]{7})(?:&|$)/.exec(hash.trim());
  return match?.[1] ? decodeCustomMap(match[1]) : null;
}

/** Whether the map would play nothing at all, which is not a map yet. */
export function isSilentMap(slots: CustomMapSlots): boolean {
  const everySlotPlaysNothing = [...slots.byCount, slots.rockSign, slots.rockSignThumb].every(
    // A modifier is not a degree: a map whose only slot arms a transposition for
    // a chord that can never be made is still a map that plays nothing.
    (target) => target === null || target === "modifier",
  );

  return everySlotPlaysNothing;
}
