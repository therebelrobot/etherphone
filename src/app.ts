/**
 * Etherphone application.
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
import { defineUserSample, defineUserWavetable } from "./audio/user-voices";
import { listVoices, registerVoice, VOICE_KIND_LABELS } from "./audio/voice";
import type { VoiceDefinition, VoiceKind } from "./audio/voice";
import { DEFAULT_VOICE_ID } from "./audio/voices";
import {
  GESTURE_MAP_STORAGE_KEY,
  MODE_STORAGE_KEY,
  MONO_STYLE_STORAGE_KEY,
  PROJECT_NAME,
} from "./config/constants";
import { getChordDisplayName, getChordTones } from "./music/harmony";
import { DEFAULT_GESTURE_MAP_ID, GESTURE_MAPS, getGestureMap } from "./music/gesture-map";
import { MonoReader, monoNoteLabel, monoNumeral } from "./music/mono";
import { ChordStabilizer } from "./music/stabilizer";
import { getSolidNotes, getVoicingLabel } from "./music/voicings";
import type {
  CanvasPoint,
  ChordNumeral,
  ChordState,
  GestureMap,
  Hand,
  Handedness,
  InstrumentMode,
  KeyName,
  MonoStyle,
} from "./types";
import { getAppElements, resizeCanvasToWindow } from "./ui/dom";
import type { AppElements } from "./ui/dom";
import { GestureGuide } from "./ui/gesture-guide";
import { HelpModal } from "./ui/help-modal";
import { Hud } from "./ui/hud";
import { MenuController, isModeSwitch, menuOptionsFor } from "./ui/menu-controller";
import { drawRadialMenu } from "./ui/radial-menu";
import type { MenuOption } from "./ui/radial-menu";
import { StartOverlay } from "./ui/start-overlay";
import { VolumeMeter } from "./ui/volume-meter";
import { startCamera } from "./vision/camera";
import {
  classifyChord,
  getHandCenter,
  getHandHeight,
  getHandHorizontalTilt,
  getRightHandQualityIndex,
  getVolumeFromHeight,
  isHandClosed,
  isThumbExtended,
} from "./vision/gestures";
import { createHandLandmarker } from "./vision/hand-tracking";
import { drawFrame, landmarkToCanvas } from "./vision/overlay";
import { drawEnergy } from "./visuals/energy";

/** The key name carried on the selected option's `data-note` attribute. */
function readKeyName(select: HTMLSelectElement): KeyName {
  return (select.selectedOptions[0]?.dataset.note ?? "A") as KeyName;
}

/** Remembers a picker choice. Storage can be disabled, in which case it just will not stick. */
function remember(storageKey: string, value: string): void {
  try {
    window.localStorage.setItem(storageKey, value);
  } catch {
    // Private mode and blocked cookies both throw here; nothing to do.
  }
}

/**
 * Restores a picker from storage.
 *
 * A value the markup no longer offers is ignored rather than assigned, so a
 * renamed option cannot leave the instrument in a state with no matching entry.
 */
function restoreSelect(select: HTMLSelectElement, storageKey: string): string {
  try {
    const stored = window.localStorage.getItem(storageKey);
    const isOffered = Array.from(select.options).some((option) => option.value === stored);
    if (stored && isOffered) select.value = stored;
  } catch {
    // Storage can be unavailable; the markup's default stands.
  }

  return select.value;
}

export class GestureSynthApp {
  private readonly els: AppElements;
  private readonly synth: SynthEngine;
  private readonly stabilizer = new ChordStabilizer();
  private readonly mono = new MonoReader();
  private readonly hud: Hud;
  private readonly guide: GestureGuide;
  private readonly help: HelpModal;

  /** Most recent landmarks per hand, carried between animation frames. */
  private readonly hands: Record<Handedness, Hand | null> = { Left: null, Right: null };

  private lastVideoTime = -1;

  private tonicFrequency: number;
  private keyName: KeyName;
  private gestureMap: GestureMap;
  private mode: InstrumentMode;
  private monoStyle: MonoStyle;

  /** Whether the gesture menu owns the frame. */
  private readonly menu = new MenuController();

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

    this.help = new HelpModal(
      this.els.helpModal,
      this.els.helpButton,
      this.els.closeHelp,
      this.els.helpGestureRows,
    );

