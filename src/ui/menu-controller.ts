/**
 * The gesture menu's state machine.
 *
 * Opening the menu and choosing from it are both deliberate, timed actions, so
 * the logic is worth keeping in one testable place rather than spread through
 * the render loop. The controller takes one frame of input — are the hands
 * closed, where is the cursor — and reports what to draw and what, if anything,
 * was chosen.
 *
 * Two rules make it safe to drive by accident:
 *
 * 1. The menu only opens when *both* hands have been closed for a while. Both
 *    closed is already a silent shape in either mode, so opening it can never
 *    cost a note.
 * 2. After the menu closes, the engage gesture has to be released before it can
 *    open again, so a player who is still holding their fists shut does not get
 *    a menu reopening underneath them.
 */
import { CONTROL } from "../config/constants";
import { DwellStabilizer } from "../music/stabilizer";
import type { CanvasPoint, InstrumentMode, RadialSlot } from "../types";
import { layoutRadial, slotAt, fitAnchor } from "./radial-menu";
import type { MenuOption } from "./radial-menu";

/** One frame of input from the hands and the canvas. */
export interface MenuInput {
  /** The options to offer, which depend on the instrument mode. */
  readonly options: readonly MenuOption[];
  /** Whether both hands are closed. */
  readonly bothClosed: boolean;
  /** The cursor in canvas coordinates, or `null` when no hand is driving it. */
  readonly cursor: CanvasPoint | null;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
}

/** What the caller needs to draw, and what it should do about it. */
export interface MenuUpdate {
  readonly isOpen: boolean;
  readonly slots: readonly RadialSlot[];
  readonly centerX: number;
  readonly centerY: number;
  readonly cursor: CanvasPoint | null;
  readonly hoveredId: string | null;
  /** How far the dwell on the hovered option has filled, 0..1. */
  readonly dwellProgress: number;
  /** Milliseconds since the menu opened, which drives the fan-out. */
  readonly elapsedMs: number;
  /** The choice that committed on this frame, if any. */
  readonly committed: string | null;
  /** True on the frame the menu opened, so the caller can silence the instrument. */
  readonly justOpened: boolean;
}

/** Timing and geometry, all defaulting to the values in `CONTROL`. */
export interface MenuControllerOptions {
  readonly engageHoldMs?: number;
  readonly dwellMs?: number;
  readonly idleTimeoutMs?: number;
  /** How far the cursor must travel before the menu responds to it, in pixels. */
  readonly moveThreshold?: number;
}

/**
 * The menu's options for a mode: the vocabulary it is currently using, plus a
 * switch to the other one.
 *
 * The vocabulary the menu offers depends on the mode, which on its own would
 * strand the gesture maps whenever the instrument was in mono mode — they would
 * be unreachable by gesture *and* their picker is hidden, so there would be no
 * way back to them at all. The switch rides along so the other set is always one
 * push away, and it keeps the menu open so the ring re-renders in place.
 */
export function menuOptionsFor(
  mode: InstrumentMode,
  vocabulary: readonly MenuOption[],
): MenuOption[] {
  const otherMode: InstrumentMode = mode === "mono" ? "chord" : "mono";

  return [
    ...vocabulary,
    { id: otherMode, label: otherMode === "mono" ? "Mono" : "Chords", keepsMenuOpen: true },
  ];
}

/** Whether a committed id is the mode switch rather than a vocabulary choice. */
export function isModeSwitch(id: string): id is InstrumentMode {
  return id === "chord" || id === "mono";
}

export class MenuController {
  private readonly idleTimeoutMs: number;
  private readonly moveThreshold: number;
  private readonly engage: DwellStabilizer<boolean>;
  private readonly dwell: DwellStabilizer<string>;

  private isOpen = false;
  /** False until the engage gesture is released once, so it cannot re-fire. */
  private armed = true;
  private idleSince = 0;

  /**
   * Where the menu is centred: the hand's position when it opened.
   *
   * Anchoring to the hand rather than to the middle of the screen is what makes
   * the menu reachable without travelling to it — the hand is already at the
   * centre, so it starts inside the dead zone and nothing is selected until the
   * player deliberately pushes out.
   */
  private anchor: CanvasPoint | null = null;
  /** Where the cursor was when the menu opened, to tell moving from resting. */
  private steerFrom: CanvasPoint | null = null;
  /** True once the cursor has travelled far enough to count as steering. */
  private steering = false;
  /** When the menu opened, so the fan-out can be animated from it. */
  private openedAt = 0;

