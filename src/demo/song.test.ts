import { describe, expect, it } from "vitest";
import { handLandmarks, poseHand, resolvePose } from "../hand";
import type { HandSide } from "../hand";
import { DEFAULT_EXPRESSION_MAP, qualityForPose } from "../music/expression-map";
import { CLASSIC_GESTURE_MAP } from "../music/gesture-map";
import { getQuality } from "../music/qualities";
import type { Handedness } from "../types";
import { getHandHorizontalTilt, isHandClosed, readHandShape } from "../vision/gestures";
import { DEMO_SONG, chordStateOf, isMinor, momentAt, songLength, stepHands } from "./song";

const HANDEDNESS: Record<HandSide, Handedness> = { left: "Left", right: "Right" };

/** The drawn hand as the instrument would read it off the camera. */
function read(spec: ReturnType<typeof stepHands>["chord"]) {
  const pose = resolvePose(spec);
  const landmarks = handLandmarks(poseHand(pose));

  return {
    shape: readHandShape(landmarks, HANDEDNESS[pose.hand]),
    tilt: getHandHorizontalTilt(landmarks, HANDEDNESS[pose.hand]),
    closed: isHandClosed(landmarks),
  };
}

describe("the demo, played back through the instrument", () => {
  // The guarantee: a player who copies the demo's hands plays the demo's song.
  // Each step's hands are drawn, read back off the drawing the way the camera
  // would read a real hand, and looked up in the shipped maps.
  for (const chordHand of ["left", "right"] as const) {
    it(`plays every chord it shows, with the chord hand on the ${chordHand}`, () => {
      for (const step of DEMO_SONG.steps) {
        if (step.chord === null) continue;

        const { shape, tilt } = read(stepHands(step, chordHand).chord);
        const numeral = CLASSIC_GESTURE_MAP.shapes.get(shape);

        expect(numeral?.toUpperCase(), step.lyric).toBe(step.chord.toUpperCase());
        // Upright reads as major, which is the instrument's rule: tilt >= 0.
        expect(tilt >= 0, `${step.lyric}: major`).toBe(!isMinor(step.chord));
      }
    });

    it(`plays every kind it shows, with the chord hand on the ${chordHand}`, () => {
      for (const step of DEMO_SONG.steps) {
        if (step.kind === null) continue;

        const { shape } = read(stepHands(step, chordHand).kind);

        expect(qualityForPose(DEFAULT_EXPRESSION_MAP, shape), step.lyric).toBe(step.kind);
      }
    });
  }

  it("ends on both hands closed, the gesture that opens the menu", () => {
    const end = DEMO_SONG.steps.at(-1)!;
    const hands = stepHands(end, "left");

    expect(read(hands.chord).closed).toBe(true);
    expect(read(hands.kind).closed).toBe(true);
  });

  it("shows the gestures worth showing first: counts, tilt both ways, and a seventh", () => {
    const chords = new Set(DEMO_SONG.steps.map((step) => step.chord));
    const kinds = new Set(DEMO_SONG.steps.map((step) => step.kind));

    // Two minors leaning out, a major held upright outside the key, and plain counts.
    expect([...chords]).toEqual(expect.arrayContaining(["vi", "ii", "III", "IV", "I"]));
    expect([...kinds]).toEqual(expect.arrayContaining(["octave", "seventh"]));
  });

  it("names only kinds the instrument has", () => {
    for (const step of DEMO_SONG.steps) {
      if (step.kind !== null) expect(getQuality(step.kind), step.kind).toBeDefined();
    }
  });
});

describe("momentAt", () => {
  const beat = 60_000 / DEMO_SONG.bpm;

  it("starts on the pickup", () => {
    expect(momentAt(DEMO_SONG, 0)).toMatchObject({ index: 0, beat: 0 });
  });

  it("counts beats within a bar", () => {
    // The pickup is one beat, so the first full bar starts on the second.
    expect(momentAt(DEMO_SONG, beat * 1.5)).toMatchObject({ index: 1, beat: 0 });
    expect(momentAt(DEMO_SONG, beat * 3.5)).toMatchObject({ index: 1, beat: 2 });
    expect(momentAt(DEMO_SONG, beat * 5.5)).toMatchObject({ index: 2, beat: 0 });
  });

  it("loops back to the start", () => {
    const length = songLength(DEMO_SONG);

    expect(momentAt(DEMO_SONG, length + beat * 0.5).index).toBe(0);
    expect(momentAt(DEMO_SONG, length - 1).index).toBe(DEMO_SONG.steps.length - 1);
  });
});

describe("chordStateOf", () => {
  it("is the intent the instrument would read off the demo's hands", () => {
    const blind = DEMO_SONG.steps.find((step) => step.chord === "ii")!;

    expect(chordStateOf(blind)).toEqual({ chord: "ii", isMajorMode: false, quality: "octave" });
  });

  it("is silence for the closed hands at the end", () => {
    expect(chordStateOf(DEMO_SONG.steps.at(-1)!)).toBeNull();
  });
});
