/**
 * The song the start screen plays, as data: what each hand does, step by step.
 *
 * The demo has one job — to show a player the instrument's core gestures before
 * they have touched it — and a song does that better than a list of gestures,
 * because a song gives each gesture a reason to happen and a moment to happen in.
 *
 * *Soon May the Wellerman Come* because its chords are the vocabulary worth
 * showing first, and because it is well known and in the public domain: a
 * traditional New Zealand whaling song of the 1860s. In C, its usual chords are
 * vi, ii, III, IV and I — which is the rock sign and two fingers, *both leaning
 * outward* to sound minor; three fingers held upright to sound the major III,
 * the one chord outside the key; and four fingers and one. The E before each
 * return to A minor is a seventh, which is the expression hand's job.
 *
 * Everything here is the instrument's own vocabulary, read from the same tables
 * the instrument plays from, so the demo cannot show a gesture that does not work.
 */
import { DEFAULT_EXPRESSION_MAP } from "../music/expression-map";
import { ROCK_SIGN, ROCK_SIGN_THUMB, shapeFromFingers } from "../music/gesture-map";
import { specFromShape } from "../hand";
import type { HandPoseSpec, HandSide } from "../hand";
import type { ChordNumeral, ChordState, HandShape, Numeral } from "../types";

/** One stretch of the song with the hands held: usually a bar. */
export interface DemoStep {
  readonly beats: number;
  /** What is sung over it. */
  readonly lyric: string;
  /** The chord, its case carrying the mode — `vi` is minor — or `null` for none. */
  readonly chord: ChordNumeral | null;
  /** The expression hand's kind of chord, a quality id, or `null` for none. */
  readonly kind: string | null;
  /** Said instead of the chord, for a step that is about a gesture rather than a chord. */
  readonly note?: string;
}

export interface DemoSong {
  readonly title: string;
  /** Where it comes from, and why it is free to use. */
  readonly credit: string;
  readonly bpm: number;
  readonly steps: readonly DemoStep[];
}

/** A bar on one chord. */
const bar = (lyric: string, chord: ChordNumeral, kind = "octave", beats = 4): DemoStep => ({
  beats,
  lyric,
  chord,
  kind,
});

/**
 * The first verse and the chorus, with the chords most charts give them.
 *
 * The kind is "Octave" throughout — the expression hand's one-finger pose, which
 * sounds the plain chord — except on the sevenths. It ends on both hands closed:
 * the silence at the end of the song, and the gesture that opens the menu.
 */
export const WELLERMAN: DemoSong = {
  title: "Soon May the Wellerman Come",
  credit: "traditional New Zealand whaling song, 1860s · public domain",
  bpm: 100,
  steps: [
    bar("There", "vi", "octave", 1),
    bar("once was a ship that", "vi"),
    bar("put to sea, the", "ii"),
    bar("name of the ship was the", "vi"),
    bar("Bil-ly o' Tea. The", "III", "seventh"),
    bar("winds blew up, her", "vi"),
    bar("bow dipped down. Oh", "ii"),
    bar("blow, my bul-ly", "vi", "octave", 2),
    bar("boys,", "III", "octave", 2),
    bar("blow!", "vi"),
    bar("Soon may the", "IV"),
    bar("Wel-ler-man come, to", "I"),
    bar("bring us su-gar and", "ii"),
    bar("tea and rum. One", "vi"),
    bar("day, when the", "IV"),
    bar("tongu-in' is done, we'll", "I"),
    bar("take our leave and", "III", "seventh"),
    bar("go.", "vi"),
    {
      beats: 4,
      lyric: "",
      chord: null,
      kind: null,
      note: "close both hands to open the menu",
    },
  ],
};

/** The song the start screen plays when it is not told otherwise. */
export const DEMO_SONG = WELLERMAN;

/**
 * The shape the demo makes for each degree, on the Classic map.
 *
 * The map is count-based, so any four fingers play IV; these are the ones a
 * person counts with — index first, the thumb last — because a demo should show
 * the shape a player would make, not merely one that works.
 */
export const DEMO_CHORD_SHAPES: Readonly<Record<Numeral, HandShape>> = {
  I: shapeFromFingers({ index: true }),
  II: shapeFromFingers({ index: true, middle: true }),
  III: shapeFromFingers({ index: true, middle: true, ring: true }),
  IV: shapeFromFingers({ index: true, middle: true, ring: true, pinky: true }),
  V: shapeFromFingers({ thumb: true, index: true, middle: true, ring: true, pinky: true }),
  VI: ROCK_SIGN,
  VII: ROCK_SIGN_THUMB,
};

/** The expression hand's pose for a kind of chord, from the shipped map. */
export function kindShape(kind: string): HandShape | null {
  for (const [shape, quality] of DEFAULT_EXPRESSION_MAP.qualities) {
    if (quality === kind) return shape;
  }
  return null;
}

/** Whether a numeral's case says minor. */
export const isMinor = (numeral: ChordNumeral): boolean => numeral === numeral.toLowerCase();

/** The chord hand's shape for a step: closed when there is no chord. */
export function chordShape(step: DemoStep): HandShape {
  return step.chord === null ? 0 : DEMO_CHORD_SHAPES[step.chord.toUpperCase() as Numeral];
}

/** The two hands for a step: the chord hand leaning outward for a minor chord. */
export function stepHands(
  step: DemoStep,
  chordHand: HandSide,
): { readonly chord: HandPoseSpec; readonly kind: HandPoseSpec } {
  const kindHand: HandSide = chordHand === "left" ? "right" : "left";
  const minor = step.chord !== null && isMinor(step.chord);

  return {
    chord: specFromShape(chordShape(step), {
      hand: chordHand,
      tilt: minor ? "outward" : "upright",
    }),
    kind: specFromShape(step.kind === null ? 0 : (kindShape(step.kind) ?? 0), { hand: kindHand }),
  };
}

/**
 * The step as the instrument's intent — what a player's hands making these
 * shapes would be read as — or `null` for silence.
 */
export function chordStateOf(step: DemoStep): ChordState | null {
  if (step.chord === null || step.kind === null) return null;

  return { chord: step.chord, isMajorMode: !isMinor(step.chord), quality: step.kind };
}

/** Where in the song a moment falls. */
export interface DemoMoment {
  readonly index: number;
  readonly step: DemoStep;
  /** The beat within the step, from 0. */
  readonly beat: number;
}

const beatMs = (song: DemoSong): number => 60_000 / song.bpm;

/** The song's length, once through. */
export function songLength(song: DemoSong): number {
  return song.steps.reduce((total, step) => total + step.beats, 0) * beatMs(song);
}

/** The step and beat at `elapsed` milliseconds in, looping. */
export function momentAt(song: DemoSong, elapsed: number): DemoMoment {
  const length = songLength(song);
  const into = ((elapsed % length) + length) % length;
  const beat = beatMs(song);
  let start = 0;

  for (let index = 0; index < song.steps.length; index += 1) {
    const step = song.steps[index];
    const end = start + step.beats * beat;

    if (into < end) return { index, step, beat: Math.floor((into - start) / beat) };
    start = end;
  }

  // Unreachable while the modulo holds, but a step must always come back.
  const last = song.steps.length - 1;
  return { index: last, step: song.steps[last], beat: song.steps[last].beats - 1 };
}

/**
 * How far ahead of a chord the hands start to make it.
 *
 * A player forms the shape *before* the beat, so it is held on the beat; a demo
 * whose hands began moving on the beat would be showing them late.
 */
export const LEAD_MS = 260;
