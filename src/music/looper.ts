/**
 * The looper: recording layers and playing them back together.
 *
 * A *track* is one recorded layer — a chord bed, a lead line, a second chord
 * part — and they all share the transport's grid, so anything recorded over
 * anything else stays in phase. Layers are numbered within their mode
 * (`Chords 1`, `Chords 2`, `Mono 1`), because the mode says what a layer
 * *plays*, not how many of them there can be.
 *
 * The looper owns neither audio nor a clock. It reads position from the
 * {@link Transport} and hands back each track's events as they come due, tagged
 * with the track they belong to; the caller decides what a chord sounds like
 * and which layer to send it to. Keeping the two apart is what makes the timing
 * testable and keeps "what is a chord" answered in one place (see `./take`).
 *
 * Playback and recording are independent: arming a new layer does not stop the
 * ones already playing, which is the point of layering.
 */
import type { InstrumentMode, LooperState, Take, TakeEvent } from "../types";
import type { Transport } from "../audio/transport";
import { Recorder } from "./recorder";
import type { RecordedIntent } from "./recorder";

/** Layers are named, not derived from their mode: there can be several per mode. */
export type TrackId = string;

/** One layer: what it is, what it holds, and whether it is sounding. */
export interface LoopTrack {
  readonly id: TrackId;
  readonly label: string;
  readonly mode: InstrumentMode;
  /** The recorded take, or `null` while the layer is empty or being recorded. */
  readonly take: Take | null;
  /**
   * Whether the layer is silenced.
   *
   * Muting is a performance move, not an edit: the take is untouched, so a layer
   * can be dropped out and brought back in as the arrangement needs it. That is
   * the difference between a looper you can play and one you can only listen to.
   */
  readonly muted: boolean;

  /**
   * The layer's own level, 0..1, multiplying whatever the take asks for.
   *
   * Mute is on/off and gain is "how much", and a performance needs both: a chord
   * bed wants to sit under a lead permanently, while a layer you drop out and
   * bring back wants a switch. One control cannot be both.
   */
  readonly gain: number;
}

/** One event, on the track it should be played through. */
export interface TrackHit {
  readonly trackId: TrackId;
  readonly event: TakeEvent;
}

/**
 * A hit with the context time it should sound at.
 *
 * Separate from {@link TrackHit} on purpose: the time is what the audio thread
 * needs and the drawing code does not, and a caller that ignores it should be
 * able to say so in the type.
 */
export interface ScheduledHit extends TrackHit {
  readonly when: number;
}

/**
 * A layer handed in from outside — an imported take, rather than a recording.
 *
 * It has no id because ids are the looper's to assign: an imported layer must
 * not be able to collide with one already in play.
 */
export interface LoopLayerSeed {
  readonly label: string;
  readonly mode: InstrumentMode;
  readonly muted: boolean;
  readonly gain?: number;
  readonly take: Take;
}

/** How far one step of the gain control moves. */
export const GAIN_STEP = 0.1;

/** Clamps a level into the range a layer's gain can take. */
export function clampGain(gain: number): number {
  if (!Number.isFinite(gain)) return 1;
  return Math.min(1, Math.max(0, gain));
}

/** Whether a pending recording fills a new layer or replaces an existing one. */
export type RecordKind = "new" | "rewrite";

/** A recording waiting for its bar line. */
interface Armed {
  readonly kind: RecordKind;
  readonly trackId: TrackId;
  readonly label: string;
  readonly mode: InstrumentMode;
  /** The absolute beat the recording begins on. */
  readonly targetBeat: number;
}

/** A recording in progress. */
interface Recording {
  readonly kind: RecordKind;
  readonly trackId: TrackId;
}

/** A hair before the cursor, so an event exactly on it still fires. */
const EPSILON = 1e-6;

/** The label a track wears, from its mode. */
export function trackLabel(mode: InstrumentMode): string {
  return mode === "mono" ? "Mono" : "Chords";
}

export class Looper {
  private readonly recorder = new Recorder();
  private readonly tracksValue = new Map<TrackId, LoopTrack>();

  /** How many layers of each mode have ever been made, for the labels. */
  private readonly labelCounts: Record<InstrumentMode, number> = { chord: 0, mono: 0 };
  private layerCount = 0;

