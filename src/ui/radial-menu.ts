/**
 * The gesture menu: options laid out around a circle and chosen by dwelling.
 *
 * A radial layout rather than a list because the cursor is a hand, which is
 * coarse: picking a *direction* is forgiving in a way that hitting a row is not.
 * The dead zone in the middle gives the cursor somewhere neutral to retreat to,
 * so nothing is selected unless the hand is deliberately pushed out towards an
 * option.
 *
 * Drawing happens outside the mirrored transform that {@link drawFrame} uses, so
 * text reads the right way round. The cursor passed in must therefore already be
 * in screen coordinates — see `landmarkToCanvas`.
 */
import { CONTROL } from "../config/constants";
import type { CanvasPoint, RadialSlot } from "../types";

/** One thing the menu can choose. */
export interface MenuOption {
  readonly id: string;
  readonly label: string;
}

/** Everything one frame of the menu needs to draw itself. */
export interface MenuFrame {
  readonly slots: readonly RadialSlot[];
  readonly centerX: number;
  readonly centerY: number;
  /** Where the cursor is, or `null` when no hand is driving it. */
  readonly cursor: CanvasPoint | null;
  /** The id of the option being dwelt on, if any. */
  readonly hoveredId: string | null;
  /** How far the dwell has filled, 0..1. */
  readonly dwellProgress: number;
  /** Milliseconds since the menu opened, which drives the fan-out. */
  readonly elapsedMs: number;
}

const GOLD = "#e8a13d";
const DIMMED = "rgba(10, 10, 10, 0.6)";
const OPTION_IDLE = "rgba(20, 20, 20, 0.75)";
const OPTION_HOVER = "rgba(232, 161, 61, 0.18)";
const EDGE = "#3a3428";

/**
 * Places options evenly around a circle, starting at the top and going clockwise.
 *
 * Top-first because a cursor pushed "up" is the easiest direction to hold.
 */
export function layoutRadial(
  options: readonly MenuOption[],
  centerX: number,
  centerY: number,
  radius: number = CONTROL.radius,
): RadialSlot[] {
  return options.map((option, index) => {
    const angle = -Math.PI / 2 + (index * 2 * Math.PI) / options.length;

    return {
      id: option.id,
      label: option.label,
      angle,
      x: centerX + Math.cos(angle) * radius,
      y: centerY + Math.sin(angle) * radius,
    };
  });
}

/** The signed angle between two directions, normalised to -PI..PI. */
function angleBetween(a: number, b: number): number {
  let difference = (a - b) % (2 * Math.PI);

  if (difference > Math.PI) difference -= 2 * Math.PI;
  if (difference < -Math.PI) difference += 2 * Math.PI;

  return difference;
}

/**
 * The option a cursor is over, or `null` inside the dead zone.
 *
 * Selection is by direction, not proximity, so a coarse hand does not have to
 * land on the option itself — pointing its way is enough.
 */
export function slotAt(
  slots: readonly RadialSlot[],
  cursor: CanvasPoint,
  centerX: number,
  centerY: number,
  deadZone: number = CONTROL.deadZone,
): RadialSlot | null {
  if (slots.length === 0) return null;

  const dx = cursor.x - centerX;
  const dy = cursor.y - centerY;

  if (Math.hypot(dx, dy) < deadZone) return null;

  const direction = Math.atan2(dy, dx);
  let best = slots[0];
  let bestDistance = Infinity;

  for (const slot of slots) {
    const distance = Math.abs(angleBetween(direction, slot.angle));
    if (distance < bestDistance) {
      bestDistance = distance;
      best = slot;
    }
  }

  return best;
}

/**
 * Keeps a whole menu on screen, given where it would like to be centred.
 *
 * The menu is anchored to a hand, and a hand near an edge would otherwise put
 * options off-screen — where they can still be selected by direction but cannot
 * be seen, which is worse than useless.
 */
export function fitAnchor(
  anchor: CanvasPoint,
  canvasWidth: number,
  canvasHeight: number,
): CanvasPoint {
  const margin = CONTROL.radius + CONTROL.optionRadius;

  return {
    x: clampAxis(anchor.x, canvasWidth, margin),
    y: clampAxis(anchor.y, canvasHeight, margin),
  };
}

/** Clamps one axis, centring instead when the canvas is smaller than the menu. */
function clampAxis(value: number, size: number, margin: number): number {
  if (size <= margin * 2) return size / 2;

  return Math.min(Math.max(value, margin), size - margin);
}

/** Clamps a number into 0..1. */
function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Decelerating ease, used for anything that should not overshoot. */
function easeOutCubic(t: number): number {
  const p = t - 1;
  return p * p * p + 1;
}

