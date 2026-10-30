import { describe, expect, it } from "vitest";
import { OPTIONS_STYLE } from "./radial-menu";
import { drawCluster } from "./radial-menu";
import type { ClusterFrame, MenuOption } from "./radial-menu";
import { layoutList } from "./radial-menu";

/**
 * A canvas that records what was asked of it.
 *
 * The menu's geometry is tested directly; this is the other half — that the
 * drawing *happens*. A glyph that is carried on an item but never drawn looks
 * identical to a glyph that was never added, from the player's side, and the two
 * are indistinguishable by any test of the data alone.
 */
function recordingContext() {
  const calls: string[] = [];
  const args: Record<string, unknown[][]> = {};
  const writes: Record<string, unknown[]> = {};

  const record =
    (name: string) =>
    (...values: unknown[]) => {
      calls.push(name);
      (args[name] ??= []).push(values);
    };

  const ctx = new Proxy(
    {},
    {
      get(_target, property: string) {
        // Properties the drawing sets rather than calls. Recorded as writes, so a
        // test can tell a style change from a stroke.
        if (property === "canvas") return { width: 1280, height: 900 };
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

const WIDTH = 1280;
const HEIGHT = 900;

function frame(items: readonly MenuOption[], hoveredId: string | null = null): ClusterFrame {
  const rows = layoutList(items, HEIGHT);

  return {
    layout: "list",
    items,
    activeId: null,
    slots: [],
    rows,
    centerX: WIDTH / 2,
    centerY: HEIGHT / 2,
    cursor: null,
    hoveredId,
    dwellProgress: 0,
    isActive: true,
    elapsedMs: 10_000,
  };
}

const PLAIN: MenuOption[] = [{ id: "a", label: "A" }];

describe("drawCluster", () => {
  it("draws a row for every item", () => {
    const { ctx, calls } = recordingContext();
    drawCluster(ctx, frame(PLAIN), OPTIONS_STYLE);

    expect(calls.filter((name) => name === "fillText")).toHaveLength(1);
  });
});

describe("a list beside a ring", () => {
  it("moves to the half the ring is not in, so the two are not drawn on top of each other", () => {
    // The parseability bug: a ring is anchored to a hand and a list is a column
    // down the middle, so on a wide screen the ring's labels end up behind the
    // rows. Selection is unaffected either way, because a row is chosen by the
    // cursor's height.
    const ringOnTheLeft = recordingContext();
    drawCluster(ringOnTheLeft.ctx, frame(PLAIN), OPTIONS_STYLE, { x: 330, y: 600 });

    const ringOnTheRight = recordingContext();
    drawCluster(ringOnTheRight.ctx, frame(PLAIN), OPTIONS_STYLE, { x: WIDTH - 330, y: 600 });

    const [left] = ringOnTheLeft.args.roundRect[0];
    const [right] = ringOnTheRight.args.roundRect[0];

    expect(left as number).toBeGreaterThan(WIDTH / 2);
    expect(right as number).toBeLessThan(WIDTH / 2);
  });

  it("stays centred when there is no ring to avoid, which is every plain list", () => {
    const { ctx, args } = recordingContext();
    drawCluster(ctx, frame(PLAIN), OPTIONS_STYLE);

    const [left, , width] = args.roundRect[0];

    expect((left as number) + (width as number) / 2).toBeCloseTo(WIDTH / 2, 6);
  });
});