  private armed: Armed | null = null;
  private recording: Recording | null = null;

  /**
   * The take a rewrite displaced, held so a cancelled rewrite is not a deletion.
   */
  private displaced: { readonly trackId: TrackId; readonly take: Take } | null = null;

  /** The absolute beat the loop's beat 0 landed on. Shared by every layer. */
  private originBeat = 0;
  /** The absolute beat the *current* recording began on. */
  private recordOriginBeat = 0;
  /** Where in the loop that was, so a take can be rotated onto the grid. */
  private recordOffset = 0;
  /** The greatest absolute beat already played, so nothing fires twice. */
  private lastPlayedBeat = 0;

  constructor(private readonly transport: Transport) {}

  get state(): LooperState {
    if (this.recording !== null) return "recording";
    if (this.armed !== null) return "armed";
    if (this.transport.isPlaying && this.hasTake) return "playing";
    return "idle";
  }

  /** Every layer, in the order it was first armed. */
  get tracks(): readonly LoopTrack[] {
    return Array.from(this.tracksValue.values());
  }

  /** Whether any layer holds a take. */
  get hasTake(): boolean {
    return this.tracks.some((track) => track.take !== null);
  }

  /** The layer currently being recorded, if any. */
  get recordingId(): TrackId | null {
    return this.recording?.trackId ?? null;
  }

  /** The name of the layer being recorded, for the readout. */
  get recordingLabel(): string | null {
    const id = this.recordingId;
    return id === null ? null : (this.tracksValue.get(id)?.label ?? null);
  }

  /** Beats until an armed recording begins, for the count-in readout. */
  countdownBeats(ctxTime: number): number {
    if (!this.armed) return 0;

    return Math.max(0, this.armed.targetBeat - this.transport.elapsedBeats(ctxTime));
  }

  /**
   * The events to draw for a track: its take, or what is being recorded into it.
   *
   * A track being recorded has no take yet — the take is what a recording
   * *becomes* — but the player still needs to see it arriving, so the open
   * recording is read straight from the recorder.
   */
  eventsFor(id: TrackId): readonly TakeEvent[] {
    const track = this.tracksValue.get(id);
    if (!track) return [];

    return this.recordingId === id ? this.recorder.events : (track.take?.events ?? []);
  }

  /**
   * Arms a recording of a **new layer** for `mode`.
   *
   * Recording adds rather than replaces, so a misflick costs nothing and the
   * way to redo a layer is to say so — see {@link rewrite}.
   */
  record(ctxTime: number, mode: InstrumentMode): void {
    if (this.armed !== null || this.recording !== null) return;

    this.startClockIfNeeded(ctxTime);

    const id = `layer-${(this.layerCount += 1)}`;
    this.labelCounts[mode] += 1;

    // The lane appears the moment it is armed, so the player can see where the
    // recording will land even before it starts.
    this.tracksValue.set(id, {
      id,
      label: `${trackLabel(mode)} ${this.labelCounts[mode]}`,
      mode,
      take: null,
      muted: false,
      gain: 1,
    });

    this.armed = {
      kind: "new",
      trackId: id,
      label: this.tracksValue.get(id)?.label ?? "",
      mode,
      targetBeat: this.transport.nextArmBeat(ctxTime),
    };
  }

  /** Arms a recording that will replace an existing layer. */
  rewrite(ctxTime: number, id: TrackId): void {
    const track = this.tracksValue.get(id);
    if (!track || this.armed !== null || this.recording !== null) return;

    this.startClockIfNeeded(ctxTime);

    this.armed = {
      kind: "rewrite",
      trackId: id,
      label: track.label,
      mode: track.mode,
      targetBeat: this.transport.nextArmBeat(ctxTime),
    };
  }

  /** Starts every stored layer from the loop's beginning, in phase. */
  play(ctxTime: number): void {
    if (!this.hasTake) return;

    this.transport.start(ctxTime);
    this.originBeat = 0;
    this.lastPlayedBeat = -EPSILON;
  }

  /**
   * Stops the clock.
   *
   * A recording in progress is **closed and kept** — Stop is a transport move,
   * and it must never be able to destroy what was just played. Playing nothing
   * is the one case that leaves nothing behind. An *arm* that never became a
   * recording has nothing in it at all, so that simply goes.
   */
  stop(): void {
    if (this.recording !== null) this.closeRecording();
    else if (this.armed !== null) this.abandonRecording();

    this.transport.stop();
  }

