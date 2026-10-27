import { describe, expect, it } from "vitest";
import { CONTROL } from "../config/constants";
import { easeOutBack, fanProgress, fanState, fitAnchor, layoutRadial, slotAt } from "./radial-menu";

const THREE = [
  { id: "a", label: "A" },
  { id: "b", label: "B" },
  { id: "c", label: "C" },
];

const CENTER = { x: 500, y: 400 };

/** A cursor at a given direction and distance from the centre. */
function cursorAt(angle: number, distance = 150) {
  return {
    x: CENTER.x + Math.cos(angle) * distance,
    y: CENTER.y + Math.sin(angle) * distance,
  };
}

describe("fitAnchor", () => {
  const MARGIN = CONTROL.radius + CONTROL.optionRadius;

  it("leaves an anchor with room around it alone", () => {
    expect(fitAnchor(CENTER, 1280, 900)).toEqual(CENTER);
  });

  it("pulls an anchor away from each edge by the menu's reach", () => {
    expect(fitAnchor({ x: 0, y: 0 }, 1280, 900)).toEqual({ x: MARGIN, y: MARGIN });
    expect(fitAnchor({ x: 1280, y: 900 }, 1280, 900)).toEqual({
      x: 1280 - MARGIN,
      y: 900 - MARGIN,
    });
  });

  it("keeps every option on screen once fitted", () => {
    const fitted = fitAnchor({ x: 5, y: 895 }, 1280, 900);

    for (const slot of layoutRadial(THREE, fitted.x, fitted.y)) {
      expect(slot.x - CONTROL.optionRadius).toBeGreaterThanOrEqual(0);
      expect(slot.y - CONTROL.optionRadius).toBeGreaterThanOrEqual(0);
      expect(slot.x + CONTROL.optionRadius).toBeLessThanOrEqual(1280);
      expect(slot.y + CONTROL.optionRadius).toBeLessThanOrEqual(900);
    }
  });

  it("centres instead when the canvas is smaller than the menu", () => {
    expect(fitAnchor({ x: 0, y: 0 }, 100, 100)).toEqual({ x: 50, y: 50 });
  });
});

describe("fanProgress", () => {
  it("has not started before the option's turn", () => {
    expect(fanProgress(0, 0)).toBe(0);
    expect(fanProgress(1, CONTROL.fanStaggerMs - 1)).toBe(0);
  });

  it("is under way once the option's turn comes round", () => {
    expect(fanProgress(0, CONTROL.fanOutMs / 2)).toBeCloseTo(0.5, 5);
    expect(fanProgress(1, CONTROL.fanStaggerMs + CONTROL.fanOutMs / 2)).toBeCloseTo(0.5, 5);
  });

  it("is finished once the option has had its full run", () => {
    expect(fanProgress(0, CONTROL.fanOutMs)).toBe(1);
    expect(fanProgress(2, CONTROL.fanStaggerMs * 2 + CONTROL.fanOutMs)).toBe(1);
  });

  it("starts each option later than the last, which is the wave", () => {
    const at = CONTROL.fanOutMs / 2;

    expect(fanProgress(0, at)).toBeGreaterThan(fanProgress(1, at));
    expect(fanProgress(1, at)).toBeGreaterThan(fanProgress(2, at));
  });
});

describe("easeOutBack", () => {
  it("starts at nothing and ends exactly on the target", () => {
    expect(easeOutBack(0)).toBeCloseTo(0, 6);
    expect(easeOutBack(1)).toBeCloseTo(1, 6);
  });

  it("overshoots on the way, which is what makes it springy", () => {
    expect(easeOutBack(0.7)).toBeGreaterThan(1);
  });
});

