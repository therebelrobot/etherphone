/**
 * The "how to play" modal, opened by the `?` button and dismissed by the close
 * button or by clicking the backdrop.
 *
 * The chord rows are rendered from the active gesture map rather than written
 * into the markup, for the same reason the on-screen guide is: the help text
 * must not describe a vocabulary the instrument is not currently using.
 */
import { describeShape, getGestureRows } from "../music/gesture-map";
import type { GestureMap } from "../types";

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

  /** Re-renders the left-hand chord rows against the map that is in play. */
  render(map: GestureMap): void {
    this.chordRows.innerHTML = getGestureRows(map)
      .map(
        ({ numeral, shape }) => `
        <div class="help-row">
          <span class="help-row-gesture">${describeShape(shape)}</span>
          <span class="help-row-result">${numeral}</span>
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
