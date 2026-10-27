/**
 * The gesture menu's state machine.
 *
 * The menu has two clusters, and each hand drives one: the **menus** cluster
 * says which menu you are in, and the **options** cluster is the choice inside
 * it. They are separate because they are different kinds of thing — one is a
 * value, the other is a door — and giving them to different hands makes that
 * structural rather than something you have to read off a label.
 *
 * Three rules make it safe to drive by accident:
 *
 * 1. The menu only opens when *both* hands have been closed for a while. Both
 *    closed is already a silent shape in either mode, so opening it can never
 *    cost a note.
 * 2. After the menu closes, the engage gesture has to be released before it can
 *    open again, so a player who is still holding their fists shut does not get
 *    a menu reopening underneath them.
 * 3. Each cluster is anchored to the hand that drives it, so that hand starts
 *    *inside* its own dead zone: nothing is selected, and no dwell begins, until
 *    the hand is deliberately pushed outwards.
 */
import { CONTROL } from "../config/constants";
import { DwellStabilizer } from "../music/stabilizer";
import type { CanvasPoint, InstrumentMode } from "../types";
import { fitAnchor, layoutList, layoutRadial, listRowAt, slotAt } from "./radial-menu";
import type { ClusterFrame, ListRow, MenuLayout, MenuOption } from "./radial-menu";

/** Which cluster a choice came from. */
export type MenuClusterName = "menus" | "options";

/** One cluster of items: how they are laid out, and what is in force. */
export interface MenuCluster {
  readonly layout: MenuLayout;
  readonly items: readonly MenuOption[];
  /** The item currently in force, drawn as active. */
  readonly activeId?: string;
}

/** One frame of input from the hands and the canvas. */
export interface MenuInput {
  /** The menus, driven by the left hand. */
  readonly menus: MenuCluster;
  /** The choices inside the current menu, driven by the right hand. */
  readonly options: MenuCluster;
  readonly bothClosed: boolean;
  /** The left hand's position, in canvas coordinates. */
  readonly menuCursor: CanvasPoint | null;
  /** The right hand's position, in canvas coordinates. */
  readonly optionCursor: CanvasPoint | null;
  readonly canvasWidth: number;
  readonly canvasHeight: number;
  /**
   * Whether one hand is driving both clusters in turn.
   *
   * With two hands both clusters are live at once. With one, the same hand picks
   * the menu and *then* the option, so only the cluster at the current stage is
   * read and the other is left showing where you came from.
   */
  readonly staged?: boolean;
}

/** What the caller needs to draw, and what it should do about it. */
export interface MenuUpdate {
  readonly isOpen: boolean;
  readonly menus: ClusterFrame;
  readonly options: ClusterFrame;
  /** The choice that committed on this frame, and which cluster it came from. */
  readonly committed: { readonly cluster: MenuClusterName; readonly id: string } | null;
  /** True on the frame the menu opened, so the caller can silence the instrument. */
  readonly justOpened: boolean;
  /** Milliseconds since the menu opened, which drives the fan-out. */
  readonly elapsedMs: number;
}

/** Timing and geometry, all defaulting to the values in `CONTROL`. */
export interface MenuControllerOptions {
  readonly engageHoldMs?: number;
  readonly dwellMs?: number;
  readonly idleTimeoutMs?: number;
  /** How far a cursor must travel before its cluster responds, in pixels. */
  readonly moveThreshold?: number;
}

/** A menu whose values are too many for a ring, so it opens as a list. */
export type MenuTopic = "vocabulary" | "key" | "instrument" | "layers" | "transport" | "settings";

/** The menus the left hand chooses between. */
export const MENU_TOPICS: readonly MenuOption[] = [
  { id: "vocabulary", label: "Vocabulary" },
  { id: "key", label: "Key" },
  { id: "instrument", label: "Instrument" },
  { id: "layers", label: "Layers" },
  { id: "transport", label: "Transport" },
  { id: "settings", label: "Settings" },
];

/** Whether a committed id selects a menu rather than a value. */
export function isMenuTopic(id: string): id is MenuTopic {
  return MENU_TOPICS.some((topic) => topic.id === id);
}

/** Whether a committed id is the instrument mode. */
export function isModeSwitch(id: string): id is InstrumentMode {
  return id === "chord" || id === "mono";
}

/**
 * One hand's grip on one cluster.
 *
 * Holds the anchor, the move gate, and the dwell for a single hand, so the two
 * clusters behave identically without the rules being written twice.
 */
class Pointer {
  private anchor: CanvasPoint | null = null;
  /** Where the cursor was when the menu opened, to tell moving from resting. */
  private steerFrom: CanvasPoint | null = null;
  /** True once the cursor has travelled far enough to count as steering. */
  private steering = false;
  private readonly dwell: DwellStabilizer<string>;

