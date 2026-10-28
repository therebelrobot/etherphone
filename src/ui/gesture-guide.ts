/**
 * The on-screen cheat sheet: what the hands do, in the mode they are in.
 *
 * In Chords mode it lists the scale degrees the active gesture map can reach and
 * the hand shape that selects each — **and the shapes it cannot use**, because a
 * cheat sheet that only lists what works cannot tell a player why four fingers
 * does nothing. In Mono mode it is a ladder of the notes the pitch hand can
 * reach, highest at the top so it reads the way the frame does.
 *
 * Below that is the *control* vocabulary: the menu and the fist transport. The
 * instrument has had two vocabularies since #4 and #18, and for a while the
 * guide described only the playing one — "reachable by gesture" and "learnable
 * by gesture" are different milestones.
 *
 * Everything is rendered from the same data the instrument plays from, so the
 * cheat sheet cannot describe a vocabulary the instrument is not using.
 */
import { MAJOR_SCALE } from "../config/music";
import { describeShape, getGestureRows, getSilentRows } from "../music/gesture-map";
import { monoGuideNotes } from "../music/mono";
import type { GestureMap, InstrumentMode, KeyName } from "../types";

/** One row of the chord cheat sheet. */
export interface ChordGuideRow {
  readonly note: string;
  readonly gesture: string;
  /** True for a shape the active map cannot use. */
  readonly silent: boolean;
}

/** One row of the control cheat sheet: a shape, and what it does. */
export interface ControlGuideRow {
  readonly gesture: string;
  readonly does: string;
}

/** The chord rows for a key and map, in scale order, then the silent shapes. */
export function chordGuideRows(keyName: KeyName, map: GestureMap): ChordGuideRow[] {
  const scale = MAJOR_SCALE[keyName];

  const playable = getGestureRows(map).map(({ degree, shape }) => ({
    note: scale[degree - 1],
    gesture: describeShape(shape),
    silent: false,
  }));

  // A dash rather than a note name: the shape reaches nothing, and inventing a
  // note for it is exactly the drift this list exists to prevent.
  const silent = getSilentRows(map).map(({ gesture }) => ({
    note: "—",
    gesture,
    silent: true,
  }));

  return [...playable, ...silent];
}

/** The mono rows for a key, highest note first. */
export function monoGuideRows(keyName: KeyName): string[] {
  return monoGuideNotes(keyName);
}

/**
 * The control rows: the menu, and the transport when it is reachable.
 *
 * The transport is only listed when it actually exists. With looping turned off
 * there is no transport to flick, and in one-handed staging a single closed hand
 * already means the menu — so listing four commands that would do nothing is
 * worse than listing none, which is the same reasoning the ring's own contents
 * follow.
 */
export function controlGuideRows(options: {
  readonly looping: boolean;
  readonly singleHanded: boolean;
}): ControlGuideRow[] {
  const rows: ControlGuideRow[] = [
    { gesture: options.singleHanded ? "✊ hold" : "✊✊ hold", does: "Menu" },
    { gesture: "☝ point, hold", does: "Choose" },
  ];

  if (!options.looping || options.singleHanded) return rows;

  return [
    ...rows,
    { gesture: "✊ →", does: "Play" },
    { gesture: "✊ ←", does: "Clear" },
    { gesture: "✊ ↑", does: "Record" },
    { gesture: "✊ ↓", does: "Stop" },
  ];
}

export class GestureGuide {
  /** Whether the player has it open, remembered across mode switches. */
  private opened = false;

  private keyName: KeyName = "A";
  private mode: InstrumentMode = "chord";
  private map: GestureMap | null = null;
  private control: ControlGuideRow[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly toggle: HTMLButtonElement,
  ) {
    this.toggle.addEventListener("click", () => this.toggleVisibility());
  }

  /** Re-renders for the mode, key, map, and control vocabulary in play. */
  render(
    mode: InstrumentMode,
    keyName: KeyName,
    map: GestureMap,
    options: { looping: boolean; singleHanded: boolean },
  ): void {
    this.mode = mode;
    this.keyName = keyName;
    this.map = map;
    this.control = controlGuideRows(options);
    this.paint();
  }

  private paint(): void {
    const playing = this.mode === "mono" ? this.paintMono() : this.paintChords();

    this.root.innerHTML = `${playing}${this.paintControl()}`;
  }

  private paintMono(): string {
    return monoGuideRows(this.keyName)
      .map(
        (note) => `
      <div class="gesture-guide-row">
        <span class="gesture-guide-pitch">${note}</span>
      </div>
    `,
      )
      .join("");
  }

  private paintChords(): string {
    const rows = this.map ? chordGuideRows(this.keyName, this.map) : [];

    return rows
      .map(
        ({ note, gesture, silent }) => `
      <div class="gesture-guide-row${silent ? " silent" : ""}">
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

  private paintControl(): string {
    if (this.control.length === 0) return "";

    const rows = this.control
      .map(
        ({ gesture, does }) => `
      <div class="gesture-guide-row">
        <span class="gesture-guide-control">${gesture}</span>
        <span class="gesture-guide-does">${does}</span>
      </div>
    `,
      )
      .join("");

    return `
      <div class="gesture-guide-heading">Control</div>
      ${rows}
    `;
  }

  private toggleVisibility(): void {
    this.opened = !this.opened;
    this.root.classList.toggle("hidden", !this.opened);
    this.toggle.textContent = this.opened ? "Close Guide" : "Open Guide";
  }
}
