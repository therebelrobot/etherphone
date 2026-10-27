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
  /**
   * Leaves the menu open after committing, so the caller can swap the options
   * underneath it and the player can carry straight on.
   *
   * Used by the mode switch: the vocabulary the menu offers depends on the mode,
   * so switching has to re-render the ring rather than close it.
   */
  readonly keepsMenuOpen?: boolean;
}

/** Everything one frame of the menu needs to draw itself. */
export interface MenuFrame {
  readonly layout: MenuLayout;
  /** Options placed around the anchor, when the layout is a ring. */
  readonly slots: readonly RadialSlot[];
  /** Options stacked down the canvas, when the layout is a list. */
  readonly rows: readonly ListRow[];
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

/** The one thing a player cannot guess: how to leave without choosing. */
const DISMISS_HINT = "close both hands again to dismiss";

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
export function fanProgress(
  index: number,
  elapsedMs: number,
  staggerMs: number = CONTROL.fanStaggerMs,
): number {
  return clamp01((elapsedMs - index * staggerMs) / CONTROL.fanOutMs);
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

/** How a menu lays its options out. */
export type MenuLayout = "radial" | "list";

/** One row of a list menu, in canvas coordinates. */
export interface ListRow {
  readonly id: string;
  readonly label: string;
  /** Centre of the row. */
  readonly y: number;
  readonly height: number;
}

/**
 * Lays options out as rows down a tall vertical band, centred on the canvas.
 *
 * A ring stops working somewhere around eight options — twelve keys would need
 * more circumference than the circle has — and a list of names is easier to read
 * and to hit with a hand anyway: the height picks the row, so the choice is one
 * dimension rather than two.
 */
export function layoutList(options: readonly MenuOption[], canvasHeight: number): ListRow[] {
  if (options.length === 0) return [];

  const band = canvasHeight * (CONTROL.listBottomFraction - CONTROL.listTopFraction);
  const height = Math.min(CONTROL.listMaxRowHeight, band / options.length);
  const start = (canvasHeight - height * options.length) / 2;

  return options.map((option, index) => ({
    id: option.id,
    label: option.label,
    y: start + (index + 0.5) * height,
    height,
  }));
}

/**
 * The row a cursor is on, or `null` above or below the list.
 *
 * Only the height matters, deliberately: a hand does not have to be over the
 * label horizontally, which keeps a coarse cursor from having to aim twice.
 */
export function listRowAt(rows: readonly ListRow[], cursor: CanvasPoint): ListRow | null {
  for (const row of rows) {
    if (cursor.y >= row.y - row.height / 2 && cursor.y < row.y + row.height / 2) {
      return row;
    }
  }

  return null;
}

/** Where a list row sits part-way through the fan-out. */
export interface ListRowState {
  readonly y: number;
  readonly height: number;
  readonly alpha: number;
}

/**
 * The animated position of one row.
 *
 * Rows travel out of the middle of the list rather than the anchor, because the
 * anchor is where the hand is and a list is not built around a point.
 */
export function listRowState(
  row: ListRow,
  index: number,
  elapsedMs: number,
  centerY: number,
): ListRowState {
  const eased = easeOutCubic(fanProgress(index, elapsedMs, CONTROL.listStaggerMs));

  return {
    y: centerY + (row.y - centerY) * eased,
    height: row.height,
    alpha: eased,
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

  // How to get out. There is no pointer to click away with, so the way to bail
  // out has to be said rather than discovered.
  ctx.globalAlpha = clamp01(elapsedMs / 200) * 0.75;
  ctx.font = "13px monospace";
  ctx.fillStyle = GOLD;
  ctx.fillText(DISMISS_HINT, ctx.canvas.width / 2, 44);

  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Draws one frame of a list menu. */
export function drawListMenu(ctx: CanvasRenderingContext2D | null, frame: MenuFrame): void {
  if (!ctx) return;

  const { rows, centerY, hoveredId, dwellProgress, elapsedMs } = frame;
  const { width, height } = ctx.canvas;
  const rowWidth = Math.min(CONTROL.listRowWidth, width * 0.8);

  ctx.save();

  ctx.globalAlpha = clamp01(elapsedMs / 200);
  ctx.fillStyle = DIMMED;
  ctx.fillRect(0, 0, width, height);
  ctx.globalAlpha = 1;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "16px monospace";

  rows.forEach((row, index) => {
    const state = listRowState(row, index, elapsedMs, centerY);
    if (state.alpha <= 0.01) return;

    const isHovered = row.id === hoveredId;
    const left = (width - rowWidth) / 2;
    const top = state.y - state.height / 2 + 3;
    const barHeight = state.height - 6;

    ctx.globalAlpha = state.alpha;

    ctx.beginPath();
    ctx.roundRect(left, top, rowWidth, barHeight, 6);
    ctx.fillStyle = isHovered ? OPTION_HOVER : OPTION_IDLE;
    ctx.fill();
    ctx.lineWidth = isHovered ? 2 : 1;
    ctx.strokeStyle = isHovered ? GOLD : EDGE;
    ctx.stroke();

    // The dwell fills the row from the left, so the commit is never a surprise.
    if (isHovered && dwellProgress > 0) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = "rgba(232, 161, 61, 0.22)";
      ctx.fillRect(left, top, rowWidth * dwellProgress, barHeight);
      ctx.restore();
    }

    ctx.fillStyle = GOLD;
    ctx.fillText(row.label, width / 2, state.y);

    ctx.globalAlpha = 1;
  });

  ctx.globalAlpha = clamp01(elapsedMs / 200) * 0.75;
  ctx.font = "13px monospace";
  ctx.fillStyle = GOLD;
  ctx.fillText(DISMISS_HINT, width / 2, 44);

  ctx.globalAlpha = 1;
  ctx.restore();
}

/** Draws one frame of whichever layout the menu is using. */
export function drawMenu(ctx: CanvasRenderingContext2D | null, frame: MenuFrame): void {
  if (frame.layout === "list") {
    drawListMenu(ctx, frame);
    return;
  }

  drawRadialMenu(ctx, frame);
}
