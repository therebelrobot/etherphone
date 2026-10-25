/**
 * Hand-landmark interpretation.
 *
 * Everything here is a pure function of MediaPipe landmark coordinates: no DOM,
 * no audio, no module state. That makes the gesture rules easy to test and easy
 * to re-tune.
 */
import { TILT_MAX_TRAVEL, VOLUME_BOTTOM_Y, VOLUME_TOP_Y } from "../config/constants";
import { ROMAN_BY_FINGER_COUNT } from "../config/music";
import type { ChordMode, ChordNumeral, FingerName, Hand, Handedness } from "../types";

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

/**
 * Reads the chord hand into a roman numeral.
 *
 * Finger count picks the scale degree (1–5), except for the two rock-sign
 * shapes which map to VI and VII. Case carries the mode.
 */
export function classifyChord(landmarks: Hand, handedness: Handedness): ChordNumeral | null {
  const thumb = isThumbExtended(landmarks, handedness);
  const index = isFingerExtended(landmarks, "index");
  const middle = isFingerExtended(landmarks, "middle");
  const ring = isFingerExtended(landmarks, "ring");
  const pinky = isFingerExtended(landmarks, "pinky");

  const quality = getChordQuality(landmarks);

  if (index && pinky && !middle && !ring && !thumb) {
    return quality === "major" ? "VI" : "vi";
  }

  if (index && pinky && !middle && !ring && thumb) {
    return quality === "major" ? "VII" : "vii";
  }

  const count = [thumb, index, middle, ring, pinky].filter(Boolean).length;
  const base = ROMAN_BY_FINGER_COUNT[count];
  if (!base) return null;

  return quality === "major" ? base : (base.toLowerCase() as ChordNumeral);
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
