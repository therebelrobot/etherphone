/**
 * One run of the looping demo, a frame at a time.
 *
 * The score says where the hands should be; this moves them there the way the
 * drawing shows them — poses through the hand engine's animator, heights eased —
 * and hands the result to the {@link Performance}, which reads and records it.
 * The drawing and the tests both drive this, so what is tested is what is drawn.
 */
import { HandAnimator, sideOf } from "../hand";
import type { HandPose, HandPoseSpec, HandSide } from "../hand";
import type { Handedness } from "../types";
import { Performance } from "./performance";
import type { PerformanceReading, PerformedHand } from "./performance";
import { CUES, REST_HEIGHT, SAILOR, SAILOR_ACTIONS, scoreAt } from "./sailor";
import type { SailorAction, ScoreFrame } from "./sailor";
import type { DemoSound } from "./sound";

/**
 * How quickly a hand's height catches up with where the score puts it, in
 * seconds. Quick, because the pitch hand jumps between notes — a slow glide
 * would play every note in between on the way.
 */
const HEIGHT_EASE_SECONDS = 0.035;

/** A hand as drawn this frame: the performed hand, plus how present it is. */
export interface RunHand extends PerformedHand {
  readonly side: HandSide;
  readonly presence: number;
}

export interface RunStep {
  readonly beat: number;
  readonly score: ScoreFrame;
  readonly chord: RunHand;
  readonly kind: RunHand;
  readonly reading: PerformanceReading;
  /** The flicks that fired this frame. */
  readonly fired: readonly SailorAction[];
  /** True once the score has played through. */
  readonly finished: boolean;
}

export class SailorRun {
  readonly performance: Performance;
  private readonly sides: Record<"chord" | "kind", HandSide>;
  private readonly animators: Record<"chord" | "kind", HandAnimator>;
  private readonly heights = { chord: REST_HEIGHT, kind: REST_HEIGHT };
  private readonly presences = { chord: 1, kind: 1 };
  private lastSeconds: number | null = null;
  private lastBeat = -Infinity;

  constructor(
    chordHand: Handedness,
    sound: DemoSound | null,
    options: { readonly instant?: boolean } = {},
  ) {
    this.performance = new Performance(chordHand, sound, SAILOR);

    const chordSide = sideOf(chordHand);
    this.sides = { chord: chordSide, kind: chordSide === "left" ? "right" : "left" };

    const first = scoreAt(0);
    this.animators = {
      chord: new HandAnimator(this.withSide(first.chord.pose, "chord"), options),
      kind: new HandAnimator(this.withSide(first.kind.pose, "kind"), options),
    };
  }

  /** Steps to `seconds` into the run. */
  step(seconds: number): RunStep {
    const beat = (seconds * SAILOR.bpm) / 60;
    const score = scoreAt(beat);
    const dt = this.lastSeconds === null ? 0 : Math.max(0, seconds - this.lastSeconds);
    this.lastSeconds = seconds;

    // Flicks fire on their beat, once, however the frames happen to fall.
    const fired = SAILOR_ACTIONS.filter((action) => action.at > this.lastBeat && action.at <= beat);
    for (const action of fired) this.performance.act(action.command, action.mode, seconds);
    this.lastBeat = beat;

    const chord = this.move("chord", score.chord, dt, seconds);
    const kind = this.move("kind", score.kind, dt, seconds);
    const reading = this.performance.frame(seconds, score.mode, { chord, kind });

    return { beat, score, chord, kind, reading, fired, finished: beat >= CUES.end };
  }

  private move(
    which: "chord" | "kind",
    target: ScoreFrame["chord"],
    dt: number,
    seconds: number,
  ): RunHand {
    const animator = this.animators[which];
    animator.setTarget(this.withSide(target.pose, which));
    const pose: HandPose = animator.update(seconds * 1000);

    const ease = 1 - Math.exp(-dt / HEIGHT_EASE_SECONDS);
    this.heights[which] += (target.height - this.heights[which]) * ease;
    // Presence fades more gently: a hand dropping out of frame, not a note.
    this.presences[which] += (target.presence - this.presences[which]) * (1 - Math.exp(-dt / 0.2));

    const height = this.heights[which];

    return {
      side: this.sides[which],
      pose,
      height,
      presence: this.presences[which],
      // The camera sees a hand while its wrist is in the frame.
      inFrame: height < 1 && this.presences[which] > 0.5,
    };
  }

  private withSide(spec: HandPoseSpec, which: "chord" | "kind"): HandPoseSpec {
    return { ...spec, hand: this.sides[which] };
  }
}
