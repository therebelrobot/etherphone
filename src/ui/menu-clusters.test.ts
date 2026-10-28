import { describe, expect, it } from "vitest";
import { CUSTOM_MAP_SLOTS, slotsFromMap } from "../music/custom-map";
import { DEFAULT_GESTURE_MAP_ID, getGestureMap } from "../music/gesture-map";
import type { CanvasPoint } from "../types";
import { MenuController } from "./menu-controller";
import type { MenuCluster, MenuInput } from "./menu-controller";
import {
  EDIT_MAP_ID,
  MAP_BACK_ID,
  mapEditorCluster,
  MODIFIER_SLOT_ID,
  NUMERALS_SET,
  SILENT_SLOT_ID,
  vocabularyCluster,
} from "./menu-clusters";

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
