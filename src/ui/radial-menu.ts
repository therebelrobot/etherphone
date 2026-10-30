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
import type { CanvasPoint, HandShape, RadialSlot } from "../types";
import { drawHandGlyph } from "./hand-glyph";

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
  /**
   * A hand to draw beside the label, for entries that *are* a hand shape.
   *
   * A pose described in words has to be held in working memory and compared to
   * the hand; a picture is checked against the hand directly. Only list rows draw
   * it, because a ring's slots have no room for anything but a short label.
   */
  readonly glyph?: { readonly pose: HandShape; readonly mirror?: boolean };
}

/** Everything one frame of one cluster needs to draw itself. */
export interface ClusterFrame {
  readonly layout: MenuLayout;
  /** The items, in order, so labels can be drawn. */
  readonly items: readonly MenuOption[];
  /** The item currently in force, drawn as active. */
  readonly activeId: string | null;
  /** Items placed around the anchor, when the layout is a ring. */
  readonly slots: readonly RadialSlot[];
  /** Items stacked down the canvas, when the layout is a list. */
  readonly rows: readonly ListRow[];
  readonly centerX: number;
  readonly centerY: number;
  /** Where the cursor is, or `null` when no hand is driving it. */
  readonly cursor: CanvasPoint | null;
  /** The id of the item being dwelt on, if any. */
  readonly hoveredId: string | null;
  /** How far the dwell has filled, 0..1. */
  readonly dwellProgress: number;
  /**
   * Whether this is the cluster the hand is driving.
   *
   * In single-handed mode one cluster waits its turn, and is drawn faded so it
   * is clear which one the hand is actually on.
   */
  readonly isActive: boolean;
  /** Milliseconds since the menu opened, which drives the fan-out. */
  readonly elapsedMs: number;
}

const GOLD = "#e8a13d";
/** The menus cluster's accent: cool, where the options are gold. */
const STEEL = "#7fa8c9";
const DIMMED = "rgba(10, 10, 10, 0.6)";
const OPTION_IDLE = "rgba(20, 20, 20, 0.75)";
const EDGE = "#3a3428";

/** The one thing a player cannot guess: how to leave without choosing. */
const DISMISS_HINT = "close both hands again to dismiss";

/**
 * How a cluster is drawn.
 *
 * The two clusters have to be tellable apart at a glance, because one is the
 * menu you are in and the other is the list of menus you could be in. Colour
 * alone is not enough on its own — it fails for colour-blind players and washes
 * out on a busy camera frame — so the menus cluster also gets a chevron and a
 * dashed outline. Three signals for the same idea: *this leads somewhere else*.
 */
export interface ClusterStyle {
  readonly accent: string;
  readonly hoverFill: string;
  /** Fill for the item currently in force, so you can see where you are. */
  readonly activeFill: string;
  /** Prefix labels with a chevron, marking them as ways into somewhere else. */
  readonly chevron: boolean;
  readonly dashed: boolean;
}

/** The menus cluster: a way into somewhere else. */
export const MENUS_STYLE: ClusterStyle = {
  accent: STEEL,
  hoverFill: "rgba(127, 168, 201, 0.20)",
  activeFill: "rgba(127, 168, 201, 0.34)",
  chevron: true,
  dashed: true,
};

/** The options cluster: the choices inside the menu you are in. */
export const OPTIONS_STYLE: ClusterStyle = {
  accent: GOLD,
  hoverFill: "rgba(232, 161, 61, 0.18)",
  activeFill: "rgba(232, 161, 61, 0.30)",
  chevron: false,
  dashed: false,
};

/** The label as drawn, with the chevron when the cluster leads elsewhere. */
function labelFor(item: MenuOption, style: ClusterStyle): string {
  return style.chevron ? `› ${item.label}` : item.label;
}

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

/**
 * Draws the dimming and the way out, once, behind both clusters.
 *
 * Separate from the clusters because they share it: drawing it per cluster would
 * dim the screen twice over.
 */
export function drawMenuBackdrop(ctx: CanvasRenderingContext2D | null, elapsedMs: number): void {
  if (!ctx) return;

  const fade = clamp01(elapsedMs / 200);

  ctx.save();

  ctx.globalAlpha = fade;
  ctx.fillStyle = DIMMED;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.globalAlpha = 1;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // There is no pointer to click away with, so the way to bail out has to be
  // said rather than discovered.
  ctx.globalAlpha = fade * 0.75;
  ctx.font = "13px monospace";
  ctx.fillStyle = GOLD;
  ctx.fillText(DISMISS_HINT, ctx.canvas.width / 2, 44);

  ctx.globalAlpha = fade;
  ctx.restore();
}

/** Draws one cluster, in whichever layout it is using. */
export function drawCluster(
  ctx: CanvasRenderingContext2D | null,
  frame: ClusterFrame,
  style: ClusterStyle,
): void {
  if (!ctx) return;

  // A cluster waiting its turn sits back, so the one the hand is on reads first.
  // Threaded through as a multiplier rather than set on the context, because
  // each item sets its own alpha and would otherwise overwrite it.
  const fade = frame.isActive ? 1 : 0.35;

  if (frame.layout === "list") {
    drawListCluster(ctx, frame, style, fade);
  } else {
    drawRingCluster(ctx, frame, style, fade);
  }
}

