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
  CanvasPoint,
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

/**
 * Whether the hand is closed into a fist.
 *
 * Judged on the four long fingers only. The thumb reads from the side and is the
 * noisiest landmark, and a fist is a fist whether or not the thumb is tucked.
 *
 * Both hands closed is the gesture that opens the menu. It is safe to use
 * because it is already a silent shape in both modes — a closed chord hand
 * chooses no chord and a closed voicing hand sounds nothing — so the menu cannot
 * be opened at the cost of a note.
 */
export function isHandClosed(landmarks: Hand): boolean {
  return getRightHandQualityIndex(landmarks) === 0;
}

/**
 * The centre of the palm, used as the menu cursor.
 *
 * Midway between the wrist and the middle knuckle, which is steadier than either
 * end of the hand on its own.
 */
/**
 * How close the hand is to the camera, as the mean of the landmarks' depth.
 *
 * MediaPipe reports `z` roughly in the same units as `x`, with the wrist as the
 * origin and **negative toward the camera** — so a hand pushed forward has a
 * *smaller* value here, which is what the articulation gesture reads.
 *
 * Averaged over every landmark rather than read from one: a single point's depth
 * is noisy frame to frame, and the mean is stable enough that a push stands out
 * from resting jitter.
 */
export function getHandDepth(landmarks: Hand): number {
  if (landmarks.length === 0) return 0;

  let total = 0;
  for (const landmark of landmarks) total += landmark.z;

  return total / landmarks.length;
}

export function getHandCenter(landmarks: Hand): CanvasPoint {
  const wrist = landmarks[WRIST];
  const middleMcp = landmarks[MIDDLE_MCP];

  return { x: (wrist.x + middleMcp.x) / 2, y: (wrist.y + middleMcp.y) / 2 };
}
