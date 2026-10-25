/**
 * The eight-segment volume meter. Bars are indexed 0 at the bottom in the
 * markup, so a rising volume lights them in reverse document order.
 */
export class VolumeMeter {
  constructor(private readonly bars: readonly HTMLElement[]) {}

  /** Lights `volume01` worth of the available bars, rounding to the nearest. */
  update(volume01: number): void {
    const litCount = Math.round(volume01 * this.bars.length);

    this.bars.forEach((bar) => {
      const index = Number(bar.dataset.index);
      bar.classList.toggle("lit", index >= this.bars.length - litCount);
    });
  }
}