  constructor(
    dwellMs: number,
    private readonly moveThreshold: number,
  ) {
    this.dwell = new DwellStabilizer<string>(dwellMs);
  }

  /** Takes hold where the hand is, so it starts inside its own dead zone. */
  open(cursor: CanvasPoint | null, canvasWidth: number, canvasHeight: number): void {
    const wanted = cursor ?? { x: canvasWidth / 2, y: canvasHeight / 2 };

    this.anchor = fitAnchor(wanted, canvasWidth, canvasHeight);
    this.steerFrom = cursor;
    this.steering = false;
    this.dwell.reset();
  }

  /**
   * Re-arms after a choice that keeps the menu open.
   *
   * Keeps the anchor — the cluster has not moved — but forgets the dwell and the
   * steering, so the hand has to move again before the same item can commit
   * twice.
   */
  release(cursor: CanvasPoint | null): void {
    this.steerFrom = cursor;
    this.steering = false;
    this.dwell.reset();
  }

  /** Forgets everything, e.g. when the menu closes. */
  reset(): void {
    this.anchor = null;
    this.steerFrom = null;
    this.steering = false;
    this.dwell.reset();
  }

  /** Reads one frame against a cluster, and folds in the dwell. */
  read(
    cluster: MenuCluster,
    cursor: CanvasPoint | null,
    canvasWidth: number,
    canvasHeight: number,
    elapsedMs: number,
    now: number,
    active = true,
  ): { frame: ClusterFrame; committed: string | null } {
    const isList = cluster.layout === "list";

    // A ring is built around the hand; a list is a column down the canvas, so it
    // has no anchor of its own to be centred on.
    const centerX = isList ? canvasWidth / 2 : (this.anchor?.x ?? canvasWidth / 2);
    const centerY = isList ? canvasHeight / 2 : (this.anchor?.y ?? canvasHeight / 2);

    const slots = isList ? [] : layoutRadial(cluster.items, centerX, centerY);
    const rows = isList ? layoutList(cluster.items, canvasHeight) : [];

    // A cluster waiting its turn is drawn, but nothing in it can be chosen.
    let hoveredId: string | null = null;
    let committed: string | null = null;

    if (active) {
      this.trackSteering(cursor);

      if (this.steering && cursor) {
        hoveredId = isList
          ? (listRowAt(rows, cursor)?.id ?? null)
          : (slotAt(slots, cursor, centerX, centerY)?.id ?? null);
      }

      committed = this.dwell.update(hoveredId, now);
    }

    return {
      frame: {
        layout: cluster.layout,
        items: cluster.items,
        activeId: cluster.activeId ?? null,
        slots,
        rows,
        centerX,
        centerY,
        cursor: active ? cursor : null,
        hoveredId,
        dwellProgress: hoveredId === null ? 0 : this.dwell.progress(now),
        isActive: active,
        elapsedMs,
      },
      committed,
    };
  }

  /**
   * Notes whether the cursor has moved far enough to count as steering.
   *
   * The dead zone already covers the ordinary case, because the hand starts at
   * the centre of its own cluster. This covers the one where the cluster had to
   * be nudged back on screen, which leaves the hand sitting off-centre from the
   * start — and so, without this, already over an item.
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
}

/** A frame with nothing highlighted, for the frame a choice commits on. */
function withoutHover(frame: ClusterFrame): ClusterFrame {
  return { ...frame, hoveredId: null, dwellProgress: 0 };
}

function emptyFrame(canvasWidth: number, canvasHeight: number): ClusterFrame {
  return {
    layout: "radial",
    items: [],
    activeId: null,
    slots: [],
    rows: [],
    centerX: canvasWidth / 2,
    centerY: canvasHeight / 2,
    cursor: null,
    hoveredId: null,
    dwellProgress: 0,
    isActive: false,
    elapsedMs: 0,
  };
}

export class MenuController {
  private readonly idleTimeoutMs: number;
  private readonly engage: DwellStabilizer<boolean>;
  private readonly menus: Pointer;
  private readonly options: Pointer;

  private isOpen = false;
  /** False until the engage gesture is released once, so it cannot re-fire. */
  private armed = true;
  private idleSince = 0;
  /** When the menu opened, so the fan-out can be animated from it. */
  private openedAt = 0;
  /** Which cluster the one hand is driving, in single-handed mode. */
  private stage: MenuClusterName = "menus";

