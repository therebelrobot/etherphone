import { describe, expect, it } from "vitest";
import { CUSTOM_MAP_SLOTS, slotsFromMap } from "../music/custom-map";
import { DEFAULT_GESTURE_MAP_ID, getGestureMap } from "../music/gesture-map";
import type { CanvasPoint } from "../types";
import { MenuController } from "./menu-controller";
import type { MenuCluster, MenuInput } from "./menu-controller";
import {
  EDIT_MAP_ID,
  expressionKindsCluster,
  expressionPosesCluster,
  MAP_BACK_ID,
  mapEditorCluster,
  mapTargetCluster,
  MODIFIER_SLOT_ID,
  NUMERALS_SET,
  poseFromOptionId,
  poseOptionId,
  SILENT_SLOT_ID,
  vocabularyCluster,
} from "./menu-clusters";
import {
  DEFAULT_EXPRESSION_MAP,
  EXPRESSION_POSES,
  poseShape,
  withPose,
} from "../music/expression-map";
import { QUALITIES } from "../music/qualities";

const MAPS = [
  { id: "classic", label: "Classic" },
  { id: "custom", label: "Custom" },
];

const WIDTH = 1280;
const HEIGHT = 900;

/** The left-hand ring, reduced to the one menu these clusters sit inside. */
const MENUS: MenuCluster = {
  layout: "radial",
  items: [{ id: "vocabulary", label: "Vocabulary" }],
  activeId: "vocabulary",
};

const LEFT: CanvasPoint = { x: 380, y: 620 };
const RIGHT: CanvasPoint = { x: 900, y: 620 };

/** A cursor pushed out from `anchor` towards item `index` of `count`. */
function pointFrom(anchor: CanvasPoint, index: number, count: number, distance = 200): CanvasPoint {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;

  return {
    x: anchor.x + Math.cos(angle) * distance,
    y: anchor.y + Math.sin(angle) * distance,
  };
}

const SLOTS = slotsFromMap(getGestureMap(DEFAULT_GESTURE_MAP_ID));

describe("vocabularyCluster", () => {
  it("lists the maps and then the way into the editor", () => {
    const cluster = vocabularyCluster(MAPS, "classic");

    expect(cluster.items.map((item) => item.id)).toEqual(["classic", "custom", EDIT_MAP_ID]);
    expect(cluster.activeId).toBe("classic");
  });

  it("stays open when the editor is chosen, because choosing it opens another menu", () => {
    // The whole bug, in one assertion. The entry navigates by changing the menu
    // in play, and a commit that does not declare `keepsMenuOpen` closes the menu
    // instead — so *Edit map…* applied the change and shut the menu, and from the
    // player's side that is indistinguishable from the entry doing nothing.
    const entry = vocabularyCluster(MAPS, "classic").items.find((item) => item.id === EDIT_MAP_ID);

    expect(entry?.keepsMenuOpen).toBe(true);
  });
});

describe("the vocabulary menu's way into the editor", () => {
  /** Drives the real cluster through the real controller. */
  function frame(
    cluster: ReturnType<typeof vocabularyCluster>,
    optionCursor: CanvasPoint,
  ): MenuInput {
    return {
      menus: MENUS,
      options: { layout: "radial", items: cluster.items, activeId: cluster.activeId },
      bothClosed: true,
      menuCursor: LEFT,
      optionCursor,
      canvasWidth: WIDTH,
      canvasHeight: HEIGHT,
    };
  }

  it("leaves the menu up so the editor has somewhere to be", () => {
    const cluster = vocabularyCluster(MAPS, "classic");
    // Zero holds and zero dwell: this test is about what a commit *does*, not
    // about the timing that produces one.
    const controller = new MenuController({ engageHoldMs: 0, dwellMs: 0, moveThreshold: 80 });

    expect(controller.update(frame(cluster, RIGHT), 0).isOpen).toBe(true);

    const pushed = pointFrom(RIGHT, cluster.items.length - 1, cluster.items.length);
    const update = controller.update(frame(cluster, pushed), 1);

    expect(update.committed).toEqual({ cluster: "options", id: EDIT_MAP_ID });
    expect(update.isOpen).toBe(true);
  });
});

describe("mapEditorCluster", () => {
  it("lists the shapes, each saying what it plays", () => {
    const cluster = mapEditorCluster(SLOTS, null);

    expect(cluster.items.map((item) => item.id)).toEqual(CUSTOM_MAP_SLOTS.map((slot) => slot.id));
    expect(cluster.items.every((item) => item.label.includes("→"))).toBe(true);
  });

  it("offers a degree once a shape is in hand, with a way back to the shapes", () => {
    const cluster = mapEditorCluster(SLOTS, CUSTOM_MAP_SLOTS[0].id);

    expect(cluster.items.map((item) => item.id)).toEqual([
      ...NUMERALS_SET,
      SILENT_SLOT_ID,
      MODIFIER_SLOT_ID,
      MAP_BACK_ID,
    ]);
  });

  it("stays open at every step, because both steps are the same menu", () => {
    // A step that closed the menu would hide the step it just opened, which is
    // how the drill-down reads as "the menu closed and nothing happened".
    const both = [mapEditorCluster(SLOTS, null), mapEditorCluster(SLOTS, CUSTOM_MAP_SLOTS[0].id)];

    for (const cluster of both) {
      expect(cluster.items.every((item) => item.keepsMenuOpen === true)).toBe(true);
    }
  });
});

