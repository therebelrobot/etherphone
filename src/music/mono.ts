/**
 * The mono voice: one note at a time, chosen by the left hand's height.
 *
 * Higher in the frame is higher in the scale. The mapping is quantised to the
 * key, which is what makes a sweep up the frame a scale run rather than a siren
 * — the same idea as the Omnichord's strum plate, which lays chord degrees out
 * across a span and plays them in key.
 *
 * Three styles read that one position differently:
 *
 * - `quantised` — the nearest degree, sustained, legato between degrees.
 * - `glide` — a continuous pitch, sliding between degrees.
 * - `harp` — the nearest degree, plucked afresh each time the hand enters one,
 *   so sweeping the frame plays a harp-like run.
 *
 * Everything except {@link MonoReader}'s edge detection is a pure function, so
 * the mapping is testable without a browser and without landmarks.
 */
import {
  AUDIO,
  MONO_OCTAVE_SPAN,
  MONO_PITCH_BOTTOM_Y,
  MONO_PITCH_TOP_Y,
} from "../config/constants";
import { DEGREE_NUMERALS, MONO_SCALE_SEMITONES } from "../config/music";
import type { KeyName, MonoReading, MonoStyle, Numeral } from "../types";
import { getPlayableTonic, getScaleNoteName, semitoneRatio } from "./harmony";

/** Scale degrees the pitch hand spans, from the bottom of its band to the top. */
export const PITCH_SPAN_DEGREES = 7 * MONO_OCTAVE_SPAN;

/**
 * The frequency of a scale degree, counted past the seventh.
 *
 * Uses {@link MONO_SCALE_SEMITONES} rather than the chord table's
 * `getDegreeFrequency`, so a run up the range keeps climbing: the chord table
 * tunes degree VII a semitone below the tonic, which as a melody would drop an
 * octave at every seventh step. The octave-extended degrees are the same seven
 * notes an octave up, which is what makes a sweep a scale run.
 */
export function frequencyForDegree(degree: number, tonicFrequency: number): number {
  const octave = Math.floor((degree - 1) / 7);
  const semitones = MONO_SCALE_SEMITONES[(degree - 1) % 7] + 12 * octave;

  return getPlayableTonic(tonicFrequency) * semitoneRatio(semitones);
}

/**
 * The pitch hand's height as a continuous degree position.
 *
 * Runs from 1 at the bottom of the band to `1 + PITCH_SPAN_DEGREES` at the top,
 * so a higher hand is a higher note.
 */
export function degreePositionAtHeight(height: number): number {
  const clamped = Math.max(MONO_PITCH_TOP_Y, Math.min(MONO_PITCH_BOTTOM_Y, height));
  const travelled = (clamped - MONO_PITCH_TOP_Y) / (MONO_PITCH_BOTTOM_Y - MONO_PITCH_TOP_Y);

  return 1 + (1 - travelled) * PITCH_SPAN_DEGREES;
}

/**
 * The height that plays a degree: the inverse of {@link degreePositionAtHeight}.
 *
 * For anything that has to *put* a hand at a note rather than read one — the
 * start screen's demonstration, which moves a drawn hand to the height a player's
 * would be at.
 */
export function heightForDegree(degree: number): number {
  const travelled = 1 - (degree - 1) / PITCH_SPAN_DEGREES;

  return MONO_PITCH_TOP_Y + travelled * (MONO_PITCH_BOTTOM_Y - MONO_PITCH_TOP_Y);
}

/**
 * Pulls a continuous position toward the nearest degree, without making it step.
 *
 * This is snap assistance: a *magnetic* mapping rather than a quantised one. The
 * pitch stays continuous — you can still slide — but the mapping is flattened
 * near each note and steepened between them, so a hand that is roughly in the
 * right place lands exactly in tune.
 *
 *     warped = round(p) + (d - s·sin(2πd) / 2π),  where d = p - round(p)
 *
 * Three properties, each of which has a test, because a bad warp here is an
 * instrument that jumps backwards as your hand moves forwards:
 *
 * - **Monotonic for every `s <= 1`.** The derivative is `1 - s·cos(2πd)`, which
 *   is never negative in that range, so the pitch can never reverse.
 * - **The endpoints do not move.** `d = ±0.5` is unchanged, so octave
 *   boundaries stay where they were and a note never drifts off the scale.
 * - **`s = 0` is the identity**, which is the glide the instrument already had.
 *
 * It is deliberately *not* quantisation at any strength: the result is still
 * continuous, so the two styles meet in feel and never in behaviour.
 */
export function snapPosition(position: number, strength: number): number {
  const amount = Math.max(0, Math.min(1, strength));
  if (amount === 0) return position;

  const nearest = Math.round(position);
  const offset = position - nearest;

  return nearest + offset - (amount * Math.sin(2 * Math.PI * offset)) / (2 * Math.PI);
}

