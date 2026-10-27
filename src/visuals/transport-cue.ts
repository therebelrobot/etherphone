/**
 * The cue that makes the transport-by-fist discoverable.
 *
 * A gesture vocabulary nobody can see is a gesture vocabulary nobody uses. The
 * fist is already held, and the hand is where the eye is, so the commands are
 * drawn around it: four arrows, labelled, fading in as the fist settles. Read
 * it twice and it is learned; after that it is furniture.
 */
import type { CanvasPoint } from "../types";

/** Distance from the fist to each arrow, in canvas pixels. */
export const CUE_RADIUS = 62;
/** How far past the arrow its label sits. */
const LABEL_GAP = 22;
/** How long the cue takes to fade in, in milliseconds. */
const FADE_MS = 180;
const GOLD = "#e8a13d";
const BACKING = "rgba(10, 10, 10, 0.55)";

export interface CueArrow {
  readonly label: string;
  readonly x: number;
  readonly y: number;
  /** Where the arrow points, in radians. */
  readonly angle: number;
  readonly labelX: number;
  readonly labelY: number;
  readonly align: CanvasTextAlign;
}

/**
 * The four arrows of the cue, positioned around a point.
 *
 * The directions are the commands: up records, down stops, right plays, left
 * clears.
 */
export function cueArrows(point: CanvasPoint, radius = CUE_RADIUS): CueArrow[] {
  const arrows = [
    { label: "Rec", angle: -Math.PI / 2, dx: 0, dy: -1, align: "center" as CanvasTextAlign },
    { label: "Play", angle: 0, dx: 1, dy: 0, align: "left" as CanvasTextAlign },
    { label: "Stop", angle: Math.PI / 2, dx: 0, dy: 1, align: "center" as CanvasTextAlign },
    { label: "Clear", angle: Math.PI, dx: -1, dy: 0, align: "right" as CanvasTextAlign },
  ];

  return arrows.map((arrow) => ({
    label: arrow.label,
    x: point.x + arrow.dx * radius,
    y: point.y + arrow.dy * radius,
    angle: arrow.angle,
    labelX: point.x + arrow.dx * (radius + LABEL_GAP),
    labelY: point.y + arrow.dy * (radius + LABEL_GAP),
    align: arrow.align,
  }));
}

export interface TransportCueFrame {
  /** The fist's centre, in canvas coordinates. */
  readonly point: CanvasPoint;
  /** How long the fist has been waiting, for the fade-in. */
  readonly readyForMs: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
}

/** A small filled triangle, pointing along `angle`. */
function drawArrow(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number): void {
  const size = 9;

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(-size * 0.6, -size * 0.72);
  ctx.lineTo(-size * 0.6, size * 0.72);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Draws one frame of the cue. Call it only while the fist is waiting to flick. */
export function drawTransportCue(ctx: CanvasRenderingContext2D, frame: TransportCueFrame): void {
  const alpha = Math.min(1, Math.max(0, frame.readyForMs / FADE_MS));
  if (alpha <= 0) return;

  // Keep the whole cue on screen even when the fist is out at an edge.
  const margin = CUE_RADIUS + LABEL_GAP + 26;
  const point = {
    x: Math.min(Math.max(frame.point.x, margin), frame.canvasWidth - margin),
    y: Math.min(Math.max(frame.point.y, margin), frame.canvasHeight - margin),
  };

  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.beginPath();
  ctx.arc(point.x, point.y, CUE_RADIUS + 28, 0, Math.PI * 2);
  ctx.fillStyle = BACKING;
  ctx.fill();

  ctx.fillStyle = GOLD;
  ctx.font = "11px monospace";

  for (const arrow of cueArrows(point)) {
    drawArrow(ctx, arrow.x, arrow.y, arrow.angle);
    ctx.textAlign = arrow.align;
    ctx.textBaseline = "middle";
    ctx.fillText(arrow.label, arrow.labelX, arrow.labelY);
  }

  ctx.restore();
}
