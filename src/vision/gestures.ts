/**
 * Hand-landmark interpretation.
 *
 * Everything here is a pure function of MediaPipe landmark coordinates: no DOM,
 * no audio, no module state. That makes the gesture rules easy to test and easy
 * to re-tune.
 */
import { TILT_MAX_TRAVEL, VOLUME_BOTTOM_Y, VOLUME_TOP_Y } from "../config/constants";
import { shapeFromFingers } from "../music/gesture-map";
import type {
  ChordMode,
  ChordNumeral,
  FingerName,
  GestureMap,
  Hand,
  Handedness,
  HandShape,
} from "../types";

/** The joint pair that decides whether a finger is extended. */
export const FINGERS: Record<FingerName, { readonly pip: number; readonly tip: number }> = {
  index: { pip: 6, tip: 8 },
  middle: { pip: 10, tip: 12 },
  ring: { pip: 14, tip: 16 },
  pinky: { pip: 18, tip: 20 },
};

/** Landmark index of the thumb tip. */
const THUMB_TIP = 4;
/** Landmark index of the thumb's interphalangeal joint. */
const THUMB_IP = 3;
/** Landmark index of the wrist. */
const WRIST = 0;
/** Landmark index of the middle-finger knuckle. */
const MIDDLE_MCP = 9;
/** Landmark index of the ring-finger knuckle. */
const RING_MCP = 13;

/** A finger is extended when its tip sits above its middle joint in screen space. */
export function isFingerExtended(landmarks: Hand, name: FingerName): boolean {
  const { pip, tip } = FINGERS[name];
  return landmarks[tip].y < landmarks[pip].y;
}

/** The thumb reads horizontally, so its direction depends on which hand it is. */
export function isThumbExtended(landmarks: Hand, handedness: Handedness): boolean {
  const thumbTip = landmarks[THUMB_TIP];
  const thumbIp = landmarks[THUMB_IP];

  if (handedness === "Right") {
    return thumbTip.x > thumbIp.x;
  }
  return thumbTip.x < thumbIp.x;
}

/** The chord hand's roll decides the mode: inward is major, outward is minor. */
export function getChordQuality(landmarks: Hand): ChordMode {
  const wrist = landmarks[WRIST];
  const middleMcp = landmarks[MIDDLE_MCP];
  return middleMcp.x > wrist.x ? "minor" : "major";
}

/** Reads the hand's extended fingers into a single shape bitmask. */
export function readHandShape(landmarks: Hand, handedness: Handedness): HandShape {
  return shapeFromFingers({
    thumb: isThumbExtended(landmarks, handedness),
    index: isFingerExtended(landmarks, "index"),
    middle: isFingerExtended(landmarks, "middle"),
    ring: isFingerExtended(landmarks, "ring"),
    pinky: isFingerExtended(landmarks, "pinky"),
  });
}

/**
 * Reads the chord hand into a roman numeral, using the supplied vocabulary.
 *
 * The shape is looked up in the map rather than reasoned about here, so the
 * gesture language is data a player can choose. When the map lets tilt pick the
 * mode, the numeral's case is overwritten from the hand's roll; when it does
 * not, the case the map stored is the one that plays.
 */
export function classifyChord(
  landmarks: Hand,
  handedness: Handedness,
  map: GestureMap,
): ChordNumeral | null {
  const numeral = map.shapes.get(readHandShape(landmarks, handedness)) ?? null;
  if (!numeral) return null;

  if (!map.tiltPicksMode) return numeral;

  const quality = getChordQuality(landmarks);
  return quality === "major"
    ? (numeral.toUpperCase() as ChordNumeral)
    : (numeral.toLowerCase() as ChordNumeral);
}

/**
 * How far the wrist has slipped sideways past the two knuckle "pillars".
 *
 * Returns a value in -1..1. A wrist inside the pillars is a deliberate dead
 * zone, so a centred hand reports 0 rather than jittering around it.
 */
export function getHandHorizontalTilt(landmarks: Hand, handedness: Handedness): number {
  // Guard against malformed landmark arrays; a dropped frame must not freeze the loop.
  if (!landmarks || typeof landmarks.length === "undefined" || landmarks.length < 18) {
    return 0;
  }

  try {
    const wrist = landmarks[WRIST];
    const middleMcp = landmarks[MIDDLE_MCP];
    const ringMcp = landmarks[RING_MCP];

    if (!wrist || !middleMcp || !ringMcp) return 0;

    const minX = Math.min(middleMcp.x, ringMcp.x);
    const maxX = Math.max(middleMcp.x, ringMcp.x);

    let tiltFactor: number;

    if (wrist.x < minX) {
      tiltFactor = (wrist.x - minX) / TILT_MAX_TRAVEL;
    } else if (wrist.x > maxX) {
      tiltFactor = (wrist.x - maxX) / TILT_MAX_TRAVEL;
    } else {
      tiltFactor = 0;
    }

    tiltFactor = Math.max(-1, Math.min(1, tiltFactor));

    // The right hand reads its tilt inverted, so "inward" feels the same on both.
    if (handedness === "Right") {
      tiltFactor = -tiltFactor;
    }

    return tiltFactor;
  } catch (error) {
    console.error("Buffered tilt calculation failed:", error);
    return 0;
  }
}

/**
 * The wrist's height in the frame: 0 at the top edge, 1 at the bottom.
 *
 * Raw, unlike {@link getVolumeFromHeight}, because the mono voice maps it onto
 * pitch rather than loudness and wants its own band.
 */
export function getHandHeight(landmarks: Hand): number {
  return landmarks[WRIST].y;
}

/** Wrist height, mapped onto 0..1 with higher meaning louder. */
export function getVolumeFromHeight(landmarks: Hand): number {
  const wrist = landmarks[WRIST];

  const clamped = Math.max(VOLUME_TOP_Y, Math.min(VOLUME_BOTTOM_Y, wrist.y));
  const t = (clamped - VOLUME_TOP_Y) / (VOLUME_BOTTOM_Y - VOLUME_TOP_Y);
  return 1 - t;
}

/** How many of the four long fingers the voicing hand is holding up. */
export function getRightHandQualityIndex(landmarks: Hand): number {
  const index = isFingerExtended(landmarks, "index");
  const middle = isFingerExtended(landmarks, "middle");
  const ring = isFingerExtended(landmarks, "ring");
  const pinky = isFingerExtended(landmarks, "pinky");

  return [index, middle, ring, pinky].filter(Boolean).length;
}
