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
import { Transport } from "./audio/transport";
import { defineUserSample, defineUserWavetable } from "./audio/user-voices";
import { listVoices, registerVoice, VOICE_KIND_LABELS } from "./audio/voice";
import type { VoiceDefinition, VoiceKind } from "./audio/voice";
import { DEFAULT_VOICE_ID } from "./audio/voices";
import {
  BARS_STORAGE_KEY,
  GESTURE_MAP_STORAGE_KEY,
  MODE_STORAGE_KEY,
  MONO_STYLE_STORAGE_KEY,
  PROJECT_NAME,
  SINGLE_HANDED_STORAGE_KEY,
  TEMPO_STORAGE_KEY,
  TRANSPORT,
} from "./config/constants";
import { getChordDisplayName, getChordTones } from "./music/harmony";
import { DEFAULT_GESTURE_MAP_ID, GESTURE_MAPS, getGestureMap } from "./music/gesture-map";
import { describeLooper, Looper } from "./music/looper";
import type { LoopTrack, TrackId } from "./music/looper";
import { MonoReader, monoNoteLabel, monoNumeral } from "./music/mono";
import { ChordStabilizer } from "./music/stabilizer";
import { resolveTakeEvent } from "./music/take";
import type { ResolvedEvent } from "./music/take";
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
import { MENU_TOPICS, MenuController } from "./ui/menu-controller";
import type { MenuClusterName, MenuTopic } from "./ui/menu-controller";
import { drawCluster, drawMenuBackdrop, MENUS_STYLE, OPTIONS_STYLE } from "./ui/radial-menu";
import type { MenuLayout, MenuOption } from "./ui/radial-menu";
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
import { TransportGesture } from "./vision/transport-gesture";
import type { TransportCommand } from "./vision/transport-gesture";
import { drawEnergy } from "./visuals/energy";
import { drawLoopTracks, trackSegments } from "./visuals/loop-tracks";
import type { TrackLane } from "./visuals/loop-tracks";
import { drawTransportCue, drawTransportFlash } from "./visuals/transport-cue";
import type { TransportCueFrame } from "./visuals/transport-cue";

/** How long a flick's confirmation stays up, in milliseconds. */
const TRANSPORT_FLASH_MS = 380;

/** The fist cue for one frame, before the canvas size is attached to it. */
type TransportCue = Omit<TransportCueFrame, "canvasWidth" | "canvasHeight">;

/** The id of the one-handed toggle, which is not a mode or a value. */
const ONE_HANDED_ID = "one-handed";

/**
 * The Layers menu, once a layer is in hand.
 *
 * The options are `"<layer id>:<action>"`, so one cluster can show what can be
 * done to whichever layer was handed over.
 */
const LAYER_ACTION_MUTE = "mute";
const LAYER_ACTION_REWRITE = "rewrite";
const LAYER_ACTION_CLEAR = "clear";
const LAYERS_BACK_ID = "layers-back";

/** Splits a layer action id, e.g. `layer-2:rewrite`. */
function parseLayerAction(id: string): { trackId: string; action: string } | null {
  const [trackId, action] = id.split(":");

  return trackId && action ? { trackId, action } : null;
}

/**
 * A number remembered between visits, kept only if it is still one the picker
 * offers — so a value the markup no longer lists cannot outlive it.
 */
