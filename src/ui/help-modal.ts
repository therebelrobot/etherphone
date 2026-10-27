/**
 * The "how to play" modal, opened by the `?` button and dismissed by the close
 * button or by clicking the backdrop.
 *
 * The prose lives in `index.html`, but the parts that are only true in one mode
 * are marked with `data-mode` and filtered here. That matters because the
 * instrument does different things with the same hand depending on the mode, and
 * a guide that describes the wrong one is worse than no guide at all. The chord
 * rows are rendered from the active gesture map for the same reason.
 */
import { chordGuideRows } from "./gesture-guide";
import type { GestureMap, InstrumentMode, KeyName } from "../types";

export class HelpModal {
  constructor(
    private readonly modal: HTMLElement,
    helpButton: HTMLButtonElement,
    closeButton: HTMLButtonElement,
    private readonly chordRows: HTMLElement,
  ) {
    helpButton.addEventListener("click", () => this.open());

    closeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      this.close();
    });

    this.modal.addEventListener("click", (event) => {
      if (event.target === this.modal) {
        this.close();
      }
    });
  }

  /**
   * Re-renders for the mode, key, and map in play.
   *
   * `looping` hides the looper's half of the guide. A guide that describes an
   * instrument you have turned off is worse than no guide, which is the same
   * reason the mode filtering exists.
   */
  render(mode: InstrumentMode, keyName: KeyName, map: GestureMap, looping = true): void {
    for (const element of this.modal.querySelectorAll<HTMLElement>("[data-mode]")) {
      element.classList.toggle("hidden", element.dataset.mode !== mode);
    }

    for (const element of this.modal.querySelectorAll<HTMLElement>("[data-feature]")) {
      element.classList.toggle("hidden", element.dataset.feature === "looping" ? !looping : false);
    }

    this.chordRows.innerHTML = chordGuideRows(keyName, map)
      .map(
        ({ note, gesture }) => `
        <div class="help-row">
          <span class="help-row-gesture">${gesture}</span>
          <span class="help-row-result">${note}</span>
        </div>
      `,
      )
      .join("");
  }

  open(): void {
    this.modal.classList.remove("hidden");
  }

  close(): void {
    this.modal.classList.add("hidden");
  }
}
