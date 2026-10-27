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

/** Draws one frame of the menu over whatever is already on the canvas. */
export function drawRadialMenu(ctx: CanvasRenderingContext2D | null, frame: MenuFrame): void {
  if (!ctx) return;

  const { slots, centerX, centerY, cursor, hoveredId, dwellProgress } = frame;

  ctx.save();

  // Push the instrument back so the options read clearly.
  ctx.fillStyle = DIMMED;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  for (const slot of slots) {
    const isHovered = slot.id === hoveredId;

    ctx.beginPath();
    ctx.arc(slot.x, slot.y, CONTROL.optionRadius, 0, Math.PI * 2);
    ctx.fillStyle = isHovered ? OPTION_HOVER : OPTION_IDLE;
    ctx.fill();
    ctx.lineWidth = isHovered ? 3 : 1;
    ctx.strokeStyle = isHovered ? GOLD : EDGE;
    ctx.stroke();

    ctx.fillStyle = GOLD;
    ctx.font = "16px monospace";
    ctx.fillText(slot.label, slot.x, slot.y);

    // The dwell ring: an arc that closes as the hold completes, so the commit
    // is never a surprise.
    if (isHovered && dwellProgress > 0) {
      ctx.beginPath();
      ctx.arc(
        slot.x,
        slot.y,
        CONTROL.optionRadius + 8,
        -Math.PI / 2,
        -Math.PI / 2 + dwellProgress * Math.PI * 2,
      );
      ctx.lineWidth = 4;
      ctx.strokeStyle = GOLD;
      ctx.stroke();
    }
  }

  // A quiet mark where the menu is centred, so the dead zone is visible.
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

  ctx.restore();
}
