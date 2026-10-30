/**
 * The start gate. Browsers will not start an AudioContext without a user
 * gesture, so the instrument stays dimmed behind this overlay until it is
 * clicked.
 *
 * It is also the one place a player is looking before anything works, which
 * makes it the right place to say why the camera did not come up, and to show
 * what the hands do. A failure stops the overlay dismissing — there is nothing to
 * start — and stops the demonstration, which would only distract from the reason.
 */

/** Something the overlay runs while it is up: the demonstration. */
export interface OverlayShow {
  start(): void;
  stop(): void;
}

/**
 * A way to hear the demonstration without leaving the start screen.
 *
 * The browser's rule is a click before any sound, not a click on *this* — so a
 * button of its own can turn the audio on while the overlay stays up, and the
 * click that starts the instrument is still the player's to make.
 */
export interface OverlayListen {
  readonly button: HTMLButtonElement;
  /** Called with true when the player asks to hear the demo, and false when that ends. */
  readonly onToggle: (listening: boolean) => void;
}

const LISTEN_LABEL = "🔊 listen to the demo";
const STOP_LABEL = "🔇 stop listening";

export class StartOverlay {
  private failed = false;
  private listening = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly onStart: () => void,
    private readonly show?: OverlayShow,
    private readonly listen?: OverlayListen,
  ) {
    this.root.addEventListener("click", () => this.dismiss());
    this.show?.start();

    if (listen) {
      listen.button.textContent = LISTEN_LABEL;
      listen.button.setAttribute("aria-pressed", "false");
      listen.button.addEventListener("click", (event) => {
        // Inside the overlay, so a click here would otherwise also start the
        // instrument — which is exactly what this button is for not doing.
        event.stopPropagation();
        this.setListening(!this.listening);
      });
    }
  }

  private setListening(listening: boolean): void {
    if (!this.listen || listening === this.listening) return;

    this.listening = listening;
    this.listen.button.textContent = listening ? STOP_LABEL : LISTEN_LABEL;
    this.listen.button.setAttribute("aria-pressed", String(listening));
    this.listen.onToggle(listening);
  }

  /**
   * Replaces the prompt with a reason, and holds the overlay open.
   *
   * Retrying is a reload, not a click, so the click-to-start gesture is turned
   * off here rather than left to silently do nothing.
   */
  showError(message: string): void {
    this.failed = true;
    this.setListening(false);
    this.show?.stop();
    this.root.classList.add("failed");

    const text = this.root.querySelector(".start-text");
    if (text) text.textContent = message;

    const circle = this.root.querySelector(".start-circle");
    if (circle) circle.textContent = "!";
  }

  private dismiss(): void {
    if (this.failed) return;

    // The demo's sound ends before the instrument's begins, so the first thing the
    // player hears is their own hands.
    this.setListening(false);
    this.show?.stop();
    this.onStart();
    this.root.style.display = "none";
    this.canvas.classList.remove("dimmed");
  }
}
