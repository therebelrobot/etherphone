/**
 * The on-screen cheat sheet: one row per scale degree the active gesture map can
 * reach, showing the note name in the current key and the hand shape that
 * selects it.
 *
 * It renders from the map rather than a fixed list, so it cannot drift from the
 * instrument: a map with three chords gets three rows.
 */
import { MAJOR_SCALE } from "../config/music";
import { describeShape, getGestureRows } from "../music/gesture-map";
import type { GestureMap, KeyName } from "../types";

export class GestureGuide {
  constructor(
    private readonly root: HTMLElement,
    private readonly toggle: HTMLButtonElement,
  ) {
    this.toggle.addEventListener("click", () => this.toggleVisibility());
  }

  /** Re-renders the rows for a key's scale and the map that is in play. */
  render(keyName: KeyName, map: GestureMap): void {
    const scale = MAJOR_SCALE[keyName];

    this.root.innerHTML = getGestureRows(map)
      .map(
        ({ degree, shape }) => `
      <div class="gesture-guide-row">
        <span class="gesture-guide-note">
          ${scale[degree - 1]}
        </span>

        <span class="gesture-guide-gesture">
          ${describeShape(shape)}
        </span>
      </div>
    `,
      )
      .join("");
  }

  private toggleVisibility(): void {
    const isHidden = this.root.classList.toggle("hidden");
    this.toggle.textContent = isHidden ? "Open Guide" : "Close Guide";
  }
}
