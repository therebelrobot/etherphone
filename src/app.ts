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
import type { ArmUnit } from "./audio/transport";
import { defineUserSample, defineUserWavetable } from "./audio/user-voices";
import { listVoicesFor, registerVoice, VOICE_KIND_LABELS } from "./audio/voice";
import type { VoiceDefinition, VoiceKind } from "./audio/voice";
import { DEFAULT_VOICE_ID } from "./audio/voices";
import {
  ARM_UNIT_CHOICES,
  ARM_UNIT_STORAGE_KEY,
  ARTICULATION_STORAGE_KEY,
  AUDIO,
  BARS_STORAGE_KEY,
  CUSTOM_MAP_STORAGE_KEY,
  EXPRESSION_MAP_STORAGE_KEY,
  GESTURE_MAP_LEFT_STORAGE_KEY,
  GESTURE_MAP_RIGHT_STORAGE_KEY,
  GESTURE_MAP_STORAGE_KEY,
  HARMONY_HAND_STORAGE_KEY,
  LOOPING_STORAGE_KEY,
  MODE_STORAGE_KEY,
  MONO_SNAP_CHOICES,
  MONO_SNAP_STRENGTH_DEFAULT,
  MONO_STYLE_STORAGE_KEY,
  SNAP_STRENGTH_STORAGE_KEY,
  PROJECT_NAME,
  SINGLE_HANDED_STORAGE_KEY,
  TEMPO_STORAGE_KEY,
  TRANSPORT,
} from "./config/constants";
import { getChordDisplayName, getChordTones } from "./music/harmony";
import {
  CUSTOM_MAP_ID,
  CUSTOM_MAP_LABEL,
  CUSTOM_MAP_SLOTS,
  customMapFromSlots,
  decodeCustomMap,
  describeSlotTarget,
  encodeCustomMap,
  hashForCustomMap,
  slotsFromHash,
  slotsFromMap,
} from "./music/custom-map";
import type { CustomMapSlots, SlotTarget } from "./music/custom-map";
import {
  DEFAULT_GESTURE_MAP_ID,
  GESTURE_MAPS,
  OPEN_HAND,
  getGestureMap,
  shiftNumeral,
} from "./music/gesture-map";
import { handName, HANDS, otherHand, parseHarmonyHand } from "./music/hands";
import { describeLooper, GAIN_STEP, Looper } from "./music/looper";
import type { LoopLayerSeed, LoopTrack, TrackId } from "./music/looper";
import { MonoReader, monoNoteLabel, monoNumeral, pluckDecayFor, snapLabel } from "./music/mono";
import { ChordStabilizer } from "./music/stabilizer";
import { ModifierArmer } from "./music/modifier";
import { resolveTakeEvent } from "./music/take";
import type { ResolvedEvent } from "./music/take";
import {
  parseTakeDocument,
  serializeTakeDocument,
  takeAudioFilename,
  takeDocumentFilename,
} from "./music/take-document";
import { renderTakeToWav } from "./audio/render";
import { canRequestMicrophone, startMicrophone } from "./audio/microphone";
import { recordVoiceLoop as captureVoiceBuffer } from "./audio/voice-capture";
import { isSilentCapture, loopFrameCount } from "./audio/voice-loop";
import { getQuality, getQualityLabel, getQualityNotes } from "./music/qualities";
import { sideOf } from "./hand";
import { MappingDiagram, diagramSizeFor } from "./ui/mapping-diagram";
import type { DiagramHand } from "./ui/mapping-diagram";
import {
  decodeExpressionMap,
  DEFAULT_EXPRESSION_MAP,
  describePose,
  encodeExpressionMap,
  qualityForPose,
  withPose,
} from "./music/expression-map";
import type { ExpressionMap } from "./music/expression-map";
import type {
  CanvasPoint,
  ChordNumeral,
  ChordState,
  GestureMap,
  Hand,
  Handedness,
  HandShape,
  InstrumentMode,
  KeyName,
  MonoStyle,
} from "./types";
import { getAppElements, resizeCanvasToWindow } from "./ui/dom";
import type { AppElements } from "./ui/dom";
import { GestureGuide } from "./ui/gesture-guide";
import { HelpModal } from "./ui/help-modal";
import { Hud } from "./ui/hud";
import { menuTopicsFor, MenuController } from "./ui/menu-controller";
import type { MenuClusterName, MenuTopic, MenuUpdate } from "./ui/menu-controller";
import {
  EDIT_MAP_ID,
  expressionKindsCluster,
  expressionPosesCluster,
  MAP_BACK_ID,
  MAP_TARGET_CHORDS_ID,
  MAP_TARGET_KINDS_ID,
  mapEditorCluster,
  mapTargetCluster,
  MODIFIER_SLOT_ID,
  NUMERALS_SET,
  poseFromOptionId,
  SILENT_SLOT_ID,
  vocabularyCluster,
} from "./ui/menu-clusters";
import type { MapTarget } from "./ui/menu-clusters";
import {
  drawCluster,
  drawMenuBackdrop,
  listBandLeft,
  listBandWidth,
  MENUS_STYLE,
  OPTIONS_STYLE,
} from "./ui/radial-menu";
import type { MenuLayout, MenuOption } from "./ui/radial-menu";
import { downloadBlob } from "./ui/download";
import { StartOverlay } from "./ui/start-overlay";
import { VolumeMeter } from "./ui/volume-meter";
import { ArticulationGesture } from "./vision/articulation-gesture";
import { describeDeviceError } from "./media";
import { startCamera, describeCameraError, hasSecureContext } from "./vision/camera";
import {
  classifyChord,
  readHandShape,
  getHandCenter,
  getHandDepth,
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

/** The id of the looper's on/off switch, which is likewise not a value. */
const LOOPING_ID = "looping";

/** The id of the entry that flips how long a recording waits to begin. */
const ARM_UNIT_ID = "arm-unit";

/** The id of the entry that swaps which hand plays the chord vocabulary. */
const HARMONY_HAND_ID = "harmony-hand";

/** The id of the entry that steps the glide's snap strength. */
const SNAP_STRENGTH_ID = "snap-strength";

/**
 * The frequencies a committed state sounds.
 *
 * One place, because both the audio and the ribbon ask the same question: the
 * live path plays these, and the drawing counts them. Two answers would be two
 * things to keep in step.
 */
function notesFor(state: ChordState, tonicFrequency: number): number[] {
  return getQualityNotes(
    getChordTones(state.chord, state.isMajorMode, tonicFrequency),
    state.quality,
    state.isMajorMode,
  );
}

/** The id of the entry that turns re-articulation on or off. */
const REARTICULATE_ID = "rearticulate";

/**
 * How long a diagram hand is drawn, wrist to fingertip.
 *
 * Large enough to hold a real hand up against, which is the only reason to draw
 * one at all — at row size it is a smudge beside a label.
 */
const MAPPING_DIAGRAM_SIZE = 200;

/** The smallest a diagram is worth drawing at, below which it stops being usable. */
const MAPPING_MIN_SIZE = 110;

/** How far a ring reaches from its anchor: its radius plus an option's. */
const RING_REACH = 244;

/**
 * The id of the "save the take" entry in the transport menu.
 *
 * An action rather than a value, like the two above, but it belongs in the
 * transport: a take is the transport's product, and saving it is the last thing
 * a player does with a loop.
 */
const EXPORT_TAKE_ID = "export-take";

/** The id of the "render the loop to a file" entry, beside it. */
const RENDER_WAV_ID = "render-wav";

/**
 * The Layers menu, once a layer is in hand.
 *
 * The options are `"<layer id>:<action>"`, so one cluster can show what can be
 * done to whichever layer was handed over.
 */
const LAYER_ACTION_MUTE = "mute";
const LAYER_ACTION_LOUDER = "louder";
const LAYER_ACTION_QUIETER = "quieter";
const LAYER_ACTION_OVERDUB = "overdub";
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

  /** Kept between frames, so the editor's hands move from pose to pose. */
  private readonly mappingDiagram = new MappingDiagram();
  private readonly mono = new MonoReader();
  private readonly hud: Hud;
  private readonly guide: GestureGuide;
  private readonly help: HelpModal;

  /** Most recent landmarks per hand, carried between animation frames. */
  private readonly hands: Record<Handedness, Hand | null> = { Left: null, Right: null };

  /**
   * A transient message for the transport readout.
   *
   * The readout is rewritten every frame from the looper's state, so a message
   * has to be able to outrank it for a moment — otherwise an import failure is
   * said and then overwritten before it can be read.
   */
  private transportNotice: { message: string; until: number } | null = null;

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

  /**
   * The chord hand's vocabulary, in force.
   *
   * Replaced by {@link refreshGestureMap} rather than recomputed per frame:
   * resolving a custom map expands all thirty-two shapes, and this is read on
   * every frame. Seeded with the default so it is never undefined, which is also
   * the honest starting state.
   */
  private gestureMap: GestureMap = getGestureMap(DEFAULT_GESTURE_MAP_ID);
  private mode: InstrumentMode;
  private monoStyle: MonoStyle;

  /** Whether the gesture menu owns the frame. */
  private readonly menu = new MenuController();

  /**
   * The start gate, kept so a camera failure can be explained in it.
   *
   * Assigned by {@link wireOverlays}, which `start` calls before the camera is
   * requested.
   */
  private startOverlay!: StartOverlay;

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
      this.els.modeDisplay,
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
    this.hud.setMode(this.mode);
    this.monoStyle = restoreSelect(this.els.monoStyleSelect, MONO_STYLE_STORAGE_KEY) as MonoStyle;
    this.singleHanded = this.readStoredSingleHanded();
    this.looping = this.readStoredLooping();
    this.setArmUnit(this.readStoredArmUnit());
    this.snapStrength = this.readStoredSnapStrength();
    this.rearticulate = this.readStoredRearticulate();
    this.renderInstruments(DEFAULT_VOICE_ID);
    this.renderGestureMaps();
    this.renderTransportChoices();
    this.applyLoopingVisibility();
    // A shared link outranks the remembered map, and both outrank Classic.
    this.customSlots = this.readHashCustomMap() ?? this.readStoredCustomMap();
    this.harmonyHand = parseHarmonyHand(this.readStoredMapId(HARMONY_HAND_STORAGE_KEY));

    // The single stored id predates per-hand maps, so it seeds both hands rather
    // than being discarded: an upgrading player keeps the vocabulary they chose.
    const legacyId = restoreSelect(this.els.gestureMapSelect, GESTURE_MAP_STORAGE_KEY);

    for (const hand of HANDS) {
      this.mapIds[hand] = this.readStoredMapId(this.mapKey(hand)) ?? legacyId;

      // A shared link is a deliberate act, so it wins — and it lands on the hand
      // that is about to play rather than on the left by default.
      if (this.readHashCustomMap() !== null) this.mapIds[this.harmonyHand] = CUSTOM_MAP_ID;

      // Custom with nothing built yet is not a map.
      if (this.mapIds[hand] === CUSTOM_MAP_ID && this.customSlots === null) {
        this.mapIds[hand] = DEFAULT_GESTURE_MAP_ID;
      }
    }

    this.expressionMap = this.readStoredExpressionMap();
    this.refreshGestureMap();
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

    await this.startCameraOrExplain();
    resizeCanvasToWindow(this.els.canvas);
    window.addEventListener("resize", () => resizeCanvasToWindow(this.els.canvas));

    const handLandmarker = await createHandLandmarker();
    this.runLoop(handLandmarker);
  }

  /**
   * Brings up the camera, or stops and says why.
   *
   * Without this the failure is a console line and a dimmed screen: on a page
   * served over plain HTTP the camera is refused with no error a player can
   * see, and the instrument looks broken rather than misconfigured.
   */
  private async startCameraOrExplain(): Promise<void> {
    try {
      await startCamera(this.els.video);
    } catch (error) {
      console.error(error);
      this.startOverlay.showError(describeCameraError(error, hasSecureContext()));
      throw error;
    }
  }

  /** Constructs the components that own their own event handling. */
  private wireOverlays(): void {
    this.startOverlay = new StartOverlay(this.els.startOverlay, this.els.canvas, () =>
      this.startAudio(),
    );
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

  /**
   * Strikes a mono note the way the current style says.
   *
   * `force` is re-articulation, and it matters for the sustained styles: striking
   * a note that is already current is deliberately a no-op, so a repeat needs to
   * say so rather than rely on the note having changed.
   */
  private strikeMonoNote(notes: number[], force = false): void {
    const decay = pluckDecayFor(this.monoStyle);

    if (decay !== null) {
      this.synth.pluckNotes(notes, decay);
      return;
    }

    if (force) this.synth.retrigger(notes);
    else this.synth.playNotes(notes);
  }

  /** Says something in the transport readout for a few seconds. */
  private flashTransport(message: string): void {
    this.transportNotice = { message, until: performance.now() + 4000 };
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

    this.els.exportTakeButton.addEventListener("click", () => this.exportTake());

    this.els.renderWavButton.addEventListener("click", () => void this.exportTakeWav());

    this.els.voiceButton.addEventListener("click", () => void this.recordVoiceLoop());

    // The promise is stated where the button is, and only where it applies: the
    // microphone is a permission a player should be able to read about before
    // granting it, rather than a footnote in a readme.
    this.els.voicePrivacy.classList.toggle("hidden", !canRequestMicrophone());

    this.els.importTakeButton.addEventListener("click", () => this.els.takeFile.click());

    this.els.takeFile.addEventListener("change", () => {
      void this.importTake(this.els.takeFile);
    });
  }

  /**
   * Records one pass of the loop from the microphone, and registers it as an
   * instrument.
   *
   * RFC #9's proposal: "Wrap playback in a `Voice` implementation and register
   * it, so a captured loop is selectable in the instrument picker exactly like a
   * sampler." That is what this does — the capture goes through `defineUserSample`,
   * the same path a loaded file takes, so nothing in the engine knows the
   * difference. Making it a *layer* on the transport is the next slice.
   *
   * The window is aligned to the grid by discarding the frames before the next
   * line. Alignment matters more here than anywhere else in the instrument: a
   * captured loop is the one thing that cannot be nudged into place afterwards,
   * because it is audio rather than intent.
   */
  private async recordVoiceLoop(): Promise<void> {
    if (!canRequestMicrophone()) {
      // `describeDeviceError` answers an insecure context from the context, not
      // from an error, because in one there is no error to read.
      this.flashTransport(describeDeviceError(null, hasSecureContext(), "microphone"));
      return;
    }

    // Clicking the button is a user gesture, so this is a legal place to open audio.
    this.synth.ensureContext();
    const ctx = this.synth.context;
    if (!ctx) return;

    try {
      this.micStream ??= await startMicrophone();
    } catch (error) {
      this.flashTransport(
        error instanceof Error ? error.message : "The microphone could not be started.",
      );
      console.warn(`${PROJECT_NAME}: microphone unavailable`, error);
      return;
    }

    const frameCount = loopFrameCount(
      this.transport.loopBeats,
      this.transport.tempo,
      ctx.sampleRate,
    );

    const startAt = this.transport.ctxTimeForBeat(this.transport.nextArmBeat(this.audioTime()));
    const skipFrames = Math.max(0, Math.round((startAt - ctx.currentTime) * ctx.sampleRate));

    this.flashTransport("Recording voice…");

    try {
      const buffer = await captureVoiceBuffer(ctx, this.micStream, {
        frameCount,
        skipFrames,
        onProgress: (progress) =>
          this.flashTransport(`Recording voice… ${Math.round(progress * 100)}%`),
      });

      if (isSilentCapture(buffer.getChannelData(0))) {
        this.flashTransport("Nothing heard — the recording was silent");
        return;
      }

      this.addInstrument(defineUserSample("Voice loop", buffer));
      this.flashTransport("Voice loop recorded");
    } catch (error) {
      this.flashTransport(
        error instanceof Error ? error.message : "The voice loop could not be recorded.",
      );
      console.warn(`${PROJECT_NAME}: could not record a voice loop`, error);
    }
  }

  /**
   * Writes the loop out as a take file.
   *
   * Only layers that hold a take are written: a lane that was armed and never
   * recorded is not a layer, and exporting an empty one would put a nameless
   * row in the file. With nothing recorded there is nothing to export, so the
   * button does nothing rather than saving an empty take the importer will
   * reject.
   */
  private exportTake(): void {
    const tracks = this.looper.tracks.flatMap((track) =>
      track.take === null
        ? []
        : [
            {
              label: track.label,
              mode: track.mode,
              muted: track.muted,
              gain: track.gain,
              take: track.take,
            },
          ],
    );

    if (tracks.length === 0) {
      this.flashTransport("Nothing recorded to export");
      return;
    }

    const text = serializeTakeDocument({
      bpm: this.transport.tempo,
      loopBeats: this.transport.loopBeats,
      tracks,
    });

    downloadBlob(
      new Blob([text], { type: "application/json" }),
      takeDocumentFilename(new Date(), this.transport.loopBeats),
    );
  }

  /**
   * Renders the loop to a WAV, offline.
   *
   * Faster than real time and independent of the tab being focused, which is the
   * point: the file does not depend on the machine keeping up, and it is the
   * same renderer #12's audio path will call.
   *
   * The layers are resolved against the *current* tonic, so the file transposes
   * with the key exactly as playback does.
   */
  private async exportTakeWav(): Promise<void> {
    const voiceId = this.els.instrumentSelect.value;

    const layers = this.looper.tracks.flatMap((track) =>
      track.take === null ? [] : [{ take: track.take, gain: track.gain, voiceId }],
    );

    if (layers.length === 0) {
      this.flashTransport("Nothing recorded to render");
      return;
    }

    this.flashTransport("Rendering…");

    try {
      const wav = await renderTakeToWav({
        layers,
        bpm: this.transport.tempo,
        loopBeats: this.transport.loopBeats,
        tonicFrequency: this.tonicFrequency,
      });

      downloadBlob(wav, takeAudioFilename(new Date(), this.transport.loopBeats));
      this.flashTransport("Rendered");
    } catch (error) {
      this.flashTransport("Could not render the loop");
      console.warn(`${PROJECT_NAME}: could not render the take`, error);
    }
  }

  /**
   * Reads a take file back in, replacing whatever is in play.
   *
   * The document's tempo and loop length are applied *before* the layers, so the
   * grid the imported events were played against is the grid they will be
   * replayed on. A take that arrived without its own grid would line up against
   * whatever happened to be selected, which is how a loop goes out of phase with
   * itself.
   */
  private async importTake(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    // Clearing the input lets the same file be picked twice in a row.
    input.value = "";
    if (!file) return;

    let parsed;
    try {
      parsed = parseTakeDocument(await file.text());
    } catch (error) {
      const reason = error instanceof Error ? error.message : "That take could not be read.";
      this.flashTransport(reason);
      console.warn(`${PROJECT_NAME}: could not import "${file.name}"`, error);
      return;
    }

    // Every existing layer's channel is retired: its track is about to be gone,
    // and a channel with no track would keep sounding forever.
    for (const layer of this.layers.values()) layer.stop();
    this.layers.clear();
    this.layerFocus = null;

    this.setTempo(parsed.bpm);
    this.setBars(parsed.loopBeats / this.transport.beatsPerBar);

    const seeds: LoopLayerSeed[] = parsed.tracks.map((track) => ({
      label: track.label,
      mode: track.mode,
      muted: track.muted,
      gain: track.gain ?? 1,
      take: track.take,
    }));

    this.looper.replaceLayers(seeds);
    this.flashTransport(`${seeds.length} layer${seeds.length === 1 ? "" : "s"} imported`);
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

    // Only what can play the mode in force. Today that is every voice, because
    // an oscillator bank and a sampler both take a one-element frequency list
    // as happily as a chord — but a drum kit will not, and a kit offered in
    // chord mode is an instrument that plays nothing.
    for (const voice of listVoicesFor(this.mode)) {
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

  /** Arms a recording that is added to one layer, keeping what it holds. */
  private overdubLoop(id: TrackId): void {
    this.looper.overdub(this.audioTime(), id);
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

  /**
   * Sets one layer's level, and re-primes it so the change is heard *now*.
   *
   * Without the re-prime a fader would only take effect on the layer's next
   * note, which on a two-bar chord is several seconds of a control that appears
   * not to work.
   */
  private setLayerGain(id: TrackId, gain: number): void {
    this.looper.setGain(id, gain);
    this.replayIfSounding(id);
  }

  /** Steps one layer's level, for the menu, which cannot drag a fader. */
  private nudgeLayerGain(id: TrackId, steps: number): void {
    this.looper.nudgeGain(id, steps);
    this.replayIfSounding(id);
  }

  /** Re-primes a layer unless it is dropped out. */
  private replayIfSounding(id: TrackId): void {
    const track = this.looper.tracks.find((candidate) => candidate.id === id);
    if (track && !track.muted) this.replayLayer(track);
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

    // One-handed staging changes which control gestures exist, so the guide has
    // to be re-rendered — otherwise it would keep offering a fist transport that
    // this setting just turned off.
    this.refreshHelp();
  }

  /** Reads the remembered arm unit, ignoring anything that is not a choice. */
  private readStoredArmUnit(): ArmUnit {
    try {
      const stored = window.localStorage.getItem(ARM_UNIT_STORAGE_KEY);
      return ARM_UNIT_CHOICES.find((choice) => choice === stored) ?? "bar";
    } catch {
      return "bar";
    }
  }

  /** Changes how long a recording waits to begin, and remembers it. */
  private setArmUnit(unit: ArmUnit): void {
    this.armUnit = unit;
    this.transport.setArmUnit(unit);
    remember(ARM_UNIT_STORAGE_KEY, unit);
  }

  /** Reads the remembered snap strength, ignoring anything that is not a choice. */
  private readStoredSnapStrength(): number {
    try {
      const stored = Number(window.localStorage.getItem(SNAP_STRENGTH_STORAGE_KEY));
      return MONO_SNAP_CHOICES.find((choice) => choice === stored) ?? MONO_SNAP_STRENGTH_DEFAULT;
    } catch {
      return MONO_SNAP_STRENGTH_DEFAULT;
    }
  }

  /** Steps the snap strength to the next choice, and remembers it. */
  private nextSnapStrength(): void {
    const index = MONO_SNAP_CHOICES.indexOf(
      this.snapStrength as (typeof MONO_SNAP_CHOICES)[number],
    );
    const next = MONO_SNAP_CHOICES[(index + 1) % MONO_SNAP_CHOICES.length] ?? 0;

    this.snapStrength = next;
    remember(SNAP_STRENGTH_STORAGE_KEY, String(next));
  }

  /** Reads the remembered re-articulation setting. On unless it was turned off. */
  private readStoredRearticulate(): boolean {
    try {
      return window.localStorage.getItem(ARTICULATION_STORAGE_KEY) !== "off";
    } catch {
      return true;
    }
  }

  /** Turns re-articulation on or off, and remembers it. */
  private setRearticulate(enabled: boolean): void {
    this.rearticulate = enabled;
    remember(ARTICULATION_STORAGE_KEY, enabled ? "on" : "off");
    this.articulation.reset();
    this.refreshHelp();
  }

  /** Reads the remembered looping setting. On unless it was turned off. */
  private readStoredLooping(): boolean {
    try {
      return window.localStorage.getItem(LOOPING_STORAGE_KEY) !== "off";
    } catch {
      return true;
    }
  }

  /**
   * Turns the looper on or off, and remembers it.
   *
   * Off means off: the transport, the layers and the fist gestures all go, and
   * anything recorded goes with them rather than sitting there hidden. The
   * instrument a player is left with is the one that existed before the looper —
   * which is a perfectly good instrument, and the one most people want.
   */
  private setLooping(enabled: boolean): void {
    if (enabled === this.looping) return;

    this.looping = enabled;
    remember(LOOPING_STORAGE_KEY, enabled ? "on" : "off");
    this.applyLoopingVisibility();

    if (!enabled) {
      this.clearLoop();
      this.transportCue = null;
      this.forgetFists();
    }

    this.refreshHelp();
  }

  /** Shows the looper's controls only when the looper is on. */
  private applyLoopingVisibility(): void {
    const controls = [
      this.els.tempoSelect,
      this.els.barsSelect,
      this.els.transportControls,
      this.els.transportDisplay,
      this.els.layerControls,
      this.els.takeControls,
    ];

    for (const control of controls) control.classList.toggle("hidden", !this.looping);
  }

  /** Drops whatever the fist readers were holding, e.g. when looping is turned off. */
  private forgetFists(): void {
    this.fists.Left.reset();
    this.fists.Right.reset();
  }

  /** Switches the gesture vocabulary and keeps the readouts in step. */
  private setGestureMap(id: string): void {
    // Choosing Custom for the first time seeds it from whatever is in play, so
    // it starts as a copy of the map the player already likes rather than as
    // seven empty shapes.
    if (id === CUSTOM_MAP_ID && this.customSlots === null) {
      this.customSlots = slotsFromMap(this.gestureMap);
      this.saveCustomMap();
    }

    this.mapIds[this.harmonyHand] = id;
    remember(this.mapKey(this.harmonyHand), id);
    this.resetTranspose();
    this.refreshGestureMap();
    this.refreshHelp();
  }

  /** The storage key for a hand's map. */
  private mapKey(hand: Handedness): string {
    return hand === "Left" ? GESTURE_MAP_LEFT_STORAGE_KEY : GESTURE_MAP_RIGHT_STORAGE_KEY;
  }

  /** Reads a stored map id, or `null` when there is not one. */
  private readStoredMapId(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  /**
   * Recomputes the chord hand's map.
   *
   * Called whenever an input to it changes — the hand, either stored id, or the
   * custom slots — rather than recomputed per frame, because resolving a custom
   * map expands all thirty-two shapes.
   */
  private refreshGestureMap(): void {
    this.gestureMap = this.resolveGestureMap(this.mapIds[this.harmonyHand]);
    this.els.gestureMapSelect.value = this.mapIds[this.harmonyHand];
  }

  /**
   * Forgets any armed transposition.
   *
   * Called whenever the vocabulary changes underneath it: a shift armed for one
   * map must not silently apply to the next one.
   */
  private resetTranspose(): void {
    this.modifier.reset();
  }

  /** Swaps which hand plays the chord vocabulary, keeping both maps. */
  private setHarmonyHand(hand: Handedness): void {
    if (hand === this.harmonyHand) return;

    this.harmonyHand = hand;
    remember(HARMONY_HAND_STORAGE_KEY, hand);
    this.resetTranspose();
    this.refreshGestureMap();
    this.refreshHelp();
  }

  /**
   * Reads a map out of the URL, which is how one is shared.
   *
   * A link is the whole distribution mechanism: there is no account, no server,
   * and no file to send. If there is one in the fragment it wins over the stored
   * map, because following a link is a deliberate act and loading the map you
   * were sent is what the link is *for*.
   */
  private readHashCustomMap(): CustomMapSlots | null {
    return slotsFromHash(window.location.hash);
  }

  /** Reads the remembered pose map, falling back to the default vocabulary. */
  private readStoredExpressionMap(): ExpressionMap {
    try {
      const stored = window.localStorage.getItem(EXPRESSION_MAP_STORAGE_KEY);
      const map = stored === null ? null : decodeExpressionMap(stored);

      return map ?? DEFAULT_EXPRESSION_MAP;
    } catch {
      return DEFAULT_EXPRESSION_MAP;
    }
  }

  /** Reads the remembered custom map, or `null` when there is not a usable one. */
  private readStoredCustomMap(): CustomMapSlots | null {
    try {
      const stored = window.localStorage.getItem(CUSTOM_MAP_STORAGE_KEY);
      return stored === null ? null : decodeCustomMap(stored);
    } catch {
      return null;
    }
  }

  /** Remembers the custom map, and keeps the shareable link up to date with it. */
  private saveCustomMap(): void {
    if (this.customSlots === null) return;

    remember(CUSTOM_MAP_STORAGE_KEY, encodeCustomMap(this.customSlots));

    // replaceState rather than assigning the hash: an edit is not a navigation,
    // and a map edited ten times should not leave ten history entries.
    const hash = hashForCustomMap(this.customSlots);
    if (window.location.hash !== hash) {
      window.history.replaceState(null, "", hash);
    }
  }

  /** Switches between chords and a single note. */
  private setMode(mode: InstrumentMode): void {
    if (mode === this.mode) return;

    this.mode = mode;
    this.els.modeSelect.value = mode;
    this.hud.setMode(mode);
    remember(MODE_STORAGE_KEY, mode);
    this.applyModeVisibility();

    // The picker is per-mode, so it is rebuilt here rather than only at startup.
    // If the instrument in play cannot play the new mode it is swapped for one
    // that can, because the alternative is a picker whose own value is not in
    // its list.
    const current = this.els.instrumentSelect.value;
    const stillPlayable = listVoicesFor(mode).some((voice) => voice.id === current);

    this.renderInstruments(stillPlayable ? current : DEFAULT_VOICE_ID);

    if (!stillPlayable) this.synth.setInstrument(this.els.instrumentSelect.value);

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
    this.guide.render(this.mode, this.keyName, this.gestureMap, {
      looping: this.looping,
      singleHanded: this.singleHanded,
      rearticulate: this.rearticulate,
    });
    this.help.render(this.mode, this.keyName, this.gestureMap, this.looping);
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

    const presets = GESTURE_MAPS.map((map) => {
      const option = document.createElement("option");
      option.value = map.id;
      option.textContent = map.label;
      option.title = map.description;
      return option;
    });

    // Custom is always offered, because choosing it is how you *make* one.
    const custom = document.createElement("option");
    custom.value = CUSTOM_MAP_ID;
    custom.textContent = CUSTOM_MAP_LABEL;
    custom.title = "Your own map: seven shapes, whatever they should play.";

    select.replaceChildren(...presets, custom);
    select.value = DEFAULT_GESTURE_MAP_ID;
  }

  /**
   * The map a picker id means.
   *
   * The presets are static data; the custom one is whatever the player built, and
   * falls back to Classic while it is still empty — an id that resolves to an
   * instrument which plays nothing is not a map.
   */
  private resolveGestureMap(id: string): GestureMap {
    if (id === CUSTOM_MAP_ID && this.customSlots !== null) {
      return customMapFromSlots(this.customSlots);
    }

    return getGestureMap(id);
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

    // Expression follows the expression hand in both modes: it is the "how it
    // sounds" hand, whichever side the chord hand is on.
    const expressionHand = otherHand(this.harmonyHand);
    const expression = expressionHand === "Left" ? Left : Right;

    const volume = expression ? getVolumeFromHeight(expression) : 0;
    const tilt = expression ? getHandHorizontalTilt(expression, expressionHand) : 0;

    if (expression) {
      this.hud.setVolume(volume);
      this.hud.setFilter(tilt);
      this.synth.updateFilterSweep(tilt);
    } else {
      this.synth.setVolume(0);
    }

    // In mono there is no voicing to choose, so the expression hand's finger
    // count carries vibrato instead. That is the RFC's reading of what the hand
    // should do once it stops picking voicings: octave, filter, vibrato, and
    // articulation. Chord mode keeps the count for quality, hence the zero.
    this.synth.setVibrato(
      this.mode === "mono" && expression
        ? getRightHandQualityIndex(expression) * AUDIO.vibratoCentsPerFinger
        : 0,
      AUDIO.vibratoRateHz,
    );

    if (this.mode === "mono") {
      this.updateMonoFrame(Left, Right, volume, tilt, ctxTime, now);
      return;
    }

    const state = this.stabilizer.update(this.readIntent(Left, Right), now);

    const isMajorMode = state?.isMajorMode ?? true;
    const chord = state?.chord ?? null;
    const quality = state?.quality ?? null;

    this.hud.setChord(getChordDisplayName(chord, isMajorMode, this.keyName), chord);
    this.hud.setQuality(
      // An armed shift outranks the kind label: it is the thing about to change,
      // and the kind is not.
      this.modifier.armed > 0
        ? `Modifier +${this.modifier.armed}`
        : quality
          ? getQualityLabel(quality)
          : undefined,
    );

    this.looper.capture(
      state && quality !== null
        ? {
            kind: "chord",
            numeral: state.chord,
            isMajorMode: state.isMajorMode,
            quality,
          }
        : null,
      volume,
      tilt,
      ctxTime,
    );

    if (Right) {
      this.updateVoices(state, volume);
    }

    // One ribbon line per note the kind sounds, so the drawing follows the same
    // thing the ear does: a four-note kind is busier than a three-note one, and a
    // pose the map does not name draws nothing at all.
    drawEnergy(
      this.els.ctx,
      volume,
      state ? notesFor(state, this.tonicFrequency).length : 0,
      tilt,
      chord,
    );
  }

  /**
   * Advances the loop and replays whatever came due this frame.
   *
   * The events drive the loop layer exactly as the hands drive the live one:
   * the same frequencies, from the same harmony functions, into a voice of the
   * same kind. That is what makes a take sound like the take.
   */
  private updateLoop(ctxTime: number): void {
    // Scheduled ahead rather than "now": the audio thread is told the moment a
    // note should start, so an onset lands on the beat instead of on whichever
    // frame noticed it. This is what #10's drums need to be believable.
    for (const hit of this.looper.schedule(ctxTime, TRANSPORT.schedulingLookaheadSeconds)) {
      this.playLoopEvent(hit.trackId, resolveTakeEvent(hit.event, this.tonicFrequency), hit.when);
    }

    const { state } = this.looper;

    // A notice outranks the state readout while it lasts, because the whole
    // point of saying "could not import" is that it is seen.
    const notice = this.transportNotice;
    const noticeActive = notice !== null && performance.now() < notice.until;
    if (notice !== null && !noticeActive) this.transportNotice = null;

    this.els.transportDisplay.textContent = noticeActive
      ? notice.message
      : describeLooper({
          state,
          loopBars: this.transport.loopBars,
          hasTake: this.looper.hasTake,
          recordingLabel: this.looper.recordingLabel,
          countdownBeats: this.looper.countdownBeats(ctxTime),
          recordKind: this.looper.recordingKind,
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

  private playLoopEvent(trackId: TrackId, resolved: ResolvedEvent, when?: number): void {
    const layer = this.layerFor(trackId);
    const gain = this.looper.tracks.find((track) => track.id === trackId)?.gain ?? 1;

    if (resolved.notes.length === 0) {
      layer.setVolume(0);
      return;
    }

    if (when === undefined) {
      layer.playNotes(resolved.notes);
    } else {
      layer.playNotesAt(resolved.notes, when);
    }

    layer.updateFilterSweep(resolved.tilt);
    layer.setVolume(resolved.volume * gain);
  }

  /**
   * Rebuilds the per-layer mute buttons, but only when the layers have changed.
   *
   * Called from the render loop, so it has to be cheap: the signature check is
   * what keeps it from rebuilding six buttons sixty times a second.
   */
  private renderLayerControls(): void {
    const tracks = this.looper.tracks;
    const signature = tracks
      .map((track) => `${track.id}:${track.muted}:${track.gain.toFixed(2)}`)
      .join(",");
    if (signature === this.layerSignature) return;

    this.layerSignature = signature;

    this.els.layerControls.replaceChildren(
      ...tracks.map((track) => {
        const row = document.createElement("div");
        row.className = "layer-row";

        const button = document.createElement("button");
        button.type = "button";
        button.textContent = track.label;
        button.classList.toggle("muted", track.muted);
        button.title = track.muted ? `Bring ${track.label} back in` : `Drop ${track.label} out`;
        button.addEventListener("click", () => this.toggleLayer(track.id));

        // A fader per layer, which is the one mix control that cannot be a
        // toggle: "how much" is not the same question as "is it in".
        const fader = document.createElement("input");
        fader.type = "range";
        fader.min = "0";
        fader.max = "1";
        fader.step = String(GAIN_STEP);
        fader.value = String(track.gain);
        fader.title = `${track.label} level: ${Math.round(track.gain * 100)}%`;
        fader.setAttribute("aria-label", `${track.label} level`);
        fader.addEventListener("input", () => this.setLayerGain(track.id, Number(fader.value)));

        row.append(button, fader);
        return row;
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
  private updateMonoFrame(
    left: Hand | null,
    right: Hand | null,
    volume: number,
    tilt: number,
    ctxTime: number,
    now: number,
  ): void {
    // Pitch comes from the chord hand — the same hand that picks chords picks
    // the note — and the thumb from the expression hand, where there is no
    // voicing to drop in mono, so it becomes the octave for a bassline.
    const pitchHand = this.harmonyHand;
    const expressionHand = otherHand(pitchHand);
    const pitch = pitchHand === "Left" ? left : right;
    const expression = expressionHand === "Left" ? left : right;

    const reading = this.mono.update(
      pitch ? getHandHeight(pitch) : null,
      this.monoStyle,
      this.tonicFrequency,
      {
        octaveDown: expression !== null && isThumbExtended(expression, expressionHand),
        snapStrength: this.snapStrength,
      },
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
      this.hud.setQuality(this.monoStyleLabel);
      drawEnergy(this.els.ctx, 0, 0, tilt, null);
      return;
    }

    const notes = [reading.frequency];

    switch (this.monoStyle) {
      case "glide":
        this.synth.glideNotes(notes);
        break;
      case "harp":
      case "staccato":
        // Pluck on entering a degree and let it *decay*. The decay is the whole
        // difference between the two plucked styles: long rings into a phrase,
        // short is a run of separate notes.
        if (reading.isNewDegree) this.strikeMonoNote(notes);
        break;
      default:
        this.synth.playNotes(notes);
    }

    // Re-articulation: the same note struck again, without moving the hand. This
    // is the one thing no style can do on its own, because a repeat is not a
    // *change* of degree and every style is driven by changes.
    const { fired } = this.rearticulate
      ? this.articulation.update(pitch ? getHandDepth(pitch) : null, now)
      : this.articulation.update(null, now);

    if (fired) this.strikeMonoNote(notes, true);

    this.synth.setVolume(volume);

    this.hud.setNote(monoNoteLabel(reading, this.keyName));
    this.hud.setQuality(this.monoStyleLabel);
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

    // With the looper off there is no transport to flick; while the menu owns
    // the frame there is no room for one either. Either way the fist stands
    // aside rather than offering commands that would do nothing.
    if (!this.looping || this.menu.open) {
      this.forgetFists();
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
        menus: { layout: "radial", items: menuTopicsFor(this.looping), activeId: this.menuId },
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
      this.customSlotFocus = null;
      this.mapTarget = null;
      this.poseFocus = null;
      return false;
    }

    drawMenuBackdrop(this.els.ctx, update.elapsedMs);

    if (this.menuId === "map") this.drawMapping(update);

    drawCluster(this.els.ctx, update.menus, MENUS_STYLE);
    // The ring is anchored to a hand and a list is a column down the middle, so
    // the list is told where the ring is and moves to the other half: drawn on top
    // of each other, neither can be read.
    drawCluster(
      this.els.ctx,
      update.options,
      OPTIONS_STYLE,
      update.menus.layout === "radial"
        ? { x: update.menus.centerX, y: update.menus.centerY }
        : undefined,
    );

    this.hud.setNote(this.menuTitle(update.menus));
    this.hud.setQuality(
      update.options.hoveredId === null ? "Control" : this.labelFor(update.options),
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

    // The editor is named here for the same reason a layer is: it is a
    // drill-down, so the ring shows no menu in force and the readout is the only
    // place that can say where the player is. Without it, choosing *Edit map…*
    // looked like nothing had happened.
    if (this.menuId === "map") {
      // Named at every step, because a three-step drill-down that only says the
      // first one leaves a player unable to tell the shape list from the kind
      // list — they are both lists of eight things.
      if (this.mapTarget === "kinds") {
        return this.poseFocus === null ? "What kind" : describePose(this.poseFocus);
      }

      if (this.mapTarget === "chords") {
        const focused = CUSTOM_MAP_SLOTS.find((slot) => slot.id === this.customSlotFocus);

        return focused ? focused.label : "Which chord";
      }

      return "Edit map";
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

    if (this.menuId === "tempo") {
      return {
        layout: "list",
        items: asOptions(this.els.tempoSelect),
        activeId: this.els.tempoSelect.value,
      };
    }

    if (this.menuId === "loop") {
      return {
        layout: "list",
        items: asOptions(this.els.barsSelect),
        activeId: this.els.barsSelect.value,
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
            // Level is stepped rather than dragged: the cursor is a hand, and a
            // hand that is coarse enough to pick a direction cannot land on a
            // fader. Both entries stay open so the level can be nudged twice.
            {
              id: `${focused.id}:${LAYER_ACTION_LOUDER}`,
              label: `Louder (${Math.round(focused.gain * 100)}%)`,
              keepsMenuOpen: true,
            },
            {
              id: `${focused.id}:${LAYER_ACTION_QUIETER}`,
              label: "Quieter",
              keepsMenuOpen: true,
            },
            // Overdub adds a pass; Rewrite replaces the take. Both are offered
            // because they answer different instincts, and losing a part to the
            // wrong one is what makes an overdub feature worth having.
            ...(focused.take
              ? [{ id: `${focused.id}:${LAYER_ACTION_OVERDUB}`, label: "Overdub" }]
              : []),
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
      //
      // Export belongs here; **import does not**. Export is a download, which a
      // gesture can start. Import opens the operating system's file picker,
      // which no gesture can drive — so it stays a button, and this menu stays
      // honest about what it can reach.
      return {
        layout: "radial",
        items: [
          { id: "record", label: "Record" },
          { id: "play", label: "Play" },
          { id: "stop", label: "Stop" },
          { id: "clear", label: "Clear" },
          { id: EXPORT_TAKE_ID, label: "Save take" },
          { id: RENDER_WAV_ID, label: "Save WAV" },
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

      const looping: MenuOption = {
        id: LOOPING_ID,
        label: this.looping ? "Looping: on" : "Looping: off",
        // Left open so the label flips where the player is looking, which is
        // the only confirmation a toggle like this gets.
        keepsMenuOpen: true,
      };

      // Where a recording begins. A setting rather than a transport control,
      // because it is decided once and then not thought about again — the
      // transport's own entries are the ones reached for mid-phrase.
      const armUnit: MenuOption = {
        id: ARM_UNIT_ID,
        label: `Arm on: ${this.armUnit}`,
        keepsMenuOpen: true,
      };

      // Which hand plays the chord vocabulary. A setting rather than a control,
      // and the whole reason per-hand maps exist: a player whose left hand
      // cannot form the shapes can put the chords on the right.
      const harmonyHand: MenuOption = {
        id: HARMONY_HAND_ID,
        label: `Chords hand: ${handName(this.harmonyHand)}`,
        keepsMenuOpen: true,
      };

      // Snap assistance on a glide. Only meaningful in mono, but listed either
      // way so it is where a player looks for it rather than appearing later.
      const snapStrength: MenuOption = {
        id: SNAP_STRENGTH_ID,
        label: `Snap: ${snapLabel(this.snapStrength)}`,
        keepsMenuOpen: true,
      };

      // Its own switch because the thresholds were chosen from MediaPipe's `z`
      // semantics rather than from a hand: if they misfire on your camera, this
      // is one dwell away from silence rather than a rebuild.
      const rearticulate: MenuOption = {
        id: REARTICULATE_ID,
        label: `Re-strike: ${this.rearticulate ? "on" : "off"}`,
        keepsMenuOpen: true,
      };

      const items: MenuOption[] = [
        { id: "chord", label: "Chords", keepsMenuOpen: true },
        { id: "mono", label: "Mono", keepsMenuOpen: true },
        harmonyHand,
        snapStrength,
        rearticulate,
        oneHanded,
        looping,
      ];

      // Only meaningful while the looper is on, matching Transport and Layers.
      if (this.looping) items.splice(3, 0, armUnit);

      return {
        layout: "radial",
        items,
        activeId: this.mode,
      };
    }

    if (this.menuId === "map") {
      // Three steps deep at most: which hand, then the shape, then what it does.
      if (this.mapTarget === null) return mapTargetCluster(this.harmonyHand);

      if (this.mapTarget === "kinds") {
        return this.poseFocus === null
          ? expressionPosesCluster(this.expressionMap)
          : expressionKindsCluster(this.expressionMap, this.poseFocus);
      }

      return mapEditorCluster(
        this.customSlots ?? slotsFromMap(this.gestureMap),
        this.customSlotFocus,
      );
    }

    if (this.mode === "mono") {
      return {
        layout: "radial",
        items: asOptions(this.els.monoStyleSelect),
        activeId: this.els.monoStyleSelect.value,
      };
    }

    // In Chords mode the vocabulary menu is the map picker, plus the way into
    // the editor.
    return vocabularyCluster(asOptions(this.els.gestureMapSelect), this.els.gestureMapSelect.value);
  }

  /**
   * The mapping, drawn large: both hands, with the pose in hand on the one that
   * owns it.
   *
   * The hovered option is what the diagram follows, not the committed one, so the
   * hand redraws as the cursor moves between poses — which is the whole point of
   * drawing it at a size you can hold your own hand against.
   */
  private drawMapping(update: MenuUpdate): void {
    const chordHand = this.harmonyHand;
    const kindHand = otherHand(chordHand);
    const hovered = update.options.hoveredId;

    const chord: DiagramHand = {
      pose: this.chordDiagramPose(hovered),
      hand: sideOf(chordHand),
      caption: this.chordDiagramCaption(hovered),
      rest: this.mapTarget !== "chords",
    };

    const kinds: DiagramHand = {
      pose: this.kindDiagramPose(hovered),
      hand: sideOf(kindHand),
      caption: this.kindDiagramCaption(hovered),
      rest: this.mapTarget !== "kinds",
    };

    const width = this.els.canvas.width;
    const ringX = update.menus.centerX;
    const listLeft = listBandLeft(width, listBandWidth(width), { x: ringX, y: 0 });

    // The band the ring and the list leave between them, whichever side each is
    // on. The diagram is drawn in it and as large as it allows: a diagram sized to
    // a column is a diagram not worth drawing, which is why the walkthrough gives
    // it a screen of its own.
    const [bandStart, bandEnd] =
      ringX < width / 2
        ? [ringX + RING_REACH, listLeft]
        : [listLeft + listBandWidth(width), ringX - RING_REACH];
    const band = Math.max(0, bandEnd - bandStart);
    const size = Math.max(MAPPING_MIN_SIZE, Math.min(MAPPING_DIAGRAM_SIZE, diagramSizeFor(band)));

    this.mappingDiagram.draw(
      this.els.ctx,
      {
        x: bandStart + band / 2,
        y: this.els.canvas.height * 0.5,
        size,
        hands: [chord, kinds],
        colour: "#e8a13d",
      },
      performance.now(),
    );
  }

  /** The shape the chord hand is shown making: the hovered shape, or at rest. */
  private chordDiagramPose(hovered: string | null): HandShape {
    const id = hovered ?? this.customSlotFocus;
    const slot = CUSTOM_MAP_SLOTS.find((candidate) => candidate.id === id);

    return slot ? slot.shape : OPEN_HAND;
  }

  /** What that shape plays, or the hand's job while nothing is in hand. */
  private chordDiagramCaption(hovered: string | null): string {
    const id = hovered ?? this.customSlotFocus;
    const slot = CUSTOM_MAP_SLOTS.find((candidate) => candidate.id === id);
    if (!slot) return "which chord";

    const target = describeSlotTarget(slot.read(this.customSlots ?? slotsFromMap(this.gestureMap)));

    return `${slot.label} → ${target}`;
  }

  /** The shape the expression hand is shown making: the hovered pose, or the one in hand. */
  private kindDiagramPose(hovered: string | null): HandShape {
    return poseFromOptionId(hovered ?? "") ?? this.poseFocus ?? OPEN_HAND;
  }

  /** What that pose plays, or the hand's job while nothing is in hand. */
  private kindDiagramCaption(hovered: string | null): string {
    const pose = this.kindDiagramPose(hovered);
    const kind = qualityForPose(this.expressionMap, pose);

    if (this.mapTarget !== "kinds" && this.poseFocus === null && pose === OPEN_HAND)
      return "what kind";

    return kind === null ? describePose(pose) : (getQualityLabel(kind) ?? describePose(pose));
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
      this.customSlotFocus = null;
      return;
    }

    if (this.menuId === "settings") {
      if (choice.id === LOOPING_ID) {
        this.setLooping(!this.looping);
        return;
      }

      if (choice.id === ONE_HANDED_ID) {
        this.setSingleHanded(!this.singleHanded);
        return;
      }

      if (choice.id === ARM_UNIT_ID) {
        this.setArmUnit(this.armUnit === "bar" ? "beat" : "bar");
        return;
      }

      if (choice.id === HARMONY_HAND_ID) {
        this.setHarmonyHand(otherHand(this.harmonyHand));
        return;
      }

      if (choice.id === SNAP_STRENGTH_ID) {
        this.nextSnapStrength();
        return;
      }

      if (choice.id === REARTICULATE_ID) {
        this.setRearticulate(!this.rearticulate);
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

    if (this.menuId === "tempo") {
      this.setTempo(Number(choice.id));
      return;
    }

    if (this.menuId === "loop") {
      this.setBars(Number(choice.id));
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
        case LAYER_ACTION_LOUDER:
          this.nudgeLayerGain(action.trackId, 1);
          return;
        case LAYER_ACTION_QUIETER:
          this.nudgeLayerGain(action.trackId, -1);
          return;
        case LAYER_ACTION_OVERDUB:
          this.layerFocus = null;
          this.overdubLoop(action.trackId);
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
        case EXPORT_TAKE_ID:
          this.exportTake();
          return;
        case RENDER_WAV_ID:
          void this.exportTakeWav();
          return;
      }
      return;
    }

    if (this.menuId === "vocabulary" && choice.id === EDIT_MAP_ID) {
      // Editing implies the map being edited, so choosing the editor chooses
      // Custom — seeded from whatever was in play on the way in.
      this.setGestureMap(CUSTOM_MAP_ID);
      this.menuId = "map";
      this.customSlotFocus = null;
      // Editing starts by asking *which* map: the chord hand's degrees, or the
      // expression hand's kinds.
      this.mapTarget = null;
      this.poseFocus = null;
      return;
    }

    if (this.menuId === "map") {
      this.applyMapEdit(choice.id);
      return;
    }

    if (this.mode === "mono") {
      this.setMonoStyle(choice.id as MonoStyle);
    } else {
      this.setGestureMap(choice.id);
    }
  }

  /**
   * One step of the map editor: choose a shape, or give it a degree.
   *
   * The assignment stays open, so a player can set seven shapes without
   * reopening the menu between each — which at three deliberate steps per open
   * would be most of the work of editing.
   */
  private applyMapEdit(id: string): void {
    // The step that says which map, before either map's own steps.
    if (this.mapTarget === null) {
      if (id === MAP_TARGET_CHORDS_ID) this.mapTarget = "chords";
      if (id === MAP_TARGET_KINDS_ID) this.mapTarget = "kinds";

      return;
    }

    if (this.mapTarget === "kinds") {
      this.applyKindEdit(id);
      return;
    }

    if (!this.customSlotFocus) {
      if (CUSTOM_MAP_SLOTS.some((slot) => slot.id === id)) this.customSlotFocus = id;
      return;
    }

    if (id === MAP_BACK_ID) {
      this.customSlotFocus = null;
      return;
    }

    const focused = CUSTOM_MAP_SLOTS.find((slot) => slot.id === this.customSlotFocus);
    if (!focused) return;

    const target: SlotTarget =
      id === SILENT_SLOT_ID
        ? null
        : id === MODIFIER_SLOT_ID
          ? "modifier"
          : (NUMERALS_SET.find((candidate) => candidate === id) ?? null);

    this.customSlots = focused.write(this.customSlots ?? slotsFromMap(this.gestureMap), target);
    this.saveCustomMap();
    this.resetTranspose();
    this.refreshGestureMap();
    this.refreshHelp();
  }

  /**
   * One step of the kind editor: choose a pose, or give it a kind.
   *
   * The assignment stays open, like the degree editor's, so several poses can be
   * changed in one visit rather than reopening the menu between each.
   */
  private applyKindEdit(id: string): void {
    if (this.poseFocus === null) {
      const pose = poseFromOptionId(id);
      if (pose !== null) this.poseFocus = pose;

      return;
    }

    if (id === MAP_BACK_ID) {
      this.poseFocus = null;
      return;
    }

    const quality = id === SILENT_SLOT_ID ? null : id;

    // Anything that is not a kind in the catalogue is not a kind; the menu only
    // offers real ones, so this is a guard on the id rather than on the player.
    if (quality !== null && getQuality(quality) === undefined) return;

    this.setExpressionPose(this.poseFocus, quality);
  }

  /** Gives one pose a kind, and remembers the map it makes. */
  private setExpressionPose(pose: HandShape, quality: string | null): void {
    this.expressionMap = withPose(this.expressionMap, pose, quality);
    remember(EXPRESSION_MAP_STORAGE_KEY, encodeExpressionMap(this.expressionMap));
  }

  /** How long a recording waits to begin: the next bar line, or the next beat. */
  private armUnit: ArmUnit = "bar";

  /** How hard a glide is pulled toward the nearest note, from the snap setting. */
  private snapStrength: number = MONO_SNAP_STRENGTH_DEFAULT;

  /** Whether pushing the pitch hand re-strikes the note. */
  private rearticulate = true;

  /** The depth reader: push the pitch hand forward to hear the note struck again. */
  private readonly articulation = new ArticulationGesture();

  /**
   * The microphone stream, once it has been granted.
   *
   * Kept so the permission prompt is asked *once* and only when a voice layer is
   * first armed — a dialog before a player has asked for anything is a dialog
   * that gets dismissed reflexively, and a dismissed prompt is expensive to come
   * back from.
   */
  private micStream: MediaStream | null = null;

  /** The player's own map, once it exists. `null` until Custom is first chosen. */
  private customSlots: CustomMapSlots | null = null;

  /**
   * Which hand plays the chord vocabulary.
   *
   * Per-hand maps only mean something alongside this: with the split fixed, a
   * second vocabulary would be unreachable. A player whose left hand cannot form
   * the shapes can put the chords on the right and keep playing.
   */
  private harmonyHand: Handedness = "Left";

  /**
   * The expression hand's vocabulary: which pose plays which kind of chord.
   *
   * A second map rather than a setting on the first, because it answers a
   * different question — the chord hand's map says *which* chord, this says *what
   * kind* — and the two are read from different hands. Editable in the same way
   * once the editor can choose a hand (RFC #19, stage b).
   */
  private expressionMap: ExpressionMap = DEFAULT_EXPRESSION_MAP;

  /**
   * Which map the editor is working on, or `null` for the step that asks.
   *
   * The editor had one map for as long as there was one; a step that names the
   * hand is what lets there be two without the two sets of options being confused
   * for each other.
   */
  private mapTarget: MapTarget | null = null;

  /** The expression hand's pose being given a kind, while the editor is in it. */
  private poseFocus: HandShape | null = null;

  /**
   * Transpositions armed by the map's modifier shape, waiting for a chord.
   *
   * The state machine lives in `ModifierArmer` so that "an arm is a visit, not a
   * frame" is tested rather than merely intended; this class only feeds it the
   * chord hand's shape and applies what comes back.
   */
  private readonly modifier = new ModifierArmer();

  /** Each hand's own map id, so swapping hands does not throw a vocabulary away. */
  private mapIds: Record<Handedness, string> = {
    Left: DEFAULT_GESTURE_MAP_ID,
    Right: DEFAULT_GESTURE_MAP_ID,
  };

  /** Which menu the left hand has chosen, and the right hand is choosing within. */
  private menuId: MenuTopic = "vocabulary";
  /** Which layer the Layers menu is working on, once one has been handed over. */
  private layerFocus: TrackId | null = null;

  /** Which custom-map shape the editor is working on, once one has been chosen. */
  private customSlotFocus: string | null = null;
  /** Whether one hand drives the whole menu, a stage at a time. */
  private singleHanded = false;
  /**
   * Whether the looper is available at all.
   *
   * Off means the instrument simply plays: no transport, no layers, no fist
   * gestures. It is a setting rather than a hidden panel because a feature you
   * do not use should not be a feature you have to work around.
   */
  private looping = true;

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
    if (!state || state.quality === null) {
      this.synth.setVolume(0);
      return;
    }

    this.synth.playNotes(notesFor(state, this.tonicFrequency));
    this.synth.setVolume(volume);
  }

  /** Reduces raw landmarks to musical intent, before stabilisation. */
  private readIntent(left: Hand | null, right: Hand | null): ChordState | null {
    const chordHand = this.harmonyHand;
    const expressionHand = otherHand(chordHand);
    const chordLandmarks = chordHand === "Left" ? left : right;
    const expressionLandmarks = expressionHand === "Left" ? left : right;

    let chord: ChordNumeral | null = null;
    let isMajorMode = true;
    let quality: string | null = null;

    // The chord hand chooses the chord and, via tilt, the mode. Which side that
    // is comes from the setting, and the handedness is passed through because
    // tilt and the thumb are both mirrored between hands.
    if (chordLandmarks) {
      const shape = readHandShape(chordLandmarks, chordHand);
      const read = classifyChord(chordLandmarks, chordHand, this.gestureMap);

      // The modifier arms rather than plays. One arm per *visit* to the shape, and
      // a rest between two arms spends nothing — see `ModifierArmer`.
      const transpose = this.modifier.read(shape, read, this.gestureMap.transposeShape);
      if (transpose.arming) return null;

      // A shift of zero is the common case, and the map lookup is already done,
      // so only a genuinely armed shape pays for the numeral arithmetic.
      chord = read === null || transpose.shift === 0 ? read : shiftNumeral(read, transpose.shift);
      isMajorMode = getHandHorizontalTilt(chordLandmarks, chordHand) >= 0;
    } else {
      // The hand dropped, so the next chord is a fresh decision rather than a
      // continuation of the last one. The arming itself survives, because it is a
      // promise about the next chord and not about the shape in hand.
      this.modifier.read(null, null, this.gestureMap.transposeShape);
    }

    // The expression hand chooses the *kind* of chord, by pose, from its own map.
    // The pose is the whole hand shape — thumb included — because four counts give
    // four kinds and the thumb doubles the bank to eight. That is also why the
    // thumb no longer drops an octave in this mode: it cannot be a pose and a
    // modifier at once, and a pose buys more.
    if (expressionLandmarks) {
      quality = qualityForPose(
        this.expressionMap,
        readHandShape(expressionLandmarks, expressionHand),
      );
    }

    if (!chord) return null;

    return { chord, isMajorMode, quality };
  }
}
