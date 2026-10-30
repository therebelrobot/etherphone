/**
 * The vocabulary menu, and the editor it leads to.
 *
 * A cluster is *data*: what a menu holds is decided by the values in play — the
 * player's own map, which shape is in hand — and not by the frame. It is built
 * here rather than inside `app.ts` so that the menu's contents can be tested
 * without a camera and a canvas, which is the same reason `MenuController` lives
 * in this directory. `app.ts` supplies the values and applies what comes back.
 *
 * These two clusters are one module because they are one journey: the vocabulary
 * cluster's last entry is the way into the editor. Both also carry the entries
 * that have to **keep the menu open** — `Edit map…`, and the editor's `Back`,
 * `Nothing` and `Modifier`. Those are the entries where forgetting to declare it
 * is invisible from the player's side, because a menu closing and a choice being
 * applied look identical: both put the instrument back on screen. That is
 * exactly how `Edit map…` shipped doing nothing at all.
 */
import { CUSTOM_MAP_SLOTS, describeSlotTarget } from "../music/custom-map";
import type { CustomMapSlots } from "../music/custom-map";
import { describePose, EXPRESSION_POSES, poseShape, qualityForPose } from "../music/expression-map";
import type { ExpressionMap } from "../music/expression-map";
import { otherHand } from "../music/hands";
import { getQualityLabel, QUALITIES } from "../music/qualities";
import type { ChordNumeral, Handedness, HandShape } from "../types";
import type { MenuLayout, MenuOption } from "./radial-menu";

/**
 * The id of the "edit my map" entry in the vocabulary menu.
 *
 * The editor lives inside Vocabulary rather than in the left-hand ring, because
 * a map is a *vocabulary* and that is where a player already goes to choose one.
 */
export const EDIT_MAP_ID = "edit-map";

/** The id of the "this shape plays nothing" choice in the editor. */
export const SILENT_SLOT_ID = "none";

/** The id of the "this shape arms a transposition" choice in the editor. */
export const MODIFIER_SLOT_ID = "modifier";

/** The id of the step back out of a shape, to the list of shapes. */
export const MAP_BACK_ID = "map-back";

/** The degrees a shape can be given, in the order a scale runs. */
export const NUMERALS_SET: readonly ChordNumeral[] = ["I", "II", "III", "IV", "V", "VI", "VII"];

/** One cluster: how it lays out, what is in it, and what is in force. */
export interface MenuClusterContents {
  readonly layout: MenuLayout;
  readonly items: readonly MenuOption[];
  readonly activeId?: string;
}

/** One entry the caller supplies, as the vocabulary cluster sees it. */
export interface MenuEntry {
  readonly id: string;
  readonly label: string;
}

/**
 * The vocabulary menu in Chords mode: the maps, then the way into the editor.
 *
 * Putting the editor here means a player who has just picked Custom is one dwell
 * from changing it, rather than having to find a second menu.
 */
export function vocabularyCluster(
  maps: readonly MenuEntry[],
  activeId: string,
): MenuClusterContents {
  return {
    layout: "radial",
    items: [
      ...maps,
      {
        id: EDIT_MAP_ID,
        label: "Edit map…",
        // Navigation rather than a value. This choice does not set something the
        // menu then closes over — it opens *another* menu — so the entry has to
        // say so, or the commit closes the menu and the editor is never seen.
        keepsMenuOpen: true,
      },
    ],
    activeId,
  };
}

/**
 * The editor: seven shapes, then what each one plays.
 *
 * Two steps on purpose, and the same shape as the Layers drill-down. A single
 * cluster offering every shape against every degree would be a grid, and a hand
 * that is coarse enough to pick a direction cannot pick a cell. So the first
 * step says *which shape*, the second says *what it does*, and the second step
 * stays open so several shapes can be changed in one visit.
 *
 * @param slots - The map being edited, already resolved for the hand in play.
 * @param focus - The shape being given a target, or `null` for the list of shapes.
 */
