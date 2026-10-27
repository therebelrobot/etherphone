/**
 * The cue that makes the transport-by-fist readable.
 *
 * A gesture vocabulary nobody can see is a gesture vocabulary nobody uses, and
 * one that gives no feedback is one nobody trusts. So the cue does three jobs in
 * one place — around the fist, where the eye already is:
 *
 * 1. **What the commands are**, as four labelled arrows, while the fist waits.
 * 2. **What you are doing**, as the path the fist has taken since it settled,
 *    plus a ring that closes as the flick approaches the threshold.
 * 3. **That it fired**, as a flash where the hand was, so the confirmation
 *    arrives at the hand rather than only in a readout across the screen.
 *
 * The ring closing is deliberately the same reading the gesture menu's dwell
 * already taught: hold steady until the ring completes. Here the "holding
 * steady" is travelling, but *the ring closes and it fires* is one idea.
 */
import type { CanvasPoint } from "../types";
import type { TransportCommand } from "../vision/transport-gesture";

/** Distance from the fist to each arrow, in canvas pixels. */
export const CUE_RADIUS = 62;
/** Radius of the ring that closes as the flick approaches the threshold. */
const RING_RADIUS = 21;
/** How far past the arrow its label sits. */
const LABEL_GAP = 22;
/** How long the cue takes to fade in, in milliseconds. */
const FADE_MS = 180;
/** How far along the travel the cue turns white-hot, saying "this will fire". */
const VALID_AT = 0.75;

const GOLD = "#e8a13d";
const GOLD_DIM = "rgba(232, 161, 61, 0.55)";
const HOT = "#fff3d6";
const BACKING = "rgba(10, 10, 10, 0.4)";

/** What each command is called on screen. */
export const COMMAND_LABELS: Record<TransportCommand, string> = {
  record: "RECORD",
  play: "PLAY",
  stop: "STOP",
  clear: "CLEAR",
};

export interface CueArrow {
  readonly command: TransportCommand;
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
    {
      command: "record",
      label: "Rec",
      angle: -Math.PI / 2,
      dx: 0,
      dy: -1,
      align: "center" as CanvasTextAlign,
    },
    {
      command: "play",
      label: "Play",
      angle: 0,
      dx: 1,
      dy: 0,
      align: "left" as CanvasTextAlign,
    },
    {
      command: "stop",
      label: "Stop",
      angle: Math.PI / 2,
      dx: 0,
      dy: 1,
      align: "center" as CanvasTextAlign,
    },
    {
      command: "clear",
      label: "Clear",
      angle: Math.PI,
      dx: -1,
      dy: 0,
      align: "right" as CanvasTextAlign,
    },
  ];

  return arrows.map((arrow) => ({
    command: arrow.command as TransportCommand,
    label: arrow.label,
    x: point.x + arrow.dx * radius,
    y: point.y + arrow.dy * radius,
    angle: arrow.angle,
    labelX: point.x + arrow.dx * (radius + LABEL_GAP),
    labelY: point.y + arrow.dy * (radius + LABEL_GAP),
    align: arrow.align,
  }));
}

/**
 * How hot the cue is running.
 *
 * Three bands rather than a smooth ramp, because what a player needs to see is
 * not a gradient but a *state change*: dim while the hand is only closed, gold
 * once a direction is running, white-hot once the flick is far enough to fire.
 */
export function heatColor(progress: number): string {
  if (progress <= 0) return GOLD_DIM;
  if (progress < VALID_AT) return GOLD;

  return HOT;
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

/** A small filled triangle, pointing along `angle`. */
function drawArrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  scale = 1,
): void {
  const size = 9 * scale;

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

/** The path the fist has taken since it settled. */
function drawTrail(
  ctx: CanvasRenderingContext2D,
  anchor: CanvasPoint,
  trail: readonly CanvasPoint[],
  colour: string,
  progress: number,
): void {
  const points = [anchor, ...trail];
  if (points.length < 2) return;

  ctx.save();
  ctx.strokeStyle = colour;
  ctx.globalAlpha = 0.3 + progress * 0.55;
  ctx.lineWidth = 2 + progress * 3;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y);
  ctx.stroke();

  ctx.restore();
}

