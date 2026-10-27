import { describe, expect, it } from "vitest";
import { CONTROL } from "../config/constants";
import { fitAnchor, layoutRadial, slotAt } from "./radial-menu";

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
