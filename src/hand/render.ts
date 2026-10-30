/**
 * Ink: a hand figure onto a canvas.
 *
 * The drawing is lines only, over whatever is behind it — the camera, the menu's
 * backdrop — so hidden lines cannot be hidden by painting over them. Instead the
 * hand is drawn on a scratch canvas, group by group, back to front:
 *
 * 1. outline every shape in the group at twice the line width,
 * 2. clear the outline where the digit grows out of the palm (its socket),
 * 3. *erase* every shape's inside.
 *
 * Erasing the inside takes the inner half of the group's own outline with it —
 * which is why it is drawn twice as wide — and everything behind the group
 * besides. What survives is the group's silhouette, and the parts of earlier
 * groups it does not cover: hidden-line removal, with the inside left clear.
 *
 * The scratch canvas is then composited once, so the hand's alpha applies to the
 * drawing as a whole rather than stacking where lines cross.
 */
import type { FigureGroup, HandFigure, Shape } from "./figure";
import { capsule } from "./figure";
import { HAND_LENGTH } from "./skeleton";

type Scratch = HTMLCanvasElement | OffscreenCanvas;
type ScratchContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface HandDrawOptions {
  /** Where the hand's pivot lands, in the target's coordinates. */
  readonly x: number;
  readonly y: number;
  /** Wrist to middle fingertip, in the target's coordinates. */
  readonly size: number;
  readonly colour: string;
  readonly alpha?: number;
  /** The outline's width, in the target's coordinates. */
  readonly lineWidth?: number;
  /** A faint fill inside the outline, 0 for none. */
  readonly fillAlpha?: number;
  /**
   * Scratch pixels per target unit. Defaults to the target's own scale, so the
   * hand is drawn at the resolution it is shown at rather than blown up.
   */
  readonly pixelRatio?: number;
}

/** A canvas to draw on before compositing. Swappable, so tests need no DOM. */
export type ScratchFactory = (width: number, height: number) => Scratch;

