import { describe, expect, it } from "vitest";
import { handFigure } from "./figure";
import { resolvePose } from "./pose";
import { HandRenderer, defaultLineWidth } from "./render";
import type { ScratchFactory } from "./render";
import { poseHand } from "./skeleton";

/**
 * A canvas that records what was asked of it.
 *
 * The geometry is tested directly; this is the other half — that the drawing
 * happens, at a width that can be seen, and lands where it was put.
 */
function recordingContext(width = 1280, height = 900) {
  const calls: string[] = [];
  const args: Record<string, unknown[][]> = {};
  const writes: Record<string, unknown[]> = {};

  const record =
    (name: string) =>
    (...values: unknown[]) => {
      calls.push(name);
      (args[name] ??= []).push(values);
      if (name === "createLinearGradient") return { addColorStop: () => undefined };
      if (name === "getTransform") return { a: 1, b: 0 };
      return undefined;
    };

  const ctx = new Proxy(
    {},
    {
      get(_target, property: string) {
        if (property === "canvas") return { width, height };
        return record(property);
      },
      set(_target, property: string, value: unknown) {
        (writes[property] ??= []).push(value);
        return true;
      },
    },
  ) as unknown as CanvasRenderingContext2D;

  return { ctx, calls, args, writes };
}

function scratches() {
  const made: ReturnType<typeof recordingContext>[] = [];
  const factory: ScratchFactory = (width, height) => {
    const recording = recordingContext(width, height);
    made.push(recording);
    return { width, height, getContext: () => recording.ctx } as unknown as OffscreenCanvas;
  };
  return { made, factory };
}

const figure = handFigure(poseHand(resolvePose({ fingers: { index: "extended" } })));

describe("HandRenderer", () => {
  it("composites one finished drawing onto the target", () => {
    const target = recordingContext();
    const { factory } = scratches();

    new HandRenderer(factory).draw(target.ctx, figure, {
      x: 400,
      y: 300,
      size: 200,
      colour: "#fff",
    });

    expect(target.calls.filter((name) => name === "drawImage")).toHaveLength(1);
  });

  it("strokes every outline wide enough to be seen", () => {
    // The bug the old glyph shipped with: line widths in drawing units divided by
    // the size a second time, so fingers were a tenth of a pixel wide — invisible
    // ink, indistinguishable from no drawing by any test of the data alone.
    const { made, factory } = scratches();
    const size = 120;

    new HandRenderer(factory).draw(recordingContext().ctx, figure, {
      x: 0,
      y: 0,
      size,
      colour: "#fff",
    });

    const [lines] = made;
    // Scratch units are centimetres, scaled to pixels by the transform it sets.
    const [, , , , , , [scale]] = [0, 0, 0, 0, 0, 0, lines.args.setTransform.at(-1)!];
    const widths = lines.writes.lineWidth.map(Number);

    expect(widths.length).toBeGreaterThan(0);
    for (const width of widths) expect(width * Number(scale)).toBeGreaterThanOrEqual(0.5);
  });

  it("centres the drawing on the point it is given, by the hand's pivot", () => {
    const target = recordingContext();
    const { factory } = scratches();

    new HandRenderer(factory).draw(target.ctx, figure, {
      x: 500,
      y: 400,
      size: 200,
      colour: "#fff",
    });

    const [, , , , , left, top, width, height] = target.args.drawImage[0] as number[];
    expect(left).toBeLessThan(500);
    expect(left + width).toBeGreaterThan(500);
    expect(top).toBeLessThan(400);
    expect(top + height).toBeGreaterThan(400);
  });

  it("erases inside each group, which is what hides the lines behind it", () => {
    const { made, factory } = scratches();

    new HandRenderer(factory).draw(recordingContext().ctx, figure, {
      x: 0,
      y: 0,
      size: 200,
      colour: "#fff",
    });

    expect(made[0].writes.globalCompositeOperation).toContain("destination-out");
  });

  it("adds a fill only when one is asked for", () => {
    const plain = recordingContext();
    const filled = recordingContext();

    new HandRenderer(scratches().factory).draw(plain.ctx, figure, {
      x: 0,
      y: 0,
      size: 200,
      colour: "#fff",
    });
    new HandRenderer(scratches().factory).draw(filled.ctx, figure, {
      x: 0,
      y: 0,
      size: 200,
      colour: "#fff",
      fillAlpha: 0.2,
    });

    expect(plain.calls.filter((name) => name === "drawImage")).toHaveLength(1);
    expect(filled.calls.filter((name) => name === "drawImage")).toHaveLength(2);
  });

  it("keeps its scratch canvas between frames", () => {
    const { made, factory } = scratches();
    const renderer = new HandRenderer(factory);
    const options = { x: 0, y: 0, size: 200, colour: "#fff" };

    renderer.draw(recordingContext().ctx, figure, options);
    renderer.draw(recordingContext().ctx, figure, options);

    expect(made).toHaveLength(1);
  });

  it("does nothing without a context", () => {
    expect(() =>
      new HandRenderer(scratches().factory).draw(null, figure, {
        x: 0,
        y: 0,
        size: 200,
        colour: "#fff",
      }),
    ).not.toThrow();
  });
});

describe("defaultLineWidth", () => {
  it("is never thinner than a pixel and never cartoonishly heavy", () => {
    expect(defaultLineWidth(20)).toBeGreaterThanOrEqual(1);
    expect(defaultLineWidth(2000)).toBeLessThanOrEqual(4);
  });
});
