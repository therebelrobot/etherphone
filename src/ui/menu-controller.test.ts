import { describe, expect, it } from "vitest";
import { CONTROL } from "../config/constants";
import type { CanvasPoint } from "../types";
import { isMenuTopic, isModeSwitch, MENU_TOPICS, MenuController } from "./menu-controller";

const VOCABULARY = [
  { id: "classic", label: "Classic" },
  { id: "triad", label: "Triad" },
  { id: "pentatonic", label: "Pentatonic" },
];

const KEYS = Array.from({ length: 12 }, (_, index) => ({
  id: `key-${index}`,
  label: `Key ${index}`,
}));

const HOLD = 600;
const DWELL = 900;
const IDLE = 5000;
const MOVE = 80;

const WIDTH = 1280;
const HEIGHT = 900;

/** Where the two hands are when the menu opens. */
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

/** The index of a menu in the menus cluster. */
const menuIndex = (id: string) => MENU_TOPICS.findIndex((topic) => topic.id === id);

function input(overrides: Partial<Parameters<MenuController["update"]>[0]> = {}) {
  return {
    menus: { layout: "radial" as const, items: MENU_TOPICS, activeId: "vocabulary" },
    options: { layout: "radial" as const, items: VOCABULARY },
    bothClosed: false,
    menuCursor: null,
    optionCursor: null,
    canvasWidth: WIDTH,
    canvasHeight: HEIGHT,
    ...overrides,
  };
}

function makeController(): MenuController {
  return new MenuController({
    engageHoldMs: HOLD,
    dwellMs: DWELL,
    idleTimeoutMs: IDLE,
    moveThreshold: MOVE,
  });
}

/** Holds both hands closed long enough to open the menu, hands at rest. */
function openMenu(controller: MenuController, from = 0): number {
  controller.update(input({ bothClosed: true, menuCursor: LEFT, optionCursor: RIGHT }), from);

  const opened = from + HOLD;
  controller.update(input({ bothClosed: true, menuCursor: LEFT, optionCursor: RIGHT }), opened);

  return opened;
}

/** Opens the menu and pushes the left hand out towards a menu. */
function chooseMenu(
  controller: MenuController,
  menu: string,
  from = 0,
): { steered: number; update: ReturnType<MenuController["update"]> } {
  const opened = openMenu(controller, from);
  const steered = opened + 1;
  const cursor = pointFrom(LEFT, menuIndex(menu), MENU_TOPICS.length);

  controller.update(input({ bothClosed: true, menuCursor: cursor, optionCursor: RIGHT }), steered);

  return {
    steered,
    update: controller.update(
      input({ bothClosed: true, menuCursor: cursor, optionCursor: RIGHT }),
      steered + DWELL,
    ),
  };
}

describe("MenuController opening", () => {
  it("stays shut until both hands have been closed for the hold", () => {
    const controller = makeController();

    expect(controller.update(input({ bothClosed: true }), 0).isOpen).toBe(false);
    expect(controller.update(input({ bothClosed: true }), HOLD - 1).isOpen).toBe(false);
    expect(controller.update(input({ bothClosed: true }), HOLD).isOpen).toBe(true);
  });

  it("reports the frame it opened on, so the caller can go quiet", () => {
    const controller = makeController();

    controller.update(input({ bothClosed: true }), 0);
    const opened = controller.update(input({ bothClosed: true }), HOLD);

    expect(opened.justOpened).toBe(true);
    expect(controller.update(input({ bothClosed: true }), HOLD + 10).justOpened).toBe(false);
  });

  it("dismisses when both hands are closed again, after a release", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    controller.update(input({ bothClosed: false }), opened + 10);
    const closedAgainAt = opened + 20;

    expect(controller.update(input({ bothClosed: true }), closedAgainAt).isOpen).toBe(true);
    expect(controller.update(input({ bothClosed: true }), closedAgainAt + HOLD).isOpen).toBe(false);
  });

  it("does not dismiss on the closed hands that opened it", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    expect(controller.update(input({ bothClosed: true }), opened + HOLD * 3).isOpen).toBe(true);
  });

  it("reports how long it has been open, so the fan-out can be animated", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    expect(controller.update(input({ bothClosed: true }), opened + 120).elapsedMs).toBe(120);
  });
});

describe("MenuController two hands", () => {
  it("anchors each cluster to the hand that drives it", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    const update = controller.update(
      input({ bothClosed: true, menuCursor: LEFT, optionCursor: RIGHT }),
      opened,
    );

    expect(update.menus.centerX).toBeCloseTo(LEFT.x);
    expect(update.menus.centerY).toBeCloseTo(LEFT.y);
    expect(update.options.centerX).toBeCloseTo(RIGHT.x);
    expect(update.options.centerY).toBeCloseTo(RIGHT.y);
  });

  it("selects nothing while both hands rest where they opened", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    const update = controller.update(
      input({ bothClosed: true, menuCursor: LEFT, optionCursor: RIGHT }),
      opened + DWELL * 3,
    );

    expect(update.menus.hoveredId).toBeNull();
    expect(update.options.hoveredId).toBeNull();
    expect(controller.open).toBe(true);
  });

  it("lets the left hand pick a menu and the right hand pick an option, at once", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    const menuCursor = pointFrom(LEFT, menuIndex("key"), MENU_TOPICS.length);
    const optionCursor = pointFrom(RIGHT, 1, VOCABULARY.length);

    const update = controller.update(
      input({ bothClosed: true, menuCursor, optionCursor }),
      opened + 10,
    );

    expect(update.menus.hoveredId).toBe("key");
    expect(update.options.hoveredId).toBe("triad");
  });

  it("marks the menu in force as active, so you can see where you are", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    const update = controller.update(
      input({
        menus: { layout: "radial", items: MENU_TOPICS, activeId: "instrument" },
        bothClosed: true,
        menuCursor: LEFT,
        optionCursor: RIGHT,
      }),
      opened,
    );

    expect(update.menus.activeId).toBe("instrument");
  });
});

