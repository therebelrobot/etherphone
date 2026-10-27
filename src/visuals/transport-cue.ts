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

/**
 * The heat ramp the tracked path is painted with: cold ember at the anchor,
 * gold through the middle, white-hot at the fist.
 *
 * A *ramp* rather than the three bands above, because this one is read as a
 * shape rather than a state — the eye follows where the hand has come from and
 * how hot the far end is getting.
 */
const HEAT_RAMP: readonly (readonly [number, number, number])[] = [
  [122, 74, 18],
  [232, 161, 61],
  [255, 243, 214],
];

/** The ramp's colour at `t`, 0..1 from the anchor to the fist. */
export function heatRamp(t: number): string {
  const scaled = Math.min(1, Math.max(0, t)) * (HEAT_RAMP.length - 1);
  const index = Math.min(HEAT_RAMP.length - 2, Math.floor(scaled));
  const mix = scaled - index;

  const from = HEAT_RAMP[index];
  const to = HEAT_RAMP[index + 1];
  const rgb = from.map((channel, channelIndex) =>
    Math.round(channel + (to[channelIndex] - channel) * mix),
  );

  return `rgb(${rgb.join(", ")})`;
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

/** Width of the tracked path at its cold end and at the fist, in pixels. */
const TRAIL_COLD_WIDTH = 7;
const TRAIL_HOT_WIDTH = 24;

/** One segment of the path. */
function strokeSegment(ctx: CanvasRenderingContext2D, from: CanvasPoint, to: CanvasPoint): void {
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

/**
 * The path the fist has taken since it settled, painted as a heat trace.
 *
 * Drawn per segment rather than as one polyline, because each segment carries
 * its own width and colour: the path thickens and heats from the anchor to the
 * fist, and a wide additive pass under a narrow core makes the overlaps glow.
 * That is what turns a line into a *shape* — where the hand came from, and how
 * hard it is travelling now.
 */
function drawTrail(
  ctx: CanvasRenderingContext2D,
  anchor: CanvasPoint,
  trail: readonly CanvasPoint[],
  progress: number,
  fade: number,
): void {
  const points = [anchor, ...trail];
  if (points.length < 2) return;

  // The whole trace runs hotter as the flick approaches its threshold.
  const heat = 0.45 + progress * 0.55;
  const last = points.length - 1;

  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // The glow pass, blended additively so the overlaps build up.
  ctx.globalCompositeOperation = "lighter";
  ctx.globalAlpha = fade * (0.16 + progress * 0.18);

  for (let index = 1; index <= last; index += 1) {
    const along = index / last;
    ctx.strokeStyle = heatRamp(along * heat);
    ctx.lineWidth = trailWidth(along) * 2.1;
    strokeSegment(ctx, points[index - 1], points[index]);
  }

  // The core, opaque enough to stay legible over a busy camera frame.
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = fade * (0.6 + progress * 0.35);

  for (let index = 1; index <= last; index += 1) {
    const along = index / last;
    ctx.strokeStyle = heatRamp(along * heat);
    ctx.lineWidth = trailWidth(along);
    strokeSegment(ctx, points[index - 1], points[index]);
  }

  ctx.restore();
}

/** The path's width at `along`, 0 at the anchor and 1 at the fist. */
function trailWidth(along: number): number {
  return TRAIL_COLD_WIDTH + (TRAIL_HOT_WIDTH - TRAIL_COLD_WIDTH) * along;
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

  drawTrail(ctx, frame.anchor, frame.trail, frame.progress, alpha);

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
