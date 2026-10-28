import { describe, expect, it } from "vitest";
import {
  assembleChannel,
  framesToSkip,
  isSilentCapture,
  loopFrameCount,
  meanLevel,
} from "./voice-loop";

const chunk = (...values: number[]) => Float32Array.from(values);

describe("loopFrameCount", () => {
  it("is the loop's own length in frames", () => {
    // Four bars of four beats at 120 BPM is eight seconds.
    expect(loopFrameCount(16, 120, 48000)).toBe(48000 * 8);
  });

  it("rounds rather than truncates, because a short loop drifts against the layers under it", () => {
    // At 44100 a beat of 100 BPM is 26460 frames exactly; at 123 BPM it is not.
    const frames = loopFrameCount(4, 123, 44100);

    expect(Number.isInteger(frames)).toBe(true);
    expect(frames).toBe(Math.round(((4 * 60) / 123) * 44100));
  });

  it("never returns nothing, however fast the tempo", () => {
    expect(loopFrameCount(1, 100000, 8000)).toBeGreaterThan(0);
  });
});

describe("framesToSkip", () => {
  it("is zero when the capture starts on the line", () => {
    expect(framesToSkip(10, 10, 48000)).toBe(0);
  });

  it("is the wait when the capture starts early, which is how a mid-bar start still lands on the bar", () => {
    expect(framesToSkip(10, 10.5, 48000)).toBe(24000);
  });

  it("is never negative, so a late start does not silently cut the window", () => {
    expect(framesToSkip(10.5, 10, 48000)).toBe(0);
  });
});

describe("assembleChannel", () => {
  it("joins the chunks in the order they arrived", () => {
    const joined = assembleChannel([chunk(1, 2), chunk(3, 4)], 4);

    expect([...joined]).toEqual([1, 2, 3, 4]);
  });

  it("trims an overshoot, because the audio thread stops on its own schedule", () => {
    const joined = assembleChannel([chunk(1, 2, 3), chunk(4, 5, 6)], 4);

    expect([...joined]).toEqual([1, 2, 3, 4]);
  });

  it("pads a shortfall with silence rather than returning a short loop", () => {
    const joined = assembleChannel([chunk(1, 2)], 4);

    expect([...joined]).toEqual([1, 2, 0, 0]);
    expect(joined.length).toBe(4);
  });

  it("drops the frames before the window opens", () => {
    const joined = assembleChannel([chunk(1, 2, 3, 4), chunk(5, 6)], 3, 3);

    // Three skipped, so the window is 4, 5, 6.
    expect([...joined]).toEqual([4, 5, 6]);
  });

  it("skips across a chunk boundary", () => {
    const joined = assembleChannel([chunk(1, 2), chunk(3, 4), chunk(5, 6)], 2, 3);

    expect([...joined]).toEqual([4, 5]);
  });

  it("returns silence when the whole capture is before the window", () => {
    expect([...assembleChannel([chunk(1, 2)], 2, 10)]).toEqual([0, 0]);
  });
});

describe("levels", () => {
  it("measures the mean absolute sample", () => {
    expect(meanLevel(chunk(1, -1, 0, 0))).toBeCloseTo(0.5, 6);
  });

  it("calls an empty capture silent rather than dividing by zero", () => {
    expect(meanLevel(new Float32Array())).toBe(0);
    expect(isSilentCapture(new Float32Array())).toBe(true);
  });

  it("refuses a capture that recorded nothing", () => {
    // A muted input, a device that resolved anyway, or a player who stayed
    // silent: registering a silent instrument is worse than saying so.
    expect(isSilentCapture(new Float32Array(1000))).toBe(true);
    expect(isSilentCapture(Float32Array.from({ length: 1000 }, () => 0.0001))).toBe(true);
  });

  it("accepts a capture with anything in it", () => {
    expect(isSilentCapture(Float32Array.from({ length: 1000 }, () => 0.05))).toBe(false);
  });
});
