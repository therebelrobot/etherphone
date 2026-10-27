import { describe, expect, it } from "vitest";
import { computeCoverRect, landmarkToCanvas } from "./overlay";

describe("computeCoverRect", () => {
  it("crops the sides when the source is wider than the destination", () => {
    expect(computeCoverRect(640, 480, 1000, 1000)).toEqual({
      sx: 80,
      sy: 0,
      sWidth: 480,
      sHeight: 480,
    });
  });

  it("crops top and bottom when the source is taller than the destination", () => {
    expect(computeCoverRect(480, 640, 1000, 500)).toEqual({
      sx: 0,
      sy: 200,
      sWidth: 480,
      sHeight: 240,
    });
  });

  it("crops nothing when the ratios already match", () => {
    expect(computeCoverRect(640, 480, 1280, 960)).toEqual({
      sx: 0,
      sy: 0,
      sWidth: 640,
      sHeight: 480,
    });
  });
});

describe("landmarkToCanvas", () => {
  it("puts the middle of the frame at the middle of the canvas", () => {
    expect(landmarkToCanvas({ x: 0.5, y: 0.5 }, 640, 480, 1280, 960)).toEqual({ x: 640, y: 480 });
  });

  it("mirrors horizontally, the way the frame is drawn", () => {
    // The overlay draws inside a flipped transform, so a landmark on the left of
    // the video appears on the right of the screen. Getting this wrong puts the
    // menu cursor on the opposite side to the drawn hand.
    expect(landmarkToCanvas({ x: 0, y: 0.5 }, 640, 480, 1280, 960).x).toBeCloseTo(1280);
    expect(landmarkToCanvas({ x: 1, y: 0.5 }, 640, 480, 1280, 960).x).toBeCloseTo(0);
  });

  it("does not mirror vertically", () => {
    expect(landmarkToCanvas({ x: 0.5, y: 0 }, 640, 480, 1280, 960).y).toBeCloseTo(0);
    expect(landmarkToCanvas({ x: 0.5, y: 1 }, 640, 480, 1280, 960).y).toBeCloseTo(960);
  });

  it("accounts for the cover crop", () => {
    // With a 4:3 source in a square destination the sides are cropped away, so
    // the horizontal middle still lands in the middle.
    expect(landmarkToCanvas({ x: 0.5, y: 0.5 }, 640, 480, 1000, 1000)).toEqual({
      x: 500,
      y: 500,
    });
  });

  it("is the inverse of the mapping drawFrame uses, up to the mirror", () => {
    const srcW = 640;
    const srcH = 480;
    const dstW = 1000;
    const dstH = 700;
    const { sx, sy, sWidth, sHeight } = computeCoverRect(srcW, srcH, dstW, dstH);

    const point = { x: 0.31, y: 0.62 };
    const mapped = landmarkToCanvas(point, srcW, srcH, dstW, dstH);

    // What drawFrame computes for the same landmark, before the mirror.
    const drawnX = ((point.x * srcW - sx) / sWidth) * dstW;
    const drawnY = ((point.y * srcH - sy) / sHeight) * dstH;

    expect(mapped.x).toBeCloseTo(dstW - drawnX);
    expect(mapped.y).toBeCloseTo(drawnY);
  });
});