  constructor(options: MenuControllerOptions = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? CONTROL.idleTimeoutMs;
    this.moveThreshold = options.moveThreshold ?? CONTROL.moveThreshold;

    this.engage = new DwellStabilizer<boolean>(options.engageHoldMs ?? CONTROL.engageHoldMs);
    this.dwell = new DwellStabilizer<string>(options.dwellMs ?? CONTROL.dwellMs);
  }

  /** Whether the menu currently owns the frame. */
  get open(): boolean {
    return this.isOpen;
  }

  /** Advances one frame. */
  update(input: MenuInput, now: number): MenuUpdate {
    if (!input.bothClosed) {
      // Releasing the gesture re-arms it, and clearing the hold means opening
      // the menu always costs a fresh, deliberate pause.
      this.armed = true;
      this.engage.reset();
    }

    let justOpened = false;
    const engaged = this.engage.update(input.bothClosed, now);

    if (this.armed && engaged) {
      // The engage gesture is a toggle. Closing both hands again is how a player
      // bails out, which they need: there is no pointer to click away with, and
      // waiting out the idle timeout to escape a menu you did not want is not an
      // answer.
      this.armed = false;
      this.engage.reset();

      if (this.isOpen) {
        this.close();
        return this.closedUpdate(input.canvasWidth / 2, input.canvasHeight / 2);
      }

      const wanted = input.cursor ?? { x: input.canvasWidth / 2, y: input.canvasHeight / 2 };

      this.isOpen = true;
      this.idleSince = now;
      this.openedAt = now;
      this.dwell.reset();
      this.anchor = fitAnchor(wanted, input.canvasWidth, input.canvasHeight);
      this.steerFrom = input.cursor;
      this.steering = false;
      justOpened = true;
    } else if (!this.isOpen) {
      return this.closedUpdate(input.canvasWidth / 2, input.canvasHeight / 2);
    }

    const anchor = this.anchor ?? { x: input.canvasWidth / 2, y: input.canvasHeight / 2 };

    this.trackSteering(input.cursor);

    const slots = layoutRadial(input.options, anchor.x, anchor.y);
    const hovered =
      this.steering && input.cursor ? slotAt(slots, input.cursor, anchor.x, anchor.y) : null;
    const hoveredId = hovered?.id ?? null;

    // Pointing at anything keeps the menu alive; only idling times it out.
    if (hovered) this.idleSince = now;

    const committed = this.dwell.update(hoveredId, now);
    let applied: string | null = null;
    let suppressHover = false;

    if (committed !== null) {
      const option = input.options.find((candidate) => candidate.id === committed);

      if (option?.keepsMenuOpen) {
        // The caller swaps the options under us — the mode switch changes what
        // the menu offers — so stay open, and make the player move again before
        // the same option can commit a second time.
        applied = committed;
        suppressHover = true;
        this.dwell.reset();
        this.steering = false;
        this.steerFrom = input.cursor;
        this.idleSince = now;
      } else {
        this.close();
        return { ...this.closedUpdate(anchor.x, anchor.y), committed };
      }
    }

    if (now - this.idleSince > this.idleTimeoutMs) {
      this.close();
      return this.closedUpdate(anchor.x, anchor.y);
    }

    return {
      isOpen: true,
      slots,
      centerX: anchor.x,
      centerY: anchor.y,
      cursor: input.cursor,
      hoveredId: suppressHover ? null : hoveredId,
      dwellProgress: suppressHover || hoveredId === null ? 0 : this.dwell.progress(now),
      elapsedMs: now - this.openedAt,
      committed: applied,
      justOpened,
    };
  }

  /** Closes the menu, e.g. when the mode changes underneath it. */
  close(): void {
    this.isOpen = false;
    this.dwell.reset();
    this.steering = false;
    this.steerFrom = null;
    this.anchor = null;
  }

  /**
   * Notes whether the cursor has moved far enough to count as steering.
   *
   * The dead zone already covers the ordinary case, because the hand starts at
   * the centre of its own menu. This covers the one where the menu had to be
   * nudged back on screen, which leaves the hand sitting off-centre from the
   * start — and so, without this, already over an option.
   */
  private trackSteering(cursor: CanvasPoint | null): void {
    if (this.steering || !cursor) return;

    if (this.steerFrom === null) {
      this.steerFrom = cursor;
      return;
    }

    if (Math.hypot(cursor.x - this.steerFrom.x, cursor.y - this.steerFrom.y) > this.moveThreshold) {
      this.steering = true;
    }
  }

  private closedUpdate(centerX: number, centerY: number): MenuUpdate {
    return {
      isOpen: false,
      slots: [],
      centerX,
      centerY,
      cursor: null,
      hoveredId: null,
      dwellProgress: 0,
      elapsedMs: 0,
      committed: null,
      justOpened: false,
    };
  }
}
