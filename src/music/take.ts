/**
 * The take: a recorded performance, and how it turns back into sound.
 *
 * A take stores *intent* — the chord that was held, or the degree the mono
 * voice reached — not frequencies. Resolving it here, against whatever tonic is
 * selected at playback, is what lets a loop transpose with the key: the same
 * events, played back through the same harmony functions the live instrument
 * uses. The reuse is the point. If the loop and the hand could disagree about
 * what a chord is, they eventually would.
 */
import type { Take, TakeEvent } from "../types";
import { getChordTones } from "./harmony";
import { frequencyForDegree } from "./mono";
import { getSolidNotes } from "./voicings";

/** Frequencies and expression to drive the loop layer with. */
export interface ResolvedEvent {
  readonly notes: number[];
  readonly volume: number;
  readonly tilt: number;
}

/**
 * Turns a recorded event into the sound it should make now.
 *
 * The tonic is what matters, not the key's name: frequencies derive from it, so
 * passing the *current* tonic is exactly what transposes a loop recorded in one
 * key into another.
 */
export function resolveTakeEvent(event: TakeEvent, tonicFrequency: number): ResolvedEvent {
  switch (event.kind) {
    case "rest":
      return { notes: [], volume: 0, tilt: event.tilt };

    case "note":
      return {
        notes: [frequencyForDegree(event.degree, tonicFrequency)],
        volume: event.volume,
        tilt: event.tilt,
      };

    case "chord": {
      const tones = getChordTones(event.numeral, event.isMajorMode, tonicFrequency);
      let notes = getSolidNotes(tones, event.qualityIndex, event.isMajorMode);

      // The thumb drops the voicing an octave, exactly as it does live.
      if (event.thumbDown) notes = notes.map((freq) => freq / 2);

      return { notes, volume: event.volume, tilt: event.tilt };
    }
  }
}

/**
 * Folds a second pass into an existing take, for an overdub.
 *
 * The subtlety is rests. In a take of its own a rest means "this silenced what
 * was sounding"; in a pass *added* to a take it means "I played nothing here",
 * and letting it erase the base would make every overdub delete the notes it was
 * not playing at the time. So rests from the added pass are dropped, and where
 * both passes do play, the newer one wins — a beat holds one intent.
 */
export function mergeTakes(base: Take, addition: Take): Take {
  const byBeat = new Map<number, TakeEvent>();

  for (const event of base.events) byBeat.set(event.beat, event);
  for (const event of addition.events) {
    if (event.kind === "rest") continue;
    byBeat.set(event.beat, event);
  }

  return {
    ...base,
    events: [...byBeat.values()].sort((a, b) => a.beat - b.beat),
  };
}

/**
 * Whether two events came from the same musical intent.
 *
 * Deliberately blind to `beat`, `volume`, and `tilt`: a note that is held while
 * the hand drifts louder is still the same note, and storing a fresh event for
 * every frame of that drift is how a take stops being a handful of numbers.
 */
export function sameIntent(a: TakeEvent, b: TakeEvent): boolean {
  if (a.kind !== b.kind) return false;

  if (a.kind === "chord" && b.kind === "chord") {
    return (
      a.numeral === b.numeral &&
      a.isMajorMode === b.isMajorMode &&
      a.qualityIndex === b.qualityIndex &&
      a.thumbDown === b.thumbDown
    );
  }

  if (a.kind === "note" && b.kind === "note") {
    return a.degree === b.degree;
  }

  return true;
}
