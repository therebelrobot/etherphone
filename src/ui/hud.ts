/**
 * The text readouts layered over the canvas: chord name, voicing quality, and
 * filter position.
 */
import type { ChordNumeral, InstrumentMode } from "../types";
import type { VolumeMeter } from "./volume-meter";

/** What the mode readout calls each mode. */
export function modeLabel(mode: InstrumentMode): string {
  return mode === "mono" ? "Mono" : "Chords";
}

export class Hud {
  constructor(
    private readonly chordEl: HTMLElement,
    private readonly qualityEl: HTMLElement,
    private readonly filterEl: HTMLElement,
    private readonly modeEl: HTMLElement,
    private readonly volumeMeter: VolumeMeter,
  ) {}

  /** Shows the chord name plus its roman numeral, or `--` when idle. */
  setChord(chordName: string, numeral: ChordNumeral | null): void {
    this.chordEl.textContent = numeral ? `${chordName}(${numeral})` : "--";
  }

  /**
   * Says which instrument is in play.
   *
   * The RFC asks for "a mode readout in the Hud". Without it the mode is only
   * inferable: the chord name is replaced by a note name in mono, so you can
   * work out where you are but nothing tells you. Worth stating outright on an
   * instrument where a wrong assumption about the left hand costs a phrase.
   */
  setMode(mode: InstrumentMode): void {
    this.modeEl.textContent = modeLabel(mode);
  }

  /** Shows a single note's name, which is what the mono voice produces. */
  setNote(noteName: string): void {
    this.chordEl.textContent = noteName;
  }

  /** Shows the active voicing's label, annotated when dropped an octave. */
  setQuality(label: string | undefined): void {
    this.qualityEl.textContent = label ?? "--";
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
