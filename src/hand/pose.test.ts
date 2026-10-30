import { describe, expect, it } from "vitest";
import { ALL_SHAPES, shapeFromFingers } from "../music/gesture-map";
import {
  DEFAULT_SPREAD,
  DIGITS,
  TILT_LEAN,
  resolvePose,
  screenRoll,
  shapeOfPose,
  sideOf,
  specFromShape,
} from "./pose";

describe("resolvePose", () => {
  it("closes every digit a spec leaves out, so one named finger is a point", () => {
    const pose = resolvePose({ fingers: { index: "extended" } });

    expect(pose.curl.index).toBe(0);
    for (const digit of DIGITS.filter((digit) => digit !== "index")) {
      expect(pose.curl[digit]).toBe(1);
    }
  });

  it("reads the words for a digit as the curl they mean", () => {
    const pose = resolvePose({ fingers: { thumb: "extended", index: "half", middle: 0.25 } });

    expect(pose.curl.thumb).toBe(0);
    expect(pose.curl.index).toBe(0.5);
    expect(pose.curl.middle).toBe(0.25);
  });

  it("reads palm and back as the two ends of the turn", () => {
    expect(resolvePose({ facing: "palm" }).facing).toBe(0);
    expect(resolvePose({ facing: "back" }).facing).toBe(1);
    expect(resolvePose({ facing: 0.5 }).facing).toBe(0.5);
  });

  it("keeps numbers in range, so a slider past its end cannot fold a finger backwards", () => {
    const pose = resolvePose({ fingers: { index: 2, middle: -1 }, facing: 3, spread: -1 });

    expect(pose.curl.index).toBe(1);
    expect(pose.curl.middle).toBe(0);
    expect(pose.facing).toBe(1);
    expect(pose.spread).toBe(0);
  });

  it("defaults to a relaxed left hand, palm to the camera", () => {
    const pose = resolvePose();

    expect(pose.hand).toBe("left");
    expect(pose.facing).toBe(0);
    expect(pose.spread).toBe(DEFAULT_SPREAD);
    expect(pose.roll).toBe(0);
    expect(pose.pitch).toBe(0);
  });
});

describe("tilt", () => {
  it("reads inward and outward as the two ends of the lean", () => {
    expect(resolvePose({ tilt: "inward" }).tilt).toBe(1);
    expect(resolvePose({ tilt: "outward" }).tilt).toBe(-1);
    expect(resolvePose({ tilt: "upright" }).tilt).toBe(0);
    expect(resolvePose({ tilt: 4 }).tilt).toBe(1);
  });

  it("turns inward opposite ways on screen for the two hands", () => {
    expect(screenRoll(resolvePose({ hand: "left", tilt: "inward" }))).toBeCloseTo(TILT_LEAN, 9);
    expect(screenRoll(resolvePose({ hand: "right", tilt: "inward" }))).toBeCloseTo(-TILT_LEAN, 9);
  });

  it("adds a roll on top, in screen terms for either hand", () => {
    expect(screenRoll(resolvePose({ hand: "right", tilt: "inward", roll: 0.1 }))).toBeCloseTo(
      -TILT_LEAN + 0.1,
      9,
    );
  });
});

describe("specFromShape", () => {
  it("round-trips every shape the instrument can read", () => {
    for (const shape of ALL_SHAPES) {
      expect(shapeOfPose(resolvePose(specFromShape(shape)))).toBe(shape);
    }
  });

  it("carries the rest of the spec through", () => {
    const spec = specFromShape(shapeFromFingers({ index: true }), {
      hand: "right",
      facing: "back",
    });

    expect(spec.hand).toBe("right");
    expect(spec.facing).toBe("back");
    expect(spec.fingers?.index).toBe("extended");
    expect(spec.fingers?.thumb).toBe("closed");
  });
});

describe("sideOf", () => {
  it("names the player's own hand from MediaPipe's label", () => {
    expect(sideOf("Left")).toBe("left");
    expect(sideOf("Right")).toBe("right");
  });
});
