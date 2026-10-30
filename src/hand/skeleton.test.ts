import { describe, expect, it } from "vitest";
import { ALL_SHAPES, OPEN_HAND, ROCK_SIGN } from "../music/gesture-map";
import type { Handedness } from "../types";
import {
  getChordQuality,
  getHandHorizontalTilt,
  isHandClosed,
  readHandShape,
} from "../vision/gestures";
import { resolvePose, specFromShape } from "./pose";
import type { HandPoseSpec, HandSide } from "./pose";
import { HAND_LENGTH, handLandmarks, poseHand } from "./skeleton";

const posed = (spec: HandPoseSpec, mirrored = true) => poseHand(resolvePose(spec), mirrored);

const HANDEDNESS: Record<HandSide, Handedness> = { left: "Left", right: "Right" };

describe("the drawn hand, read by the instrument", () => {
  // The guarantee the engine exists for: a player who copies the drawing makes the
  // shape it names. The drawing is checked by the same function that reads a
  // player's hand off the camera, fed the landmarks MediaPipe would report for it.
  for (const hand of ["left", "right"] as const) {
    it(`reads every shape a ${hand} hand is drawn making, palm to the camera`, () => {
      for (const shape of ALL_SHAPES) {
        const landmarks = handLandmarks(posed(specFromShape(shape, { hand })));

        expect(readHandShape(landmarks, HANDEDNESS[hand]), `shape ${shape}`).toBe(shape);
      }
    });

    it(`still reads them with the ${hand} hand's fingers fanned or held together`, () => {
      for (const spread of [0, 1]) {
        for (const shape of ALL_SHAPES) {
          const landmarks = handLandmarks(posed(specFromShape(shape, { hand, spread })));

          expect(readHandShape(landmarks, HANDEDNESS[hand]), `shape ${shape}`).toBe(shape);
        }
      }
    });
  }

  it("reads a closed hand as closed, which is the gesture that opens the menu", () => {
    expect(isHandClosed(handLandmarks(posed(specFromShape(0))))).toBe(true);
    expect(isHandClosed(handLandmarks(posed(specFromShape(ROCK_SIGN))))).toBe(false);
  });

  describe("tilt", () => {
    const reading = (hand: HandSide, tilt: HandPoseSpec["tilt"], shape = OPEN_HAND) =>
      getHandHorizontalTilt(
        handLandmarks(posed(specFromShape(shape, { hand, tilt }))),
        HANDEDNESS[hand],
      );

    for (const hand of ["left", "right"] as const) {
      it(`reads a ${hand} hand drawn leaning inward as inward, and outward as outward`, () => {
        // Inward is positive to the instrument on both hands — it is what picks
        // major — though on screen the two hands lean opposite ways to do it.
        expect(reading(hand, "inward")).toBeGreaterThan(0.25);
        expect(reading(hand, "outward")).toBeLessThan(-0.25);
      });

      it(`reads a ${hand} hand drawn upright as no tilt at all`, () => {
        // Close to rather than equal: the right hand's reading is negated, and zero
        // negated is -0.
        expect(reading(hand, "upright")).toBeCloseTo(0, 9);
        // The instrument has a dead zone, so a slight lean is still upright.
        expect(reading(hand, 0.05)).toBeCloseTo(0, 9);
      });

      it(`reads more tilt the further the ${hand} hand is drawn leaning`, () => {
        const readings = [0.25, 0.5, 0.75, 1].map((tilt) => reading(hand, tilt));

        for (let i = 1; i < readings.length; i += 1) {
          expect(readings[i]).toBeGreaterThan(readings[i - 1]);
        }
      });

      it(`still reads every shape on a ${hand} hand leaning fully either way`, () => {
        // Leaning moves the fingers and the thumb, and the instrument reads both by
        // screen direction: a lean must not turn one shape into another.
        for (const tilt of [-1, 1]) {
          for (const shape of ALL_SHAPES) {
            const landmarks = handLandmarks(posed(specFromShape(shape, { hand, tilt })));

            expect(readHandShape(landmarks, HANDEDNESS[hand]), `shape ${shape}, tilt ${tilt}`).toBe(
              shape,
            );
          }
        }
      });
    }

    it("leans a left hand clockwise inward on screen, and a right hand the other way", () => {
      // The mirror again: a left hand is on the left, so its middle is to its right.
      const lean = (hand: HandSide) => {
        const drawn = posed(specFromShape(OPEN_HAND, { hand, tilt: "inward" }));
        return drawn.digits.middle.tip[0] - drawn.wrist[0];
      };

      expect(lean("left")).toBeGreaterThan(0);
      expect(lean("right")).toBeLessThan(0);
    });
  });

  it("agrees with classifyChord's reading of a lean, which goes by screen direction", () => {
    // `getChordQuality` does not ask which hand it is: fingers leaning left on
    // screen — the camera's right — read as minor for either. `roll` is in the same
    // screen terms, so the two agree.
    for (const hand of ["left", "right"] as const) {
      const leanLeft = handLandmarks(posed({ ...specFromShape(OPEN_HAND, { hand }), roll: -0.3 }));
      const leanRight = handLandmarks(posed({ ...specFromShape(OPEN_HAND, { hand }), roll: 0.3 }));

      expect(getChordQuality(leanLeft)).toBe("minor");
      expect(getChordQuality(leanRight)).toBe("major");
    }
  });
});