  constructor(options: MenuControllerOptions = {}) {
    this.idleTimeoutMs = options.idleTimeoutMs ?? CONTROL.idleTimeoutMs;

    const moveThreshold = options.moveThreshold ?? CONTROL.moveThreshold;
    const dwellMs = options.dwellMs ?? CONTROL.dwellMs;

    this.engage = new DwellStabilizer<boolean>(options.engageHoldMs ?? CONTROL.engageHoldMs);
    this.menus = new Pointer(dwellMs, moveThreshold);
    this.options = new Pointer(dwellMs, moveThreshold);
  }

  /** Whether the menu currently owns the frame. */
  get open(): boolean {
    return this.isOpen;
  }

  /** Advances one frame. */
  update(input: MenuInput, now: number): MenuUpdate {
    const { canvasWidth, canvasHeight } = input;

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
        return this.closedUpdate(canvasWidth, canvasHeight);
      }

      this.isOpen = true;
      this.idleSince = now;
      this.openedAt = now;
      this.stage = "menus";
      this.menus.open(input.menuCursor, canvasWidth, canvasHeight);
      this.options.open(input.optionCursor, canvasWidth, canvasHeight);
      justOpened = true;
    } else if (!this.isOpen) {
      return this.closedUpdate(canvasWidth, canvasHeight);
    }

    const elapsedMs = now - this.openedAt;
    const staged = input.staged === true;

    // With one hand only the cluster at the current stage is read; the other is
    // still laid out so you can see where you came from.
    const menuRead = this.menus.read(
      input.menus,
      input.menuCursor,
      canvasWidth,
      canvasHeight,
      elapsedMs,
      now,
      !staged || this.stage === "menus",
    );
    const optionRead = this.options.read(
      input.options,
      input.optionCursor,
      canvasWidth,
      canvasHeight,
      elapsedMs,
      now,
      !staged || this.stage === "options",
    );

    // Pointing at anything keeps the menu alive; only idling times it out.
    if (menuRead.frame.hoveredId || optionRead.frame.hoveredId) {
      this.idleSince = now;
    }

    let committed: MenuUpdate["committed"] = null;
    let menusFrame = menuRead.frame;
    let optionsFrame = optionRead.frame;

    // The menus cluster is read first, so a menu change wins a tie.
    if (menuRead.committed !== null) {
      committed = { cluster: "menus", id: menuRead.committed };
      menusFrame = withoutHover(menusFrame);
      this.menus.release(input.menuCursor);
      // The other cluster now holds different things, so nothing in it may
      // commit until that hand has moved again.
      optionsFrame = withoutHover(optionsFrame);
      this.options.release(input.optionCursor);
      this.idleSince = now;

      if (staged) {
        // Hand over to the options, anchored where the chosen menu item was.
        // The hand is out there, so it lands in the middle of the new cluster
        // and cannot select anything by simply not moving.
        this.stage = "options";

        const chosen = menusFrame.slots.find((slot) => slot.id === menuRead.committed);
        this.options.open(
          chosen ? { x: chosen.x, y: chosen.y } : input.optionCursor,
          canvasWidth,
          canvasHeight,
        );

        // Re-lay the options out at the new anchor, so the frame handed back is
        // the one the player will see rather than the one from before the swap.
        optionsFrame = this.options.read(
          input.options,
          input.optionCursor,
          canvasWidth,
          canvasHeight,
          elapsedMs,
          now,
          false,
        ).frame;
      }
    } else if (optionRead.committed !== null) {
      const item = input.options.items.find((candidate) => candidate.id === optionRead.committed);

      if (item?.keepsMenuOpen) {
        committed = { cluster: "options", id: optionRead.committed };
        optionsFrame = withoutHover(optionsFrame);
        this.options.release(input.optionCursor);
        this.idleSince = now;
      } else {
        this.close();
        return {
          ...this.closedUpdate(canvasWidth, canvasHeight),
          committed: { cluster: "options", id: optionRead.committed },
        };
      }
    }

    if (now - this.idleSince > this.idleTimeoutMs) {
      this.close();
      return this.closedUpdate(canvasWidth, canvasHeight);
    }

    return {
      isOpen: true,
      menus: menusFrame,
      options: optionsFrame,
      committed,
      justOpened,
      elapsedMs,
    };
  }

  /** Closes the menu, e.g. when the mode changes underneath it. */
  close(): void {
    this.isOpen = false;
    this.stage = "menus";
    this.menus.reset();
    this.options.reset();
  }

  private closedUpdate(canvasWidth: number, canvasHeight: number): MenuUpdate {
    return {
      isOpen: false,
      menus: emptyFrame(canvasWidth, canvasHeight),
      options: emptyFrame(canvasWidth, canvasHeight),
      committed: null,
      justOpened: false,
      elapsedMs: 0,
    };
  }
}

export type { ListRow };
