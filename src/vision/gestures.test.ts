import { describe, expect, it } from "vitest";
import { CLASSIC_GESTURE_MAP, TRIAD_GESTURE_MAP } from "../music/gesture-map";
import type { ChordNumeral, FingerName, GestureMap, Hand, HandShape } from "../types";
import {
  classifyChord,
  getChordQuality,
  getHandCenter,
  getHandHorizontalTilt,
  getRightHandQualityIndex,
  getVolumeFromHeight,
  isFingerExtended,
  isHandClosed,
  isThumbExtended,
  readHandShape,
} from "./gestures";

const FINGER_JOINTS: Record<FingerName, { pip: number; tip: number }> = {
  index: { pip: 6, tip: 8 },
  middle: { pip: 10, tip: 12 },
  ring: { pip: 14, tip: 16 },
  pinky: { pip: 18, tip: 20 },
};

const WRIST = 0;
const THUMB_IP = 3;
const THUMB_TIP = 4;
const MIDDLE_MCP = 9;
const RING_MCP = 13;

/** A neutral 21-point hand: nothing extended, nothing tilted. */
function makeHand(): Hand {
  return Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 1 }));
}

function setPoint(hand: Hand, index: number, x: number, y: number): void {
  hand[index] = { x, y, z: 0, visibility: 1 };
}

/** Extends a finger by raising its tip above its middle joint. */
function setFinger(hand: Hand, name: FingerName, extended: boolean): void {
  const { pip, tip } = FINGER_JOINTS[name];
  setPoint(hand, pip, 0.5, 0.5);
  setPoint(hand, tip, 0.5, extended ? 0.3 : 0.7);
}

/** Points the thumb out to the side, in whichever direction that hand reads. */
function setThumb(hand: Hand, handedness: "Left" | "Right", extended: boolean): void {
  setPoint(hand, THUMB_IP, 0.5, 0.5);
  const outward = handedness === "Right" ? extended : !extended;
  setPoint(hand, THUMB_TIP, outward ? 0.7 : 0.3, 0.5);
}

/** Rolls the hand so the chord quality reads major or minor. */
function setQuality(hand: Hand, quality: "major" | "minor"): void {
  setPoint(hand, WRIST, 0.4, 0.5);
  setPoint(hand, MIDDLE_MCP, quality === "minor" ? 0.6 : 0.3, 0.5);
}

describe("isFingerExtended", () => {
  it("is true when the tip sits above the middle joint", () => {
    const hand = makeHand();
    setFinger(hand, "index", true);
    expect(isFingerExtended(hand, "index")).toBe(true);
  });

  it("is false when the finger is curled", () => {
    const hand = makeHand();
    setFinger(hand, "ring", false);
    expect(isFingerExtended(hand, "ring")).toBe(false);
  });
});

describe("isThumbExtended", () => {
  it("reads a right hand as extended when the tip is to the right", () => {
    const hand = makeHand();
    setThumb(hand, "Right", true);
    expect(isThumbExtended(hand, "Right")).toBe(true);
  });

  it("reads a left hand as extended when the tip is to the left", () => {
    const hand = makeHand();
    setThumb(hand, "Left", true);
    expect(isThumbExtended(hand, "Left")).toBe(true);
  });

  it("is false when the thumb is tucked in", () => {
    const hand = makeHand();
    setThumb(hand, "Right", false);
    expect(isThumbExtended(hand, "Right")).toBe(false);
  });
});

describe("getChordQuality", () => {
  it("is major when the middle knuckle sits left of the wrist", () => {
    const hand = makeHand();
    setQuality(hand, "major");
    expect(getChordQuality(hand)).toBe("major");
  });

  it("is minor when the middle knuckle sits right of the wrist", () => {
    const hand = makeHand();
    setQuality(hand, "minor");
    expect(getChordQuality(hand)).toBe("minor");
  });
});

