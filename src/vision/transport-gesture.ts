/**
 * The transport, by fist.
 *
 * The gesture menu is *deliberate*: close both hands, pick a menu, dwell on an
 * option. That is right for a setting and far too slow for a transport, which a
 * player reaches for mid-phrase. This is the fast path: close one hand and flick
 * it.
 *
 * A closed hand is the right modifier because it is already **silent** in both
 * modes — a closed chord hand chooses no chord, a closed voicing hand sounds
 * nothing — so holding one can never cost a note, and it cannot be mistaken for
 * playing. The direction of the flick is the command:
 *
 * ```
 *            ↑ Record
 *     ← Clear      → Play
 *            ↓ Stop
 * ```
 *
 * The reader is stateful because a flick is a *movement*, not a pose: it arms on
 * the close, ignores the closing motion itself, fires once per flick, and needs
 * the hand to open before it will fire again. It also reports the hand's **path**
 * and how far it has travelled, which is what the cue draws — a gesture with no
 * visible state is a gesture nobody trusts.
 */
import { TRANSPORT_GESTURE } from "../config/constants";
import type { CanvasPoint, Hand } from "../types";
import { getHandCenter, isHandClosed } from "./gestures";

/** What a flick can ask the looper to do. */
export type TransportCommand = "record" | "play" | "stop" | "clear";

export interface TransportGestureOptions {
  readonly armMs?: number;
  readonly flickMs?: number;
  readonly travel?: number;
}

export interface TransportGestureReading {
  /** The command this frame produced, or `null`. */
  readonly command: TransportCommand | null;
  /** True while a fist is held and waiting to flick — the cue reads this. */
  readonly ready: boolean;
  /** How long the fist has been waiting, for the cue's fade-in. */
  readonly readyForMs: number;
  /** Where the flick is measured from, in normalised frame coordinates. */
  readonly anchor: CanvasPoint | null;
  /** The fist's path since the anchor, oldest first, in normalised coordinates. */
  readonly trail: readonly CanvasPoint[];
  /**
   * The direction the fist is heading, once it is clear of the dead zone.
   *
   * Reported before the flick is long enough to fire, which is what lets the cue
   * say *this way* rather than only *that happened*.
   */
  readonly direction: TransportCommand | null;
  /** How far the fist has travelled toward the firing threshold, 0..1. */
  readonly progress: number;
}

/**
 * Which command a flick means.
 *
 * In **screen** terms: up is record, down is stop, right is play, left is clear.
 * The vertical pair is the one reached for most, so it gets the axis a hand
 * moves most naturally; the horizontal pair reads like a tape transport's
 * forward and back.
 */
export function commandForDirection(screenDx: number, screenDy: number): TransportCommand {
  if (Math.abs(screenDy) >= Math.abs(screenDx)) return screenDy < 0 ? "record" : "stop";

  return screenDx > 0 ? "play" : "clear";
}

/** Where the fist is in its cycle. */
type Phase = "idle" | "arming" | "ready" | "fired";

/** Points of path kept for the trail. At a frame apiece, about a quarter second. */
const TRAIL_LENGTH = 16;

/**
 * How much of the travel counts as a *direction* rather than noise.
 *
 * Below this the hand is still in its own dead zone and the cue shows no
 * preferred way out, so a hand that is merely unsteady does not flicker between
 * commands.
 */
const DIRECTION_DEAD_ZONE = 0.25;

/** The reading for a frame with nothing to say. */
function nothing(trail: readonly CanvasPoint[] = []): TransportGestureReading {
  return {
    command: null,
    ready: false,
    readyForMs: 0,
    anchor: null,
    trail,
    direction: null,
    progress: 0,
  };
}

export class TransportGesture {
  private phase: Phase = "idle";
  private anchor: CanvasPoint = { x: 0, y: 0 };
  private phaseSince = 0;
  private trail: CanvasPoint[] = [];

  private readonly armMs: number;
  private readonly flickMs: number;
  private readonly travel: number;

  constructor(options: TransportGestureOptions = {}) {
    this.armMs = options.armMs ?? TRANSPORT_GESTURE.armMs;
    this.flickMs = options.flickMs ?? TRANSPORT_GESTURE.flickMs;
    this.travel = options.travel ?? TRANSPORT_GESTURE.travel;
  }

  /** Forgets the gesture, e.g. when the camera restarts or the menu opens. */
  reset(): void {
    this.phase = "idle";
    this.phaseSince = 0;
    this.trail = [];
  }

  /**
   * Reads one frame.
   *
   * @param hand - The hand driving the transport, or `null` when there is none.
   * @param now - Monotonic timestamp in milliseconds.
   */
  update(hand: Hand | null, now: number): TransportGestureReading {
    if (!hand || !isHandClosed(hand)) {
      this.phase = "idle";
      this.trail = [];

      return nothing();
    }

    const center = getHandCenter(hand);

    if (this.phase === "idle") {
      // The motion of closing the hand moves the wrist, and that is not a flick.
      this.phase = "arming";
      this.phaseSince = now;
      this.anchor = center;
      this.trail = [center];

      return nothing(this.trail);
    }

    if (this.phase === "arming") {
      this.pushTrail(center);

      if (now - this.phaseSince < this.armMs) return nothing(this.trail);

      // Settled into the fist, so *here* is where a flick is measured from.
      this.phase = "ready";
      this.phaseSince = now;
      this.anchor = center;
      this.trail = [center];

      return this.waiting(0, this.trail, 0);
    }

    if (this.phase === "fired") {
      // One flick, one command: the hand has to open before it can fire again.
      return nothing();
    }

    this.pushTrail(center);

    const readyForMs = now - this.phaseSince;

    if (readyForMs > this.flickMs) {
      // Too slow to be a flick. Re-anchor where the hand has drifted to, so the
      // fist can stay closed and the player can try again.
      this.anchor = center;
      this.phaseSince = now;
      this.trail = [center];

      return this.waiting(0, this.trail, 0);
    }

    // The frame is drawn mirrored, so a flick to the player's own right is a
    // *falling* landmark x. Screen x is the mirror of it; y is not mirrored.
    const screenDx = this.anchor.x - center.x;
    const screenDy = center.y - this.anchor.y;
    const distance = Math.hypot(screenDx, screenDy);

    const progress = Math.min(1, distance / this.travel);
    const direction =
      distance > this.travel * DIRECTION_DEAD_ZONE ? commandForDirection(screenDx, screenDy) : null;

    if (distance < this.travel) {
      return this.waiting(readyForMs, this.trail, progress, direction);
    }

    this.phase = "fired";

    return {
      command: commandForDirection(screenDx, screenDy),
      ready: false,
      readyForMs: 0,
      anchor: this.anchor,
      trail: this.trail,
      direction,
      progress: 1,
    };
  }

  private waiting(
    readyForMs: number,
    trail: readonly CanvasPoint[],
    progress: number,
    direction: TransportCommand | null = null,
  ): TransportGestureReading {
    return {
      command: null,
      ready: true,
      readyForMs,
      anchor: this.anchor,
      trail,
      direction,
      progress,
    };
  }

  private pushTrail(point: CanvasPoint): void {
    const last = this.trail.at(-1);
    if (last && last.x === point.x && last.y === point.y) return;

    this.trail.push(point);
    if (this.trail.length > TRAIL_LENGTH) this.trail.shift();
  }
}
