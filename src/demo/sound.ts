/**
 * What a demonstration asks of the instrument's sound.
 *
 * The demos never make a sound themselves: they say what their hands are doing,
 * in the instrument's own terms, and the instrument sounds it through the same
 * calls it makes for a player's hands. That is what makes a demo sound like
 * copying it would — and a demo that is not being listened to simply has nothing
 * on the other end of this.
 */
import type { ChordState, TakeEvent } from "../types";

/** What the hands in frame are playing, as the instrument reads it. */
export type DemoPlay =
  | { readonly kind: "chord"; readonly state: ChordState | null }
  | { readonly kind: "mono"; readonly height: number | null };

/** The expression hand's contribution: its height's volume, its fingers, its thumb. */
export interface DemoExpression {
  readonly volume: number;
  /** Long fingers held up, which is vibrato in the mono voice. */
  readonly fingers: number;
  /** The thumb out, which drops the mono voice an octave. */
  readonly octaveDown: boolean;
}

export interface DemoSound {
  /** One frame of the hands, live: what the voice they are playing would be told. */
  live(play: DemoPlay, expression: DemoExpression): void;
  /** A loop event come due, for the demo's own layer of that track. */
  loop(trackId: string, event: TakeEvent, gain: number): void;
  /** Everything off: the demo is ending, restarting, or being switched away from. */
  silence(): void;
}