describe("classifyChord", () => {
  it("returns null when no fingers are extended", () => {
    expect(classifyChord(makeHand(), "Left", CLASSIC_GESTURE_MAP)).toBeNull();
  });

  it("maps one finger to the tonic", () => {
    const hand = makeHand();
    setFinger(hand, "index", true);
    setQuality(hand, "major");
    expect(classifyChord(hand, "Left", CLASSIC_GESTURE_MAP)).toBe("I");
  });

  it("lower-cases the numeral for a minor reading", () => {
    const hand = makeHand();
    setFinger(hand, "index", true);
    setQuality(hand, "minor");
    expect(classifyChord(hand, "Left", CLASSIC_GESTURE_MAP)).toBe("i");
  });

  it("maps five extended fingers to the dominant", () => {
    const hand = makeHand();
    (["index", "middle", "ring", "pinky"] as FingerName[]).forEach((finger) =>
      setFinger(hand, finger, true),
    );
    setThumb(hand, "Left", true);
    setQuality(hand, "major");
    expect(classifyChord(hand, "Left", CLASSIC_GESTURE_MAP)).toBe("V");
  });

  it("maps the rock sign to the submediant", () => {
    const hand = makeHand();
    setFinger(hand, "index", true);
    setFinger(hand, "pinky", true);
    setQuality(hand, "major");
    expect(classifyChord(hand, "Left", CLASSIC_GESTURE_MAP)).toBe("VI");
  });

  it("maps the rock sign with a thumb to the leading tone", () => {
    const hand = makeHand();
    setFinger(hand, "index", true);
    setFinger(hand, "pinky", true);
    setThumb(hand, "Left", true);
    setQuality(hand, "major");
    expect(classifyChord(hand, "Left", CLASSIC_GESTURE_MAP)).toBe("VII");
  });

  it("carries the minor mode through the rock sign", () => {
    const hand = makeHand();
    setFinger(hand, "index", true);
    setFinger(hand, "pinky", true);
    setQuality(hand, "minor");
    expect(classifyChord(hand, "Left", CLASSIC_GESTURE_MAP)).toBe("vi");
  });

  it("looks the shape up in the injected map, not a built-in table", () => {
    const hand = makeHand();
    setQuality(hand, "major");

    // The rock sign is VI under Classic, but only two fingers under Triad.
    setFinger(hand, "index", true);
    setFinger(hand, "pinky", true);
    expect(classifyChord(hand, "Left", CLASSIC_GESTURE_MAP)).toBe("VI");
    expect(classifyChord(hand, "Left", TRIAD_GESTURE_MAP)).toBe("IV");
  });

  it("plays nothing for a shape the map leaves out", () => {
    const hand = makeHand();
    (["index", "middle", "ring", "pinky"] as FingerName[]).forEach((finger) =>
      setFinger(hand, finger, true),
    );
    setThumb(hand, "Left", true);

    // Five fingers is V under Classic, but Triad stops at three.
    expect(classifyChord(hand, "Left", CLASSIC_GESTURE_MAP)).toBe("V");
    expect(classifyChord(hand, "Left", TRIAD_GESTURE_MAP)).toBeNull();
  });

  it("keeps the map's own case when tilt does not pick the mode", () => {
    const hand = makeHand();
    setFinger(hand, "index", true);
    setQuality(hand, "major");

    const fixedMinor: GestureMap = {
      id: "fixed-minor",
      label: "Fixed minor",
      description: "A map that always plays a minor tonic.",
      shapes: new Map<HandShape, ChordNumeral | null>([[2, "i"]]),
      tiltPicksMode: false,
    };

    // The hand reads major, but a map with `tiltPicksMode: false` ignores that.
    expect(classifyChord(hand, "Left", fixedMinor)).toBe("i");
  });
});

describe("readHandShape", () => {
  it("is zero for a closed hand", () => {
    expect(readHandShape(makeHand(), "Left")).toBe(0);
  });

  it("sets only the index bit for a single extended finger", () => {
    const hand = makeHand();
    setFinger(hand, "index", true);
    expect(readHandShape(hand, "Left")).toBe(2);
  });

  it("sets the thumb bit from the handedness-aware reading", () => {
    const hand = makeHand();
    setThumb(hand, "Left", true);
    expect(readHandShape(hand, "Left")).toBe(1);
  });

  it("sets every bit for an open hand", () => {
    const hand = makeHand();
    (["index", "middle", "ring", "pinky"] as FingerName[]).forEach((finger) =>
      setFinger(hand, finger, true),
    );
    setThumb(hand, "Left", true);
    expect(readHandShape(hand, "Left")).toBe(31);
  });
});

