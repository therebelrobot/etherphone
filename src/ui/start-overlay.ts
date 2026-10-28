/**
 * The start gate. Browsers will not start an AudioContext without a user
 * gesture, so the instrument stays dimmed behind this overlay until it is
 * clicked.
 *
 * It is also the one place a player is looking before anything works, which
 * makes it the right place to say why the camera did not come up. A failure
 * stops the overlay dismissing: there is nothing to start.
 */
export class StartOverlay {
  private failed = false;

  constructor(
    private readonly root: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly onStart: () => void,
  ) {
    this.root.addEventListener("click", () => this.dismiss());
  }

  /**
   * Replaces the prompt with a reason, and holds the overlay open.
   *
   * Retrying is a reload, not a click, so the click-to-start gesture is turned
   * off here rather than left to silently do nothing.
   */
  showError(message: string): void {
    this.failed = true;
    this.root.classList.add("failed");

    const text = this.root.querySelector(".start-text");
    if (text) text.textContent = message;

    const circle = this.root.querySelector(".start-circle");
    if (circle) circle.textContent = "!";
  }

  private dismiss(): void {
    if (this.failed) return;

    this.onStart();
    this.root.style.display = "none";
    this.canvas.classList.remove("dimmed");
  }
}
