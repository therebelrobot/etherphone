/**
 * The on-screen cheat sheet: what the left hand is doing, for the mode it is in.
 *
 * In Chords mode it lists the scale degrees the active gesture map can reach and
 * the hand shape that selects each. In Mono mode it is a ladder of the notes the
 * pitch hand can reach, highest at the top so it reads the way the frame does.
 *
 * Both are rendered from the same data the instrument plays from, so the cheat
 * sheet cannot describe a vocabulary the instrument is not using.
 */
import { MAJOR_SCALE } from "../config/music";
import { describeShape, getGestureRows } from "../music/gesture-map";
import { monoGuideNotes } from "../music/mono";
import type { GestureMap, InstrumentMode, KeyName } from "../types";

/** One row of the chord cheat sheet. */
export interface ChordGuideRow {
  readonly note: string;
  readonly gesture: string;
}

/** The chord rows for a key and map, in scale order. */
export function chordGuideRows(keyName: KeyName, map: GestureMap): ChordGuideRow[] {
  const scale = MAJOR_SCALE[keyName];

  return getGestureRows(map).map(({ degree, shape }) => ({
    note: scale[degree - 1],
    gesture: describeShape(shape),
  }));
}

/** The mono rows for a key, highest note first. */
export function monoGuideRows(keyName: KeyName): string[] {
  return monoGuideNotes(keyName);
}

export class GestureGuide {
  /** Whether the player has it open, remembered across mode switches. */
  private opened = false;

  private keyName: KeyName = "A";
  private mode: InstrumentMode = "chord";
  private map: GestureMap | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly toggle: HTMLButtonElement,
  ) {
    this.toggle.addEventListener("click", () => this.toggleVisibility());
  }

  /** Re-renders for the mode, key, and map in play. */
  render(mode: InstrumentMode, keyName: KeyName, map: GestureMap): void {
    this.mode = mode;
    this.keyName = keyName;
    this.map = map;
    this.paint();
  }

  private paint(): void {
    if (this.mode === "mono") {
      this.root.innerHTML = monoGuideRows(this.keyName)
        .map(
          (note) => `
      <div class="gesture-guide-row">
        <span class="gesture-guide-pitch">${note}</span>
      </div>
    `,
        )
        .join("");
      return;
    }

    const rows = this.map ? chordGuideRows(this.keyName, this.map) : [];
    this.root.innerHTML = rows
      .map(
        ({ note, gesture }) => `
      <div class="gesture-guide-row">
        <span class="gesture-guide-note">
          ${note}
        </span>

        <span class="gesture-guide-gesture">
          ${gesture}
        </span>
      </div>
    `,
      )
      .join("");
  }

  private toggleVisibility(): void {
    this.opened = !this.opened;
    this.root.classList.toggle("hidden", !this.opened);
    this.toggle.textContent = this.opened ? "Close Guide" : "Open Guide";
  }
}
