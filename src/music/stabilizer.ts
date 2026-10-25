/**
 * Temporal stabilisation of hand readings.
 *
 * MediaPipe's per-frame output flickers. This smooths it in two directions:
 * a chord must be held briefly before it is committed, and a hand may vanish
 * briefly without the chord dropping out.
 */
import { CHORD_HOLD_TIME_MS, VIBE_NULL_WINDOW_MS } from "../config/constants";
import type { ChordState } from "../types";

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
 * Stateful per-session stabiliser. Construct one, then call {@link update} once
 * per frame with the raw reading and the current timestamp.
 */
export class ChordStabilizer {
  private stable: ChordState | null = null;
  private candidate: ChordState | null = null;
  private candidateSince = 0;
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
    let effectiveState = rawState;
    if (rawState === null && now - this.lastValidSeen < VIBE_NULL_WINDOW_MS) {
      effectiveState = this.candidate;
    }

    if (!sameChordState(effectiveState, this.candidate)) {
      this.candidate = effectiveState;
      this.candidateSince = now;
    }

    if (now - this.candidateSince >= CHORD_HOLD_TIME_MS) {
      this.stable = this.candidate;
    }

    return this.stable;
  }

  /** Forgets all history, e.g. when the camera is restarted. */
  reset(): void {
    this.stable = null;
    this.candidate = null;
    this.candidateSince = 0;
    this.lastValidSeen = 0;
  }
}