/**
 * Ease that carries past its target and settles back onto it.
 *
 * This is what makes the fan-out feel thrown rather than moved: each option
 * overshoots its resting spot by roughly a tenth and springs back.
 */
export function easeOutBack(t: number): number {
  const s = CONTROL.fanOvershoot;
  const p = t - 1;

  return 1 + (s + 1) * p * p * p + s * p * p;
}

/**
 * How far one option has travelled out of the anchor, 0..1.
 *
 * Each option starts a little later than the one before it, so the menu arrives
 * as a wave instead of all at once.
 */
export function fanProgress(index: number, elapsedMs: number): number {
  return clamp01((elapsedMs - index * CONTROL.fanStaggerMs) / CONTROL.fanOutMs);
}

/** Where an option sits, and how it is shaped, part-way through the fan-out. */
export interface FanState {
  readonly x: number;
  readonly y: number;
  readonly radius: number;
  /** How far the option is pulled along its own radius, as a fraction. */
  readonly stretch: number;
  readonly alpha: number;
}

/**
 * The animated position and shape of one option.
 *
 * The stretch peaks mid-flight and is gone on arrival, so an option reads as a
 * blob being pulled out of the anchor rather than a circle sliding along a line.
 */
export function fanState(
  slot: RadialSlot,
  index: number,
  elapsedMs: number,
  centerX: number,
  centerY: number,
): FanState {
  const progress = fanProgress(index, elapsedMs);
  const distance = CONTROL.radius * easeOutBack(progress);
  const scale = easeOutCubic(progress);

  return {
    x: centerX + Math.cos(slot.angle) * distance,
    y: centerY + Math.sin(slot.angle) * distance,
    radius: CONTROL.optionRadius * scale,
    stretch: Math.sin(Math.PI * progress) * 0.45,
    alpha: scale,
  };
}

/** Draws one frame of the menu over whatever is already on the canvas. */
export function drawRadialMenu(ctx: CanvasRenderingContext2D | null, frame: MenuFrame): void {
  if (!ctx) return;

  const { slots, centerX, centerY, cursor, hoveredId, dwellProgress, elapsedMs } = frame;

  ctx.save();

  // Push the instrument back so the options read clearly, fading in with the
  // menu rather than arriving ahead of what it is there to frame.
  ctx.globalAlpha = clamp01(elapsedMs / 200);
  ctx.fillStyle = DIMMED;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.globalAlpha = 1;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  slots.forEach((slot, index) => {
    const state = fanState(slot, index, elapsedMs, centerX, centerY);
    if (state.radius <= 0.5) return;

    const isHovered = slot.id === hoveredId;

    // Stretched along its own radius, which is the direction it is travelling.
    ctx.save();
    ctx.translate(state.x, state.y);
    ctx.rotate(slot.angle);

    ctx.beginPath();
    ctx.ellipse(
      0,
      0,
      state.radius * (1 + state.stretch),
      state.radius * (1 - state.stretch * 0.45),
      0,
      0,
      Math.PI * 2,
    );
    ctx.globalAlpha = state.alpha;
    ctx.fillStyle = isHovered ? OPTION_HOVER : OPTION_IDLE;
    ctx.fill();
    ctx.lineWidth = isHovered ? 3 : 1;
    ctx.strokeStyle = isHovered ? GOLD : EDGE;
    ctx.stroke();
    ctx.restore();

    // The label stays upright, and arrives with the option rather than before it.
    ctx.globalAlpha = state.alpha;
    ctx.fillStyle = GOLD;
    ctx.font = "16px monospace";
    ctx.fillText(slot.label, state.x, state.y);
    ctx.globalAlpha = 1;

    // The dwell ring: an arc that closes as the hold completes, so the commit
    // is never a surprise.
    if (isHovered && dwellProgress > 0) {
      ctx.beginPath();
      ctx.arc(
        state.x,
        state.y,
        state.radius + 8,
        -Math.PI / 2,
        -Math.PI / 2 + dwellProgress * Math.PI * 2,
      );
      ctx.lineWidth = 4;
      ctx.strokeStyle = GOLD;
      ctx.stroke();
    }
  });

  // A quiet mark where the menu is centred, so the dead zone is visible.
  ctx.globalAlpha = clamp01(elapsedMs / 200);
  ctx.beginPath();
  ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
  ctx.fillStyle = EDGE;
  ctx.fill();

  if (cursor) {
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, 12, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = GOLD;
    ctx.stroke();
  }

  ctx.globalAlpha = 1;
  ctx.restore();
}
