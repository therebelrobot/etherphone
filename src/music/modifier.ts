/**
 * The modifier shape's arming.
 *
 * A map's modifier is a shape that *arms* a transposition instead of playing:
 * make it, then the next chord you make is shifted up a degree. Reaching the far
 * side of the scale means arming more than once, so "how many degrees" is state
 * that outlives the frame.
 *
 * Three rules, each of which the obvious implementation gets wrong:
 *
 * 1. **An arm is a visit, not a frame.** The chord hand holds one shape for as
 *    long as the chord lasts, so a hand resting in the modifier for a second is
 *    one arm — but counting frames would make it sixty. That would not merely be
 *    a large shift; because the numeral arithmetic wraps at seven, it would be an
 *    *arbitrary* one, decided by how long the player happened to hold still.
 * 2. **The shift is spent by a chord, not by a shape.** Leaving the modifier for a
 *    neutral hand and coming back is how a player arms twice, so the shapes in
 *    between must not spend the arming — otherwise "arming twice shifts twice"
 *    would be unreachable and the modifier could only ever give one degree.
 * 3. **A shift belongs to the shape it was spent on.** A hand holding one chord
 *    must not re-shift every frame; that is the same bug in the other direction.
 *    Changing chord spends the next arm, or returns to plain.
 *
 * So this class is the arming state machine, out of `app.ts` and testable: a
 * frame in, the shift for that frame out.
 */
import type { ChordNumeral, HandShape } from "../types";

/** One frame's reading of the chord hand against the map's modifier. */
export interface ModifierReading {
  /** True when this frame *is* the modifier, so nothing sounds. */
  readonly arming: boolean;
  /** How many degrees a chord read this frame should be moved by. */
  readonly shift: number;
  /** How many shifts are waiting for the next chord, for the readout. */
  readonly pending: number;
}

export class ModifierArmer {
  /** Shifts armed and not yet spent. */
  private pending = 0;
  /** The shift in force for the chord currently being held. */
  private shift = 0;
  /** The shape the shift in force was spent on. */
  private lastShape: HandShape | null = null;
  /** True while the hand is in the modifier, so a hold arms only once. */
  private inModifier = false;

  /** How many shifts are waiting, for the readout. */
  get armed(): number {
    return this.pending;
  }

  /**
   * Folds one frame in.
   *
   * @param shape - The chord hand's shape, or `null` when the hand is not visible.
   * @param numeral - What that shape plays, or `null` when it plays nothing. This
   *   is what tells a chord from the modifier and from a silent slot.
   * @param modifier - The map's modifier shape, or null/undefined when it has none.
   */
  read(
    shape: HandShape | null,
    numeral: ChordNumeral | null,
    modifier: HandShape | null | undefined,
  ): ModifierReading {
    // No hand: the next chord is a fresh decision, not a continuation. The arming
    // survives, because it is a promise about the *next* chord rather than about
    // the shape in hand — a dropout must not silently disarm it.
    if (shape === null) {
      this.inModifier = false;
      this.lastShape = null;
      this.shift = 0;

      return { arming: false, shift: 0, pending: this.pending };
    }

    if (modifier !== null && modifier !== undefined && shape === modifier) {
      // One arm per visit. The flag is what makes a held hand one arm instead of
      // one per frame; leaving the shape clears it, so re-entering arms again.
      if (!this.inModifier) this.pending += 1;

      this.inModifier = true;
      this.lastShape = null;

      return { arming: true, shift: 0, pending: this.pending };
    }

    this.inModifier = false;

    // A shape that plays nothing spends nothing. It is a rest between two arms,
    // not a chord, so the arming waits for the chord that follows.
    if (numeral === null) {
      this.lastShape = null;
      this.shift = 0;

      return { arming: false, shift: 0, pending: this.pending };
    }

    // Spent by the shape it was armed for, and only once: a hand holding one
    // chord must not re-shift on every frame.
    if (shape !== this.lastShape) {
      this.lastShape = shape;
      this.shift = this.pending;
      this.pending = 0;
    }

    return { arming: false, shift: this.shift, pending: this.pending };
  }

  /** Forgets everything, e.g. when the vocabulary or the hand changes. */
  reset(): void {
    this.pending = 0;
    this.shift = 0;
    this.lastShape = null;
    this.inModifier = false;
  }
}
