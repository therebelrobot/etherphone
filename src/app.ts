/**
 * Gesture Synth application.
 *
 * This is the only module that knows about every layer at once. It owns the
 * per-frame state and drives the pipeline:
 *
 *     camera -> landmarks -> musical intent -> stabiliser -> audio + visuals
 *
 * Each step lives in its own module; everything here is wiring.
 */
import type { HandLandmarker, HandLandmarkerResult } from "@mediapipe/tasks-vision";
import { SynthEngine } from "./audio/synth-engine";
import { getChordDisplayName, getChordTones } from "./music/harmony";
import { ChordStabilizer } from "./music/stabilizer";
import { getSolidNotes, getVoicingLabel } from "./music/voicings";
import type { ChordNumeral, ChordState, Hand, Handedness, KeyName, Waveform } from "./types";
import { getAppElements, resizeCanvasToWindow } from "./ui/dom";
import type { AppElements } from "./ui/dom";
import { GestureGuide } from "./ui/gesture-guide";
import { HelpModal } from "./ui/help-modal";
import { Hud } from "./ui/hud";
import { StartOverlay } from "./ui/start-overlay";
import { VolumeMeter } from "./ui/volume-meter";
import { startCamera } from "./vision/camera";
import {
  classifyChord,
  getHandHorizontalTilt,
  getRightHandQualityIndex,
  getVolumeFromHeight,
  isThumbExtended,
} from "./vision/gestures";
import { createHandLandmarker } from "./vision/hand-tracking";
import { drawFrame } from "./vision/overlay";
import { drawEnergy } from "./visuals/energy";

/** The key name carried on the selected option's `data-note` attribute. */
function readKeyName(select: HTMLSelectElement): KeyName {
  return (select.selectedOptions[0]?.dataset.note ?? "A") as KeyName;
}

/** The waveform carried on the selected option's value. */
function readWaveform(select: HTMLSelectElement): Waveform {
  return select.value as Waveform;
}

export class GestureSynthApp {
  private readonly els: AppElements;
  private readonly synth: SynthEngine;
  private readonly stabilizer = new ChordStabilizer();
  private readonly hud: Hud;
  private readonly guide: GestureGuide;

  /** Most recent landmarks per hand, carried between animation frames. */
  private readonly hands: Record<Handedness, Hand | null> = { Left: null, Right: null };

  private lastVideoTime = -1;

  private tonicFrequency: number;
  private keyName: KeyName;
  private waveform: Waveform;

  constructor() {
    this.els = getAppElements();

    this.synth = new SynthEngine();

    this.hud = new Hud(
      this.els.chordDisplay,
      this.els.qualityDisplay,
      this.els.filterDisplay,
      new VolumeMeter(this.els.volumeBars),
    );

    this.guide = new GestureGuide(this.els.gestureGuide, this.els.guideToggle);

    this.tonicFrequency = Number(this.els.keySelect.value);
    this.keyName = readKeyName(this.els.keySelect);
    this.waveform = readWaveform(this.els.toneSelect);
  }

  /**
   * Wires the UI, then brings up the camera and the gesture loop.
   *
   * Resolves once the hand landmarker has loaded; the render loop then runs
   * until the page is closed.
   */
  async start(): Promise<void> {
    this.wireOverlays();
    this.bindControls();
    this.guide.render(this.keyName);
    this.synth.setWaveform(this.waveform);

    await startCamera(this.els.video);
    resizeCanvasToWindow(this.els.canvas);
    window.addEventListener("resize", () => resizeCanvasToWindow(this.els.canvas));

    const handLandmarker = await createHandLandmarker();
    this.runLoop(handLandmarker);
  }

  /** Constructs the components that own their own event handling. */
  private wireOverlays(): void {
    new StartOverlay(this.els.startOverlay, this.els.canvas, () => this.synth.ensureContext());

    new HelpModal(this.els.helpModal, this.els.helpButton, this.els.closeHelp);
  }