/** The frequency at a continuous degree position, for the glide style. */
export function frequencyAtPosition(
  position: number,
  tonicFrequency: number,
  snapStrength = 0,
): number {
  const warped = snapPosition(position, snapStrength);
  const lower = Math.floor(warped);
  const mix = warped - lower;

  const from = frequencyForDegree(lower, tonicFrequency);
  const to = frequencyForDegree(lower + 1, tonicFrequency);

  // Interpolating the ratio rather than the frequency keeps the slide even in
  // equal temperament; a linear blend would rush the bottom of the range.
  return from * Math.pow(to / from, mix);
}

/** The written name of a scale degree, with its octave marked when it has one. */
export function noteNameForDegree(degree: number, keyName: KeyName): string {
  const withinOctave = ((degree - 1) % 7) + 1;
  const name = getScaleNoteName(keyName, withinOctave);
  const octave = Math.floor((degree - 1) / 7);

  if (octave === 0) return name;
  return `${name} +${octave}`;
}

/** The written name of a reading's pitch, e.g. `C#` or `C# +1` an octave up. */
export function monoNoteLabel(reading: MonoReading, keyName: KeyName): string {
  return noteNameForDegree(reading.degree, keyName);
}

/**
 * Every note the pitch hand can reach, highest first.
 *
 * Highest first so the guide can be read top-to-bottom as the frame is: the top
 * of the list is the top of the frame.
 */
export function monoGuideNotes(keyName: KeyName): string[] {
  const notes: string[] = [];

  for (let degree = 1 + PITCH_SPAN_DEGREES; degree >= 1; degree -= 1) {
    notes.push(noteNameForDegree(degree, keyName));
  }

  return notes;
}

/** The roman numeral of a reading's degree, used to colour the energy ribbon. */
export function monoNumeral(reading: MonoReading): Numeral {
  return DEGREE_NUMERALS[(reading.degree - 1) % 7];
}

/**
 * How long a plucked style lets a note ring, or `null` for a sustained one.
 *
 * The two plucked styles differ only in this: `harp` rings so a sweep is a
 * phrase, `staccato` cuts short so a sweep is a run of separate notes. Putting
 * the number here rather than at the call site keeps the mapping in the module
 * that already owns "what a style means", and gives it somewhere to be tested.
 */
export function pluckDecayFor(style: MonoStyle): number | null {
  if (style === "harp") return AUDIO.pluckDecaySeconds;
  if (style === "staccato") return AUDIO.staccatoDecaySeconds;
  return null;
}

/** How the snap-strength setting names each step. */
export function snapLabel(strength: number): string {
  if (strength <= 0) return "off";
  if (strength >= 1) return "firm";
  return "light";
}

/** What the expression hand and the settings say about a mono frame. */
export interface MonoFrameOptions {
  /** Drops the whole reading an octave, for a bassline. */
  readonly octaveDown?: boolean;
  /** How hard to pull a glide toward the nearest note, 0..1. */
  readonly snapStrength?: number;
}

/**
 * Reads the pitch hand, frame by frame.
 *
 * Stateful only for the edge the harp style plucks on: it remembers which degree
 * was sounding so a note is not re-struck while the hand holds still.
 */
export class MonoReader {
  private lastDegree: number | null = null;

  /** Forgets the sounding degree, e.g. when the hand drops or the mode changes. */
  reset(): void {
    this.lastDegree = null;
  }

  /**
   * Reads one frame. Returns `null` when there is no pitch hand.
   *
   * The two options are the expression hand's contributions rather than the
   * pitch hand's: `octaveDown` is its thumb (the same control that drops a chord
   * voicing — the instrument should not have two different "make it lower"
   * gestures) and `snapStrength` is the setting for how hard a glide is pulled
   * toward the nearest note.
   */
  update(
    height: number | null,
    style: MonoStyle,
    tonicFrequency: number,
    options: MonoFrameOptions = {},
  ): MonoReading | null {
    if (height === null) {
      this.lastDegree = null;
      return null;
    }

    const position = degreePositionAtHeight(height);

    // The degree is the nearest one either way: snap assistance changes the
    // pitch between degrees, not which degree is nearest, so a snap can never
    // change when a note counts as new.
    const degree = Math.round(position);
    const isNewDegree = degree !== this.lastDegree;

    this.lastDegree = degree;

    const raw =
      style === "glide"
        ? frequencyAtPosition(position, tonicFrequency, options.snapStrength ?? 0)
        : frequencyForDegree(degree, tonicFrequency);

    return {
      frequency: options.octaveDown ? raw / 2 : raw,
      degree,
      octave: Math.floor((degree - 1) / 7),
      isNewDegree,
    };
  }
}