describe("fanState", () => {
  const slots = layoutRadial(THREE, CENTER.x, CENTER.y);

  it("starts the option at the anchor, with no size", () => {
    const state = fanState(slots[0], 0, 0, CENTER.x, CENTER.y);

    expect(state.x).toBeCloseTo(CENTER.x);
    expect(state.y).toBeCloseTo(CENTER.y);
    expect(state.radius).toBeCloseTo(0);
    expect(state.alpha).toBeCloseTo(0);
  });

  it("lands the option on its resting spot, round and opaque", () => {
    const settled = CONTROL.fanOutMs;
    const state = fanState(slots[0], 0, settled, CENTER.x, CENTER.y);

    expect(state.x).toBeCloseTo(slots[0].x);
    expect(state.y).toBeCloseTo(slots[0].y);
    expect(state.radius).toBeCloseTo(CONTROL.optionRadius);
    expect(state.stretch).toBeCloseTo(0, 5);
    expect(state.alpha).toBeCloseTo(1, 5);
  });

  it("stretches while it is travelling, and not once it has arrived", () => {
    const mid = fanState(slots[0], 0, CONTROL.fanOutMs * 0.45, CENTER.x, CENTER.y);

    expect(mid.stretch).toBeGreaterThan(0.1);
    expect(mid.stretch).toBeLessThan(0.5);
  });

  it("overshoots its resting spot and springs back onto it", () => {
    const resting = Math.hypot(slots[0].x - CENTER.x, slots[0].y - CENTER.y);

    let furthest = 0;
    for (let elapsed = 0; elapsed <= CONTROL.fanOutMs; elapsed += 10) {
      const state = fanState(slots[0], 0, elapsed, CENTER.x, CENTER.y);
      furthest = Math.max(furthest, Math.hypot(state.x - CENTER.x, state.y - CENTER.y));
    }

    // The throw carries past the target, then settles exactly on it.
    expect(furthest).toBeGreaterThan(resting);

    const settled = fanState(slots[0], 0, CONTROL.fanOutMs, CENTER.x, CENTER.y);
    expect(Math.hypot(settled.x - CENTER.x, settled.y - CENTER.y)).toBeCloseTo(resting, 3);
  });
});

describe("layoutRadial", () => {
  it("starts at the top and goes clockwise", () => {
    const slots = layoutRadial(THREE, CENTER.x, CENTER.y, 100);

    expect(slots[0].angle).toBeCloseTo(-Math.PI / 2);
    expect(slots[1].angle).toBeCloseTo(-Math.PI / 2 + (2 * Math.PI) / 3);
    expect(slots[2].angle).toBeCloseTo(-Math.PI / 2 + (4 * Math.PI) / 3);
  });

  it("puts the first option directly above the centre", () => {
    const [first] = layoutRadial(THREE, CENTER.x, CENTER.y, 100);

    expect(first.x).toBeCloseTo(CENTER.x);
    expect(first.y).toBeCloseTo(CENTER.y - 100);
  });

  it("keeps every option the same distance from the centre", () => {
    for (const slot of layoutRadial(THREE, CENTER.x, CENTER.y, 100)) {
      expect(Math.hypot(slot.x - CENTER.x, slot.y - CENTER.y)).toBeCloseTo(100);
    }
  });

  it("carries each option's label through", () => {
    expect(layoutRadial(THREE, CENTER.x, CENTER.y).map((slot) => slot.label)).toEqual([
      "A",
      "B",
      "C",
    ]);
  });
});

describe("slotAt", () => {
  const slots = layoutRadial(THREE, CENTER.x, CENTER.y, 100);

  it("selects nothing inside the dead zone", () => {
    const inside = { x: CENTER.x + 10, y: CENTER.y + 10 };
    expect(slotAt(slots, inside, CENTER.x, CENTER.y)).toBeNull();
  });

  it("uses the configured dead zone by default", () => {
    expect(
      slotAt(slots, cursorAt(-Math.PI / 2, CONTROL.deadZone - 5), CENTER.x, CENTER.y),
    ).toBeNull();
  });

  it("selects the option the cursor points at", () => {
    expect(slotAt(slots, cursorAt(-Math.PI / 2), CENTER.x, CENTER.y)?.id).toBe("a");
  });

  it("selects by direction, not by distance", () => {
    // Far past the option, but still in its direction.
    expect(slotAt(slots, cursorAt(-Math.PI / 2, 900), CENTER.x, CENTER.y)?.id).toBe("a");
  });

  it("picks the nearer direction when between two options", () => {
    // The options sit 120 degrees apart, so the boundary is 60 degrees out.
    expect(slotAt(slots, cursorAt(-Math.PI / 2 + 0.2), CENTER.x, CENTER.y)?.id).toBe("a");
    expect(slotAt(slots, cursorAt(-Math.PI / 2 + 1.2), CENTER.x, CENTER.y)?.id).toBe("b");
  });

  it("normalises across the seam where atan2 flips sign", () => {
    // Just either side of the negative x-axis, which is the same direction.
    expect(slotAt(slots, cursorAt(Math.PI - 0.1), CENTER.x, CENTER.y)?.id).toBe("c");
    expect(slotAt(slots, cursorAt(-Math.PI + 0.1), CENTER.x, CENTER.y)?.id).toBe("c");
  });

  it("handles a single option, which is the only thing selectable", () => {
    const one = layoutRadial([{ id: "only", label: "Only" }], CENTER.x, CENTER.y, 100);
    expect(slotAt(one, cursorAt(0), CENTER.x, CENTER.y)?.id).toBe("only");
  });

  it("selects nothing when there are no options", () => {
    expect(slotAt([], cursorAt(0), CENTER.x, CENTER.y)).toBeNull();
  });
});
