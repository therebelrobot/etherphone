import { describe, expect, it } from "vitest";
import { CONTROL } from "../config/constants";
import type { CanvasPoint } from "../types";
import { isModeSwitch, MenuController, menuOptionsFor } from "./menu-controller";

const OPTIONS = [
  { id: "classic", label: "Classic" },
  { id: "triad", label: "Triad" },
  { id: "pentatonic", label: "Pentatonic" },
];

const HOLD = 600;
const DWELL = 900;
const IDLE = 5000;
const MOVE = 80;

const WIDTH = 1280;
const HEIGHT = 900;
const CENTER: CanvasPoint = { x: WIDTH / 2, y: HEIGHT / 2 };

/** Where a hand opens the menu, deliberately off-centre to prove the anchoring. */
const HAND: CanvasPoint = { x: 420, y: 620 };

/** A cursor pointing away from `anchor` at the option at `index`. */
function pointFrom(
  anchor: CanvasPoint,
  index: number,
  count: number = OPTIONS.length,
  distance = 200,
): CanvasPoint {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / count;
  return {
    x: anchor.x + Math.cos(angle) * distance,
    y: anchor.y + Math.sin(angle) * distance,
  };
}

function input(overrides: Partial<Parameters<MenuController["update"]>[0]> = {}) {
  return {
    options: OPTIONS,
    bothClosed: false,
    cursor: null,
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

/** Holds both hands closed with the cursor at `at`, and returns the frame it opened on. */
function openMenu(controller: MenuController, at: CanvasPoint = HAND, from = 0): number {
  controller.update(input({ bothClosed: true, cursor: at }), from);

  const opened = from + HOLD;
  controller.update(input({ bothClosed: true, cursor: at }), opened);

  return opened;
}

/**
 * Opens the menu and pushes the hand out towards an option, which takes two
 * frames: one to open at rest, one to move. Returns the time the dwell started.
 */
function openAndSteer(
  controller: MenuController,
  index: number,
  at: CanvasPoint = HAND,
  from = 0,
): number {
  const opened = openMenu(controller, at, from);

  const steered = opened + 1;
  controller.update(input({ bothClosed: true, cursor: pointFrom(at, index) }), steered);

  return steered;
}

describe("MenuController opening", () => {
  it("stays shut until both hands have been closed for the hold", () => {
    const controller = makeController();

    expect(controller.update(input({ bothClosed: true, cursor: HAND }), 0).isOpen).toBe(false);
    expect(controller.update(input({ bothClosed: true, cursor: HAND }), HOLD - 1).isOpen).toBe(
      false,
    );
    expect(controller.update(input({ bothClosed: true, cursor: HAND }), HOLD).isOpen).toBe(true);
  });

  it("reports the frame it opened on, so the caller can go quiet", () => {
    const controller = makeController();

    controller.update(input({ bothClosed: true, cursor: HAND }), 0);
    const opened = controller.update(input({ bothClosed: true, cursor: HAND }), HOLD);

    expect(opened.justOpened).toBe(true);
    expect(controller.update(input({ bothClosed: true, cursor: HAND }), HOLD + 10).justOpened).toBe(
      false,
    );
  });

  it("does not open on one closed hand", () => {
    const controller = makeController();

    controller.update(input({ bothClosed: false }), 0);
    expect(controller.update(input({ bothClosed: false }), HOLD * 4).isOpen).toBe(false);
  });

  it("restarts the hold if the hands come apart", () => {
    const controller = makeController();

    controller.update(input({ bothClosed: true, cursor: HAND }), 0);
    controller.update(input({ bothClosed: true, cursor: HAND }), HOLD - 100);
    controller.update(input({ bothClosed: false }), HOLD - 50);

    expect(controller.update(input({ bothClosed: true, cursor: HAND }), HOLD).isOpen).toBe(false);
    expect(controller.update(input({ bothClosed: true, cursor: HAND }), HOLD + 100).isOpen).toBe(
      false,
    );
    expect(controller.update(input({ bothClosed: true, cursor: HAND }), HOLD + HOLD).isOpen).toBe(
      true,
    );
  });

  it("will not reopen while the hands stay closed", () => {
    const controller = makeController();
    const steered = openAndSteer(controller, 1);

    const committed = controller.update(
      input({ bothClosed: true, cursor: pointFrom(HAND, 1) }),
      steered + DWELL,
    );
    expect(committed.committed).toBe("triad");
    expect(controller.open).toBe(false);

    expect(
      controller.update(input({ bothClosed: true, cursor: HAND }), steered + HOLD * 3).isOpen,
    ).toBe(false);
  });

  it("reopens once the gesture is released and held again", () => {
    const controller = makeController();
    const steered = openAndSteer(controller, 1);

    controller.update(input({ bothClosed: true, cursor: pointFrom(HAND, 1) }), steered + DWELL);
    controller.update(input({ bothClosed: false }), steered + DWELL + 10);

    expect(
      controller.update(input({ bothClosed: true, cursor: HAND }), steered + DWELL + 20).isOpen,
    ).toBe(false);
    expect(
      controller.update(input({ bothClosed: true, cursor: HAND }), steered + DWELL + 20 + HOLD)
        .isOpen,
    ).toBe(true);
  });
});

describe("MenuController dismissing", () => {
  /** Opens the menu, then releases the gesture so it can be re-armed. */
  function openThenRelease(controller: MenuController): number {
    const opened = openMenu(controller);

    controller.update(input({ bothClosed: false }), opened + 10);
    return opened + 10;
  }

  it("dismisses when both hands are closed again", () => {
    const controller = makeController();
    const released = openThenRelease(controller);
    const closedAgainAt = released + 10;

    // Still open until the hold runs out — a passing fist is not a dismissal.
    expect(controller.update(input({ bothClosed: true }), closedAgainAt).isOpen).toBe(true);
    expect(controller.update(input({ bothClosed: true }), closedAgainAt + HOLD - 1).isOpen).toBe(
      true,
    );

    expect(controller.update(input({ bothClosed: true }), closedAgainAt + HOLD).isOpen).toBe(false);
    expect(controller.open).toBe(false);
  });

  it("needs the hold again, so a passing fist does not dismiss it", () => {
    const controller = makeController();
    const released = openThenRelease(controller);
    const closedAgainAt = released + 10;

    controller.update(input({ bothClosed: true }), closedAgainAt);
    expect(controller.update(input({ bothClosed: false }), closedAgainAt + 100).isOpen).toBe(true);
    expect(controller.open).toBe(true);
  });

  it("does not dismiss on the closed hands that opened it", () => {
    const controller = makeController();

    // Never released, so the same hold that opened it cannot also close it.
    const opened = openMenu(controller);
    expect(controller.update(input({ bothClosed: true }), opened + HOLD * 3).isOpen).toBe(true);
  });
});

describe("menuOptionsFor", () => {
  const vocabulary = [
    { id: "classic", label: "Classic" },
    { id: "triad", label: "Triad" },
    { id: "pentatonic", label: "Pentatonic" },
  ];

  it("keeps the current vocabulary", () => {
    const options = menuOptionsFor("chord", vocabulary);

    expect(options.slice(0, 3).map((option) => option.id)).toEqual([
      "classic",
      "triad",
      "pentatonic",
    ]);
  });

  it("offers the other mode, so the other vocabulary is reachable", () => {
    expect(menuOptionsFor("chord", vocabulary).at(-1)).toMatchObject({
      id: "mono",
      keepsMenuOpen: true,
    });
    expect(menuOptionsFor("mono", vocabulary).at(-1)).toMatchObject({
      id: "chord",
      keepsMenuOpen: true,
    });
  });

  it("recognises the mode switch ids and nothing else", () => {
    expect(isModeSwitch("chord")).toBe(true);
    expect(isModeSwitch("mono")).toBe(true);
    expect(isModeSwitch("triad")).toBe(false);
    expect(isModeSwitch("harp")).toBe(false);
  });
});

describe("MenuController keeping the menu open", () => {
  const SWITCHING = [...OPTIONS, { id: "mono", label: "Mono", keepsMenuOpen: true }];

  it("stays open when the committed option asks it to", () => {
    const controller = makeController();
    const options = SWITCHING;
    const opened = openMenu(controller);
    const target = pointFrom(HAND, 3, SWITCHING.length);

    controller.update(input({ options, bothClosed: true, cursor: target }), opened + 1);
    const committed = controller.update(
      input({ options, bothClosed: true, cursor: target }),
      opened + 1 + DWELL,
    );

    expect(committed.committed).toBe("mono");
    expect(committed.isOpen).toBe(true);
    expect(controller.open).toBe(true);
  });

  it("requires a move again before the same option can commit twice", () => {
    const controller = makeController();
    const options = SWITCHING;
    const opened = openMenu(controller);
    const target = pointFrom(HAND, 3, SWITCHING.length);

    controller.update(input({ options, bothClosed: true, cursor: target }), opened + 1);
    const first = controller.update(
      input({ options, bothClosed: true, cursor: target }),
      opened + 1 + DWELL,
    );
    expect(first.committed).toBe("mono");

    // Still resting on it: nothing highlighted, and no second commit.
    const second = controller.update(
      input({ options, bothClosed: true, cursor: target }),
      opened + 1 + DWELL * 3,
    );
    expect(second.committed).toBeNull();
    expect(second.hoveredId).toBeNull();
  });

  it("still closes on an ordinary choice", () => {
    const controller = makeController();
    const opened = openMenu(controller);
    const target = pointFrom(HAND, 1);

    controller.update(input({ bothClosed: true, cursor: target }), opened + 1);
    const committed = controller.update(
      input({ bothClosed: true, cursor: target }),
      opened + 1 + DWELL,
    );

    expect(committed.committed).toBe("triad");
    expect(committed.isOpen).toBe(false);
  });
});

describe("MenuController anchoring", () => {
  it("centres the menu on the hand that opened it, not the screen", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    const frame = controller.update(input({ bothClosed: true, cursor: HAND }), opened);

    expect(frame.centerX).toBeCloseTo(HAND.x);
    expect(frame.centerY).toBeCloseTo(HAND.y);
  });

  it("puts the options around the hand", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    const frame = controller.update(input({ bothClosed: true, cursor: HAND }), opened);
    const first = frame.slots[0];

    expect(first.x).toBeCloseTo(HAND.x);
    expect(first.y).toBeCloseTo(HAND.y - CONTROL.radius);
  });

  it("nudges the anchor back on screen when the hand is near an edge", () => {
    const controller = makeController();
    const corner: CanvasPoint = { x: 20, y: HEIGHT - 20 };

    const opened = openMenu(controller, corner);
    const frame = controller.update(input({ bothClosed: true, cursor: corner }), opened);

    const margin = CONTROL.radius + CONTROL.optionRadius;
    expect(frame.centerX).toBeCloseTo(margin);
    expect(frame.centerY).toBeCloseTo(HEIGHT - margin);
  });
});

