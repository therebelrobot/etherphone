/**
 * Cross-cutting tunables.
 *
 * Anything a future contributor might reasonably want to nudge lives here rather
 * than buried inside the render loop.
 */

/**
 * The instrument's name, in one place.
 *
 * It appears in readouts and in every user-facing error message, so renaming the
 * project is a one-line change rather than a search across the source.
 */
export const PROJECT_NAME = "Etherphone";

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

/**
 * The vertical band of the frame the mono voice maps onto its pitch range.
 *
 * Slightly inset from the volume band so a note is already sounding by the time
 * the hand reaches the very top or bottom of the frame.
 */
export const MONO_PITCH_TOP_Y = 0.1;
export const MONO_PITCH_BOTTOM_Y = 0.9;

/** Octaves the pitch hand spans, from the bottom of its band to the top. */
export const MONO_OCTAVE_SPAN = 2;

/** Radius of the hand-skeleton dots drawn onto the overlay, in canvas pixels. */
export const LANDMARK_DOT_RADIUS = 4;

/**
 * Where the chosen gesture map is remembered between visits. A map that vanished
 * on reload would be a toy, so the picker's choice is persisted.
 */
export const GESTURE_MAP_STORAGE_KEY = "etherphone.gesture-map";

/** Where the instrument mode and the mono style are remembered between visits. */
export const MODE_STORAGE_KEY = "etherphone.mode";
export const MONO_STYLE_STORAGE_KEY = "etherphone.mono-style";

/**
 * The gesture menu.
 *
 * Opening it is a deliberate pause — nothing sounds while a setting is being
 * chosen — so both the gesture that opens it and the dwell that commits a choice
 * are timed generously. All four are the dials to turn if the menu feels wrong
 * in the hand.
 */
export const CONTROL = {
  /** How long both hands must be closed before the menu opens (ms). */
  engageHoldMs: 600,
  /**
   * How far the cursor must travel before the menu starts responding to it, in
   * canvas pixels.
   *
   * The menu opens with the cursor wherever the closed hand already is, which
   * may be sitting over an option. Without this, the dwell would start before
   * the player had read the menu, so nothing is selected until they move.
   */
  moveThreshold: 80,
  /** How long the cursor must rest on an option before it commits (ms). */
  dwellMs: 900,
  /** How long the menu stays open with the cursor off every option (ms). */
  idleTimeoutMs: 5000,
  /** Distance from the menu's centre to an option, in canvas pixels. */
  radius: 190,
  /** Inside this, the cursor selects nothing, so the centre is a neutral spot. */
  deadZone: 70,
  /** Radius of an option's circle, in canvas pixels. */
  optionRadius: 54,
} as const;

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

  /**
   * Portamento time constant, in seconds, for retuning a sounding note.
   *
   * Short enough to read as a slide rather than a swoop. Used by the voices'
   * `retune`, which is what the mono voice's glide style drives.
   */
  glideSeconds: 0.06,

  /**
   * Harmonics a wavetable may use. 64 is well past the point where more
   * harmonics stop changing the timbre, and it bounds the analysis of a loaded
   * file to something that finishes in a frame.
   */
  wavetableMaxHarmonics: 64,
  /** Samples the analyser reads per cycle; longer cycles are decimated to this. */
  wavetableAnalysisSamples: 2048,

  /** Ramp from silence when a sampled note starts, in seconds. */
  samplerAttackSeconds: 0.008,
  /** Ramp to silence when a sampled note stops, in seconds. */
  samplerReleaseSeconds: 0.06,
  /** Extra time before a stopped source is torn down, in seconds. */
  samplerStopPaddingSeconds: 0.02,
  /** Crossfade applied to a looping sample's seam, in milliseconds. */
  samplerLoopFadeMilliseconds: 5,
} as const;
