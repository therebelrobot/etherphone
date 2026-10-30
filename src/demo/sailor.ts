/**
 * The second demonstration's score: looping, layering, and the mono voice, to
 * *What Shall We Do with the Drunken Sailor?*
 *
 * A shanty because a shanty is built to loop — a call sung over and over to the
 * same two chords while the work goes round — and this is the one nearly everyone
 * can hum. It is traditional and in the public domain. The first half of the
 * verse is the whole demo: four bars, the instrument's default loop length, at
 * its default tempo, on two chords. In C it is ii, ii, I, I — the D minor and C of
 * the tune's D dorian — so the chord hand needs only two shapes, one of them the
 * outward lean, and the melody stays inside one octave of the mono voice.
 *
 * The run of the demo, in beats from its start:
 *
 *  0  close a hand, flick it up — Record              (transport starts)
 *  4  count-in: the recording waits for the bar
 *  8  record layer 1, the chords
 * 24  the loop plays on its own; both hands closed is the menu → Mono
 * 30  the chord hand is now the pitch hand: its height is the note
 * 36  the other hand flicks up — Record again
 * 40  record layer 2, the tune, over the chords
 * 56  hands down: both layers loop
 * 66  a hand comes back, closes, flicks down — Stop
 * 72  and round again
 *
 * Only *what the hands do* lives here — not what they play. What is played is
 * read off the drawn hands by the instrument's own readers, exactly as off a
 * camera; whether that records, when the recording starts and what plays back is
 * decided by a real `Transport` and `Looper`. So the beats above are the score,
 * and the instrument is what makes them true.
 */
import { specFromShape } from "../hand";
import type { HandPoseSpec } from "../hand";
import { OPEN_HAND, shapeFromFingers } from "../music/gesture-map";
import { heightForDegree } from "../music/mono";
import type { TransportCommand } from "../vision/transport-gesture";
import type { ChordNumeral, InstrumentMode } from "../types";
import { DEMO_CHORD_SHAPES } from "./song";

/** One bar of the loop. */
export interface SailorBar {
  readonly lyric: string;
  readonly chord: ChordNumeral;
  /**
   * The tune, as `[beat in the bar, scale degree]`, each note held until the next.
   *
   * Degrees of the major scale counted past the seventh, as the mono voice counts
   * them — an octave up, so the hand works the upper half of the frame. Repeated
   * syllables on one note are one held note: a steady hand holds its note, and the
   * demo shows what a hand does.
   */
  readonly tune: readonly (readonly [beat: number, degree: number])[];
}

/** A = 13, D = 9, F = 11; G = 12, C = 8, E = 10 — degrees of C, an octave up. */
export const SAILOR_BARS: readonly SailorBar[] = [
  { lyric: "What shall we do with a", chord: "ii", tune: [[0, 13]] },
  {
    lyric: "drun-ken sai-lor?",
    chord: "ii",
    tune: [
      [0, 13],
      [1, 9],
      [2, 11],
      [3, 13],
    ],
  },
  { lyric: "What shall we do with a", chord: "I", tune: [[0, 12]] },
  {
    lyric: "drun-ken sai-lor?",
    chord: "I",
    tune: [
      [0, 12],
      [1, 8],
      [2, 10],
      [3, 12],
    ],
  },
];

export const SAILOR = {
  title: "What Shall We Do with the Drunken Sailor?",
  credit: "traditional sea shanty, early 1800s · public domain",
  /** The instrument's defaults: a player who copies the demo needs to change nothing. */
  bpm: 100,
  loopBars: 4,
  beatsPerBar: 4,
} as const;

/** Where the score's moments fall, in beats from the demo's start. */
export const CUES = {
  recordChords: 4,
  chordsFrom: 8,
  // A touch before the loop comes round, so the live chord has stopped by the
  // time the recorded one starts.
  menuFrom: 23.8,
  monoAt: 30,
  recordTune: 38,
  tuneFrom: 40,
  // Just after the tune's take has closed, not on its last beat: a hand dropping
  // through the frame plays every note on the way down, and in the take's last
  // moment those notes would be recorded — onto the loop's start, where a note
  // played just before the loop comes round belongs.
  handsDown: 56.3,
  handsBack: 66,
  stop: 71,
  end: 76,
} as const;

const LOOP_BEATS = SAILOR.loopBars * SAILOR.beatsPerBar;

