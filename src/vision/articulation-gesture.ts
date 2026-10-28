/**
 * Re-articulation, by pushing the pitch hand forward.
 *
 * RFC #7 asks what the expression hand should carry once it stops picking
 * voicings, and names "articulation (legato vs retrigger)". The styles answer
 * retrigger between *degrees* — harp and staccato re-strike when the hand moves
 * from one note to the next — but none of them can re-strike a note you are
 * **already holding**. That is most of what articulation means to a lead player:
 * you hold a note and stab it again.
 *
 * Depth is the free axis. Height is pitch, tilt is the filter, the thumb is the
 * octave, the finger count is vibrato — but `z` is used nowhere in the
 * instrument, and unlike a vertical bounce it cannot collide with the note being
 * played.
 *
 * The thresholds are **relative to a slow baseline**, not absolute: where a hand
 * rests in `z` depends on the hand, the pose, and the distance from the camera,
 * so an absolute threshold would either never fire or fire constantly. The
 * baseline follows the resting depth and a *push* is measured against it.
 *
 * NOTE, and this is the honest part: the numbers below were chosen by reading
 * MediaPipe's `z` semantics, not by watching a hand. They are the one thing here
 * that needs hands in front of a camera, which is why they live in one block in
 * `constants.ts` and why the whole gesture can be switched off in Settings.
 */
import { ARTICULATION } from "../config/constants";

/**
 * The thresholds, as plain numbers rather than the constants' literal types.
 *
 * They are meant to be overridden — that is the whole point of them living in one
 * block — and a literal type would pin them to one value at compile time.
 */
export interface ArticulationOptions {
  readonly baselineAlpha: number;
  readonly pushDepth: number;
  readonly releaseDepth: number;
  readonly minIntervalMs: number;
}

export interface ArticulationReading {
  /** True on the frame the push crossed the threshold. */
  readonly fired: boolean;
  /** How far into the push the hand is, 0..1, for whatever draws it. */
  readonly progress: number;
}

export class ArticulationGesture {
  /** Where the hand has been resting, in depth. */
  private baseline: number | null = null;
  private armed = true;
  private lastFiredAt = -Infinity;

  constructor(private readonly options: ArticulationOptions = ARTICULATION) {}

  /**
   * Reads one frame. `null` means there is no pitch hand.
   *
   * Fires once per push: the hand has to come back out past the release
   * threshold before it can fire again, or a hand held forward would machine-gun
   * the note.
   */
  update(depth: number | null, now: number): ArticulationReading {
    if (depth === null) {
      this.forget();
      return { fired: false, progress: 0 };
    }

    // First frame of a hand: take its depth as the baseline, so opening a hand
    // into frame cannot read as a push.
    if (this.baseline === null) {
      this.baseline = depth;
      return { fired: false, progress: 0 };
    }

    // Measured against the baseline *before* it moves, so the reading is of where
    // the hand is relative to where it has been resting.
    const push = this.baseline - depth;
    const progress = Math.max(0, Math.min(1, push / this.options.pushDepth));

    // The baseline only follows the hand while it is *not* pushed. Letting it
    // catch up during a push would shrink the push under its own threshold and
    // let a held hand re-fire, which is a drum roll nobody asked for.
    if (push < this.options.releaseDepth) {
      this.baseline += (depth - this.baseline) * this.options.baselineAlpha;
      this.armed = true;
    }

    const settled = now - this.lastFiredAt >= this.options.minIntervalMs;

    if (this.armed && push >= this.options.pushDepth && settled) {
      this.armed = false;
      this.lastFiredAt = now;
      return { fired: true, progress: 1 };
    }

    return { fired: false, progress };
  }

  /** Forgets the baseline and re-arms, e.g. when the mode or hand changes. */
  reset(): void {
    this.forget();
    this.lastFiredAt = -Infinity;
  }

  private forget(): void {
    this.baseline = null;
    this.armed = true;
  }
}