describe("mapTargetCluster", () => {
  it("names each map by the hand holding it, not by its axis", () => {
    // "Left hand — which chord" is the question a player is actually asking. Naming
    // them by axis ("degrees" / "kinds") would be accurate and unanswerable.
    const cluster = mapTargetCluster("Left");

    expect(cluster.items.map((item) => item.label)).toEqual([
      "Left hand — which chord",
      "Right hand — what kind",
    ]);
  });

  it("follows the Chords-hand setting, so the answer is never out of date", () => {
    expect(mapTargetCluster("Right").items.map((item) => item.label)).toEqual([
      "Right hand — which chord",
      "Left hand — what kind",
    ]);
  });

  it("draws a hand for each, mirrored to match the side", () => {
    // Two rows of text differing by one word are read twice; two hands are told
    // apart at a glance.
    const [chords, kinds] = mapTargetCluster("Left").items;

    expect(chords.glyph?.mirror).toBe(false);
    expect(kinds.glyph?.mirror).toBe(true);
  });

  it("stays open, because choosing a map only opens the next step", () => {
    expect(mapTargetCluster("Left").items.every((item) => item.keepsMenuOpen)).toBe(true);
  });
});

describe("the kind editor", () => {
  const MIRROR = false;

  it("lists every pose the hand can make, showing what each plays now", () => {
    const cluster = expressionPosesCluster(DEFAULT_EXPRESSION_MAP, MIRROR);

    expect(cluster.items).toHaveLength(EXPRESSION_POSES.length);
    expect(cluster.items[0].label).toBe("1 finger → Octave");
    expect(cluster.items[4].label).toBe("1 finger + thumb → Sus 2");
  });

  it("says so when a pose plays nothing, rather than leaving a blank", () => {
    // An unmapped pose is a legitimate state — it is how a player silences one —
    // and a blank row would read as a drawing bug.
    const unmapped = withPose(DEFAULT_EXPRESSION_MAP, poseShape({ index: true }), null);
    const cluster = expressionPosesCluster(unmapped, MIRROR);

    expect(cluster.items[0].label).toBe("1 finger → nothing");
  });

  it("offers the whole catalogue plus Nothing, with the current kind in force", () => {
    const pose = poseShape({ index: true });
    const cluster = expressionKindsCluster(DEFAULT_EXPRESSION_MAP, pose);
    const ids = cluster.items.map((item) => item.id);

    expect(ids).toEqual([...QUALITIES.map((q) => q.id), SILENT_SLOT_ID, MAP_BACK_ID]);
    expect(cluster.activeId).toBe("octave");
  });

  it("marks Nothing as in force for a pose that plays nothing", () => {
    const pose = poseShape({ index: true });
    const unmapped = withPose(DEFAULT_EXPRESSION_MAP, pose, null);

    expect(expressionKindsCluster(unmapped, pose).activeId).toBe(SILENT_SLOT_ID);
  });

  it("draws the pose beside its name, mirrored for the hand holding it", () => {
    const cluster = expressionPosesCluster(DEFAULT_EXPRESSION_MAP, true);

    expect(cluster.items.every((item) => item.glyph?.mirror === true)).toBe(true);
  });

  it("keeps the menu open at both steps, since each one opens the next", () => {
    // The bug the degree editor shipped with: a step that closes the menu hides
    // the step it just opened.
    const poses = expressionPosesCluster(DEFAULT_EXPRESSION_MAP, MIRROR);
    const kinds = expressionKindsCluster(DEFAULT_EXPRESSION_MAP, poseShape({ index: true }));

    expect(poses.items.every((item) => item.keepsMenuOpen)).toBe(true);
    expect(kinds.items.every((item) => item.keepsMenuOpen)).toBe(true);
  });
});

describe("pose option ids", () => {
  it("round-trips every pose the editor offers", () => {
    for (const pose of EXPRESSION_POSES) {
      const shape = poseShape(pose);

      expect(poseFromOptionId(poseOptionId(shape))).toBe(shape);
    }
  });

  it("refuses anything that is not a pose, so a kind id cannot be read as one", () => {
    expect(poseFromOptionId("octave")).toBeNull();
    expect(poseFromOptionId("pose:99")).toBeNull();
    expect(poseFromOptionId("pose:x")).toBeNull();
  });
});
