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
 * it. Moving between poses *moves* that hand, which is the whole reason it is
 * drawn once rather than eight times: a player watches the fingers that change.
 *
 * The hands are drawn as the camera view shows the player's own — mirrored, palm
 * out, left hand on the left — because that is the picture they are matching.
 * The engine behind them is `src/hand`.
 */
import { HandView, specFromShape } from "../hand";
import type { HandSide, Tilt } from "../hand";
import type { HandShape } from "../types";

export interface DiagramHand {
  readonly pose: HandShape;
  /** Which of the player's hands this is. */
  readonly hand: HandSide;
  /** What this hand's pose means, under the hand. */
  readonly caption: string;
  /** A lean to show with the pose, for a mapping that tilt is part of. Upright if absent. */
  readonly tilt?: Tilt;
  /** True for the hand not currently being edited, drawn back so it reads second. */
  readonly rest?: boolean;
}

export interface MappingDiagramOptions {
  readonly x: number;
  readonly y: number;
  /** A hand's length, wrist to fingertip, in pixels. */
  readonly size: number;
  readonly hands: readonly DiagramHand[];
  readonly colour: string;
  readonly alpha?: number;
}

/** How far below a hand's pivot its caption sits, past the wrist. */
const CAPTION_GAP = 0.72;

/** The gap between two hands, as a multiple of a hand's length. */
const HAND_GAP = 1.6;

/** The caption's type size, as a fraction of the hand's. */
const CAPTION_SIZE = 0.14;

/** How wide one hand is drawn, thumb out, as a multiple of its length. */
const HAND_WIDTH = 0.9;

/**
 * How wide a diagram is for a hand of a given size.
 *
 * Exported so a caller can size a diagram to the space it has: a diagram is only
 * worth drawing if it is large, and how large it can be is a fact about the
 * screen rather than about the drawing.
 */
export function diagramWidth(size: number, handCount = 2): number {
  return (handCount - 1) * size * HAND_GAP + size * HAND_WIDTH;
}

/** The largest a diagram can be and still fit a given width. */
export function diagramSizeFor(width: number, handCount = 2): number {
  return width / ((handCount - 1) * HAND_GAP + HAND_WIDTH);
}

/**
 * Left hand first, as a mirror shows them.
 *
 * Stable otherwise, so two hands of the same side keep the order they were given.
 */
export function inMirrorOrder(hands: readonly DiagramHand[]): DiagramHand[] {
  return [...hands].sort((a, b) => Number(a.hand === "right") - Number(b.hand === "right"));
}

/** Whether the player has asked for less motion. Read once: it does not change mid-set. */
function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

/**
 * The diagram, kept between frames so its hands can move.
 *
 * One hand view per side of the body: the left hand is the same drawing whether
 * it is the one being edited or the one at rest, so its fingers carry on from
 * where they were rather than jumping when the editor switches hands.
 */
export class MappingDiagram {
  private readonly views = new Map<string, HandView>();
  private readonly instant = prefersReducedMotion();

  /**
   * Draws the hands and their captions, centred on the point given.
   *
   * Centred rather than cornered because the caller does not know how wide two
   * hands are — that is this module's business — and a diagram that has to be
   * positioned twice is a diagram that ends up off-centre once.
   *
   * @param now - The frame's time in milliseconds, which the hands move by.
   */
  draw(ctx: CanvasRenderingContext2D | null, options: MappingDiagramOptions, now: number): void {
    if (!ctx || options.hands.length === 0) return;

    const { x, y, size, colour, alpha = 1 } = options;
    const hands = inMirrorOrder(options.hands);
    const step = size * HAND_GAP;
    const first = x - ((hands.length - 1) * step) / 2;

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `${Math.round(size * CAPTION_SIZE)}px monospace`;
    ctx.fillStyle = colour;

    hands.forEach((hand, index) => {
      const handX = first + index * step;
      const spec = specFromShape(hand.pose, { hand: hand.hand, facing: "palm", tilt: hand.tilt });
      const view = this.viewFor(hand, index, spec);

      view.setPose(spec);
      view.draw(
        ctx,
        {
          x: handX,
          y,
          size,
          colour,
          // A hand at rest sits back, so the one being edited is the one that reads.
          alpha: alpha * (hand.rest ? 0.3 : 1),
          fillAlpha: 0.12,
        },
        now,
      );

      ctx.globalAlpha = alpha * (hand.rest ? 0.5 : 1);
      ctx.fillText(hand.caption, handX, y + size * CAPTION_GAP);
    });

    ctx.restore();
  }

  private viewFor(
    hand: DiagramHand,
    index: number,
    spec: ReturnType<typeof specFromShape>,
  ): HandView {
    // Keyed by side, and by position as well for the rare diagram with two hands
    // of one side, so neither inherits the other's fingers.
    const key = `${hand.hand}:${index}`;
    let view = this.views.get(key);

    if (!view) {
      view = new HandView(spec, { instant: this.instant });
      this.views.set(key, view);
    }

    return view;
  }
}
