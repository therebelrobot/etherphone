import { describe, expect, it } from "vitest";
import { CUE_RADIUS, cueArrows } from "./transport-cue";

const POINT = { x: 400, y: 300 };

describe("cueArrows", () => {
  it("names the four commands, in a stable order", () => {
    expect(cueArrows(POINT).map((arrow) => arrow.label)).toEqual(["Rec", "Play", "Stop", "Clear"]);
  });

  it("places each command in its own direction", () => {
    const byLabel = Object.fromEntries(cueArrows(POINT).map((arrow) => [arrow.label, arrow]));

    expect(byLabel.Rec.y).toBeLessThan(POINT.y);
    expect(byLabel.Stop.y).toBeGreaterThan(POINT.y);
    expect(byLabel.Play.x).toBeGreaterThan(POINT.x);
    expect(byLabel.Clear.x).toBeLessThan(POINT.x);

    // Directly above, below, and beside: no arrow drifts off its axis.
    expect(byLabel.Rec.x).toBeCloseTo(POINT.x, 6);
    expect(byLabel.Play.y).toBeCloseTo(POINT.y, 6);
  });

  it("keeps every label outside its arrow, so the two never collide", () => {
    for (const arrow of cueArrows(POINT)) {
      const toArrow = Math.hypot(arrow.x - POINT.x, arrow.y - POINT.y);
      const toLabel = Math.hypot(arrow.labelX - POINT.x, arrow.labelY - POINT.y);

      expect(toArrow).toBeCloseTo(CUE_RADIUS, 6);
      expect(toLabel).toBeGreaterThan(toArrow);
    }
  });

  it("reads outward from the point", () => {
    const byLabel = Object.fromEntries(cueArrows(POINT).map((arrow) => [arrow.label, arrow]));

    expect(byLabel.Rec.angle).toBeCloseTo(-Math.PI / 2, 6);
    expect(byLabel.Play.angle).toBeCloseTo(0, 6);
    expect(byLabel.Stop.angle).toBeCloseTo(Math.PI / 2, 6);
    expect(byLabel.Clear.angle).toBeCloseTo(Math.PI, 6);
  });
});
