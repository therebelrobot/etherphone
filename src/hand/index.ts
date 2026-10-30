/**
 * The hand engine: a pose in, an animated line drawing of a hand out.
 *
 * The pipeline, each stage pure but the last:
 *
 *     HandPoseSpec ──resolvePose──▶ HandPose ──poseHand──▶ PosedHand ──handFigure──▶ HandFigure ──HandRenderer──▶ canvas
 *                                      ▲
 *                               HandAnimator eases between poses
 *
 * {@link HandView} wires the stages together for the common case — one hand, kept
 * on screen, moved from pose to pose:
 *
 * ```ts
 * const hand = new HandView({ hand: "left", fingers: { index: "extended" } });
 * hand.setPose(specFromShape(shape, { hand: "left" }));
 * hand.draw(ctx, { x, y, size: 200, colour: "#e8a13d" }, performance.now());
 * ```
 *
 * The drawing is a mirror image by default, because that is what the instrument
 * shows a player: their left hand appears on the left, palm out, thumb inward.
 */
import { HandAnimator } from "./animator";
import type { HandAnimatorOptions } from "./animator";
import { handFigure } from "./figure";
import type { HandPose, HandPoseSpec } from "./pose";
import { HandRenderer } from "./render";
import type { HandDrawOptions, ScratchFactory } from "./render";
import { poseHand } from "./skeleton";

export { HandAnimator } from "./animator";
export type { HandAnimatorOptions } from "./animator";
export { handFigure } from "./figure";
export type { FigureDetail, FigureGroup, HandFigure, Shape } from "./figure";
export {
  DIGITS,
  TILT_LEAN,
  resolvePose,
  screenRoll,
  shapeOfPose,
  sideOf,
  specFromShape,
} from "./pose";
export type { Digit, DigitState, Facing, HandPose, HandPoseSpec, HandSide, Tilt } from "./pose";
export { HandRenderer, defaultLineWidth } from "./render";
export type { HandDrawOptions, ScratchFactory } from "./render";
export { HAND_LENGTH, handLandmarks, poseHand } from "./skeleton";
export type { PosedHand } from "./skeleton";

export interface HandViewOptions extends HandAnimatorOptions {
  /** Draw the hand as a mirror shows it. Defaults to true, as the instrument does. */
  readonly mirrored?: boolean;
  readonly createScratch?: ScratchFactory;
}

/** One hand on screen: tell it a pose, draw it each frame, and it moves there. */
export class HandView {
  private readonly animator: HandAnimator;
  private readonly renderer: HandRenderer;
  private readonly mirrored: boolean;

  constructor(initial: HandPoseSpec | HandPose = {}, options: HandViewOptions = {}) {
    this.animator = new HandAnimator(initial, options);
    this.renderer = new HandRenderer(options.createScratch);
    this.mirrored = options.mirrored ?? true;
  }

  setPose(pose: HandPoseSpec | HandPose): void {
    this.animator.setTarget(pose);
  }

  setInstant(instant: boolean): void {
    this.animator.setInstant(instant);
  }

  /** True once the hand has stopped moving. */
  get isSettled(): boolean {
    return this.animator.isSettled;
  }

  /** Advances the animation to `now` (milliseconds) and draws the hand there. */
  draw(ctx: CanvasRenderingContext2D | null, options: HandDrawOptions, now: number): void {
    const pose = this.animator.update(now);
    this.renderer.draw(ctx, handFigure(poseHand(pose, this.mirrored)), options);
  }
}