export function mapEditorCluster(slots: CustomMapSlots, focus: string | null): MenuClusterContents {
  const focused = CUSTOM_MAP_SLOTS.find((slot) => slot.id === focus);

  if (!focused) {
    return {
      layout: "radial",
      items: CUSTOM_MAP_SLOTS.map((slot) => ({
        id: slot.id,
        label: `${slot.label} → ${describeSlotTarget(slot.read(slots))}`,
        // Choosing a shape opens the step that says what it plays, so the menu
        // has to still be there to show it.
        keepsMenuOpen: true,
      })),
    };
  }

  const numeral = focused.read(slots);

  return {
    layout: "radial",
    items: [
      ...NUMERALS_SET.map((option) => ({
        id: option,
        label: option,
        keepsMenuOpen: true,
      })),
      { id: SILENT_SLOT_ID, label: "Nothing", keepsMenuOpen: true },
      // The modifier is a slot target rather than a setting, so it is chosen
      // exactly where a degree is — one more option in the step that already
      // exists, and no picker for thirty-two shapes.
      { id: MODIFIER_SLOT_ID, label: "Modifier", keepsMenuOpen: true },
      { id: MAP_BACK_ID, label: "Back", keepsMenuOpen: true },
    ],
    activeId: numeral ?? SILENT_SLOT_ID,
  };
}

/** Which hand's map the editor is working on. */
export type MapTarget = "chords" | "kinds";

/** The ids of the step that chooses a map. */
export const MAP_TARGET_CHORDS_ID = "map-chords";
export const MAP_TARGET_KINDS_ID = "map-kinds";

/** A pose as an option id, so a shape can travel through the menu as a string. */
export function poseOptionId(pose: HandShape): string {
  return `pose:${pose}`;
}

/** The pose an option id names, or `null` when it names something else. */
export function poseFromOptionId(id: string): HandShape | null {
  if (!id.startsWith("pose:")) return null;

  const pose = Number(id.slice("pose:".length));

  return Number.isInteger(pose) && pose >= 0 && pose <= 31 ? pose : null;
}

/**
 * The step that says **which hand's map** you are editing.
 *
 * This is the step the editor was missing: it had one map, so it never had to say
 * which one. Naming the entries by hand rather than by axis ("left hand — which
 * chord") is deliberate, because that is the question a player is actually
 * asking, and the hand names follow the Chords-hand setting so the answer is
 * never out of date.
 *
 * Both entries are drawn as a hand. Two rows of text that differ by one word are
 * read twice; two hands are told apart at a glance, and a player who cannot
 * remember which side they play with can look.
 */
export function mapTargetCluster(chordHand: Handedness): MenuClusterContents {
  const kindHand = otherHand(chordHand);

  return {
    layout: "list",
    items: [
      {
        id: MAP_TARGET_CHORDS_ID,
        label: `${chordHand} hand — which chord`,
        keepsMenuOpen: true,
      },
      {
        id: MAP_TARGET_KINDS_ID,
        label: `${kindHand} hand — what kind`,
        keepsMenuOpen: true,
      },
    ],
  };
}

/**
 * The poses the expression hand can be given, each showing what it plays now.
 *
 * A list rather than a ring: eight poses with names like "2 fingers + thumb" do
 * not fit in a ring's circles. The drawing that makes the names unnecessary is
 * the diagram beside the list, which is large enough to check a hand against —
 * not a picture per row, which is read at the same size as the words.
 */
export function expressionPosesCluster(map: ExpressionMap): MenuClusterContents {
  return {
    layout: "list",
    items: EXPRESSION_POSES.map((pose) => {
      const shape = poseShape(pose);
      const kind = qualityForPose(map, shape);

      return {
        id: poseOptionId(shape),
        label: `${describePose(shape)} → ${kind === null ? "nothing" : (getQualityLabel(kind) ?? "nothing")}`,
        keepsMenuOpen: true,
      };
    }),
  };
}

/**
 * The kinds a pose can be given.
 *
 * The whole catalogue plus *Nothing*, because unmapping a pose is how a player
 * silences it — the same move the degree editor offers, for the same reason.
 */
export function expressionKindsCluster(map: ExpressionMap, pose: HandShape): MenuClusterContents {
  const current = qualityForPose(map, pose);

  return {
    layout: "list",
    items: [
      ...QUALITIES.map((quality) => ({
        id: quality.id,
        label: quality.label,
        keepsMenuOpen: true,
      })),
      { id: SILENT_SLOT_ID, label: "Nothing", keepsMenuOpen: true },
      { id: MAP_BACK_ID, label: "Back", keepsMenuOpen: true },
    ],
    activeId: current ?? SILENT_SLOT_ID,
  };
}