describe("MenuController choosing", () => {
  it("commits a menu, naming the cluster it came from, and stays open", () => {
    const controller = makeController();
    const { update } = chooseMenu(controller, "key");

    expect(update.committed).toEqual({ cluster: "menus", id: "key" });
    expect(update.isOpen).toBe(true);
  });

  it("hides both hovers on the frame a menu commits, so nothing double-fires", () => {
    const controller = makeController();
    const { update } = chooseMenu(controller, "key");

    expect(update.menus.hoveredId).toBeNull();
    expect(update.options.hoveredId).toBeNull();
  });

  it("makes the right hand move again after the menu changes under it", () => {
    const controller = makeController();
    const { steered } = chooseMenu(controller, "key");

    // The right hand has not moved, but the options are different now.
    const after = controller.update(
      input({
        bothClosed: true,
        menuCursor: pointFrom(LEFT, menuIndex("key"), 4),
        optionCursor: RIGHT,
      }),
      steered + DWELL + 10,
    );

    expect(after.options.hoveredId).toBeNull();
    expect(after.options.dwellProgress).toBe(0);
  });

  it("commits an option and closes the menu", () => {
    const controller = makeController();
    const opened = openMenu(controller);
    const cursor = pointFrom(RIGHT, 1, VOCABULARY.length);

    controller.update(
      input({ bothClosed: true, menuCursor: LEFT, optionCursor: cursor }),
      opened + 10,
    );
    const update = controller.update(
      input({ bothClosed: true, menuCursor: LEFT, optionCursor: cursor }),
      opened + 10 + DWELL,
    );

    expect(update.committed).toEqual({ cluster: "options", id: "triad" });
    expect(update.isOpen).toBe(false);
  });

  it("keeps the menu open for an option that asks it to", () => {
    const controller = makeController();
    const items = [...VOCABULARY, { id: "extra", label: "Extra", keepsMenuOpen: true }];
    const opened = openMenu(controller);
    const cursor = pointFrom(RIGHT, 3, items.length);

    controller.update(
      input({
        options: { layout: "radial", items },
        bothClosed: true,
        menuCursor: LEFT,
        optionCursor: cursor,
      }),
      opened + 10,
    );
    const update = controller.update(
      input({
        options: { layout: "radial", items },
        bothClosed: true,
        menuCursor: LEFT,
        optionCursor: cursor,
      }),
      opened + 10 + DWELL,
    );

    expect(update.committed).toEqual({ cluster: "options", id: "extra" });
    expect(update.isOpen).toBe(true);
  });

  it("closes itself after idling with neither hand on anything", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    expect(
      controller.update(
        input({ bothClosed: true, menuCursor: LEFT, optionCursor: RIGHT }),
        opened + IDLE + 1,
      ).isOpen,
    ).toBe(false);
  });
});

describe("MenuController options list", () => {
  const listInput = (overrides = {}) =>
    input({
      options: { layout: "list" as const, items: KEYS },
      bothClosed: true,
      menuCursor: LEFT,
      optionCursor: RIGHT,
      ...overrides,
    });

  it("lays the options down the canvas rather than around the hand", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    const update = controller.update(listInput(), opened);

    expect(update.options.layout).toBe("list");
    expect(update.options.rows).toHaveLength(KEYS.length);
    expect(update.options.centerY).toBe(HEIGHT / 2);
  });

  it("selects the row at the right hand's height", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    controller.update(listInput(), opened);
    const update = controller.update(
      listInput({ optionCursor: { x: RIGHT.x, y: 140 } }),
      opened + 10,
    );

    expect(update.options.hoveredId).toBe("key-0");
  });

  it("keeps the left hand's menu ring anchored to the left hand", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    const update = controller.update(listInput(), opened);

    expect(update.menus.layout).toBe("radial");
    expect(update.menus.centerX).toBeCloseTo(LEFT.x);
  });
});

describe("menu topic and mode ids", () => {
  it("recognises the menus and nothing else", () => {
    expect(isMenuTopic("vocabulary")).toBe(true);
    expect(isMenuTopic("key")).toBe(true);
    expect(isMenuTopic("instrument")).toBe(true);
    expect(isMenuTopic("settings")).toBe(true);
    expect(isMenuTopic("classic")).toBe(false);
    expect(isMenuTopic("chord")).toBe(false);
  });

  it("recognises the mode ids and nothing else", () => {
    expect(isModeSwitch("chord")).toBe(true);
    expect(isModeSwitch("mono")).toBe(true);
    expect(isModeSwitch("triad")).toBe(false);
  });

  it("offers four menus", () => {
    expect(MENU_TOPICS.map((topic) => topic.id)).toEqual([
      "vocabulary",
      "key",
      "instrument",
      "settings",
    ]);
  });

  it("uses the configured dead zone for both clusters", () => {
    const controller = makeController();
    const opened = openMenu(controller);
    const inside = { x: LEFT.x + CONTROL.deadZone - 5, y: LEFT.y };

    const update = controller.update(
      input({ bothClosed: true, menuCursor: inside, optionCursor: RIGHT }),
      opened + 10,
    );

    expect(update.menus.hoveredId).toBeNull();
  });
});
