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
 * the hand to open before it will fire again.
 */
import { TRANSPORT_GESTURE } from "../config/constants";
import type { Hand } from "../types";
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
  /** True while a fist is held and waiting to flick — the on-canvas cue reads this. */
  readonly ready: boolean;
  /** How long the fist has been waiting, for the cue's fade-in. */
  readonly readyForMs: number;
}

/** Where the fist is in its cycle. */
type Phase = "idle" | "arming" | "ready" | "fired";

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

export class TransportGesture {
  private phase: Phase = "idle";
  private anchor = { x: 0, y: 0 };
  private phaseSince = 0;

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
  }

  /**
   * Reads one frame.
   *
   * @param hand - The hand driving the transport, or `null` when there is none.
   *   The caller decides which hand that is; two closed hands belong to the menu.
   * @param now - Monotonic timestamp in milliseconds.
   */
  update(hand: Hand | null, now: number): TransportGestureReading {
    if (!hand || !isHandClosed(hand)) {
      this.phase = "idle";

      return { command: null, ready: false, readyForMs: 0 };
    }

    const center = getHandCenter(hand);

    if (this.phase === "idle") {
      // The motion of closing the hand moves the wrist, and that is not a flick.
      this.phase = "arming";
      this.phaseSince = now;
      this.anchor = center;

      return { command: null, ready: false, readyForMs: 0 };
    }

    if (this.phase === "arming") {
      if (now - this.phaseSince < this.armMs) return { command: null, ready: false, readyForMs: 0 };

      // Settled into the fist, so *here* is where a flick is measured from.
      this.phase = "ready";
      this.phaseSince = now;
      this.anchor = center;

      return { command: null, ready: true, readyForMs: 0 };
    }

    if (this.phase === "fired") {
      // One flick, one command: the hand has to open before it can fire again.
      return { command: null, ready: false, readyForMs: 0 };
    }

    const readyForMs = now - this.phaseSince;

    if (readyForMs > this.flickMs) {
      // Too slow to be a flick. Re-anchor where the hand has drifted to, so the
      // fist can stay closed and the player can try again.
      this.anchor = center;
      this.phaseSince = now;

      return { command: null, ready: true, readyForMs: 0 };
    }

    // The frame is drawn mirrored, so a flick to the player's own right is a
    // *falling* landmark x. Screen x is the mirror of it; y is not mirrored.
    const screenDx = this.anchor.x - center.x;
    const screenDy = center.y - this.anchor.y;

    if (Math.hypot(screenDx, screenDy) < this.travel) {
      return { command: null, ready: true, readyForMs };
    }

    this.phase = "fired";

    return { command: commandForDirection(screenDx, screenDy), ready: false, readyForMs: 0 };
  }
}