/** What the demo tells the looper to do, and when. */
export interface SailorAction {
  readonly at: number;
  readonly command: TransportCommand;
  /** The mode a recording is made in. */
  readonly mode: InstrumentMode;
  readonly hand: "chord" | "kind";
}

export const SAILOR_ACTIONS: readonly SailorAction[] = [
  { at: CUES.recordChords, command: "record", mode: "chord", hand: "chord" },
  { at: CUES.recordTune, command: "record", mode: "mono", hand: "kind" },
  { at: CUES.stop, command: "stop", mode: "mono", hand: "kind" },
];

/** One hand at one moment of the score. */
export interface ScoreHand {
  readonly pose: HandPoseSpec;
  /** Where its wrist is in the frame, 0 at the top — what the instrument reads as height. */
  readonly height: number;
  /** 1 in the frame; faded as it drops out of it. */
  readonly presence: number;
}

/** A fist waiting to flick, and how far the flick has gone. */
export interface ScoreFist {
  readonly hand: "chord" | "kind";
  readonly command: TransportCommand;
  /** Beats the fist has been held still, for the cue's fade-in. */
  readonly heldBeats: number;
  /** 0 until the flick starts, 1 when it fires. */
  readonly progress: number;
}

export interface ScoreFrame {
  readonly mode: InstrumentMode;
  readonly chord: ScoreHand;
  readonly kind: ScoreHand;
  readonly fist: ScoreFist | null;
  /** True while both hands are closed for the menu, which silences what is played. */
  readonly menu: boolean;
  /** What is happening, in a line. */
  readonly caption: string;
}

/** How far a flick carries the fist, in frame heights. */
const FLICK = 0.12;
/** The height both hands play at: the middle of the frame. */
export const REST_HEIGHT = 0.5;
/** Below the frame, which is where a hand goes when it stops playing. */
const DOWN_HEIGHT = 1.08;
/**
 * How far ahead of the beat a hand heads for its next shape or note.
 *
 * A player moves *before* the beat so the shape is there on it. And what is
 * played is read off the hand, through the instrument's stabiliser — which takes
 * a chord only once it has been held a tenth of a second — so a hand that moved
 * on the beat would sound late.
 */
export const LEAD_BEATS = 0.3;

/**
 * The pitch hand's lead, which is much shorter: the mono voice reads the hand's
 * height directly, with no stabiliser to wait for, so the hand only needs to be
 * at the note's height as the beat arrives.
 */
const TUNE_LEAD_BEATS = 0.08;

const FIST = specFromShape(0);
const ONE = specFromShape(shapeFromFingers({ index: true }));
const OPEN = specFromShape(OPEN_HAND);

/** The chord hand's pose for a chord, the outward lean included. */
function chordPose(chord: ChordNumeral): HandPoseSpec {
  const minor = chord === chord.toLowerCase();
  const shape = DEMO_CHORD_SHAPES[chord.toUpperCase() as keyof typeof DEMO_CHORD_SHAPES];

  return specFromShape(shape, { tilt: minor ? "outward" : "upright" });
}

/** The tune's degree at a demo beat during the recording of the tune. */
export function tuneDegreeAt(beat: number): number {
  const into = (((beat - CUES.tuneFrom) % LOOP_BEATS) + LOOP_BEATS) % LOOP_BEATS;
  const bar = SAILOR_BARS[Math.floor(into / 4)];
  const inBar = into % 4;
  let degree = bar.tune[0][1];

  for (const [at, note] of bar.tune) if (at <= inBar) degree = note;
  return degree;
}

const hand = (pose: HandPoseSpec, height = REST_HEIGHT, presence = 1): ScoreHand => ({
  pose,
  height,
  presence,
});

/** A fist that closes at `from`, waits, then flicks over the beat before `fires`. */
function flick(
  beat: number,
  from: number,
  fires: number,
  command: TransportCommand,
  which: "chord" | "kind",
): { readonly hand: ScoreHand; readonly fist: ScoreFist } {
  const flickFrom = fires - 0.6;
  const progress = beat < flickFrom ? 0 : Math.min(1, (beat - flickFrom) / (fires - flickFrom));
  const direction = command === "stop" ? 1 : -1;

  return {
    hand: hand(FIST, REST_HEIGHT + direction * FLICK * progress),
    // The cue appears once the fist has settled, as the instrument's does.
    fist: { hand: which, command, heldBeats: Math.max(0, beat - from - 0.6), progress },
  };
}

