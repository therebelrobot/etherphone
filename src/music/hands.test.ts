import { describe, expect, it } from "vitest";
import { HANDS, handName, otherHand, parseHarmonyHand } from "./hands";

describe("otherHand", () => {
  it("swaps the two hands", () => {
    expect(otherHand("Left")).toBe("Right");
    expect(otherHand("Right")).toBe("Left");
  });

  it("is its own inverse, so a swap can be undone", () => {
    for (const hand of HANDS) expect(otherHand(otherHand(hand))).toBe(hand);
  });
});

describe("parseHarmonyHand", () => {
  it("defaults to the left, which is what the instrument did first", () => {
    expect(parseHarmonyHand(null)).toBe("Left");
    expect(parseHarmonyHand(undefined)).toBe("Left");
    expect(parseHarmonyHand("")).toBe("Left");
  });

  it("reads a stored right hand", () => {
    expect(parseHarmonyHand("Right")).toBe("Right");
  });

  it("falls back to the left for anything else, rather than leaving no hand playing", () => {
    expect(parseHarmonyHand("both")).toBe("Left");
    expect(parseHarmonyHand("left")).toBe("Left");
  });
});

describe("handName", () => {
  it("lower-cases the name for use mid-sentence", () => {
    expect(handName("Left")).toBe("left");
    expect(handName("Right")).toBe("right");
  });
});
