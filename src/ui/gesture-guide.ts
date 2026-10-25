/**
 * The on-screen cheat sheet: one row per scale degree, showing the note name in
 * the current key and the hand shape that selects it.
 */
import { MAJOR_SCALE } from "../config/music";
import type { KeyName } from "../types";

/** Scale degree paired with the emoji that depicts it. */
const GESTURE_ROWS = [
  { degree: 1, gesture: "1️⃣" },
  { degree: 2, gesture: "2️⃣" },
  { degree: 3, gesture: "3️⃣" },
  { degree: 4, gesture: "4️⃣" },
  { degree: 5, gesture: "5️⃣" },
  { degree: 6, gesture: "🤘" },
  { degree: 7, gesture: "🤟" },
] as const;

export class GestureGuide {
  constructor(
    private readonly root: HTMLElement,
    private readonly toggle: HTMLButtonElement,
  ) {
    this.toggle.addEventListener("click", () => this.toggleVisibility());
  }

  /** Re-renders the rows against a key's scale. */
  render(keyName: KeyName): void {
    const scale = MAJOR_SCALE[keyName];

    this.root.innerHTML = GESTURE_ROWS.map(
      ({ degree, gesture }) => `
      <div class="gesture-guide-row">
        <span class="gesture-guide-note">
          ${scale[degree - 1]}
        </span>

        <span class="gesture-guide-gesture">
          ${gesture}
        </span>
      </div>
    `,
    ).join("");
  }

  private toggleVisibility(): void {
    const isHidden = this.root.classList.toggle("hidden");
    this.toggle.textContent = isHidden ? "Open Guide" : "Close Guide";
  }
}