/** The score at a beat of the demo. */
export function scoreAt(beat: number): ScoreFrame {
  const mode: InstrumentMode = beat < CUES.monoAt ? "chord" : "mono";
  const base = { mode, fist: null, menu: false } as const;
  const downChord = hand(ONE, DOWN_HEIGHT, 0);
  const downKind = hand(ONE, DOWN_HEIGHT, 0);

  if (beat < 1.5) {
    return {
      ...base,
      chord: hand(chordPose("ii")),
      kind: hand(ONE),
      caption: "Chords mode. Close one hand, then flick it up to record",
    };
  }

  if (beat < CUES.recordChords) {
    const { hand: fist, fist: cue } = flick(beat, 1.5, CUES.recordChords, "record", "chord");
    return {
      ...base,
      chord: fist,
      kind: hand(ONE),
      fist: cue,
      caption: "Close one hand, then flick it up to record",
    };
  }

  if (beat < CUES.chordsFrom) {
    return {
      ...base,
      chord: hand(chordPose("ii")),
      kind: hand(ONE),
      caption: "Counting in: the recording starts on the next bar",
    };
  }

  if (beat < CUES.menuFrom) {
    // The hands go for each chord a little before its bar, so it is held on the
    // beat — but not past the last bar, or they would go back to the first.
    const bar = SAILOR_BARS[Math.min(3, Math.floor((beat + LEAD_BEATS - CUES.chordsFrom) / 4))];
    return {
      ...base,
      chord: hand(chordPose(bar.chord)),
      kind: hand(ONE),
      caption: "Recording layer 1: the chords",
    };
  }

  if (beat < CUES.monoAt) {
    return {
      ...base,
      menu: true,
      chord: hand(FIST),
      kind: hand(FIST),
      caption: "The loop plays on. Both hands closed: the menu — Settings, then Mono",
    };
  }

  const pointing = (height: number) => hand(ONE, height);
  const ready = pointing(heightForDegree(tuneDegreeAt(CUES.tuneFrom)));

  if (beat < CUES.recordTune - 2) {
    return {
      ...base,
      chord: ready,
      kind: hand(ONE),
      caption: "Mono: the chord hand's height is the note",
    };
  }

  if (beat < CUES.recordTune) {
    const { hand: fist, fist: cue } = flick(
      beat,
      CUES.recordTune - 2,
      CUES.recordTune,
      "record",
      "kind",
    );
    return {
      ...base,
      chord: ready,
      kind: fist,
      fist: cue,
      caption: "The other hand flicks up: record a second layer",
    };
  }

  if (beat < CUES.tuneFrom) {
    return {
      ...base,
      chord: ready,
      kind: hand(ONE),
      caption: "Counting in, holding the first note",
    };
  }

  if (beat < CUES.handsDown) {
    // Not past the end of this pass, or the hand would reach for the next one's
    // first note — and record it at the end of this one.
    const degree = tuneDegreeAt(
      Math.min(beat + TUNE_LEAD_BEATS, CUES.tuneFrom + LOOP_BEATS - 0.01),
    );
    return {
      ...base,
      chord: pointing(heightForDegree(degree)),
      kind: hand(ONE),
      caption: "Recording layer 2: the tune, over the chords",
    };
  }

  if (beat < CUES.handsBack) {
    return {
      ...base,
      chord: downChord,
      kind: downKind,
      caption: "Hands down: both layers loop on their own",
    };
  }

  if (beat < CUES.stop) {
    const { hand: fist, fist: cue } = flick(beat, CUES.handsBack, CUES.stop, "stop", "kind");
    return {
      ...base,
      chord: downChord,
      kind: fist,
      fist: cue,
      caption: "Close a hand and flick it down to stop",
    };
  }

  return {
    ...base,
    chord: downChord,
    kind: hand(OPEN, DOWN_HEIGHT, 0),
    caption: "Stopped. Flick left to clear, and build it again",
  };
}

/** The bar of the song a loop position is in, for the words. */
export function barAtLoopBeat(position: number): SailorBar {
  return SAILOR_BARS[Math.floor((((position % LOOP_BEATS) + LOOP_BEATS) % LOOP_BEATS) / 4)];
}
