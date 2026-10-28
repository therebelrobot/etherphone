/**
 * Which hand does what.
 *
 * RFC #8 asks whether the gesture map is per-hand "or is the left/right split
 * itself fixed". It is per-hand, and the split is a setting — because the RFC's
 * own motivation for the map is a player whose hand cannot form the shapes, and
 * a fixed split answers that with "then you cannot play".
 *
 * The roles are named rather than sided everywhere it matters: a *chord hand*
 * and an *expression hand*, not a left and a right. Left-handed players, and
 * players with one usable hand, get the same instrument instead of a mirror of
 * it.
 */
import type { Handedness } from "../types";

/** Both hands, in the order the settings offer them. */
export const HANDS: readonly Handedness[] = ["Left", "Right"];

/** The hand that is not this one. */
export function otherHand(hand: Handedness): Handedness {
  return hand === "Left" ? "Right" : "Left";
}

/**
 * Reads a stored chord-hand setting.
 *
 * Anything that is not a recognised hand reads as the default rather than
 * throwing, because a corrupt storage value must not be able to leave the
 * instrument with no hand playing chords.
 */
export function parseHarmonyHand(stored: string | null | undefined): Handedness {
  return stored === "Right" ? "Right" : "Left";
}

/** What the settings and the help call a hand. */
export function handName(hand: Handedness): string {
  return hand === "Left" ? "left" : "right";
}
