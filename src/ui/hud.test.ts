import { describe, expect, it } from "vitest";
import { modeLabel } from "./hud";

describe("modeLabel", () => {
  it("names the chord mode the way the rest of the instrument does", () => {
    expect(modeLabel("chord")).toBe("Chords");
  });

  it("names the mono mode", () => {
    expect(modeLabel("mono")).toBe("Mono");
  });
});