/** Draws a cluster laid out around its anchor. */
function drawRingCluster(
  ctx: CanvasRenderingContext2D,
  frame: ClusterFrame,
  style: ClusterStyle,
  fade: number,
): void {
  const { slots, items, activeId, centerX, centerY, cursor, hoveredId, dwellProgress, elapsedMs } =
    frame;

  ctx.save();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  slots.forEach((slot, index) => {
    const state = fanState(slot, index, elapsedMs, centerX, centerY);
    if (state.radius <= 0.5) return;

    const item = items[index];
    const isHovered = slot.id === hoveredId;
    const isActive = slot.id === activeId;

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
    ctx.globalAlpha = state.alpha * fade;
    ctx.fillStyle = isHovered ? style.hoverFill : isActive ? style.activeFill : OPTION_IDLE;
    ctx.fill();
    ctx.lineWidth = isHovered ? 3 : isActive ? 2 : 1;
    ctx.strokeStyle = isHovered || isActive ? style.accent : EDGE;
    ctx.setLineDash(style.dashed && !isHovered && !isActive ? [6, 6] : []);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // The label stays upright, and arrives with the option rather than before it.
    ctx.globalAlpha = state.alpha * fade;
    ctx.fillStyle = style.accent;
    ctx.font = "16px monospace";
    ctx.fillText(item ? labelFor(item, style) : slot.label, state.x, state.y);
    ctx.globalAlpha = fade;

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
      ctx.strokeStyle = style.accent;
      ctx.stroke();
    }
  });

  // A quiet mark where the cluster is centred, so the dead zone is visible.
  ctx.globalAlpha = clamp01(elapsedMs / 200) * fade;
  ctx.beginPath();
  ctx.arc(centerX, centerY, 3, 0, Math.PI * 2);
  ctx.fillStyle = EDGE;
  ctx.fill();

  if (cursor) {
    ctx.beginPath();
    ctx.arc(cursor.x, cursor.y, 12, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = style.accent;
    ctx.stroke();
  }

  ctx.globalAlpha = fade;
  ctx.restore();
}

/** Draws a cluster laid out as rows down the canvas. */
function drawListCluster(
  ctx: CanvasRenderingContext2D,
  frame: ClusterFrame,
  style: ClusterStyle,
  fade: number,
): void {
  const { rows, items, activeId, centerY, hoveredId, dwellProgress, elapsedMs } = frame;
  const { width } = ctx.canvas;
  const rowWidth = Math.min(CONTROL.listRowWidth, width * 0.8);

  ctx.save();

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "16px monospace";

  rows.forEach((row, index) => {
    const state = listRowState(row, index, elapsedMs, centerY);
    if (state.alpha <= 0.01) return;

    const item = items[index];
    const isHovered = row.id === hoveredId;
    const isActive = row.id === activeId;

    const left = (width - rowWidth) / 2;
    const top = state.y - state.height / 2 + 3;
    const barHeight = state.height - 6;

    ctx.globalAlpha = state.alpha * fade;

    ctx.beginPath();
    ctx.roundRect(left, top, rowWidth, barHeight, 6);
    ctx.fillStyle = isHovered ? style.hoverFill : isActive ? style.activeFill : OPTION_IDLE;
    ctx.fill();
    ctx.lineWidth = isHovered ? 2 : isActive ? 2 : 1;
    ctx.strokeStyle = isHovered || isActive ? style.accent : EDGE;
    ctx.setLineDash(style.dashed && !isHovered && !isActive ? [6, 6] : []);
    ctx.stroke();
    ctx.setLineDash([]);

    // The dwell fills the row from the left, so the commit is never a surprise.
    if (isHovered && dwellProgress > 0) {
      ctx.save();
      ctx.clip();
      ctx.globalAlpha = 0.35 * fade;
      ctx.fillStyle = style.accent;
      ctx.fillRect(left, top, rowWidth * dwellProgress, barHeight);
      ctx.restore();
    }

    ctx.fillStyle = style.accent;

    if (item?.glyph) {
      // The glyph takes the left of the row and the label follows it, so a column
      // of poses reads as a column of pictures with their names beside them.
      drawHandGlyph(ctx, {
        x: left + 40,
        y: state.y,
        size: 46,
        pose: item.glyph.pose,
        mirror: item.glyph.mirror ?? false,
        colour: style.accent,
        alpha: state.alpha * fade,
      });

      ctx.textAlign = "left";
      ctx.fillText(item ? labelFor(item, style) : row.label, left + 76, state.y);
      ctx.textAlign = "center";
    } else {
      ctx.fillText(item ? labelFor(item, style) : row.label, width / 2, state.y);
    }

    ctx.globalAlpha = fade;
  });

  ctx.globalAlpha = fade;
  ctx.restore();
}
