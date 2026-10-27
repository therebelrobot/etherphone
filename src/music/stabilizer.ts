/**
 * Holding a reading before acting on it.
 *
 * Two things in the instrument want the same rule: wait for a value to be steady
 * before committing to it. The chord path wants it so a flickering hand reading
 * does not become a flickering chord; the gesture menu wants it so a cursor
 * resting over an option commits only after a deliberate pause.
 *
 * `DwellStabilizer` is that rule, once. `ChordStabilizer` is it plus the
 * tolerance for MediaPipe dropping a hand for a frame.
 */
import { CHORD_HOLD_TIME_MS, VIBE_NULL_WINDOW_MS } from "../config/constants";
import type { ChordState } from "../types";

/**
 * Commits a value only once it has held steady for {@link holdMs}.
 *
 * The committed value is sticky: it survives a candidate changing and only
 * moves once the new candidate has itself held long enough.
 */
export class DwellStabilizer<T> {
  private committed: T | null = null;
  private candidate: T | null = null;
  private candidateSince = 0;

  /**
   * @param holdMs - How long a candidate must hold before it is committed.
   * @param isSame - Value equality. Defaults to identity, which is right for
   *   primitives; a caller that rebuilds its value every frame passes a
   *   structural comparison instead.
   */
  constructor(
    private readonly holdMs: number,
    private readonly isSame: (a: T | null, b: T | null) => boolean = Object.is,
  ) {}

  /**
   * The value being held, whether or not it has committed yet.
   *
   * Exposed so a caller can substitute it for a reading it wants to treat as
   * unchanged, which is how the chord path rides out a dropped hand.
   */
  get pending(): T | null {
    return this.candidate;
  }

  /** Folds one reading into the committed value. */
  update(value: T | null, now: number): T | null {
    if (!this.isSame(value, this.candidate)) {
      this.candidate = value;
      this.candidateSince = now;
    }

    if (now - this.candidateSince >= this.holdMs) {
      this.committed = this.candidate;
    }

    return this.committed;
  }

  /**
   * How far the pending value has held towards its commit, 0..1.
   *
   * Exposed so a caller can show the hold filling, which is what stops a
   * dwell-to-commit interaction from feeling like a surprise.
   */
  progress(now: number): number {
    return Math.min(1, (now - this.candidateSince) / this.holdMs);
  }

  /** Forgets all history. */
  reset(): void {
    this.committed = null;
    this.candidate = null;
    this.candidateSince = 0;
  }
}

/** Two readings that would produce identical audio and identical readouts. */
function sameChordState(a: ChordState | null, b: ChordState | null): boolean {
  if (a === null && b === null) return true;
  if (a === null || b === null) return false;

  return (
    a.chord === b.chord &&
    a.isMajorMode === b.isMajorMode &&
    a.qualityIndex === b.qualityIndex &&
    a.thumbDown === b.thumbDown
  );
}

/**
 * Temporal stabilisation of hand readings.
 *
 * MediaPipe's per-frame output flickers. This smooths it in two directions:
 * a chord must be held briefly before it is committed, and a hand may vanish
 * briefly without the chord dropping out.
 */
export class ChordStabilizer {
  private readonly dwell = new DwellStabilizer<ChordState>(CHORD_HOLD_TIME_MS, sameChordState);
  private lastValidSeen = 0;

  /**
   * Folds one raw reading into the committed state.
   *
   * @param rawState - The reading for this frame, or `null` when no chord hand
   *   was visible.
   * @param now - Monotonic timestamp in milliseconds.
   * @returns The committed state, which is sticky: it survives brief dropouts
   *   and only changes once a new reading has held for {@link CHORD_HOLD_TIME_MS}.
   */
  update(rawState: ChordState | null, now: number): ChordState | null {
    if (rawState !== null) {
      this.lastValidSeen = now;
    }

    // Ride out MediaPipe flicker by treating a just-dropped hand as unchanged.
    const effectiveState =
      rawState === null && now - this.lastValidSeen < VIBE_NULL_WINDOW_MS
        ? this.dwell.pending
        : rawState;

    return this.dwell.update(effectiveState, now);
  }

  /** Forgets all history, e.g. when the camera is restarted. */
  reset(): void {
    this.dwell.reset();
    this.lastValidSeen = 0;
  }
}
