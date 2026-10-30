/**
 * Moves a hand from the pose it is in to the pose it is asked for.
 *
 * Every value of a {@link HandPose} is a number, so animating one is easing
 * numbers: each on a critically damped spring, which arrives without overshoot and
 * — unlike a fixed-length tween — takes a new target mid-flight without a jerk.
 * That matters here, because a cursor moving down a list of poses retargets the
 * hand every few frames.
 *
 * The digits run on slightly different springs, the index quickest and the little
 * finger slowest, so a hand closes the way a hand does rather than as one hinge.
 * The difference is small enough that a pose is never misread on the way.
 */
import { DIGITS, resolvePose } from "./pose";
import type { Digit, HandPose, HandPoseSpec } from "./pose";

/** How quickly a value closes on its target, in radians per second. */
const STIFFNESS = 17;

const DIGIT_PACE: Readonly<Record<Digit, number>> = {
  thumb: 1,
  index: 1.08,
  middle: 1,
  ring: 0.93,
  pinky: 0.88,
};

/** Turning the hand over is a bigger movement than folding a finger, and slower. */
const FACING_PACE = 0.7;

/**
 * Leaning the hand is a small movement of the wrist, and it goes with the fingers.
 *
 * Quicker than the fingers, not slower, because the instrument reads both at
 * once: a hand going from two fingers leaning out to one finger upright that
 * folds its finger before it straightens is, for a moment, one finger leaning
 * out — a different chord, and one held long enough to be heard. At this pace the
 * lean comes upright as the finger folds.
 */
const TILT_PACE = 1.7;

/** The longest step taken in one update: a stalled tab must not fling the hand. */
const MAX_STEP_SECONDS = 0.1;

/** Close enough to the target to stop. */
const SETTLED = 1e-3;

interface Spring {
  value: number;
  velocity: number;
  target: number;
  readonly pace: number;
}

/** One step of a critically damped spring, solved exactly for the step's length. */
function step(spring: Spring, seconds: number): void {
  const omega = STIFFNESS * spring.pace;
  const offset = spring.value - spring.target;
  const decay = Math.exp(-omega * seconds);
  const carry = (spring.velocity + omega * offset) * seconds;

  spring.value = spring.target + (offset + carry) * decay;
  spring.velocity = (spring.velocity - omega * carry) * decay;
}

const settled = (spring: Spring): boolean =>
  Math.abs(spring.value - spring.target) < SETTLED && Math.abs(spring.velocity) < SETTLED;

export interface HandAnimatorOptions {
  /**
   * Jump to each new pose instead of moving to it — for a player who has asked
   * for less motion, and for a screenshot, which wants the pose and not the way
   * there.
   */
  readonly instant?: boolean;
}

export class HandAnimator {
  private hand: HandPose["hand"];
  private readonly curl: Record<Digit, Spring>;
  private readonly facing: Spring;
  private readonly spread: Spring;
  private readonly tilt: Spring;
  private readonly roll: Spring;
  private readonly pitch: Spring;
  private lastTime: number | null = null;
  private instant: boolean;

  /** Starts *at* the pose given: a hand appearing for the first time does not animate in. */
  constructor(initial: HandPoseSpec | HandPose = {}, options: HandAnimatorOptions = {}) {
    const pose = isResolved(initial) ? initial : resolvePose(initial);
    const spring = (value: number, pace = 1): Spring => ({
      value,
      velocity: 0,
      target: value,
      pace,
    });

    this.hand = pose.hand;
    this.curl = Object.fromEntries(
      DIGITS.map((digit) => [digit, spring(pose.curl[digit], DIGIT_PACE[digit])]),
    ) as Record<Digit, Spring>;
    this.facing = spring(pose.facing, FACING_PACE);
    this.spread = spring(pose.spread);
    this.tilt = spring(pose.tilt, TILT_PACE);
    this.roll = spring(pose.roll, FACING_PACE);
    this.pitch = spring(pose.pitch, FACING_PACE);
    this.instant = options.instant ?? false;
  }

  /** Whether to jump to each new pose rather than move to it. */
  setInstant(instant: boolean): void {
    this.instant = instant;
  }

  /** Sets where the hand is going. Cheap to call every frame with the same pose. */
  setTarget(target: HandPoseSpec | HandPose): void {
    const pose = isResolved(target) ? target : resolvePose(target);

    // A hand cannot turn into the other hand, so changing which hand it is jumps:
    // easing a left hand into a right one would pass through a hand that is
    // neither.
    if (pose.hand !== this.hand) {
      this.hand = pose.hand;
      this.jumpTo(pose);
      return;
    }

    for (const digit of DIGITS) this.curl[digit].target = pose.curl[digit];
    this.facing.target = pose.facing;
    this.spread.target = pose.spread;
    this.tilt.target = pose.tilt;
    this.roll.target = pose.roll;
    this.pitch.target = pose.pitch;

    if (this.instant) this.jumpTo(pose);
  }

  /** Advances to `now`, in milliseconds, and returns the pose there. */
  update(now: number): HandPose {
    const seconds =
      this.lastTime === null
        ? 0
        : Math.min(MAX_STEP_SECONDS, Math.max(0, (now - this.lastTime) / 1000));
    this.lastTime = now;

    for (const spring of this.springs()) {
      if (settled(spring)) {
        spring.value = spring.target;
        spring.velocity = 0;
        continue;
      }
      step(spring, seconds);
    }

    return this.pose;
  }

  /** The pose as it stands, without advancing. */
  get pose(): HandPose {
    return {
      hand: this.hand,
      curl: Object.fromEntries(DIGITS.map((digit) => [digit, this.curl[digit].value])) as Record<
        Digit,
        number
      >,
      facing: this.facing.value,
      spread: this.spread.value,
      tilt: this.tilt.value,
      roll: this.roll.value,
      pitch: this.pitch.value,
    };
  }

  /** True once the hand has arrived, so a caller can stop redrawing it. */
  get isSettled(): boolean {
    return this.springs().every(settled);
  }

  private jumpTo(pose: HandPose): void {
    for (const digit of DIGITS) {
      this.curl[digit].target = pose.curl[digit];
    }
    this.facing.target = pose.facing;
    this.spread.target = pose.spread;
    this.tilt.target = pose.tilt;
    this.roll.target = pose.roll;
    this.pitch.target = pose.pitch;

    for (const spring of this.springs()) {
      spring.value = spring.target;
      spring.velocity = 0;
    }
  }

  private springs(): Spring[] {
    return [
      ...DIGITS.map((digit) => this.curl[digit]),
      this.facing,
      this.spread,
      this.tilt,
      this.roll,
      this.pitch,
    ];
  }
}

function isResolved(pose: HandPoseSpec | HandPose): pose is HandPose {
  return typeof (pose as HandPose).curl === "object";
}
