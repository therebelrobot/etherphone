/**
 * The mapping, drawn as hands.
 *
 * The editor's question is "which shape does what", and the answer is a *shape*.
 * Words for eight of them — "two fingers", "two fingers and the thumb" — have to
 * be held in working memory and compared against a hand one at a time, and a
 * picture per row is no better: at row size it is a smudge beside a label, read
 * at exactly the size of the words it was meant to replace.
 *
 * So the drawing is **large and singular**: both hands, at a size you can hold
 * your own hand up against, with the pose you are on drawn on the hand that owns
 * it. Moving between poses redraws that hand, which is the whole reason it is
 * drawn once rather than eight times.
 *
 * Pure geometry in `handGlyph`, drawing here, for the same reason as everywhere
 * else in this directory: what can be asserted is the shape, not the pixels.
 */
import type { HandShape } from "../types";
import { drawHandGlyph } from "./hand-glyph";

export interface DiagramHand {
  readonly pose: HandShape;
  /** Draw it as the player's right hand, which the mirrored camera view needs. */
  readonly mirror: boolean;
  /** What this hand's pose means, under the hand. */
  readonly caption: string;
  /** True for the hand not currently being edited, drawn back so it reads second. */
  readonly rest?: boolean;
}

export interface MappingDiagramOptions {
  readonly x: number;
  readonly y: number;
  /** The height of a hand, in pixels. */
  readonly size: number;
  readonly hands: readonly DiagramHand[];
  readonly colour: string;
  readonly alpha?: number;
}

/** How far below a hand its caption sits. */
const CAPTION_GAP = 0.62;

/** The gap between two hands, as a multiple of a hand's height. */
const HAND_GAP = 1.6;

/** The caption's type size, as a fraction of the hand's. */
const CAPTION_SIZE = 0.14;

/**
 * How wide a diagram is for a hand of a given size.
 *
 * Exported so a caller can size a diagram to the space it has: a diagram is only
 * worth drawing if it is large, and how large it can be is a fact about the
 * screen rather than about the drawing.
 */
export function diagramWidth(size: number, handCount = 2): number {
  // A hand is a little wider than its height once the thumb is out, plus the gap
  // between them.
  return (handCount - 1) * size * HAND_GAP + size * 0.9;
}

/** The largest a diagram can be and still fit a given width. */
export function diagramSizeFor(width: number, handCount = 2): number {
  return width / ((handCount - 1) * HAND_GAP + 0.9);
}

/**
 * Draws the hands and their captions, centred on the point given.
 *
 * Centred rather than cornered because the caller does not know how wide two
 * hands are — that is this module's business — and a diagram that has to be
 * positioned twice is a diagram that ends up off-centre once.
 */
export function drawMappingDiagram(
  ctx: CanvasRenderingContext2D | null,
  options: MappingDiagramOptions,
): void {
  if (!ctx || options.hands.length === 0) return;

  const { x, y, size, hands, colour, alpha = 1 } = options;
  const step = size * HAND_GAP;
  const first = x - ((hands.length - 1) * step) / 2;

  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(size * CAPTION_SIZE)}px monospace`;
  ctx.fillStyle = colour;

  hands.forEach((hand, index) => {
    const handX = first + index * step;
    // A hand at rest sits back, so the one being edited is the one that reads.
    const handAlpha = alpha * (hand.rest ? 0.3 : 1);

    drawHandGlyph(ctx, {
      x: handX,
      y,
      size,
      pose: hand.pose,
      mirror: hand.mirror,
      colour,
      alpha: handAlpha,
    });

    ctx.globalAlpha = alpha * (hand.rest ? 0.5 : 1);
    ctx.fillText(hand.caption, handX, y + size * CAPTION_GAP);
  });

  ctx.restore();
}