  /**
   * Abandons a pending or in-progress recording, keeping every finished layer.
   *
   * Used when the mode changes underneath a recording: the take in progress
   * would be half chord and half melody, so it is dropped rather than stored.
   */
  cancelRecording(): void {
    this.abandonRecording();
  }

  /** Forgets every layer. */
  clear(): void {
    this.transport.stop();
    this.abandonRecording();
    this.tracksValue.clear();
  }

  /**
   * Replaces every layer with the ones from an imported take.
   *
   * Import *replaces* rather than merges, because a take is a performance: its
   * layers were all played against one grid, and merging two performances that
   * disagree about the loop length would produce something neither player ever
   * played. The caller applies the document's tempo and loop length with it, so
   * the grid arrives with the events that were played against it.
   *
   * Naming restarts at the imported layers, so recording after an import is
   * `Chords 3` when three chord layers came in — not `Chords 1` again.
   */
  replaceLayers(seeds: readonly LoopLayerSeed[]): void {
    this.transport.stop();
    this.abandonRecording();
    this.displaced = null;
    this.tracksValue.clear();

    this.layerCount = 0;
    this.labelCounts.chord = 0;
    this.labelCounts.mono = 0;

    for (const seed of seeds) {
      const id = `layer-${(this.layerCount += 1)}`;
      this.labelCounts[seed.mode] += 1;

      this.tracksValue.set(id, {
        id,
        label: seed.label,
        mode: seed.mode,
        take: seed.take,
        muted: seed.muted,
        gain: clampGain(seed.gain ?? 1),
      });
    }
  }

  /** Forgets one layer, retiring its channel with it. */
  clearTrack(id: TrackId): void {
    if (this.recording?.trackId === id || this.armed?.trackId === id) this.abandonRecording();
    if (this.displaced?.trackId === id) this.displaced = null;

    this.tracksValue.delete(id);

    if (!this.hasTake && this.recording === null) this.transport.stop();
  }

  /** Silences or restores a layer. The take is untouched. */
  setMuted(id: TrackId, muted: boolean): void {
    const track = this.tracksValue.get(id);
    if (!track || track.muted === muted) return;

    this.tracksValue.set(id, { ...track, muted });
  }

  /**
   * Sets a layer's own level.
   *
   * Separate from mute because they answer different questions — "is this part
   * in" and "how loud is it" — and a mix needs both at once.
   */
  setGain(id: TrackId, gain: number): void {
    const track = this.tracksValue.get(id);
    if (!track) return;

    const clamped = clampGain(gain);
    if (track.gain === clamped) return;

    this.tracksValue.set(id, { ...track, gain: clamped });
  }

  /** Moves a layer's level by one step, for a gesture that cannot drag a slider. */
  nudgeGain(id: TrackId, steps: number): void {
    const track = this.tracksValue.get(id);
    if (!track) return;

    this.setGain(id, track.gain + steps * GAIN_STEP);
  }

  /** Flips a layer between sounding and silent. */
  toggleMute(id: TrackId): void {
    const track = this.tracksValue.get(id);
    if (track) this.setMuted(id, !track.muted);
  }

  /** Where the playhead is in the loop, in beats from the loop's own start. */
  positionBeats(ctxTime: number): number {
    return this.wrap(this.transport.elapsedBeats(ctxTime) - this.originBeat);
  }

  /**
   * The event sounding on a track at the playhead, if any.
   *
   * Used when a layer is brought back in mid-loop: without this, unmuting a
   * two-bar chord would leave the layer silent until the chord changed, which is
   * exactly the wrong moment for it to come back.
   */
  currentEvent(id: TrackId, ctxTime: number): TakeEvent | null {
    const track = this.tracksValue.get(id);
    if (!track?.take || track.muted) return null;

    const position = this.positionBeats(ctxTime);
    let sounding: TakeEvent | null = null;

    for (const event of track.take.events) {
      if (event.beat > position) break;
      sounding = event;
    }

    // Before a take's first event, the loop is still holding the note from the
    // previous pass: the seam does not silence anything, so the last event is
    // what is sounding.
    return sounding ?? track.take.events.at(-1) ?? null;
  }

