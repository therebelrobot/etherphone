/**
 * The start gate. Browsers will not start an AudioContext without a user
 * gesture, so the instrument stays dimmed behind this overlay until it is
 * clicked.
 */
export class StartOverlay {
  constructor(
    private readonly root: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
    private readonly onStart: () => void,
  ) {
    this.root.addEventListener("click", () => this.dismiss());
  }

  private dismiss(): void {
    this.onStart();
    this.root.style.display = "none";
    this.canvas.classList.remove("dimmed");
  }
}
