import { describe, expect, it } from "vitest";
import { OPEN_HAND, shapeFromFingers } from "../music/gesture-map";
import { capsule, convexHull, handFigure, wound } from "./figure";
import type { FigureGroup, HandFigure, Shape } from "./figure";
import { resolvePose, specFromShape } from "./pose";
import type { HandPoseSpec } from "./pose";
import { poseHand } from "./skeleton";

const figure = (spec: HandPoseSpec): HandFigure => handFigure(poseHand(resolvePose(spec)));

const area = (shape: Shape): number => {
  let total = 0;
  for (let i = 0; i < shape.length; i += 1) {
    const [x0, y0] = shape[i];
    const [x1, y1] = shape[(i + 1) % shape.length];
    total += x0 * y1 - x1 * y0;
  }
  return total / 2;
};

const order = (hand: HandFigure): FigureGroup["id"][] => hand.groups.map((group) => group.id);
const before = (hand: HandFigure, a: FigureGroup["id"], b: FigureGroup["id"]): boolean =>
  order(hand).indexOf(a) < order(hand).indexOf(b);
const group = (hand: HandFigure, id: FigureGroup["id"]): FigureGroup =>
  hand.groups.find((candidate) => candidate.id === id)!;
const strongest = (details: FigureGroup["details"]): number =>
  Math.max(0, ...details.map((detail) => detail.alpha));

describe("handFigure", () => {
  it("draws a palm and five digits", () => {
    expect([...order(figure({}))].sort()).toEqual(
      ["index", "middle", "palm", "pinky", "ring", "thumb"].sort(),
    );
  });

  it("winds every shape the same way, mirrored or not, so a group's shapes join", () => {
    // Shapes wound against each other cut holes where they overlap: the outline of
    // the hole is then drawn, as a stray line inside the hand.
    for (const spec of [
      specFromShape(OPEN_HAND, { hand: "left" }),
      specFromShape(OPEN_HAND, { hand: "right", facing: "back" }),
      specFromShape(0, { hand: "right", facing: 0.5 }),
    ]) {
      for (const { shapes } of figure(spec).groups) {
        for (const shape of shapes) expect(area(shape)).toBeGreaterThan(0);
      }
    }
  });

  it("draws a folded finger over the palm when the palm faces the camera", () => {
    expect(before(figure({ facing: "palm" }), "palm", "index")).toBe(true);
  });

  it("hides a folded finger behind the hand when the back faces the camera", () => {
    expect(before(figure({ facing: "back" }), "index", "palm")).toBe(true);
  });

  it("hides a tucked thumb behind the hand from the back, though it is level with its knuckle", () => {
    // The bug this pins: measured against its own knuckle, a thumb tucked across
    // the palm looked level with the hand and was drawn over the back of it.
    const back = figure({ facing: "back", fingers: { index: "extended", middle: "extended" } });

    expect(before(back, "thumb", "palm")).toBe(true);
  });

  it("draws a straight finger over the palm from either side, so it can join it", () => {
    for (const facing of ["palm", "back"] as const) {
      expect(before(figure({ facing, fingers: { index: "extended" } }), "palm", "index")).toBe(
        true,
      );
    }
  });

  it("gives every digit a socket where it leaves the palm, and the palm none", () => {
    const hand = figure({});

    expect(group(hand, "palm").sockets).toHaveLength(0);
    for (const id of ["thumb", "index", "middle", "ring", "pinky"] as const) {
      expect(group(hand, id).sockets).toHaveLength(1);
    }
  });

  it("shows the palm's lines only with the palm to the camera", () => {
    expect(strongest(group(figure({ facing: "palm" }), "palm").details)).toBeGreaterThan(0.5);

    // The back has knuckles instead; its strongest line is one of those.
    const back = group(figure({ facing: "back" }), "palm");
    expect(back.details.slice(0, 4).every((detail) => detail.alpha === 0)).toBe(true);
  });

  it("shows nails only with the back to the camera", () => {
    const pointing = { fingers: { index: "extended" } } as const;
    const nail = (facing: "palm" | "back") => {
      const details = group(figure({ ...pointing, facing }), "index").details;
      return details.find((detail) => detail.closed)!;
    };

    expect(nail("back").alpha).toBeGreaterThan(0.9);
    expect(nail("palm").alpha).toBe(0);
  });

  it("bounds every outline it draws", () => {
    const hand = figure(specFromShape(shapeFromFingers({ thumb: true, index: true })));
    const { minX, minY, maxX, maxY } = hand.bounds;

    for (const { shapes } of hand.groups) {
      for (const shape of shapes) {
        for (const [x, y] of shape) {
          expect(x).toBeGreaterThanOrEqual(minX);
          expect(x).toBeLessThanOrEqual(maxX);
          expect(y).toBeGreaterThanOrEqual(minY);
          expect(y).toBeLessThanOrEqual(maxY);
        }
      }
    }
  });

  it("draws an extended finger above its folded self", () => {
    // Canvas y runs down, so higher on screen is smaller.
    const top = (spec: HandPoseSpec) =>
      Math.min(
        ...group(figure(spec), "index")
          .shapes.flat()
          .map(([, y]) => y),
      );

    expect(top({ fingers: { index: "extended" } })).toBeLessThan(top({}) - 4);
  });
});

describe("capsule", () => {
  it("is a circle when one end is inside the other, as a finger pointed at the camera is", () => {
    const shape = capsule([0, 0], [0.1, 0], 1, 0.5);

    for (const [x, y] of shape) expect(Math.hypot(x, y)).toBeCloseTo(1, 6);
  });

  it("reaches each end's radius past its centre", () => {
    const shape = capsule([0, 0], [10, 0], 1, 2);
    const xs = shape.map(([x]) => x);

    expect(Math.min(...xs)).toBeCloseTo(-1, 2);
    expect(Math.max(...xs)).toBeCloseTo(12, 2);
  });
});

describe("convexHull", () => {
  it("drops the points inside", () => {
    const hull = convexHull([
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
      [2, 2],
    ]);

    expect(hull).toHaveLength(4);
    expect(hull).not.toContainEqual([2, 2]);
  });
});

describe("wound", () => {
  it("turns a shape round when it runs the other way", () => {
    const backwards: Shape = [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 0],
    ];

    expect(area(backwards)).toBeLessThan(0);
    expect(area(wound(backwards))).toBeGreaterThan(0);
  });
});
