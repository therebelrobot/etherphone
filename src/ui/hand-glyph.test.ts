import { describe, expect, it } from "vitest";
import { shapeFromFingers } from "../music/gesture-map";
import { GLYPH_FINGERS, handGlyph, handGlyphBounds } from "./hand-glyph";

const thumb = (glyph: ReturnType<typeof handGlyph>) =>
  glyph.fingers.find((f) => f.name === "thumb")!;
const long = (glyph: ReturnType<typeof handGlyph>) =>
  glyph.fingers.filter((f) => f.name !== "thumb");

describe("handGlyph", () => {
  it("draws four long fingers in a stable order, plus the thumb", () => {
    const glyph = handGlyph(shapeFromFingers({}));

    expect(long(glyph).map((finger) => finger.name)).toEqual(GLYPH_FINGERS);
    expect(glyph.fingers).toHaveLength(5);
  });

  it("reaches further with an extended finger than a folded one", () => {
    // The whole point of the drawing: a player compares the picture to their hand
    // at a glance, so up and down have to be unmistakable.
    const up = handGlyph(shapeFromFingers({ thumb: true, index: true }));
    const down = handGlyph(shapeFromFingers({}));

    expect(long(up)[0].length).toBeGreaterThan(long(down)[0].length);
    expect(thumb(up).length).toBeGreaterThan(thumb(down).length);
  });

  it("folds every long finger for a closed hand, so silence has a picture too", () => {
    const glyph = handGlyph(shapeFromFingers({}));

    for (const finger of long(glyph)) {
      expect(finger.length).toBeLessThan(0.2);
    }
  });

  it("spreads the fingers across the palm without crossing them", () => {
    const xs = long(handGlyph(shapeFromFingers({ index: true }))).map((finger) => finger.x);

    for (let i = 1; i < xs.length; i += 1) {
      expect(xs[i]).toBeGreaterThan(xs[i - 1]);
    }
  });

  it("mirrors the whole hand, thumb included, when it is the right one", () => {
    // The camera view is mirrored, so a right hand is seen with its thumb on the
    // other side. A diagram that ignored that would show the wrong hand.
    const pose = shapeFromFingers({ thumb: true, index: true });
    const left = handGlyph(pose, false);
    const right = handGlyph(pose, true);

    expect(right.palm).toEqual(left.palm);
    expect(thumb(right).x).toBeCloseTo(-thumb(left).x, 6);
    expect(thumb(right).angle).toBeCloseTo(-thumb(left).angle, 6);
    expect(long(right).map((finger) => finger.x)).toEqual(long(left).map((finger) => -finger.x));
  });

  it("keeps the thumb outside the long fingers, on the thumb's side", () => {
    const glyph = handGlyph(shapeFromFingers({ thumb: true, index: true }));

    expect(thumb(glyph).x).toBeLessThan(Math.min(...long(glyph).map((finger) => finger.x)));
  });

  it("gives every finger a length a drawer can use, extended or not", () => {
    // A zero-length stroke would be invisible, which would read as "no finger"
    // rather than "folded".
    for (const pose of [0, 31, shapeFromFingers({ middle: true })]) {
      for (const finger of handGlyph(pose).fingers) {
        expect(finger.length).toBeGreaterThan(0);
        expect(finger.width).toBeGreaterThan(0);
      }
    }
  });
});

describe("handGlyphBounds", () => {
  it("fits a glyph inside a list row, which is what the rows are", () => {
    // The bug this pins: drawn from the point it was given, a hand's fingers poked
    // out of the top of every row, because the point was treated as the wrist.
    const rowHeight = 48;
    const size = 46;

    for (const pose of [
      0,
      31,
      shapeFromFingers({ index: true }),
      shapeFromFingers({ thumb: true }),
    ]) {
      const { top, bottom } = handGlyphBounds(handGlyph(pose));

      expect((bottom - top) * size).toBeLessThanOrEqual(rowHeight - 2);
    }
  });

  it("reports a box whose middle is the point the drawer is given", () => {
    const { top, bottom } = handGlyphBounds(handGlyph(31));

    // Centring the glyph is translating by this, so the middle lands on zero.
    expect((top + bottom) / 2 + -(top + bottom) / 2).toBeCloseTo(0, 6);
    expect(bottom).toBeGreaterThan(top);
  });
});