describe("getHandHorizontalTilt", () => {
  /** Wrist centred between the knuckle pillars. */
  function makeCentredHand(): Hand {
    const hand = makeHand();
    setPoint(hand, WRIST, 0.5, 0.5);
    setPoint(hand, MIDDLE_MCP, 0.4, 0.5);
    setPoint(hand, RING_MCP, 0.6, 0.5);
    return hand;
  }

  it("reports zero inside the knuckle dead zone", () => {
    expect(getHandHorizontalTilt(makeCentredHand(), "Left")).toBe(0);
  });

  it("saturates at -1 when the wrist slips out to the left", () => {
    const hand = makeCentredHand();
    setPoint(hand, WRIST, 0.4 - 0.12, 0.5);
    expect(getHandHorizontalTilt(hand, "Left")).toBeCloseTo(-1);
  });

  it("clamps travel beyond the dead zone", () => {
    const hand = makeCentredHand();
    setPoint(hand, WRIST, 0, 0.5);
    expect(getHandHorizontalTilt(hand, "Left")).toBe(-1);
  });

  it("inverts the reading for the right hand", () => {
    const hand = makeCentredHand();
    setPoint(hand, WRIST, 0.6 + 0.12, 0.5);
    expect(getHandHorizontalTilt(hand, "Left")).toBeCloseTo(1);
    expect(getHandHorizontalTilt(hand, "Right")).toBeCloseTo(-1);
  });

  it("bails out on a truncated landmark array", () => {
    expect(getHandHorizontalTilt([], "Left")).toBe(0);
  });
});

describe("getVolumeFromHeight", () => {
  function handAtHeight(y: number): Hand {
    const hand = makeHand();
    setPoint(hand, WRIST, 0.5, y);
    return hand;
  }

  it("is loudest at the top of the frame", () => {
    expect(getVolumeFromHeight(handAtHeight(0.05))).toBeCloseTo(1);
  });

  it("is silent at the bottom of the frame", () => {
    expect(getVolumeFromHeight(handAtHeight(0.95))).toBeCloseTo(0);
  });

  it("is halfway at the middle", () => {
    expect(getVolumeFromHeight(handAtHeight(0.5))).toBeCloseTo(0.5);
  });

  it("clamps above and below the mapped band", () => {
    expect(getVolumeFromHeight(handAtHeight(0))).toBeCloseTo(1);
    expect(getVolumeFromHeight(handAtHeight(1))).toBeCloseTo(0);
  });
});

describe("getRightHandQualityIndex", () => {
  it("counts the extended long fingers", () => {
    const hand = makeHand();
    setFinger(hand, "index", true);
    setFinger(hand, "middle", true);
    expect(getRightHandQualityIndex(hand)).toBe(2);
  });

  it("ignores the thumb", () => {
    const hand = makeHand();
    setThumb(hand, "Right", true);
    expect(getRightHandQualityIndex(hand)).toBe(0);
  });
});

describe("isHandClosed", () => {
  it("is true for a fist", () => {
    expect(isHandClosed(makeHand())).toBe(true);
  });

  it("is false as soon as one long finger is up", () => {
    const hand = makeHand();
    setFinger(hand, "index", true);
    expect(isHandClosed(hand)).toBe(false);
  });

  it("ignores the thumb, which is the noisiest landmark", () => {
    const hand = makeHand();
    setThumb(hand, "Right", true);
    expect(isHandClosed(hand)).toBe(true);
  });
});

describe("getHandCenter", () => {
  it("sits midway between the wrist and the middle knuckle", () => {
    const hand = makeHand();
    setPoint(hand, WRIST, 0.4, 0.6);
    setPoint(hand, MIDDLE_MCP, 0.6, 0.2);

    expect(getHandCenter(hand)).toEqual({ x: 0.5, y: 0.4 });
  });
});
