/**
 * The start screen's demonstrations, one at a time, chosen by tab.
 *
 * To the start overlay the reel is the one thing it runs: start it, stop it, take
 * it back to the beginning. Which demo that reaches is the reel's business, so
 * the overlay never has to know there is more than one.
 */

/** A demonstration: something that can run, stop, and go back to its beginning. */
export interface Demo {
  start(): void;
  stop(): void;
  restart(): void;
}

export interface ReelEntry {
  readonly demo: Demo;
  readonly tab: HTMLButtonElement;
  /** What the demo shows, for a reader that cannot see the canvas. */
  readonly description: string;
}

export class DemoReel implements Demo {
  private current = 0;
  private running = false;

  /**
   * @param onSwitch - Called as one demo hands over to another, so whatever it was
   *   sounding can be silenced before the next begins.
   */
  constructor(
    private readonly entries: readonly ReelEntry[],
    private readonly canvas: HTMLElement,
    private readonly onSwitch: () => void = () => undefined,
  ) {
    entries.forEach((entry, index) => {
      entry.tab.addEventListener("click", (event) => {
        // The tabs sit on the start overlay, and a click that reached it would
        // start the instrument instead of changing the demo.
        event.stopPropagation();
        this.select(index);
      });
    });

    this.markSelected();
  }

  start(): void {
    this.running = true;
    this.entries[this.current].demo.start();
  }

  stop(): void {
    this.running = false;
    this.entries[this.current].demo.stop();
  }

  restart(): void {
    this.entries[this.current].demo.restart();
  }

  /** Shows the demo at `index`, from its beginning. */
  select(index: number): void {
    if (index === this.current || !this.entries[index]) return;

    this.entries[this.current].demo.stop();
    this.onSwitch();
    this.current = index;
    this.markSelected();

    const next = this.entries[index].demo;
    next.restart();
    if (this.running) next.start();
  }

  private markSelected(): void {
    this.entries.forEach((entry, index) => {
      entry.tab.setAttribute("aria-selected", String(index === this.current));
    });
    this.canvas.setAttribute("aria-label", this.entries[this.current].description);
  }
}
