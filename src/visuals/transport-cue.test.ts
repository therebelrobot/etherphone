import { describe, expect, it } from "vitest";
import { COMMAND_LABELS, CUE_RADIUS, cueArrows, heatColor, heatRamp } from "./transport-cue";

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

  it("tags every arrow with the command it fires", () => {
    expect(cueArrows(POINT).map((arrow) => arrow.command)).toEqual([
      "record",
      "play",
      "stop",
      "clear",
    ]);
  });
});

describe("heatColor", () => {
  it("runs dim, then gold, then white-hot as the flick approaches", () => {
    expect(heatColor(0)).toBe("rgba(232, 161, 61, 0.55)");
    expect(heatColor(0.4)).toBe("#e8a13d");
    // The band that says "this will fire".
    expect(heatColor(0.9)).toBe("#fff3d6");
    expect(heatColor(1)).toBe("#fff3d6");
  });
});

describe("heatRamp", () => {
  it("runs from ember, through gold, to white-hot", () => {
    expect(heatRamp(0)).toBe("rgb(122, 74, 18)");
    expect(heatRamp(0.5)).toBe("rgb(232, 161, 61)");
    expect(heatRamp(1)).toBe("rgb(255, 243, 214)");
  });

  it("clamps outside the path", () => {
    expect(heatRamp(-1)).toBe(heatRamp(0));
    expect(heatRamp(2)).toBe(heatRamp(1));
  });

  it("moves monotonically hotter along the path", () => {
    const brightness = (colour: string): number =>
      colour
        .replace(/[^\d,]/g, "")
        .split(",")
        .map(Number)
        .reduce((sum, channel) => sum + channel, 0);

    expect(brightness(heatRamp(0.25))).toBeGreaterThan(brightness(heatRamp(0)));
    expect(brightness(heatRamp(0.75))).toBeGreaterThan(brightness(heatRamp(0.25)));
  });
});

describe("COMMAND_LABELS", () => {
  it("names every command, for the confirmation flash", () => {
    expect(Object.keys(COMMAND_LABELS).sort()).toEqual(["clear", "play", "record", "stop"]);
    expect(COMMAND_LABELS.record).toBe("RECORD");
  });
});