describe("poseHand", () => {
  const thumbX = (spec: HandPoseSpec, mirrored = true) => posed(spec, mirrored).digits.thumb.tip[0];
  const pinkyX = (spec: HandPoseSpec, mirrored = true) => posed(spec, mirrored).digits.pinky.tip[0];
  const open = (hand: HandSide, facing: "palm" | "back"): HandPoseSpec =>
    specFromShape(OPEN_HAND, { hand, facing });

  it("puts a left palm's thumb on the screen's right, as a mirror does", () => {
    // Hold up your left hand, palm out, in front of a mirror: the thumb points to
    // the middle of you, which is the mirror's right. A drawing that disagrees
    // cannot be followed.
    expect(thumbX(open("left", "palm"))).toBeGreaterThan(pinkyX(open("left", "palm")));
    expect(thumbX(open("right", "palm"))).toBeLessThan(pinkyX(open("right", "palm")));
  });

  it("swaps the thumb's side when the back is turned to the camera", () => {
    expect(thumbX(open("left", "back"))).toBeLessThan(pinkyX(open("left", "back")));
    expect(thumbX(open("right", "back"))).toBeGreaterThan(pinkyX(open("right", "back")));
  });

  it("swaps it again when the view is not mirrored", () => {
    expect(thumbX(open("left", "palm"), false)).toBeLessThan(pinkyX(open("left", "palm"), false));
  });

  it("draws the left hand as the right hand's reflection", () => {
    const left = posed(open("left", "palm"));
    const right = posed(open("right", "palm"));

    for (const digit of ["thumb", "index", "pinky"] as const) {
      const [lx, ly, lz] = left.digits[digit].tip;
      const [rx, ry, rz] = right.digits[digit].tip;

      expect(lx).toBeCloseTo(-rx, 6);
      expect(ly).toBeCloseTo(ry, 6);
      expect(lz).toBeCloseTo(rz, 6);
    }
  });

  it("is a hand's length from the wrist to the middle fingertip, held straight", () => {
    const hand = posed({ fingers: { middle: 0 } });
    const [x, y] = hand.digits.middle.tip;
    const [wx, wy] = hand.wrist;

    // The fingers keep a slight natural bend even straight, so a little short.
    expect(Math.hypot(x - wx, y - wy)).toBeGreaterThan(HAND_LENGTH * 0.97);
    expect(Math.hypot(x - wx, y - wy)).toBeLessThanOrEqual(HAND_LENGTH);
  });

  it("orders the fingers by length the way a hand does", () => {
    const hand = posed(specFromShape(OPEN_HAND, { spread: 0 }));
    const height = (digit: "index" | "middle" | "ring" | "pinky") => hand.digits[digit].tip[1];

    expect(height("middle")).toBeGreaterThan(height("ring"));
    expect(height("ring")).toBeGreaterThan(height("index"));
    expect(height("index")).toBeGreaterThan(height("pinky"));
  });

  it("folds a closed finger towards whatever the palm faces", () => {
    // Palm to the camera, a fist comes towards it; back to the camera, away.
    const palm = posed({ facing: "palm" });
    const back = posed({ facing: "back" });

    expect(palm.digits.index.joints[1][2]).toBeGreaterThan(palm.digits.index.joints[0][2]);
    expect(back.digits.index.joints[1][2]).toBeLessThan(back.digits.index.joints[0][2]);
  });

  it("lays a tucked thumb over the fingers once they are folded, not through them", () => {
    const tucked = posed({ fingers: { index: 0, middle: 0, ring: 0, pinky: 0 } });
    const fist = posed({});

    expect(fist.digits.thumb.joints[1][2]).toBeGreaterThan(tucked.digits.thumb.joints[1][2] + 1);
  });

  it("keeps its pivot still while the fingers move, so the hand does not slide about", () => {
    const open = posed(specFromShape(OPEN_HAND));
    const closed = posed(specFromShape(0));

    expect(open.wrist).toEqual(closed.wrist);
    expect(open.digits.index.joints[0]).toEqual(closed.digits.index.joints[0]);
  });
});

describe("handLandmarks", () => {
  it("reports MediaPipe's 21 points, in the camera's unmirrored image", () => {
    const hand = posed(specFromShape(OPEN_HAND, { hand: "left" }));
    const landmarks = handLandmarks(hand);

    expect(landmarks).toHaveLength(21);
    // On screen a left palm's thumb is on the right; in the camera's own image,
    // which is what MediaPipe sees, it is on the left.
    expect(landmarks[4].x).toBeLessThan(landmarks[20].x);
    // Image y runs down: the fingertips are above the wrist.
    expect(landmarks[12].y).toBeLessThan(landmarks[0].y);
  });

  it("puts the wrist at depth zero, as MediaPipe does", () => {
    expect(handLandmarks(posed({}))[0].z).toBeCloseTo(0, 9);
  });
});