export const defaultScratch: ScratchFactory = (width, height) => {
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(width, height);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

/**
 * The default outline width for a hand of a given size.
 *
 * Capped, because a line that keeps thickening with the hand stops reading as an
 * outline and starts reading as a cartoon.
 */
export const defaultLineWidth = (size: number): number =>
  Math.min(3.5, Math.max(1.25, size * 0.012));

function tracePath(ctx: ScratchContext, shapes: readonly Shape[]): void {
  ctx.beginPath();

  for (const shape of shapes) {
    if (shape.length === 0) continue;
    ctx.moveTo(shape[0][0], shape[0][1]);
    for (let i = 1; i < shape.length; i += 1) ctx.lineTo(shape[i][0], shape[i][1]);
    ctx.closePath();
  }
}

function drawGroup(ctx: ScratchContext, group: FigureGroup, line: number): void {
  tracePath(ctx, group.shapes);
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.lineWidth = line * 2;
  ctx.stroke();

  ctx.globalCompositeOperation = "destination-out";

  for (const socket of group.sockets) {
    ctx.save();
    tracePath(ctx, socket.within);
    ctx.clip();
    // Widened by the outline, so the cleared stretch takes the whole line with it.
    tracePath(ctx, [
      capsule(socket.from, socket.to, socket.radius + line * 1.2, socket.radius + line * 1.2),
    ]);
    ctx.fill();
    ctx.restore();
  }

  tracePath(ctx, group.shapes);
  ctx.fill();

  ctx.globalCompositeOperation = "source-over";

  for (const detail of group.details) {
    if (detail.alpha < 0.02 || detail.points.length < 2) continue;

    ctx.beginPath();
    ctx.moveTo(detail.points[0][0], detail.points[0][1]);
    for (let i = 1; i < detail.points.length; i += 1) {
      ctx.lineTo(detail.points[i][0], detail.points[i][1]);
    }
    if (detail.closed) ctx.closePath();

    ctx.globalAlpha = detail.alpha;
    ctx.lineWidth = line * detail.weight;
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
}

/** Fades the forearm stub out, so the hand ends at a wrist rather than a stump. */
function fadeForearm(ctx: ScratchContext, figure: HandFigure): void {
  const { from, to } = figure.fade;
  const gradient = ctx.createLinearGradient(from[0], from[1], to[0], to[1]);
  gradient.addColorStop(0, "rgba(0, 0, 0, 0)");
  gradient.addColorStop(1, "rgba(0, 0, 0, 1)");

  ctx.globalCompositeOperation = "destination-out";
  ctx.fillStyle = gradient;
  const { minX, minY, maxX, maxY } = figure.bounds;
  ctx.fillRect(minX - 2, minY - 2, maxX - minX + 4, maxY - minY + 4);
  ctx.globalCompositeOperation = "source-over";
}

/**
 * Draws hand figures, keeping its scratch canvases between frames.
 *
 * A class only for the scratch canvases: allocating two canvases per frame per
 * hand is the one cost here worth not paying sixty times a second.
 */
export class HandRenderer {
  private lines: Scratch | null = null;
  private fill: Scratch | null = null;

  constructor(private readonly createScratch: ScratchFactory = defaultScratch) {}

  draw(ctx: CanvasRenderingContext2D | null, figure: HandFigure, options: HandDrawOptions): void {
    if (!ctx) return;

    const { x, y, size, colour, alpha = 1, fillAlpha = 0 } = options;
    const lineWidth = options.lineWidth ?? defaultLineWidth(size);
    const ratio = options.pixelRatio ?? targetScale(ctx);

    const unit = size / HAND_LENGTH;
    const pixels = unit * ratio;
    const margin = lineWidth * 2 * ratio + 2;
    const { minX, minY, maxX, maxY } = figure.bounds;

    const width = Math.ceil((maxX - minX) * pixels + margin * 2);
    const height = Math.ceil((maxY - minY) * pixels + margin * 2);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;

    // Scratch units are the figure's centimetres; the line is converted to them.
    const line = lineWidth / unit;

    const prepare = (existing: Scratch | null): { scratch: Scratch; context: ScratchContext } => {
      const scratch =
        existing && existing.width >= width && existing.height >= height
          ? existing
          : this.createScratch(
              Math.max(width, existing?.width ?? 0),
              Math.max(height, existing?.height ?? 0),
            );
      const context = scratch.getContext("2d") as ScratchContext | null;
      if (!context) throw new Error("hand: no 2d context on the scratch canvas");

      context.setTransform(1, 0, 0, 1, 0, 0);
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = 1;
      context.clearRect(0, 0, scratch.width, scratch.height);
      context.setTransform(pixels, 0, 0, pixels, margin - minX * pixels, margin - minY * pixels);

      return { scratch, context };
    };

    const lines = prepare(this.lines);
    this.lines = lines.scratch;
    lines.context.strokeStyle = colour;
    lines.context.fillStyle = colour;
    lines.context.lineJoin = "round";
    lines.context.lineCap = "round";

    for (const group of figure.groups) drawGroup(lines.context, group, line);
    fadeForearm(lines.context, figure);

    // Where the scratch's top left lands on the target.
    const left = x + minX * unit - margin / ratio;
    const top = y + minY * unit - margin / ratio;

    ctx.save();

    if (fillAlpha > 0) {
      const fill = prepare(this.fill);
      this.fill = fill.scratch;
      fill.context.fillStyle = colour;
      tracePath(
        fill.context,
        figure.groups.flatMap((group) => group.shapes),
      );
      fill.context.fill();
      fadeForearm(fill.context, figure);

      ctx.globalAlpha = alpha * fillAlpha;
      ctx.drawImage(fill.scratch, 0, 0, width, height, left, top, width / ratio, height / ratio);
    }

    ctx.globalAlpha = alpha;
    ctx.drawImage(lines.scratch, 0, 0, width, height, left, top, width / ratio, height / ratio);
    ctx.restore();
  }
}

/** How many device pixels one unit of the target is, from its current transform. */
function targetScale(ctx: CanvasRenderingContext2D): number {
  if (typeof ctx.getTransform !== "function") return 1;

  const { a, b } = ctx.getTransform();
  const scale = Math.hypot(a, b);

  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}