describe("MenuController choosing", () => {
  it("selects nothing while the hand rests where the menu opened", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    // The hand opened the menu somewhere; even after the dwell time has passed
    // with no movement, nothing has been chosen.
    const frame = controller.update(input({ bothClosed: true, cursor: HAND }), opened + DWELL * 3);

    expect(frame.hoveredId).toBeNull();
    expect(frame.dwellProgress).toBe(0);
    expect(controller.open).toBe(true);
  });

  it("still selects nothing when the hand happened to open over an option", () => {
    const controller = makeController();
    // Open the menu with the hand already sitting where an option will be.
    const overOption = pointFrom(HAND, 1);

    const opened = openMenu(controller, overOption);
    const frame = controller.update(
      input({ bothClosed: true, cursor: overOption }),
      opened + DWELL * 3,
    );

    expect(frame.hoveredId).toBeNull();
  });

  it("highlights the option once the hand is pushed towards it", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    const frame = controller.update(
      input({ bothClosed: true, cursor: pointFrom(HAND, 2) }),
      opened + 10,
    );

    expect(frame.hoveredId).toBe("pentatonic");
  });

  it("highlights nothing in the dead zone", () => {
    const controller = makeController();
    const steered = openAndSteer(controller, 1);

    const frame = controller.update(input({ bothClosed: true, cursor: HAND }), steered + 10);

    expect(frame.hoveredId).toBeNull();
  });

  it("commits only after the hand has dwelt on an option", () => {
    const controller = makeController();
    const steered = openAndSteer(controller, 1);
    const cursor = pointFrom(HAND, 1);

    expect(
      controller.update(input({ bothClosed: true, cursor }), steered + DWELL - 1).committed,
    ).toBeNull();

    const committed = controller.update(input({ bothClosed: true, cursor }), steered + DWELL);
    expect(committed.committed).toBe("triad");
    expect(committed.isOpen).toBe(false);
  });

  it("restarts the dwell when the hand moves to another option", () => {
    const controller = makeController();
    const steered = openAndSteer(controller, 1);

    controller.update(
      input({ bothClosed: true, cursor: pointFrom(HAND, 1) }),
      steered + DWELL - 100,
    );

    const other = pointFrom(HAND, 2);
    controller.update(input({ bothClosed: true, cursor: other }), steered + DWELL - 50);
    expect(
      controller.update(input({ bothClosed: true, cursor: other }), steered + DWELL).committed,
    ).toBeNull();
    expect(
      controller.update(input({ bothClosed: true, cursor: other }), steered + DWELL + DWELL - 60)
        .committed,
    ).toBeNull();
    expect(
      controller.update(input({ bothClosed: true, cursor: other }), steered + DWELL + DWELL)
        .committed,
    ).toBe("pentatonic");
  });

  it("does not commit while the hand rests in the dead zone", () => {
    const controller = makeController();
    const steered = openAndSteer(controller, 0);

    expect(
      controller.update(input({ bothClosed: true, cursor: HAND }), steered + DWELL * 2).committed,
    ).toBeNull();
  });

  it("fills the dwell ring as the hold progresses", () => {
    const controller = makeController();
    const steered = openAndSteer(controller, 0);

    const half = controller.update(
      input({ bothClosed: true, cursor: pointFrom(HAND, 0) }),
      steered + DWELL / 2,
    );

    expect(half.dwellProgress).toBeCloseTo(0.5, 2);
  });

  it("closes itself after idling with the hand off every option", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    expect(
      controller.update(input({ bothClosed: true, cursor: HAND }), opened + IDLE + 1).isOpen,
    ).toBe(false);
  });

  it("times out from the last time the hand was on an option, not from opening", () => {
    const controller = makeController();
    const opened = openMenu(controller);
    const lastPointedAt = opened + IDLE - 100;

    controller.update(input({ bothClosed: true, cursor: pointFrom(HAND, 0) }), lastPointedAt);

    expect(
      controller.update(input({ bothClosed: true, cursor: HAND }), opened + IDLE + 100).isOpen,
    ).toBe(true);
    expect(
      controller.update(input({ bothClosed: true, cursor: HAND }), lastPointedAt + IDLE + 1).isOpen,
    ).toBe(false);
  });

  it("lays one slot per option", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    const frame = controller.update(input({ bothClosed: true, cursor: HAND }), opened + 10);
    expect(frame.slots).toHaveLength(OPTIONS.length);
  });

  it("reports how long it has been open, so the fan-out can be animated", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    expect(controller.update(input({ bothClosed: true, cursor: HAND }), opened).elapsedMs).toBe(0);
    expect(
      controller.update(input({ bothClosed: true, cursor: HAND }), opened + 120).elapsedMs,
    ).toBe(120);
  });

  it("reports no elapsed time when it is shut", () => {
    const controller = makeController();

    expect(controller.update(input({ bothClosed: false }), 500).elapsedMs).toBe(0);
  });

  it("forgets the anchor when it closes", () => {
    const controller = makeController();
    const steered = openAndSteer(controller, 1);

    controller.update(input({ bothClosed: true, cursor: pointFrom(HAND, 1) }), steered + DWELL);
    controller.update(input({ bothClosed: false }), steered + DWELL + 10);

    // Reopening somewhere else anchors there, not where it was before.
    const reopened = openMenu(controller, CENTER, steered + DWELL + 20);
    const frame = controller.update(input({ bothClosed: true, cursor: CENTER }), reopened);

    expect(frame.centerX).toBeCloseTo(CENTER.x);
  });
});