function readStoredChoice(key: string, fallback: number, choices: readonly number[]): number {
  try {
    const stored = Number(window.localStorage.getItem(key));
    if (choices.includes(stored)) return stored;
  } catch {
    // Storage can be unavailable; the default stands.
  }

  return fallback;
}

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

  /**
   * One channel strip per track, on the instrument's context.
   *
   * A layer is its own engine, so a loop and the hands — and several loops — can
   * sound at once without fighting over one voice. Each is created the same way
   * the live engine is, so an instrument is whatever the picker says for all of
   * them, and each can be dropped out and brought back independently.
   */
  private readonly layers = new Map<TrackId, SynthEngine>();

  /** The shared clock: tempo and bar lines, for the looper now and for percussion later. */
  private readonly transport: Transport;
  private readonly looper: Looper;

  private readonly stabilizer = new ChordStabilizer();
  private readonly mono = new MonoReader();
  private readonly hud: Hud;
  private readonly guide: GestureGuide;
  private readonly help: HelpModal;

  /** Most recent landmarks per hand, carried between animation frames. */
  private readonly hands: Record<Handedness, Hand | null> = { Left: null, Right: null };

  private lastVideoTime = -1;

  /**
   * The most recent inference.
   *
   * Kept so the frame can be redrawn every animation frame — overlays have to be
   * repainted on a cleared canvas, and re-running detection at 60Hz to do that
   * would be pure waste.
   */
  private lastResults: HandLandmarkerResult = {
    landmarks: [],
    worldLandmarks: [],
    handedness: [],
    handednesses: [],
  };

  private tonicFrequency: number;
  private keyName: KeyName;
  private gestureMap: GestureMap;
  private mode: InstrumentMode;
  private monoStyle: MonoStyle;

  /** Whether the gesture menu owns the frame. */
  private readonly menu = new MenuController();

  /**
   * The fast transport: one fist, flicked in a direction.
   *
   * One reader per hand, because with both hands closed either may be the one
   * that flicks.
   */
  private readonly fists: Record<Handedness, TransportGesture> = {
    Left: new TransportGesture(),
    Right: new TransportGesture(),
  };

  /** The cue to draw this frame, or `null`. */
  private transportCue: TransportCue | null = null;

  /** The confirmation of the last flick, until it fades. */
  private transportFlash: { command: TransportCommand; point: CanvasPoint; at: number } | null =
    null;

  constructor() {
    this.els = getAppElements();

    this.synth = new SynthEngine();

    this.transport = new Transport({
      bpm: readStoredChoice(TEMPO_STORAGE_KEY, TRANSPORT.defaultBpm, TRANSPORT.tempoChoices),
      loopBars: readStoredChoice(BARS_STORAGE_KEY, TRANSPORT.defaultBars, TRANSPORT.barChoices),
    });
    this.looper = new Looper(this.transport);

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
    this.singleHanded = this.readStoredSingleHanded();
    this.renderInstruments(DEFAULT_VOICE_ID);
    this.renderGestureMaps();
    this.renderTransportChoices();
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
    this.setInstrument(this.els.instrumentSelect.value);

    await startCamera(this.els.video);
    resizeCanvasToWindow(this.els.canvas);
    window.addEventListener("resize", () => resizeCanvasToWindow(this.els.canvas));

    const handLandmarker = await createHandLandmarker();
    this.runLoop(handLandmarker);
  }

  /** Constructs the components that own their own event handling. */
  private wireOverlays(): void {
    new StartOverlay(this.els.startOverlay, this.els.canvas, () => this.startAudio());
  }

  /**
   * Opens the audio graph, on a click.
   *
   * Every layer joins the instrument's context rather than making its own, so
   * they share one clock — two contexts would mean two clocks, and a loop that
   * drifts against the hand it was played with.
   */
  private startAudio(): void {
    this.synth.ensureContext();

    for (const layer of this.layers.values()) {
      layer.ensureContext(this.synth.context ?? undefined);
      layer.setInstrument(this.els.instrumentSelect.value);
    }
  }

  /**
   * The channel strip for a track, built on first use.
   *
   * Layers are made lazily so a player who never records never pays for one, and
   * so a new track — a chord bed, a lead, and later a kit — needs no wiring of
   * its own.
   */
  private layerFor(id: TrackId): SynthEngine {
    const existing = this.layers.get(id);
    if (existing) return existing;

    const layer = new SynthEngine();
    layer.ensureContext(this.synth.context ?? undefined);
    layer.setInstrument(this.els.instrumentSelect.value);
    layer.setVolume(0);
    this.layers.set(id, layer);

    return layer;
  }

  /** The instrument's clock, or zero before the audio graph exists. */
  private audioTime(): number {
    return this.synth.context?.currentTime ?? 0;
  }

  /** Wires the key, gesture-map, instrument, and instrument-loading controls. */
  private bindControls(): void {
    this.els.keySelect.addEventListener("change", () => {
      this.setKey(this.els.keySelect.value);
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
      this.setInstrument(this.els.instrumentSelect.value);
    });

    this.els.tempoSelect.addEventListener("change", () => {
      this.setTempo(Number(this.els.tempoSelect.value));
    });

    this.els.barsSelect.addEventListener("change", () => {
      this.setBars(Number(this.els.barsSelect.value));
    });

    this.els.recordButton.addEventListener("click", () => this.recordLoop());
    this.els.playButton.addEventListener("click", () => this.playLoop());
    this.els.stopButton.addEventListener("click", () => this.stopLoop());
    this.els.clearButton.addEventListener("click", () => this.clearLoop());

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

  /** Switches key, and keeps the readouts in step. */
  private setKey(value: string): void {
    this.els.keySelect.value = value;
    this.tonicFrequency = Number(value);
    this.keyName = readKeyName(this.els.keySelect);
    this.refreshHelp();
  }

  /**
   * Switches instrument, by the picker's id.
   *
   * Both layers follow the picker: a loop is the same instrument it was played
   * on, and a player who changes instrument expects to hear the change on the
   * next note either way.
   */
  private setInstrument(id: string): void {
    this.els.instrumentSelect.value = id;
    this.synth.setInstrument(id);

    for (const layer of this.layers.values()) {
      layer.setInstrument(id);
    }
  }

  /** Changes tempo, live and without moving the loop off its place in the bar. */
  private setTempo(bpm: number): void {
    this.transport.setTempo(bpm, this.audioTime());
    this.els.tempoSelect.value = String(bpm);
    remember(TEMPO_STORAGE_KEY, String(bpm));
  }

  /**
   * Changes the loop's length.
   *
   * A take recorded against one grid does not fit another, so playback stops
   * rather than continuing a loop of the wrong length. The take is kept.
   */
  private setBars(bars: number): void {
    this.transport.setLoopBars(bars);
    this.els.barsSelect.value = String(bars);
    remember(BARS_STORAGE_KEY, String(bars));

    if (this.looper.hasTake) this.stopLoop();
  }

  /**
   * Arms a recording of a **new layer** in the current mode.
   *
   * Recording adds rather than replaces, so a part can be built up — chords,
   * then another chord part, then a melody — and a misflick never destroys
   * anything. Redoing one layer is {@link rewriteLoop}, which has to be asked
   * for by name.
   */
  private recordLoop(): void {
    this.looper.record(this.audioTime(), this.mode);
  }

  /** Arms a re-recording of one layer, replacing what it holds. */
  private rewriteLoop(id: TrackId): void {
    this.looper.rewrite(this.audioTime(), id);
  }

  /** Throws one layer away, retiring its channel with it. */
  private clearLayer(id: TrackId): void {
    this.looper.clearTrack(id);
    this.layers.get(id)?.stop();
    this.layers.delete(id);

    if (this.layerFocus === id) this.layerFocus = null;
  }

  /** Starts every stored layer from the loop's beginning. */
  private playLoop(): void {
    this.looper.play(this.audioTime());
  }

  /** Stops the loop, keeping every layer. */
  private stopLoop(): void {
    this.looper.stop();

    for (const layer of this.layers.values()) layer.stop();
  }

  /** Throws every layer away. */
  private clearLoop(): void {
    this.looper.clear();

    for (const layer of this.layers.values()) layer.stop();
  }

  /**
   * Silences or restores a layer.
   *
   * Muting has to silence the layer *now*, not just stop scheduling it: a
   * two-bar chord would otherwise keep ringing after the track was dropped out.
   * Unmuting is the mirror image — the track picks up the note it is already in
   * the middle of, so it comes back in as though it had never left.
   */
  private toggleLayer(id: TrackId): void {
    this.looper.toggleMute(id);

    const track = this.looper.tracks.find((candidate) => candidate.id === id);
    const layer = this.layers.get(id);
    if (!track || !layer) return;

    if (track.muted) {
      layer.stop();
      return;
    }

    this.replayLayer(track);
  }

  /** Re-primes a layer with whatever it should be sounding right now. */
  private replayLayer(track: LoopTrack): void {
    const event = this.looper.currentEvent(track.id, this.audioTime());
    if (!event) return;

    this.playLoopEvent(track.id, resolveTakeEvent(event, this.tonicFrequency));
  }

  /** Reads the remembered one-handed setting. */
  private readStoredSingleHanded(): boolean {
    try {
      return window.localStorage.getItem(SINGLE_HANDED_STORAGE_KEY) === "on";
    } catch {
      return false;
    }
  }

  /** Turns one-handed staging on or off, and remembers it. */
  private setSingleHanded(enabled: boolean): void {
    this.singleHanded = enabled;
    remember(SINGLE_HANDED_STORAGE_KEY, enabled ? "on" : "off");
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

    // A take in progress would be half chord and half melody, so it is dropped.
    // The layers already recorded keep playing; that is how you record the
    // melody *over* the chord bed.
    this.looper.cancelRecording();

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
   * Fills the tempo and loop-length pickers from the configured choices.
   *
   * Like the other pickers, this reads a list rather than hardcoding options, so
   * a tempo or a loop length is added by declaring it once.
   */
  private renderTransportChoices(): void {
    const fill = (
      select: HTMLSelectElement,
      values: readonly number[],
      label: (value: number) => string,
      selected: number,
    ): void => {
      select.replaceChildren(
        ...values.map((value) => {
          const option = document.createElement("option");
          option.value = String(value);
          option.textContent = label(value);
          return option;
        }),
      );

      select.value = String(selected);
    };

    fill(this.els.tempoSelect, TRANSPORT.tempoChoices, (bpm) => `${bpm} BPM`, this.transport.tempo);
    fill(
      this.els.barsSelect,
      TRANSPORT.barChoices,
      (bars) => `${bars} bar${bars === 1 ? "" : "s"}`,
      this.transport.loopBars,
    );
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

      // Inference only when the video has actually advanced, but the frame is
      // drawn **every** frame: drawing only on new video leaves the overlays to
      // pile up on top of one another between clears, which smears everything
      // that moves — the menu, the ribbon, and the fist cue alike.
      if (this.els.video.currentTime !== this.lastVideoTime) {
        this.lastVideoTime = this.els.video.currentTime;
        this.lastResults = handLandmarker.detectForVideo(this.els.video, now);
        this.captureHands(this.lastResults);
      }

      drawFrame(
        this.els.ctx,
        this.els.video,
        this.lastResults,
        this.els.canvas.width,
        this.els.canvas.height,
      );

      this.updateFrame(now);
      // The cue is drawn last so it sits over the ribbon and the loop's lanes.
      this.renderTransportCue(now);
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
    const ctxTime = this.audioTime();

    // The loop runs under everything, including the menu: changing a setting
    // mid-performance should not stop the music it is playing over.
    this.updateLoop(ctxTime);

    // The fist is read *before* the menu, so a flick can beat an engage that is
    // still counting down — and cancel it, because a flick is deliberate.
    this.updateTransportGesture(now, Left, Right);

    // The menu takes the whole frame when it is up: opening it is a deliberate
    // pause, so nothing *played* sounds underneath it.
    if (this.updateControlMenu(now, Left, Right)) {
      this.transportCue = null;
      return;
    }

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
      this.updateMonoFrame(Left, volume, tilt, ctxTime);
      return;
    }

    const state = this.stabilizer.update(this.readIntent(Left, Right), now);

    const isMajorMode = state?.isMajorMode ?? true;
    const qualityIndex = state?.qualityIndex ?? 0;
    const thumbDown = state?.thumbDown ?? false;
    const chord = state?.chord ?? null;

    this.hud.setChord(getChordDisplayName(chord, isMajorMode, this.keyName), chord);
    this.hud.setQuality(getVoicingLabel(isMajorMode, qualityIndex), thumbDown);

    this.looper.capture(
      state && state.qualityIndex >= 1
        ? {
            kind: "chord",
            numeral: state.chord,
            isMajorMode: state.isMajorMode,
            qualityIndex: state.qualityIndex,
            thumbDown: state.thumbDown,
          }
        : null,
      volume,
      tilt,
      ctxTime,
    );

    if (Right) {
      this.updateVoices(state, volume);
    }

    drawEnergy(this.els.ctx, volume, qualityIndex, tilt, chord);
  }

  /**
   * Advances the loop and replays whatever came due this frame.
   *
   * The events drive the loop layer exactly as the hands drive the live one:
   * the same frequencies, from the same harmony functions, into a voice of the
   * same kind. That is what makes a take sound like the take.
   */
  private updateLoop(ctxTime: number): void {
    for (const hit of this.looper.tick(ctxTime)) {
      this.playLoopEvent(hit.trackId, resolveTakeEvent(hit.event, this.tonicFrequency));
    }

    const { state } = this.looper;

    this.els.transportDisplay.textContent = describeLooper({
      state,
      loopBars: this.transport.loopBars,
      hasTake: this.looper.hasTake,
      recordingLabel: this.looper.recordingLabel,
      countdownBeats: this.looper.countdownBeats(ctxTime),
    });

    this.els.recordButton.classList.toggle("active", state === "recording" || state === "armed");

    this.renderLayerControls();
    drawLoopTracks(this.els.ctx, {
      lanes: this.layerLanes(ctxTime),
      positionBeats: this.looper.positionBeats(ctxTime),
      loopBeats: this.transport.loopBeats,
      isPlaying: this.transport.isPlaying,
      canvasWidth: this.els.canvas.width,
      canvasHeight: this.els.canvas.height,
    });
  }

  /** The tracks, as the loop view needs them. */
  private layerLanes(ctxTime: number): TrackLane[] {
    return this.looper.tracks.map((track) => {
      const isRecording = this.looper.recordingId === track.id;

      return {
        label: track.label,
        mode: track.mode,
        // A lane being recorded is drawn only as far as the playhead, so its
        // notes arrive as they are played rather than all at once at the end.
        segments: trackSegments(
          this.looper.eventsFor(track.id),
          this.transport.loopBeats,
          isRecording ? this.looper.positionBeats(ctxTime) : this.transport.loopBeats,
        ),
        isRecording,
        isEmpty: track.take === null,
        muted: track.muted,
      };
    });
  }

  private playLoopEvent(trackId: TrackId, resolved: ResolvedEvent): void {
    const layer = this.layerFor(trackId);

    if (resolved.notes.length === 0) {
      layer.setVolume(0);
      return;
    }

    layer.playNotes(resolved.notes);
    layer.updateFilterSweep(resolved.tilt);
    layer.setVolume(resolved.volume);
  }

  /**
   * Rebuilds the per-layer mute buttons, but only when the layers have changed.
   *
   * Called from the render loop, so it has to be cheap: the signature check is
   * what keeps it from rebuilding six buttons sixty times a second.
   */
  private renderLayerControls(): void {
    const tracks = this.looper.tracks;
    const signature = tracks.map((track) => `${track.id}:${track.muted}`).join(",");
    if (signature === this.layerSignature) return;

    this.layerSignature = signature;

    this.els.layerControls.replaceChildren(
      ...tracks.map((track) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = track.label;
        button.classList.toggle("muted", track.muted);
        button.title = track.muted ? `Bring ${track.label} back in` : `Drop ${track.label} out`;
        button.addEventListener("click", () => this.toggleLayer(track.id));
        return button;
      }),
    );
  }

  /** The last signature the layer buttons were built from, to avoid rebuilding. */
  private layerSignature = "";

  /**
   * The mono voice: pitch from the left hand's height, expression from the right.
   *
   * There is no chord to stabilise here — the note is simply wherever the hand
   * is — so this reads the frame directly rather than through the stabiliser.
   */
  private updateMonoFrame(left: Hand | null, volume: number, tilt: number, ctxTime: number): void {
    const reading = this.mono.update(
      left ? getHandHeight(left) : null,
      this.monoStyle,
      this.tonicFrequency,
    );

    // A recorded melody is its degrees, not its frequencies, so it transposes
    // with the key like the chord loop does.
    this.looper.capture(
      reading ? { kind: "note", degree: reading.degree } : null,
      volume,
      tilt,
      ctxTime,
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
   * The fast transport: one fist, flicked in a direction.
   *
   * Each hand is read separately, because with both hands closed either one may
   * be the one that flicks — and a flick is *deliberate*, so it is allowed to
   * beat a menu engage that is still counting down. That is the split: a closed
   * hand that **moves** is a transport, a closed pair that **holds** is the menu.
   *
   * The cue is stashed rather than drawn, so it can be put on top of everything
   * else once the frame is complete.
   */
  private updateTransportGesture(now: number, left: Hand | null, right: Hand | null): void {
    const hands: readonly (readonly [Handedness, Hand | null])[] = [
      ["Left", left],
      ["Right", right],
    ];

    // While the menu owns the frame the transport stands aside entirely, so a
    // flick inside it cannot mean two things.
    if (this.menu.open) {
      this.fists.Left.reset();
      this.fists.Right.reset();
      this.transportCue = null;
      return;
    }

    const closed = hands.filter(([, hand]) => hand !== null && isHandClosed(hand));
    const bothClosed = closed.length === 2;

    let cue: TransportCue | null = null;
    let fired: TransportCommand | null = null;
    let firedAt: CanvasPoint | null = null;

    for (const [handedness, hand] of hands) {
      const reading = this.fists[handedness].update(hand, now);

      if (reading.command !== null && hand) {
        fired = reading.command;
        firedAt = this.placePoint(getHandCenter(hand));
      }

      // With both hands closed the fist is sharing the hold with the menu, so
      // its cue waits until a flick is actually under way — otherwise a hand
      // held for the menu would be told it could flick.
      const showCue = reading.ready && (!bothClosed || reading.progress > 0);
      const point = showCue && hand ? this.placePoint(getHandCenter(hand)) : null;
      const anchor = reading.anchor ? this.placePoint(reading.anchor) : null;
      if (!point || !anchor) continue;

      cue = {
        point,
        anchor,
        trail: reading.trail.flatMap((step) => this.placePoint(step) ?? []),
        direction: reading.direction,
        progress: reading.progress,
        readyForMs: reading.readyForMs,
      };
    }

    this.transportCue = cue;

    if (fired !== null) {
      // A flick is deliberate, so it takes the hand back from a menu that was
      // still counting down, and confirms itself where the hand is.
      this.menu.cancelEngage();
      this.transportFlash = firedAt ? { command: fired, point: firedAt, at: now } : null;
      this.runTransportCommand(fired);
    }
  }

  /** Draws the fist cue and its confirmation, if either is live. */
  private renderTransportCue(now: number): void {
    const cue = this.transportCue;
    if (cue) {
      drawTransportCue(this.els.ctx, {
        ...cue,
        canvasWidth: this.els.canvas.width,
        canvasHeight: this.els.canvas.height,
      });
    }

    const flash = this.transportFlash;
    if (!flash) return;

    const ageMs = now - flash.at;
    if (ageMs > TRANSPORT_FLASH_MS) {
      this.transportFlash = null;
      return;
    }

    drawTransportFlash(this.els.ctx, {
      command: flash.command,
      point: flash.point,
      ageMs,
      durationMs: TRANSPORT_FLASH_MS,
    });
  }

  /** Sends a flicked command to the looper. */
  private runTransportCommand(command: TransportCommand): void {
    switch (command) {
      case "record":
        this.recordLoop();
        return;
      case "play":
        this.playLoop();
        return;
      case "stop":
        this.stopLoop();
        return;
      case "clear":
        this.clearLoop();
        return;
    }
  }

  /**
   * Runs the gesture menu, opening it when the engage gesture is held.
   *
   * @returns True when the menu owns the frame, which is what keeps the
   *   instrument silent while a setting is being chosen.
   */
  private updateControlMenu(now: number, left: Hand | null, right: Hand | null): boolean {
    const leftClosed = left !== null && isHandClosed(left);
    const rightClosed = right !== null && isHandClosed(right);

    // One hand closed is the engage gesture when there is only one hand driving;
    // otherwise it takes both, so the menu cannot open on a single resting fist.
    const bothClosed = this.singleHanded ? leftClosed || rightClosed : leftClosed && rightClosed;

    // In single-handed mode one hand drives both stages, so it supplies both
    // cursors; otherwise each hand drives its own cluster.
    const soloHand = right ?? left;
    const solo = this.singleHanded && soloHand ? this.cursorFor(soloHand) : null;

    const update = this.menu.update(
      {
        menus: { layout: "radial", items: MENU_TOPICS, activeId: this.menuId },
        options: this.optionsCluster(),
        bothClosed,
        menuCursor: solo ?? (left ? this.cursorFor(left) : null),
        optionCursor: solo ?? (right ? this.cursorFor(right) : null),
        canvasWidth: this.els.canvas.width,
        canvasHeight: this.els.canvas.height,
        staged: this.singleHanded,
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
    }

    if (!update.isOpen) {
      // The next open starts on the vocabulary again, not wherever this one was.
      this.menuId = "vocabulary";
      this.layerFocus = null;
      return false;
    }

    drawMenuBackdrop(this.els.ctx, update.elapsedMs);
    drawCluster(this.els.ctx, update.menus, MENUS_STYLE);
    drawCluster(this.els.ctx, update.options, OPTIONS_STYLE);

    this.hud.setNote(this.menuTitle(update.menus));
    this.hud.setQuality(
      update.options.hoveredId === null ? "Control" : this.labelFor(update.options),
      false,
    );

    return true;
  }

  /** The label under the readout: the menu in play, and the option hovered. */
  private menuLabel(frame: { items: readonly MenuOption[]; activeId: string | null }): string {
    return frame.items.find((item) => item.id === frame.activeId)?.label ?? "MENU";
  }

  /**
   * What the readout calls the menu — the layer's name while one is in hand.
   *
   * Drilling into a layer changes what the options mean without changing which
   * menu is in play, so the readout is the only place that can say *which* layer
   * Rewrite and Clear would act on.
   */
  private menuTitle(frame: { items: readonly MenuOption[]; activeId: string | null }): string {
    if (this.menuId === "layers" && this.layerFocus) {
      const track = this.looper.tracks.find((candidate) => candidate.id === this.layerFocus);
      if (track) return track.label;
    }

    return this.menuLabel(frame);
  }

  /** The values the current menu holds. */
  private optionsCluster(): {
    layout: MenuLayout;
    items: readonly MenuOption[];
    activeId?: string;
  } {
    const asOptions = (select: HTMLSelectElement): MenuOption[] =>
      Array.from(select.options).map((option) => ({
        id: option.value,
        label: option.textContent ?? option.value,
      }));

    if (this.menuId === "key") {
      return {
        layout: "list",
        items: asOptions(this.els.keySelect),
        activeId: this.els.keySelect.value,
      };
    }

    if (this.menuId === "instrument") {
      return {
        layout: "list",
        items: asOptions(this.els.instrumentSelect),
        activeId: this.els.instrumentSelect.value,
      };
    }

    if (this.menuId === "layers") {
      const tracks = this.looper.tracks;
      if (tracks.length === 0) {
        return { layout: "radial", items: [{ id: "none", label: "No layers yet" }] };
      }

      // With a layer in hand, the menu shows what can be done to *it*. Those are
      // the destructive options — redo it, throw it away — so a second step to
      // reach them is the point, not an accident.
      const focused = tracks.find((track) => track.id === this.layerFocus);
      if (focused) {
        return {
          layout: "radial",
          items: [
            {
              id: `${focused.id}:${LAYER_ACTION_MUTE}`,
              label: focused.muted ? "Unmute" : "Mute",
              keepsMenuOpen: true,
            },
            { id: `${focused.id}:${LAYER_ACTION_REWRITE}`, label: "Rewrite" },
            { id: `${focused.id}:${LAYER_ACTION_CLEAR}`, label: "Clear" },
            { id: LAYERS_BACK_ID, label: "Back", keepsMenuOpen: true },
          ],
        };
      }

      // One entry per layer; choosing one hands it over to be worked on. The
      // menu stays open, so a player can drop two parts out in one visit.
      return {
        layout: "radial",
        items: tracks.map((track) => ({
          id: track.id,
          label: `${track.label}${track.muted ? " · off" : ""}`,
          keepsMenuOpen: true,
        })),
      };
    }

    if (this.menuId === "transport") {
      // The looper's controls, reachable without dropping a hand to the mouse —
      // which is the whole point of running the transport through the menu.
      return {
        layout: "radial",
        items: [
          { id: "record", label: "Record" },
          { id: "play", label: "Play" },
          { id: "stop", label: "Stop" },
          { id: "clear", label: "Clear" },
        ],
        activeId: this.looper.state,
      };
    }

    if (this.menuId === "settings") {
      const oneHanded: MenuOption = {
        id: ONE_HANDED_ID,
        label: this.singleHanded ? "One hand: on" : "One hand: off",
        // A settings panel is somewhere you set more than one thing, so its
        // choices leave it open; dismissing is how you leave.
        keepsMenuOpen: true,
      };

      return {
        layout: "radial",
        items: [
          { id: "chord", label: "Chords", keepsMenuOpen: true },
          { id: "mono", label: "Mono", keepsMenuOpen: true },
          oneHanded,
        ],
        activeId: this.mode,
      };
    }

    const vocabulary = this.mode === "mono" ? this.els.monoStyleSelect : this.els.gestureMapSelect;

    return {
      layout: "radial",
      items: asOptions(vocabulary),
      activeId: vocabulary.value,
    };
  }

  /** The label of a cluster's hovered item, for the readout. */
  private labelFor(frame: { items: readonly MenuOption[]; hoveredId: string | null }): string {
    return frame.items.find((item) => item.id === frame.hoveredId)?.label ?? "";
  }

  /** Applies a committed choice to whatever it came from. */
  private applyMenuChoice(choice: { cluster: MenuClusterName; id: string }): void {
    if (choice.cluster === "menus") {
      // A menu choice changes what the other cluster holds, so the menu stays
      // open and the right hand picks up from the new list.
      this.menuId = choice.id as MenuTopic;
      this.layerFocus = null;
      return;
    }

    if (this.menuId === "settings") {
      if (choice.id === ONE_HANDED_ID) {
        this.setSingleHanded(!this.singleHanded);
        return;
      }

      // Settings holds the mode, which is what the vocabulary menu depends on.
      this.setMode(choice.id as InstrumentMode);
      return;
    }

    if (this.menuId === "key") {
      this.setKey(choice.id);
      return;
    }

    if (this.menuId === "instrument") {
      this.setInstrument(choice.id);
      return;
    }

    if (this.menuId === "layers") {
      if (choice.id === LAYERS_BACK_ID) {
        this.layerFocus = null;
        return;
      }

      const action = parseLayerAction(choice.id);

      // No action means a layer was chosen: hand it over for the next step.
      if (!action) {
        if (this.looper.tracks.some((track) => track.id === choice.id)) this.layerFocus = choice.id;
        return;
      }

      switch (action.action) {
        case LAYER_ACTION_MUTE:
          this.toggleLayer(action.trackId);
          return;
        case LAYER_ACTION_REWRITE:
          this.layerFocus = null;
          this.rewriteLoop(action.trackId);
          return;
        case LAYER_ACTION_CLEAR:
          this.clearLayer(action.trackId);
          return;
      }
      return;
    }

    if (this.menuId === "transport") {
      switch (choice.id) {
        case "record":
          this.recordLoop();
          return;
        case "play":
          this.playLoop();
          return;
        case "stop":
          this.stopLoop();
          return;
        case "clear":
          this.clearLoop();
          return;
      }
      return;
    }

    if (this.mode === "mono") {
      this.setMonoStyle(choice.id as MonoStyle);
    } else {
      this.setGestureMap(choice.id);
    }
  }

  /** Which menu the left hand has chosen, and the right hand is choosing within. */
  private menuId: MenuTopic = "vocabulary";
  /** Which layer the Layers menu is working on, once one has been handed over. */
  private layerFocus: TrackId | null = null;
  /** Whether one hand drives the whole menu, a stage at a time. */
  private singleHanded = false;

  /**
   * A normalised frame point, in canvas coordinates.
   *
   * Everything that has to line up with the drawn hand comes through here,
   * because `drawFrame` draws inside a mirrored transform — see
   * {@link landmarkToCanvas}.
   */
  private placePoint(point: { readonly x: number; readonly y: number }): CanvasPoint | null {
    const { videoWidth, videoHeight } = this.els.video;
    if (!videoWidth || !videoHeight) return null;

    return landmarkToCanvas(
      point,
      videoWidth,
      videoHeight,
      this.els.canvas.width,
      this.els.canvas.height,
    );
  }

  /** A hand's palm centre, in canvas coordinates, for the menu cursor. */
  private cursorFor(hand: Hand): CanvasPoint | null {
    return this.placePoint(getHandCenter(hand));
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
