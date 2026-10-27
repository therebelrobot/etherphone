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
import type { CanvasPoint, RadialSlot } from "../types";
import { layoutRadial, slotAt } from "./radial-menu";
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
  /** The choice that committed on this frame, if any. */
  readonly committed: string | null;
  /** True on the frame the menu opened, so the caller can silence the instrument. */
  readonly justOpened: boolean;
}

export class MenuController {
  private readonly engage: DwellStabilizer<boolean>;
  private readonly dwell: DwellStabilizer<string>;

  private isOpen = false;
  /** False until the engage gesture is released once, so it cannot re-fire. */
  private armed = true;
  private idleSince = 0;

  constructor(
    engageHoldMs: number = CONTROL.engageHoldMs,
    dwellMs: number = CONTROL.dwellMs,
    private readonly idleTimeoutMs: number = CONTROL.idleTimeoutMs,
  ) {
    this.engage = new DwellStabilizer<boolean>(engageHoldMs);
    this.dwell = new DwellStabilizer<string>(dwellMs);
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

    const centerX = input.canvasWidth / 2;
    const centerY = input.canvasHeight / 2;

    let justOpened = false;

    if (!this.isOpen) {
      const engaged = this.engage.update(input.bothClosed, now);

      if (!this.armed || !engaged) return this.closedUpdate(centerX, centerY);

      this.isOpen = true;
      this.armed = false;
      this.idleSince = now;
      this.dwell.reset();
      justOpened = true;
    }

    const slots = layoutRadial(input.options, centerX, centerY);
    const hovered = input.cursor ? slotAt(slots, input.cursor, centerX, centerY) : null;
    const hoveredId = hovered?.id ?? null;

    // Pointing at anything keeps the menu alive; only idling times it out.
    if (hovered) this.idleSince = now;

    const committed = this.dwell.update(hoveredId, now);
    if (committed !== null) {
      this.close();
      return { ...this.closedUpdate(centerX, centerY), committed };
    }

    if (now - this.idleSince > this.idleTimeoutMs) {
      this.close();
      return this.closedUpdate(centerX, centerY);
    }

    return {
      isOpen: true,
      slots,
      centerX,
      centerY,
      cursor: input.cursor,
      hoveredId,
      dwellProgress: hoveredId === null ? 0 : this.dwell.progress(now),
      committed: null,
      justOpened,
    };
  }

  /** Closes the menu, e.g. when the mode changes underneath it. */
  close(): void {
    this.isOpen = false;
    this.dwell.reset();
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
      committed: null,
      justOpened: false,
    };
  }
}
