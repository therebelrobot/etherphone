/**
 * A hand, drawn from a pose.
 *
 * The editor asks a player to choose a hand *shape*, and eight shapes described
 * in words — "two fingers", "two fingers and the thumb" — are read one at a time
 * and compared in working memory. A drawing is recognised instead: the point of a
 * diagram here is that a player checks the picture against their own hand without
 * holding anything in their head.
 *
 * The geometry is a pure function of the pose, separate from the drawing, for the
 * same reason `cueArrows` is: what can be asserted is the shape, not the pixels.
 * A test can say "every long finger is longer extended than folded" and "the thumb
 * changes side with the hand"; it cannot say whether the result looks like a hand.
 *
 * Drawn from the front, with the thumb on the side the mirror flag says — the
 * camera view is mirrored, so a player's right hand reads as the thumb being on
 * their left.
 */
import { FINGER_BITS } from "../music/gesture-map";
import type { FingerName, HandShape } from "../types";

/** A finger, thumb included: the glyph draws all five. */
export type GlyphFingerName = FingerName | "thumb";

/** One finger, in units of the glyph's size, measured from the palm's top centre. */
export interface GlyphStroke {
  readonly name: GlyphFingerName;
  /** Horizontal offset. Negative is towards the thumb. */
  readonly x: number;
  /** Where the finger starts, relative to the glyph's centre. */
  readonly y: number;
  /** How far it reaches, along its own angle. */
  readonly length: number;
  readonly width: number;
  /** Radians from straight up, so a finger's angle is the lean off vertical. */
  readonly angle: number;
}

export interface HandGlyph {
  readonly palm: { readonly width: number; readonly height: number; readonly radius: number };
  readonly fingers: readonly GlyphStroke[];
}

/** The four long fingers, in the order they sit across the palm. */
export const GLYPH_FINGERS: readonly FingerName[] = ["index", "middle", "ring", "pinky"];

/** How far a finger reaches when it is held up, and when it is folded in. */
const EXTENDED = 0.54;
const FOLDED = 0.13;

/**
 * The thumb leans out rather than reaching straight up, and reaches less far.
 *
 * It starts *inside* the palm's edge rather than beside it: a thumb drawn from
 * outside the palm is a stroke floating next to a box, which is what the first
 * version looked like.
 */
const THUMB_ANGLE = 1.1;
const THUMB_EXTENDED = 0.26;
const THUMB_FOLDED = 0.1;

/**
 * The palm's outline, in glyph units like everything else.
 *
 * Units rather than pixels because the whole glyph scales with its size, and a
 * stroke measured in pixels would be the one part of the drawing that did not.
 */
const OUTLINE = 0.05;

/** The gap between neighbouring fingers, and the width of one. */
const SPREAD = 0.15;
const WIDTH = 0.1;

/**
 * The glyph for a pose.
 *
 * @param pose - The hand shape, as read from a real hand.
 * @param mirror - Draw it as the player's right hand. The camera view is mirrored,
 *   so a right hand is seen with its thumb on the left.
 */
export function handGlyph(pose: HandShape, mirror = false): HandGlyph {
  const side = mirror ? -1 : 1;

  const long = GLYPH_FINGERS.map((name, index) => {
    const extended = (pose & FINGER_BITS[name]) !== 0;

    return {
      name,
      // Index sits nearest the thumb, so the row is offset by its own centre.
      x: side * (-1.5 * SPREAD + index * SPREAD),
      y: -0.09,
      length: extended ? EXTENDED : FOLDED,
      width: WIDTH,
      angle: 0,
    };
  });

  const thumbExtended = (pose & FINGER_BITS.thumb) !== 0;

  const thumb: GlyphStroke = {
    name: "thumb",
    // The palm's half-width, so the joint is where the palm is.
    x: side * -0.3,
    y: 0.04,
    length: thumbExtended ? THUMB_EXTENDED : THUMB_FOLDED,
    width: WIDTH + 0.02,
    // Leaning outwards, which is the way a thumb reads as a thumb.
    angle: side * -THUMB_ANGLE,
  };

  return {
    palm: { width: 0.6, height: 0.44, radius: 0.17 },
    fingers: [...long, thumb],
  };
}

/**
 * The glyph's vertical extent in its own units.
 *
 * Exposed because a row has a height and a glyph does not: the first version drew
 * from the point it was given, so the fingers poked out of the top of every row.
 * The drawer uses this to centre the hand on the point instead.
 */
export function handGlyphBounds(glyph: HandGlyph): {
  readonly top: number;
  readonly bottom: number;
} {
  const palmTop = -0.09;

  let top = palmTop;
  let bottom = palmTop + glyph.palm.height;

  for (const finger of glyph.fingers) {
    const tipY = finger.y - Math.cos(finger.angle) * finger.length;

    top = Math.min(top, finger.y, tipY);
    bottom = Math.max(bottom, tipY);
  }

  return { top, bottom };
}

/** Everything the drawer needs to put a glyph on a canvas. */
export interface HandGlyphDrawOptions {
  readonly x: number;
  readonly y: number;
  /** The glyph's scale: a size of 1 draws a hand about one unit tall. */
  readonly size: number;
  readonly pose: HandShape;
  readonly mirror?: boolean;
  readonly colour: string;
  readonly alpha?: number;
}

/**
 * Draws a glyph.
 *
 * Separate from {@link handGlyph} so the geometry can be tested without a canvas,
 * and so this can be the only part that knows about stroke caps and rounded
 * rectangles.
 */
export function drawHandGlyph(
  ctx: CanvasRenderingContext2D | null,
  options: HandGlyphDrawOptions,
): void {
  if (!ctx) return;

  const { x, y, size, pose, mirror = false, colour, alpha = 1 } = options;
  const glyph = handGlyph(pose, mirror);

  const { top, bottom } = handGlyphBounds(glyph);

  ctx.save();
  ctx.translate(x, y);
  // The point given is the hand's centre, not its wrist: a caller places a glyph
  // in a row, and a row is measured from its middle.
  ctx.translate(0, -(top + bottom) / 2);
  ctx.scale(size, size);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = colour;
  ctx.fillStyle = colour;
  ctx.lineWidth = OUTLINE;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.roundRect(
    -glyph.palm.width / 2,
    -0.09,
    glyph.palm.width,
    glyph.palm.height,
    glyph.palm.radius,
  );
  ctx.globalAlpha = alpha * 0.22;
  ctx.fill();
  ctx.globalAlpha = alpha;
  ctx.stroke();

  for (const finger of glyph.fingers) {
    const tipX = finger.x + Math.sin(finger.angle) * finger.length;
    const tipY = finger.y - Math.cos(finger.angle) * finger.length;

    ctx.beginPath();
    ctx.moveTo(finger.x, finger.y);
    ctx.lineTo(tipX, tipY);
    // In glyph units, *not* divided by the size: the context is already scaled, so
    // dividing here drew fingers a tenth of a pixel wide — invisible ink, which
    // looks exactly like no drawing at all.
    ctx.lineWidth = finger.width;
    ctx.stroke();
  }

  ctx.restore();
}