  /** Wires the key and tone selectors. */
  private bindControls(): void {
    this.els.keySelect.addEventListener("change", () => {
      this.tonicFrequency = Number(this.els.keySelect.value);
      this.keyName = readKeyName(this.els.keySelect);
      this.guide.render(this.keyName);
    });

    this.els.toneSelect.addEventListener("change", () => {
      this.waveform = readWaveform(this.els.toneSelect);
      this.synth.setWaveform(this.waveform);
    });
  }

  /**
   * Runs one gesture pass per animation frame.
   *
   * Inference is skipped when the video has not advanced, but the frame is still
   * drawn and the previously cached landmarks keep driving the instrument.
   */
  private runLoop(handLandmarker: HandLandmarker): void {
    const tick = (): void => {
      const now = performance.now();

      if (this.els.video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.els.video.currentTime;

        const results = handLandmarker.detectForVideo(this.els.video, now);
        drawFrame(
          this.els.ctx,
          this.els.video,
          results,
          this.els.canvas.width,
          this.els.canvas.height,
        );
        this.captureHands(results);
      }

      this.updateFrame(now);
      requestAnimationFrame(tick);
    };

    tick();
  }

  /** Records the most recent landmark set for each hand. */
  private captureHands(results: HandLandmarkerResult): void {
    this.hands.Left = null;
    this.hands.Right = null;

    results.landmarks.forEach((landmarks, index) => {
      const handedness = results.handedness[index][0].categoryName as Handedness;

      if (handedness === "Left") {
        this.hands.Left = landmarks;
      }

      if (handedness === "Right") {
        this.hands.Right = landmarks;
      }
    });
  }

  /** Maps one frame of gestures onto sound, readouts, and animation. */
  private updateFrame(now: number): void {
    const { Left, Right } = this.hands;

    const state = this.stabilizer.update(this.readIntent(Left, Right), now);

    const isMajorMode = state?.isMajorMode ?? true;
    const qualityIndex = state?.qualityIndex ?? 0;
    const thumbDown = state?.thumbDown ?? false;
    const chord = state?.chord ?? null;

    this.hud.setChord(getChordDisplayName(chord, isMajorMode, this.keyName), chord);
    this.hud.setQuality(getVoicingLabel(isMajorMode, qualityIndex), thumbDown);

    // Expression follows the voicing hand; with no hand, everything rests.
    const volume = Right ? getVolumeFromHeight(Right) : 0;
    const tilt = Right ? getHandHorizontalTilt(Right, "Right") : 0;

    if (Right) {
      this.hud.setVolume(volume);
      this.hud.setFilter(tilt);
      this.synth.updateFilterSweep(tilt);
      this.updateVoices(state, volume);
    } else {
      this.synth.setVolume(0);
    }

    drawEnergy(this.els.ctx, volume, qualityIndex, tilt, chord);
  }

  /** Sends the current intent to the synth, or silences it. */
  private updateVoices(state: ChordState | null, volume: number): void {
    if (!state || state.qualityIndex < 1) {
      this.synth.setVolume(0);
      return;
    }

    const tones = getChordTones(state.chord, state.isMajorMode, this.tonicFrequency);
    let notes = getSolidNotes(tones, state.qualityIndex, state.isMajorMode);

    // Thumb in drops the whole voicing an octave.
    if (state.thumbDown) {
      notes = notes.map((freq) => freq / 2);
    }

    this.synth.playNotes(notes);
    this.synth.setVolume(volume);
  }

  /** Reduces raw landmarks to musical intent, before stabilisation. */
  private readIntent(left: Hand | null, right: Hand | null): ChordState | null {
    let chord: ChordNumeral | null = null;
    let isMajorMode = true;
    let qualityIndex = 0;
    let thumbDown = false;

    // Left hand chooses the chord and, via tilt, the mode.
    if (left) {
      const leftTilt = getHandHorizontalTilt(left, "Left");

      chord = classifyChord(left, "Left");
      isMajorMode = leftTilt >= 0;
    }

    // Right hand chooses the voicing and whether it drops an octave.
    if (right) {
      qualityIndex = getRightHandQualityIndex(right);
      thumbDown = isThumbExtended(right, "Right");
    }

    if (!chord) return null;

    return { chord, isMajorMode, qualityIndex, thumbDown };
  }
}