    this.tonicFrequency = Number(this.els.keySelect.value);
    this.keyName = readKeyName(this.els.keySelect);
    this.mode = restoreSelect(this.els.modeSelect, MODE_STORAGE_KEY) as InstrumentMode;
    this.monoStyle = restoreSelect(this.els.monoStyleSelect, MONO_STYLE_STORAGE_KEY) as MonoStyle;
    this.renderInstruments(DEFAULT_VOICE_ID);
    this.renderGestureMaps();
    this.gestureMap = getGestureMap(
      restoreSelect(this.els.gestureMapSelect, GESTURE_MAP_STORAGE_KEY),
    );
    this.els.gestureMapSelect.value = this.gestureMap.id;
    this.applyModeVisibility();
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
    this.refreshHelp();
    this.synth.setInstrument(this.els.instrumentSelect.value);

    await startCamera(this.els.video);
    resizeCanvasToWindow(this.els.canvas);
    window.addEventListener("resize", () => resizeCanvasToWindow(this.els.canvas));

    const handLandmarker = await createHandLandmarker();
    this.runLoop(handLandmarker);
  }

  /** Constructs the components that own their own event handling. */
  private wireOverlays(): void {
    new StartOverlay(this.els.startOverlay, this.els.canvas, () => this.synth.ensureContext());
  }

  /** Wires the key, gesture-map, instrument, and instrument-loading controls. */
  private bindControls(): void {
    this.els.keySelect.addEventListener("change", () => {
      this.tonicFrequency = Number(this.els.keySelect.value);
      this.keyName = readKeyName(this.els.keySelect);
      this.refreshHelp();
    });

    this.els.gestureMapSelect.addEventListener("change", () => {
      this.setGestureMap(this.els.gestureMapSelect.value);
    });

    this.els.modeSelect.addEventListener("change", () => {
      this.setMode(this.els.modeSelect.value as InstrumentMode);
    });

    this.els.monoStyleSelect.addEventListener("change", () => {
      this.setMonoStyle(this.els.monoStyleSelect.value as MonoStyle);
    });

    this.els.instrumentSelect.addEventListener("change", () => {
      this.synth.setInstrument(this.els.instrumentSelect.value);
    });

    // The file inputs are hidden; the buttons are what the player sees, and
    // clicking one opens the picker for its input.
    this.els.loadWavetable.addEventListener("click", () => this.els.wavetableFile.click());
    this.els.loadSample.addEventListener("click", () => this.els.sampleFile.click());

    this.els.wavetableFile.addEventListener("change", () => {
      void this.loadInstrument(this.els.wavetableFile, "wavetable");
    });

    this.els.sampleFile.addEventListener("change", () => {
      void this.loadInstrument(this.els.sampleFile, "sampler");
    });
  }

  /** Reads a picked file as an instrument, then switches to it. */
  private async loadInstrument(input: HTMLInputElement, kind: VoiceKind): Promise<void> {
    const file = input.files?.[0];
    // Clearing the input lets the same file be picked twice in a row.
    input.value = "";
    if (!file) return;

    try {
      const decoded = await this.decodeFile(file);
      const definition =
        kind === "wavetable"
          ? defineUserWavetable(file.name, decoded.getChannelData(0))
          : defineUserSample(file.name, decoded);

      this.addInstrument(definition);
    } catch (error) {
      console.warn(`${PROJECT_NAME}: could not load "${file.name}" as a ${kind}`, error);
    }
  }

  /** Decodes a file against the instrument's audio context, starting it if needed. */
  private async decodeFile(file: File): Promise<AudioBuffer> {
    // Picking a file is a user gesture, so this is a legal place to open audio.
    this.synth.ensureContext();
    return this.synth.decode(await file.arrayBuffer());
  }

  /** Registers a loaded instrument, lists it, and makes it active. */
  private addInstrument(definition: VoiceDefinition): void {
    registerVoice(definition);
    this.renderInstruments(definition.id);
    this.synth.setInstrument(definition.id);
  }

  /**
   * Rebuilds the instrument picker from the registry, grouped by kind.
   *
   * Reading the registry rather than a hardcoded list is what makes a loaded
   * instrument indistinguishable from a built-in: there is one source of truth
   * for what can be played.
   */
  private renderInstruments(selectedId: string): void {
    const select = this.els.instrumentSelect;
    const groups = new Map<VoiceKind, HTMLOptGroupElement>();

    select.replaceChildren();

    for (const voice of listVoices()) {
      let group = groups.get(voice.kind);
      if (!group) {
        group = document.createElement("optgroup");
        group.label = VOICE_KIND_LABELS[voice.kind];
        groups.set(voice.kind, group);
        select.append(group);
      }

      const option = document.createElement("option");
      option.value = voice.id;
      option.textContent = voice.label;
      group.append(option);
    }

    select.value = selectedId;
  }

  /** Switches the gesture vocabulary and keeps the readouts in step. */
  private setGestureMap(id: string): void {
    this.gestureMap = getGestureMap(id);
    this.els.gestureMapSelect.value = this.gestureMap.id;
    remember(GESTURE_MAP_STORAGE_KEY, this.gestureMap.id);
    this.refreshHelp();
  }

  /** Switches between chords and a single note. */
  private setMode(mode: InstrumentMode): void {
    if (mode === this.mode) return;

    this.mode = mode;
    this.els.modeSelect.value = mode;
    remember(MODE_STORAGE_KEY, mode);
    this.applyModeVisibility();

    // Both modes share one sounding voice, so hand it over cleanly: silence
    // whatever is playing and forget the notes each reader was holding.
    this.synth.stop();
    this.stabilizer.reset();
    this.mono.reset();
    this.refreshHelp();
  }

  /** Switches how the mono voice follows the pitch hand. */
  private setMonoStyle(style: MonoStyle): void {
    if (style === this.monoStyle) return;

    this.monoStyle = style;
    this.els.monoStyleSelect.value = style;
    remember(MONO_STYLE_STORAGE_KEY, style);

    // A glide that becomes a quantised note must be re-struck, not slid into.
    this.synth.stop();
    this.mono.reset();
  }

  /** Re-renders the two places that describe what the hands do. */
  private refreshHelp(): void {
    this.guide.render(this.mode, this.keyName, this.gestureMap);
    this.help.render(this.mode, this.keyName, this.gestureMap);
  }

  /**
   * Shows only the controls the current mode uses.
   *
   * The chord vocabulary and the mono style are alternatives, so they share one
   * slot in the stack. The guide stays available in both modes — it describes
   * the left hand either way, just differently.
   */
  private applyModeVisibility(): void {
    const isMono = this.mode === "mono";

    this.els.gestureMapSelect.classList.toggle("hidden", isMono);
    this.els.monoStyleSelect.classList.toggle("hidden", !isMono);
  }

  /** The mono style's label, read from the picker so the two cannot drift. */
  private get monoStyleLabel(): string {
    return this.els.monoStyleSelect.selectedOptions[0]?.textContent ?? this.monoStyle;
  }

  /**
   * Fills the gesture-map picker from the presets.
   *
   * Like the instrument picker, this reads the preset list rather than a
   * hardcoded set of options, so a new map appears the moment it is declared.
   */
  private renderGestureMaps(): void {
    const select = this.els.gestureMapSelect;

    select.replaceChildren(
      ...GESTURE_MAPS.map((map) => {
        const option = document.createElement("option");
        option.value = map.id;
        option.textContent = map.label;
        option.title = map.description;
        return option;
      }),
    );

    select.value = DEFAULT_GESTURE_MAP_ID;
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

    // The menu takes the whole frame when it is up: opening it is a deliberate
    // pause, so nothing plays underneath it.
    if (this.updateControlMenu(now, Left, Right)) return;

    // Expression follows the right hand in both modes: it is the "how it
    // sounds" hand, whether the left hand is playing chords or a melody.
    const volume = Right ? getVolumeFromHeight(Right) : 0;
    const tilt = Right ? getHandHorizontalTilt(Right, "Right") : 0;

    if (Right) {
      this.hud.setVolume(volume);
      this.hud.setFilter(tilt);
      this.synth.updateFilterSweep(tilt);
    } else {
      this.synth.setVolume(0);
    }

    if (this.mode === "mono") {
      this.updateMonoFrame(Left, volume, tilt);
      return;
    }

    const state = this.stabilizer.update(this.readIntent(Left, Right), now);

    const isMajorMode = state?.isMajorMode ?? true;
    const qualityIndex = state?.qualityIndex ?? 0;
    const thumbDown = state?.thumbDown ?? false;
    const chord = state?.chord ?? null;

    this.hud.setChord(getChordDisplayName(chord, isMajorMode, this.keyName), chord);
    this.hud.setQuality(getVoicingLabel(isMajorMode, qualityIndex), thumbDown);

    if (Right) {
      this.updateVoices(state, volume);
    }

    drawEnergy(this.els.ctx, volume, qualityIndex, tilt, chord);
  }

  /**
   * The mono voice: pitch from the left hand's height, expression from the right.
   *
   * There is no chord to stabilise here — the note is simply wherever the hand
   * is — so this reads the frame directly rather than through the stabiliser.
   */
  private updateMonoFrame(left: Hand | null, volume: number, tilt: number): void {
    const reading = this.mono.update(
      left ? getHandHeight(left) : null,
      this.monoStyle,
      this.tonicFrequency,
    );

    if (!reading) {
      this.synth.stop();
      this.hud.setNote("--");
      this.hud.setQuality(this.monoStyleLabel, false);
      drawEnergy(this.els.ctx, 0, 0, tilt, null);
      return;
    }

    const notes = [reading.frequency];

    switch (this.monoStyle) {
      case "glide":
        this.synth.glideNotes(notes);
        break;
      case "harp":
        // Pluck on entering a degree and let the note ring while the hand holds,
        // so a sweep across the frame plays a run rather than one long slide.
        if (reading.isNewDegree) this.synth.playNotes(notes);
        break;
      default:
        this.synth.playNotes(notes);
    }

    this.synth.setVolume(volume);

    this.hud.setNote(monoNoteLabel(reading, this.keyName));
    this.hud.setQuality(this.monoStyleLabel, false);
    // One ribbon line, coloured by the degree the note sits on.
    drawEnergy(this.els.ctx, volume, 1, tilt, monoNumeral(reading));
  }

  /**
   * Runs the gesture menu, opening it when the engage gesture is held.
   *
   * @returns True when the menu owns the frame, which is what keeps the
   *   instrument silent while a setting is being chosen.
   */
  private updateControlMenu(now: number, left: Hand | null, right: Hand | null): boolean {
    const bothClosed = left !== null && right !== null && isHandClosed(left) && isHandClosed(right);

    const update = this.menu.update(
      {
        options: this.menuOptions(),
        bothClosed,
        cursor: right ? this.cursorFor(right) : null,
        canvasWidth: this.els.canvas.width,
        canvasHeight: this.els.canvas.height,
      },
      now,
    );

    if (update.justOpened) {
      // The menu is a deliberate pause, so nothing sounds underneath it.
      this.synth.stop();
      this.stabilizer.reset();
      this.mono.reset();
    }

    if (update.committed !== null) {
      this.applyMenuChoice(update.committed);
      return true;
    }

    if (!update.isOpen) return false;

    this.hud.setNote(update.hoveredId === null ? "MENU" : this.labelFor(update.hoveredId));
    this.hud.setQuality("Control", false);
    drawRadialMenu(this.els.ctx, update);

    return true;
  }

  /** The label of a menu option, for the readout. */
  private labelFor(id: string): string {
    return this.menuOptions().find((option) => option.id === id)?.label ?? id;
  }

  /**
   * The options the menu offers: whichever picker currently occupies the shared
   * slot, plus a switch to the other mode.
   */
  private menuOptions(): readonly MenuOption[] {
    const select = this.mode === "mono" ? this.els.monoStyleSelect : this.els.gestureMapSelect;

    const vocabulary = Array.from(select.options).map((option) => ({
      id: option.value,
      label: option.textContent ?? option.value,
    }));

    return menuOptionsFor(this.mode, vocabulary);
  }

  /** Applies a committed menu choice to whatever it came from. */
  private applyMenuChoice(id: string): void {
    if (isModeSwitch(id)) {
      this.setMode(id);
      return;
    }

    if (this.mode === "mono") {
      this.setMonoStyle(id as MonoStyle);
    } else {
      this.setGestureMap(id);
    }
  }

  /** The right hand's palm centre, in canvas coordinates, for the menu cursor. */
  private cursorFor(hand: Hand): CanvasPoint | null {
    const { videoWidth, videoHeight } = this.els.video;
    if (!videoWidth || !videoHeight) return null;

    return landmarkToCanvas(
      getHandCenter(hand),
      videoWidth,
      videoHeight,
      this.els.canvas.width,
      this.els.canvas.height,
    );
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

      chord = classifyChord(left, "Left", this.gestureMap);
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
