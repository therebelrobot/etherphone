/**
 * The text readouts layered over the canvas: chord name, voicing quality, and
 * filter position.
 */
import type { ChordNumeral } from "../types";
import type { VolumeMeter } from "./volume-meter";

export class Hud {
  constructor(
    private readonly chordEl: HTMLElement,
    private readonly qualityEl: HTMLElement,
    private readonly filterEl: HTMLElement,
    private readonly volumeMeter: VolumeMeter,
  ) {}

  /** Shows the chord name plus its roman numeral, or `--` when idle. */
  setChord(chordName: string, numeral: ChordNumeral | null): void {
    this.chordEl.textContent = numeral ? `${chordName}(${numeral})` : "--";
  }

  /** Shows a single note's name, which is what the mono voice produces. */
  setNote(noteName: string): void {
    this.chordEl.textContent = noteName;
  }

  /** Shows the active voicing's label, annotated when dropped an octave. */
  setQuality(label: string | undefined, thumbDown: boolean): void {
    this.qualityEl.textContent = label ? `${label}${thumbDown ? " (-8ve)" : ""}` : "--";
  }

  /** Shows the filter sweep as a signed percentage. */
  setFilter(tiltFactor: number): void {
    const percent = Math.round(tiltFactor * 100);
    this.filterEl.textContent = `Filter: ${percent > 0 ? "+" : ""}${percent}%`;
  }

  /** Forwards the master volume to the meter. */
  setVolume(volume01: number): void {
    this.volumeMeter.update(volume01);
  }
}
