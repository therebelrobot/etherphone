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
import { MONO_OCTAVE_SPAN, MONO_PITCH_BOTTOM_Y, MONO_PITCH_TOP_Y } from "../config/constants";
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

/** The frequency at a continuous degree position, for the glide style. */
export function frequencyAtPosition(position: number, tonicFrequency: number): number {
  const lower = Math.floor(position);
  const mix = position - lower;

  const from = frequencyForDegree(lower, tonicFrequency);
  const to = frequencyForDegree(lower + 1, tonicFrequency);

  // Interpolating the ratio rather than the frequency keeps the slide even in
  // equal temperament; a linear blend would rush the bottom of the range.
  return from * Math.pow(to / from, mix);
}

/** The written name of a reading's pitch, e.g. `C#` or `C# +1` an octave up. */
export function monoNoteLabel(reading: MonoReading, keyName: KeyName): string {
  const withinOctave = ((reading.degree - 1) % 7) + 1;
  const name = getScaleNoteName(keyName, withinOctave);

  if (reading.octave === 0) return name;
  return `${name} ${reading.octave > 0 ? "+" : ""}${reading.octave}`;
}

/** The roman numeral of a reading's degree, used to colour the energy ribbon. */
export function monoNumeral(reading: MonoReading): Numeral {
  return DEGREE_NUMERALS[(reading.degree - 1) % 7];
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

  /** Reads one frame. Returns `null` when there is no pitch hand. */
  update(height: number | null, style: MonoStyle, tonicFrequency: number): MonoReading | null {
    if (height === null) {
      this.lastDegree = null;
      return null;
    }

    const position = degreePositionAtHeight(height);
    const degree = Math.round(position);
    const isNewDegree = degree !== this.lastDegree;

    this.lastDegree = degree;

    return {
      frequency:
        style === "glide"
          ? frequencyAtPosition(position, tonicFrequency)
          : frequencyForDegree(degree, tonicFrequency),
      degree,
      octave: Math.floor((degree - 1) / 7),
      isNewDegree,
    };
  }
}
