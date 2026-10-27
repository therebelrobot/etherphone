import { describe, expect, it } from "vitest";
import type { CanvasPoint } from "../types";
import { MenuController } from "./menu-controller";

const OPTIONS = [
  { id: "classic", label: "Classic" },
  { id: "triad", label: "Triad" },
  { id: "pentatonic", label: "Pentatonic" },
];

const HOLD = 600;
const DWELL = 900;
const IDLE = 5000;

const WIDTH = 1000;
const HEIGHT = 800;
const CENTER_X = WIDTH / 2;
const CENTER_Y = HEIGHT / 2;

/** A cursor pointing at the option at `index`, well outside the dead zone. */
function cursorOn(index: number, distance = 300): CanvasPoint {
  const angle = -Math.PI / 2 + (index * 2 * Math.PI) / OPTIONS.length;
  return {
    x: CENTER_X + Math.cos(angle) * distance,
    y: CENTER_Y + Math.sin(angle) * distance,
  };
}

/** The middle of the menu, where nothing is selected. */
const NEUTRAL: CanvasPoint = { x: CENTER_X, y: CENTER_Y };

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
  return new MenuController(HOLD, DWELL, IDLE);
}

/** Holds both hands closed long enough to open the menu, and returns the time it opened. */
function openMenu(controller: MenuController, from = 0): number {
  controller.update(input({ bothClosed: true }), from);

  const opened = from + HOLD;
  controller.update(input({ bothClosed: true }), opened);

  return opened;
}

/**
 * Opens the menu and puts the cursor on an option in the same frame, so the
 * dwell starts at the returned time and commits exactly `DWELL` later.
 */
function openMenuOn(controller: MenuController, index: number, from = 0): number {
  controller.update(input({ bothClosed: true }), from);

  const opened = from + HOLD;
  controller.update(input({ bothClosed: true, cursor: cursorOn(index) }), opened);

  return opened;
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

  it("does not open on one closed hand", () => {
    const controller = makeController();

    controller.update(input({ bothClosed: false }), 0);
    expect(controller.update(input({ bothClosed: false }), HOLD * 4).isOpen).toBe(false);
  });

  it("restarts the hold if the hands come apart", () => {
    const controller = makeController();

    controller.update(input({ bothClosed: true }), 0);
    controller.update(input({ bothClosed: true }), HOLD - 100);
    controller.update(input({ bothClosed: false }), HOLD - 50);

    // The earlier hold no longer counts, so this has to run its course again.
    expect(controller.update(input({ bothClosed: true }), HOLD).isOpen).toBe(false);
    expect(controller.update(input({ bothClosed: true }), HOLD + 100).isOpen).toBe(false);
    expect(controller.update(input({ bothClosed: true }), HOLD + HOLD).isOpen).toBe(true);
  });

  it("will not reopen while the hands stay closed", () => {
    const controller = makeController();
    const opened = openMenuOn(controller, 1);
    const committedAt = opened + DWELL;

    const committed = controller.update(
      input({ bothClosed: true, cursor: cursorOn(1) }),
      committedAt,
    );
    expect(committed.committed).toBe("triad");
    expect(controller.open).toBe(false);

    // Committed, so the menu is shut — and still-closed hands must not reopen it.
    expect(controller.update(input({ bothClosed: true }), committedAt + HOLD * 3).isOpen).toBe(
      false,
    );
  });

  it("reopens once the gesture is released and held again", () => {
    const controller = makeController();
    const opened = openMenuOn(controller, 1);
    const committedAt = opened + DWELL;

    controller.update(input({ bothClosed: true, cursor: cursorOn(1) }), committedAt);
    controller.update(input({ bothClosed: false }), committedAt + 10);

    expect(controller.update(input({ bothClosed: true }), committedAt + 20).isOpen).toBe(false);
    expect(controller.update(input({ bothClosed: true }), committedAt + 20 + HOLD).isOpen).toBe(
      true,
    );
  });
});