  /** Feeds one frame of intent to the recorder while a recording is running. */
  capture(intent: RecordedIntent, volume: number, tilt: number, ctxTime: number): void {
    if (this.recording === null) return;

    // The take is stored against the *loop's* grid, not the recording's own
    // start: a layer may begin at any bar, and rotating it into place is what
    // lets it keep time with the layers already playing.
    const beat = this.wrap(this.recordOffset + this.recordedBeats(ctxTime));
    this.recorder.capture(intent, volume, tilt, beat);
  }

  /** Advances the loop and returns the events due since the last call. */
  tick(ctxTime: number): TrackHit[] {
    return this.schedule(ctxTime, 0).map(({ trackId, event }) => ({ trackId, event }));
  }

  /**
   * Advances the loop and returns the events due in the next `lookahead` seconds.
   *
   * Each hit carries the context time it should *sound* at, which is the whole
   * point: the render loop wakes roughly sixteen milliseconds at a time, so an
   * event handed to the audio thread "now" can be most of a frame late. A
   * sustained chord forgives that; a drum hit does not, and #10 is built on this.
   *
   * The window advances the playhead past everything it hands back, so the next
   * call cannot return the same event twice — the scheduler is still one
   * window-at-a-time, not a queue that has to be drained.
   */
  schedule(ctxTime: number, lookahead: number): ScheduledHit[] {
    if (this.armed !== null && this.transport.elapsedBeats(ctxTime) >= this.armed.targetBeat) {
      this.beginRecording();
    }

    if (this.recording !== null && this.recordedBeats(ctxTime) >= this.transport.loopBeats) {
      this.closeRecording();
    }

    return this.dueHits(ctxTime, lookahead);
  }

  /** Beats since the recording began. */
  private recordedBeats(ctxTime: number): number {
    return this.transport.elapsedBeats(ctxTime) - this.recordOriginBeat;
  }

  /** Wraps a beat count into `[0, loopBeats)`. */
  private wrap(beats: number): number {
    const loopBeats = this.transport.loopBeats;
    const wrapped = beats % loopBeats;

    return wrapped < 0 ? wrapped + loopBeats : wrapped;
  }

  private startClockIfNeeded(ctxTime: number): void {
    if (this.transport.isPlaying) return;

    this.transport.start(ctxTime);
    this.originBeat = 0;
    this.lastPlayedBeat = -EPSILON;
  }

  private beginRecording(): void {
    const armed = this.armed;
    if (!armed) return;

    // The first layer sets the loop's phase at the line it was armed onto — a
    // bar line by default, a beat line when the player has asked to drop in
    // faster. Later layers are rotated onto that grid, so they can begin at any
    // line rather than waiting for the top of the loop.
    if (armed.kind === "new" && !this.hasTake) this.originBeat = armed.targetBeat;

    const existing = this.tracksValue.get(armed.trackId);
    if (existing?.take) this.displaced = { trackId: existing.id, take: existing.take };

    // Re-recording a layer replaces it, so the old take stops sounding now
    // rather than playing underneath the new one. Its mute and its level
    // survive: they are how the part sits in the mix, not part of the take.
    this.tracksValue.set(armed.trackId, {
      id: armed.trackId,
      label: armed.label,
      mode: armed.mode,
      take: null,
      muted: existing?.muted ?? false,
      gain: existing?.gain ?? 1,
    });

    this.recordOriginBeat = armed.targetBeat;
    this.recordOffset = this.wrap(this.recordOriginBeat - this.originBeat);
    this.recorder.start();
    this.recording = { kind: armed.kind, trackId: armed.trackId };
    this.armed = null;
  }

  /**
   * Ends a recording and keeps what was played.
   *
   * Reached both by the loop running its length and by Stop arriving early —
   * "that is enough, close it here". A partial take is a perfectly good one: the
   * last note holds to the end of the loop, so nothing sounds unfinished.
   */
  private closeRecording(): void {
    const recording = this.recording;
    if (!recording) return;

    const take = this.recorder.finish({
      bpm: this.transport.tempo,
      loopBeats: this.transport.loopBeats,
    });

    if (take.events.length === 0) {
      // Nothing was played, so nothing has changed: put back whatever the
      // rewrite displaced, or forget a layer with nothing in it.
      this.restoreOrDrop(recording);
      return;
    }

    const existing = this.tracksValue.get(recording.trackId);
    if (existing) this.tracksValue.set(recording.trackId, { ...existing, take });

    this.recording = null;
    this.displaced = null;
  }