/** The ring that closes as the flick approaches the threshold. */
function drawProgressRing(
  ctx: CanvasRenderingContext2D,
  point: CanvasPoint,
  progress: number,
  colour: string,
): void {
  ctx.save();

  ctx.beginPath();
  ctx.arc(point.x, point.y, RING_RADIUS, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(232, 161, 61, 0.28)";
  ctx.lineWidth = 3;
  ctx.stroke();

  if (progress > 0) {
    ctx.beginPath();
    ctx.arc(point.x, point.y, RING_RADIUS, -Math.PI / 2, -Math.PI / 2 + progress * Math.PI * 2);
    ctx.strokeStyle = colour;
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.stroke();
  }

  ctx.restore();
}

export interface TransportCueFrame {
  /** The fist, in canvas coordinates. */
  readonly point: CanvasPoint;
  /** Where the flick is measured from, in canvas coordinates. */
  readonly anchor: CanvasPoint;
  /** The fist's path since the anchor, oldest first, in canvas coordinates. */
  readonly trail: readonly CanvasPoint[];
  /** The direction currently running, if any. */
  readonly direction: TransportCommand | null;
  /** How far the flick has travelled toward the threshold, 0..1. */
  readonly progress: number;
  /** How long the fist has been waiting, for the fade-in. */
  readonly readyForMs: number;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
}

/** Draws one frame of the cue. Call it only while a fist is being read. */
export function drawTransportCue(ctx: CanvasRenderingContext2D, frame: TransportCueFrame): void {
  const alpha = clamp(frame.readyForMs / FADE_MS, 0, 1);
  if (alpha <= 0) return;

  // Keep the whole cue on screen even when the fist is out at an edge, and draw
  // every part of it from the same clamped point so the ring stays on the arrows.
  const margin = CUE_RADIUS + LABEL_GAP + 26;
  const point = {
    x: clamp(frame.point.x, margin, frame.canvasWidth - margin),
    y: clamp(frame.point.y, margin, frame.canvasHeight - margin),
  };
  const heat = heatColor(frame.progress);

  ctx.save();
  ctx.globalAlpha = alpha;

  // Light, so it reads over a busy frame without looking like a panel.
  ctx.beginPath();
  ctx.arc(point.x, point.y, CUE_RADIUS + 22, 0, Math.PI * 2);
  ctx.fillStyle = BACKING;
  ctx.fill();

  drawTrail(ctx, frame.anchor, frame.trail, heat, frame.progress);

  ctx.beginPath();
  ctx.arc(frame.anchor.x, frame.anchor.y, 3, 0, Math.PI * 2);
  ctx.fillStyle = heat;
  ctx.globalAlpha = alpha * 0.7;
  ctx.fill();
  ctx.globalAlpha = alpha;

  drawProgressRing(ctx, point, frame.progress, heat);

  // Once a direction is running the other three step back, so there is no doubt
  // which one is about to fire. The labels go too — they have been read.
  const labelAlpha = Math.max(0, 1 - frame.progress * 1.8);

  for (const arrow of cueArrows(point)) {
    const isCandidate = frame.direction === arrow.command;
    const dimmed = frame.direction !== null && !isCandidate;

    ctx.globalAlpha = alpha * (dimmed ? 0.22 : 1);
    ctx.fillStyle = isCandidate ? heat : GOLD;
    drawArrow(ctx, arrow.x, arrow.y, arrow.angle, isCandidate ? 1 + frame.progress * 0.7 : 1);

    if (labelAlpha > 0) {
      ctx.globalAlpha = alpha * (dimmed ? 0.22 : 1) * labelAlpha;
      ctx.font = "11px monospace";
      ctx.textAlign = arrow.align;
      ctx.textBaseline = "middle";
      ctx.fillText(arrow.label, arrow.labelX, arrow.labelY);
    }
  }

  ctx.restore();
}

export interface TransportFlashFrame {
  readonly command: TransportCommand;
  /** Where the fist was when it fired, in canvas coordinates. */
  readonly point: CanvasPoint;
  readonly ageMs: number;
  readonly durationMs: number;
}

/**
 * The confirmation: a ring bursting out of the fist the flick came from, with
 * the command named. It is drawn after the cue, so it is visible even though the
 * cue itself has already stood down.
 */
export function drawTransportFlash(
  ctx: CanvasRenderingContext2D,
  frame: TransportFlashFrame,
): void {
  const t = clamp(frame.ageMs / frame.durationMs, 0, 1);
  const { point } = frame;

  ctx.save();
  ctx.globalAlpha = 1 - t;

  ctx.beginPath();
  ctx.arc(point.x, point.y, 24 + t * 54, 0, Math.PI * 2);
  ctx.strokeStyle = HOT;
  ctx.lineWidth = 1 + 3 * (1 - t);
  ctx.stroke();

  ctx.font = "bold 15px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = HOT;
  ctx.fillText(COMMAND_LABELS[frame.command], point.x, point.y);

  ctx.restore();
}