describe("MenuController choosing", () => {
  it("highlights the option the cursor points at", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    const frame = controller.update(input({ bothClosed: true, cursor: cursorOn(2) }), opened + 10);
    expect(frame.hoveredId).toBe("pentatonic");
  });

  it("highlights nothing in the dead zone", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    const frame = controller.update(input({ bothClosed: true, cursor: NEUTRAL }), opened + 10);
    expect(frame.hoveredId).toBeNull();
  });

  it("commits only after the cursor has dwelt on an option", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    const first = controller.update(input({ bothClosed: true, cursor: cursorOn(1) }), opened);
    expect(first.committed).toBeNull();
    expect(
      controller.update(input({ bothClosed: true, cursor: cursorOn(1) }), opened + DWELL - 1)
        .committed,
    ).toBeNull();

    const committed = controller.update(
      input({ bothClosed: true, cursor: cursorOn(1) }),
      opened + DWELL,
    );
    expect(committed.committed).toBe("triad");
    expect(committed.isOpen).toBe(false);
  });

  it("restarts the dwell when the cursor moves to another option", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    controller.update(input({ bothClosed: true, cursor: cursorOn(1) }), opened);
    controller.update(input({ bothClosed: true, cursor: cursorOn(1) }), opened + DWELL - 100);

    // A new option starts its own hold from scratch.
    controller.update(input({ bothClosed: true, cursor: cursorOn(2) }), opened + DWELL - 50);
    expect(
      controller.update(input({ bothClosed: true, cursor: cursorOn(2) }), opened + DWELL).committed,
    ).toBeNull();
    expect(
      controller.update(
        input({ bothClosed: true, cursor: cursorOn(2) }),
        opened + DWELL + DWELL - 60,
      ).committed,
    ).toBeNull();
    expect(
      controller.update(input({ bothClosed: true, cursor: cursorOn(2) }), opened + DWELL + DWELL)
        .committed,
    ).toBe("pentatonic");
  });

  it("does not commit while the cursor rests in the dead zone", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    controller.update(input({ bothClosed: true, cursor: NEUTRAL }), opened);
    expect(
      controller.update(input({ bothClosed: true, cursor: NEUTRAL }), opened + DWELL * 2).committed,
    ).toBeNull();
  });

  it("fills the dwell ring as the hold progresses", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    controller.update(input({ bothClosed: true, cursor: cursorOn(0) }), opened);
    const half = controller.update(
      input({ bothClosed: true, cursor: cursorOn(0) }),
      opened + DWELL / 2,
    );

    expect(half.dwellProgress).toBeCloseTo(0.5, 2);
  });

  it("closes itself after idling with the cursor off every option", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    controller.update(input({ bothClosed: true, cursor: NEUTRAL }), opened);
    expect(
      controller.update(input({ bothClosed: true, cursor: NEUTRAL }), opened + IDLE + 1).isOpen,
    ).toBe(false);
  });

  it("times out from the last time the cursor was on an option, not from opening", () => {
    const controller = makeController();
    const opened = openMenu(controller);
    const lastPointedAt = opened + IDLE - 100;

    controller.update(input({ bothClosed: true, cursor: cursorOn(0) }), lastPointedAt);

    // Pointing reset the clock, so the menu outlives the original deadline.
    expect(
      controller.update(input({ bothClosed: true, cursor: NEUTRAL }), opened + IDLE + 100).isOpen,
    ).toBe(true);

    // But it still times out once the idle window has passed since then.
    expect(
      controller.update(input({ bothClosed: true, cursor: NEUTRAL }), lastPointedAt + IDLE + 1)
        .isOpen,
    ).toBe(false);
  });

  it("lays the options out around the canvas centre", () => {
    const controller = makeController();
    const opened = openMenu(controller);

    const frame = controller.update(input({ bothClosed: true, cursor: cursorOn(0) }), opened + 10);

    expect(frame.centerX).toBe(CENTER_X);
    expect(frame.centerY).toBe(CENTER_Y);
    expect(frame.slots).toHaveLength(OPTIONS.length);
  });
});
