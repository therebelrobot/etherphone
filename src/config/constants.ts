/**
 * Cross-cutting tunables.
 *
 * Anything a future contributor might reasonably want to nudge lives here rather
 * than buried inside the render loop.
 */

/** How long a new chord must hold before it becomes the committed chord (ms). */
export const CHORD_HOLD_TIME_MS = 100;

/** How long a dropped hand may flicker to nothing before that counts as a change (ms). */
export const VIBE_NULL_WINDOW_MS = 50;

/**
 * MediaPipe assets. The WASM URL pins the runtime this app was built against,
 * independently of the version resolved from the npm package.
 */
export const HAND_LANDMARKER_WASM_URL =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";

export const HAND_LANDMARKER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

/** Hands tracked at once: one for the chord, one for the voicing. */
export const NUM_HANDS = 2;

/** Requested camera capture settings. */
export const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  video: { width: 640, height: 480 },
  audio: false,
};

/** Horizontal wrist travel, in normalised units, that maps to a full 100% tilt. */
export const TILT_MAX_TRAVEL = 0.12;

/** The vertical band of the frame mapped onto the full volume range. */
export const VOLUME_TOP_Y = 0.05;
export const VOLUME_BOTTOM_Y = 0.95;

/** Radius of the hand-skeleton dots drawn onto the overlay, in canvas pixels. */
export const LANDMARK_DOT_RADIUS = 4;

/** Synth voicing and filter response. */
export const AUDIO = {
  /** Lowpass cutoff with a perfectly centred hand. */
  filterBaseFrequency: 1200,
  filterBaseQ: 0.7,
  /** Inward tilt: how far the cutoff drops, and how much resonance is added. */
  warmFrequencyDrop: 950,
  warmQBoost: 1.5,
  /** Outward tilt: how far the cutoff rises, and how much resonance is added. */
  brightFrequencyRise: 3800,
  brightQBoost: 4.5,
  /** Time constant for frame-by-frame parameter ramps, in seconds. */
  smoothingSeconds: 0.04,
  /** Master-gain smoothing used by {@link SynthEngine.updateVolume}, in seconds. */
  gainSmoothingSeconds: 0.03,
  /** Master-gain ramp used by {@link SynthEngine.setVolume}, in seconds. */
  volumeRampSeconds: 0.05,
} as const;
