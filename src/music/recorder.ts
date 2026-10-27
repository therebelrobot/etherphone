/**
 * Capturing a performance.
 *
 * Records *intent*, not audio: the chord or note in force, stamped with where in
 * the loop it began. Only changes are stored, so holding a chord for two bars is
 * one event and not a hundred and twenty — the take stays a handful of numbers
 * you could read, which is the whole point of recording intent rather than
 * output.
 *
 * Pure and clock-free: the caller says which beat it is capturing at, so the
 * recorder is testable without a transport, a context, or a browser.
 */
import { TRANSPORT } from "../config/constants";
import type { ChordNumeral, Take, TakeEvent } from "../types";
import { sameIntent } from "./take";

/**
 * What the hands were doing, as the recorder sees it.
 *
 * `null` is a rest — the hands were not playing — and it becomes a rest event
 * only when something *was* sounding, so a take never opens on silence it did
 * not break.
 */
export type RecordedIntent =
  | {
      readonly kind: "chord";
      readonly numeral: ChordNumeral;
      readonly isMajorMode: boolean;
      readonly qualityIndex: number;
      readonly thumbDown: boolean;
    }
  | { readonly kind: "note"; readonly degree: number }
  | null;

/** How long a take is, and at what tempo, when it is closed. */
export interface FinishOptions {
  readonly bpm: number;
  readonly loopBeats: number;
}

/** Snaps a beat to the recording grid. */
export function quantiseBeat(beat: number): number {
  return Math.round(beat / TRANSPORT.quantiseBeats) * TRANSPORT.quantiseBeats;
}

/** Turns a recorded intent into a take event at a beat. */
function toEvent(intent: RecordedIntent, beat: number, volume: number, tilt: number): TakeEvent {
  if (intent === null) {
    return { kind: "rest", beat, volume: 0, tilt };
  }

  if (intent.kind === "note") {
    return { kind: "note", beat, volume, tilt, degree: intent.degree };
  }

  return {
    kind: "chord",
    beat,
    volume,
    tilt,
    numeral: intent.numeral,
    isMajorMode: intent.isMajorMode,
    qualityIndex: intent.qualityIndex,
    thumbDown: intent.thumbDown,
  };
}

export class Recorder {
  private events: TakeEvent[] = [];
  private last: TakeEvent | null = null;
  private active = false;

  get isRecording(): boolean {
    return this.active;
  }

  /** Begins a fresh take. */
  start(): void {
    this.events = [];
    this.last = null;
    this.active = true;
  }

  /** Ends the take without producing one, e.g. when recording is cancelled. */
  stop(): void {
    this.active = false;
  }

  /** Folds one frame of intent in, if it says something the last event did not. */
  capture(intent: RecordedIntent, volume: number, tilt: number, beat: number): void {
    if (!this.active) return;

    const event = toEvent(intent, quantiseBeat(beat), volume, tilt);

    // A rest is only worth storing when it silences something.
    if (event.kind === "rest" && this.last === null) return;

    // Nothing changed since the last event, so there is nothing to store.
    if (this.last && sameIntent(event, this.last)) return;

    this.events.push(event);
    this.last = event;
  }

  /**
   * Closes the take and returns it.
   *
   * Events past the loop's end are dropped rather than wrapped: an onset that
   * landed in the last few milliseconds before the boundary is a rounding
   * artefact of the frame, not a note the player meant to place there.
   */
  finish(options: FinishOptions): Take {
    this.active = false;

    const events = this.events.filter((event) => event.beat < options.loopBeats);

    return { bpm: options.bpm, loopBeats: options.loopBeats, events };
  }

  /** Discards everything, e.g. when the take is cleared. */
  reset(): void {
    this.events = [];
    this.last = null;
    this.active = false;
  }
}