  /** Undoes a recording that turned out to contain nothing. */
  private restoreOrDrop(recording: Recording): void {
    this.recording = null;

    if (this.displaced?.trackId === recording.trackId) {
      const track = this.tracksValue.get(recording.trackId);
      if (track) this.tracksValue.set(recording.trackId, { ...track, take: this.displaced.take });
      this.displaced = null;
      return;
    }

    this.tracksValue.delete(recording.trackId);
  }

  /**
   * Drops whatever recording is open.
   *
   * A cancelled *new* layer never existed, so it goes. A cancelled *rewrite*
   * puts back the take it displaced, because changing your mind about redoing a
   * layer must not destroy it.
   */
  private abandonRecording(): void {
    const target = this.recording?.trackId ?? this.armed?.trackId ?? null;
    const kind = this.recording?.kind ?? this.armed?.kind ?? null;

    this.recorder.stop();
    this.armed = null;
    this.recording = null;

    if (target === null) return;

    if (this.displaced?.trackId === target) {
      const track = this.tracksValue.get(target);
      if (track) this.tracksValue.set(target, { ...track, take: this.displaced.take });
      this.displaced = null;
      return;
    }

    if (kind === "new") this.tracksValue.delete(target);
  }

  /**
   * The events whose loop position was crossed since the last tick.
   *
   * Each event recurs every `loopBeats`, so the question is not "is its beat
   * between the last two ticks" but "is its next occurrence", which is what
   * keeps a loop seamless across the seam and a new layer in phase with the
   * ones already playing.
   */
  private dueHits(ctxTime: number, lookahead: number): ScheduledHit[] {
    const now = this.transport.elapsedBeats(ctxTime);
    // The horizon is where the window ends, in beats. With no lookahead that is
    // the playhead itself, which is the frame-driven behaviour this replaces.
    const horizon = now + (lookahead > 0 ? lookahead / this.transport.secondsPerBeat : 0);
    const loopBeats = this.transport.loopBeats;
    const due: { hit: ScheduledHit; occurrence: number }[] = [];

    for (const track of this.tracksValue.values()) {
      if (!track.take || track.muted) continue;

      for (const event of track.take.events) {
        const base = this.originBeat + event.beat;
        let occurrence = base + Math.floor((this.lastPlayedBeat - base) / loopBeats) * loopBeats;

        while (occurrence <= this.lastPlayedBeat) occurrence += loopBeats;

        if (occurrence <= horizon) {
          due.push({
            hit: {
              trackId: track.id,
              event,
              when: this.transport.ctxTimeForBeat(occurrence),
            },
            occurrence,
          });
        }
      }
    }

    this.lastPlayedBeat = Math.max(horizon, this.lastPlayedBeat);

    // A long frame can span several events — and, at the seam, the end of one
    // pass and the start of the next — so they are ordered by when they fall.
    return due.sort((a, b) => a.occurrence - b.occurrence).map((entry) => entry.hit);
  }
}

/** What the transport readout needs to say. */
export interface LooperStatus {
  readonly state: LooperState;
  readonly loopBars: number;
  readonly hasTake: boolean;
  /** The layer being recorded, if any. */
  readonly recordingLabel?: string | null;
  /** Beats until an armed recording begins. */
  readonly countdownBeats?: number;
}

/** A short status line for the transport readout. */
export function describeLooper(status: LooperStatus): string {
  const bars = `${status.loopBars} bar${status.loopBars === 1 ? "" : "s"}`;

  switch (status.state) {
    case "armed": {
      // A count-in the player can read, rather than a wait they have to guess at.
      const beats = Math.ceil(status.countdownBeats ?? 0);

      return beats > 0 ? `Armed · Rec in ${beats}` : "Armed…";
    }
    case "recording":
      return `Recording · ${status.recordingLabel ?? bars}`;
    case "playing":
      return `Looping · ${bars}`;
    default:
      return status.hasTake ? "Stopped" : "Idle";
  }
}
