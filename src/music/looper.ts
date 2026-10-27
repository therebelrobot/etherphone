/**
 * The looper: recording layers and playing them back together.
 *
 * A *track* is one recorded layer — a chord bed, a lead line — and they all
 * share the transport's grid, so a chord loop and a melody over it stay in
 * phase. That is the whole reason tracks exist as a concept rather than the
 * instrument having "a loop": the moment there are two, they have to agree
 * about where the bar line is.
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

/** A track is named after the mode that plays it: `chord` or `mono`. */
export type TrackId = InstrumentMode;

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
}

/** A recording request, which names the layer it will fill. */
export interface TrackRequest {
  readonly id: TrackId;
  readonly label: string;
  readonly mode: InstrumentMode;
}

/** One event, on the track it should be played through. */
export interface TrackHit {
  readonly trackId: TrackId;
  readonly event: TakeEvent;
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

  /** The track waiting for its bar line, and where that line is. */
  private armed: { track: TrackRequest; targetBeat: number; setsOrigin: boolean } | null = null;
  private recordingValue: TrackId | null = null;

  /** The absolute beat the loop's beat 0 landed on. Shared by every track. */
  private originBeat = 0;
  /** The absolute beat the *current* recording began on, so its beats are loop-relative. */
  private recordOriginBeat = 0;
  /** The greatest absolute beat already played, so nothing fires twice. */
  private lastPlayedBeat = 0;

  constructor(private readonly transport: Transport) {}

  get state(): LooperState {
    if (this.recordingValue !== null) return "recording";
    if (this.armed !== null) return "armed";
    if (this.transport.isPlaying && this.hasTake) return "playing";
    return "idle";
  }

  /** Every track, in the order it was first armed. */
  get tracks(): readonly LoopTrack[] {
    return Array.from(this.tracksValue.values());
  }

  /** Whether any track holds a take. */
  get hasTake(): boolean {
    return this.tracks.some((track) => track.take !== null);
  }

  /** The track currently being recorded, if any. */
  get recordingId(): TrackId | null {
    return this.recordingValue;
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

    return this.recordingValue === id ? this.recorder.events : (track.take?.events ?? []);
  }

  /**
   * Arms a recording into a track, which begins on the next bar line.
   *
   * The first track sets the loop's phase at the next bar — a bar of count-in
   * from rest. Every later track waits for the *top of the loop* instead, so
   * the new layer's first beat is the loop's first beat and the layers stay
   * lined up rather than starting wherever a hand happened to be.
   */
  record(ctxTime: number, track: TrackRequest): void {
    if (this.armed !== null || this.recordingValue !== null) return;

    if (!this.transport.isPlaying) {
      this.transport.start(ctxTime);
      this.originBeat = 0;
      this.lastPlayedBeat = -EPSILON;
    }

    const setsOrigin = !this.hasTake;

    // The lane appears the moment it is armed, so the player can see where the
    // recording will land even before it starts.
    const existing = this.tracksValue.get(track.id);
    this.tracksValue.set(track.id, {
      ...track,
      take: existing?.take ?? null,
      muted: existing?.muted ?? false,
    });

    this.armed = {
      track,
      targetBeat: setsOrigin ? this.transport.nextBarBeat(ctxTime) : this.nextLoopTop(ctxTime),
      setsOrigin,
    };
  }

  /** Starts every stored track from the loop's beginning, in phase. */
  play(ctxTime: number): void {
    if (!this.hasTake) return;

    this.transport.start(ctxTime);
    this.originBeat = 0;
    this.lastPlayedBeat = -EPSILON;
  }

  /** Stops the clock and any recording. The tracks are kept. */
  stop(): void {
    this.transport.stop();
    this.recorder.stop();
    this.armed = null;
    this.recordingValue = null;
  }

  /**
   * Abandons a pending or in-progress recording, keeping every finished track.
   *
   * Used when the mode changes underneath a recording: the take in progress
   * would be half chord and half melody, so it is dropped rather than stored.
   */
  cancelRecording(): void {
    this.recorder.stop();
    this.armed = null;
    this.recordingValue = null;
  }

  /** Forgets every track. */
  clear(): void {
    this.stop();
    this.tracksValue.clear();
  }

  /** Silences or restores a layer. The take is untouched. */
  setMuted(id: TrackId, muted: boolean): void {
    const track = this.tracksValue.get(id);
    if (!track || track.muted === muted) return;

    this.tracksValue.set(id, { ...track, muted });
  }

  /** Flips a layer between sounding and silent. */
  toggleMute(id: TrackId): void {
    const track = this.tracksValue.get(id);
    if (track) this.setMuted(id, !track.muted);
  }

  /** Where the playhead is in the loop, in beats from the loop's own start. */
  positionBeats(ctxTime: number): number {
    const loopBeats = this.transport.loopBeats;
    const local = this.localBeat(ctxTime) % loopBeats;

    return local < 0 ? local + loopBeats : local;
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

    return sounding;
  }

  /** Feeds one frame of intent to the recorder while a recording is running. */
  capture(intent: RecordedIntent, volume: number, tilt: number, ctxTime: number): void {
    if (this.recordingValue === null) return;

    this.recorder.capture(intent, volume, tilt, this.recordedBeats(ctxTime));
  }

  /** Advances the loop and returns the events due since the last call. */
  tick(ctxTime: number): TrackHit[] {
    if (this.armed !== null && this.transport.elapsedBeats(ctxTime) >= this.armed.targetBeat) {
      this.beginRecording();
    }

    if (this.recordingValue !== null && this.recordedBeats(ctxTime) >= this.transport.loopBeats) {
      this.finishRecording();
    }

    return this.dueHits(ctxTime);
  }

  /** Beats since the loop's beat 0, which is what the playhead reads. */
  private localBeat(ctxTime: number): number {
    return this.transport.elapsedBeats(ctxTime) - this.originBeat;
  }

  /**
   * Beats since the recording began.
   *
   * A later track begins at the top of the loop, so its start is many beats from
   * the loop's origin — but its take is still measured from its own first beat,
   * which is what makes every take interchangeable on the same grid.
   */
  private recordedBeats(ctxTime: number): number {
    return this.transport.elapsedBeats(ctxTime) - this.recordOriginBeat;
  }

  /** The first loop boundary strictly after `ctxTime`. */
  private nextLoopTop(ctxTime: number): number {
    const loopBeats = this.transport.loopBeats;
    const loops =
      Math.floor((this.transport.elapsedBeats(ctxTime) - this.originBeat) / loopBeats) + 1;

    return this.originBeat + loops * loopBeats;
  }

  private beginRecording(): void {
    const armed = this.armed;
    if (!armed) return;

    if (armed.setsOrigin) this.originBeat = armed.targetBeat;
    this.recordOriginBeat = armed.targetBeat;

    // Re-recording a layer replaces it, so the old take goes now rather than
    // playing underneath the new one. Its mute survives the re-record.
    const existing = this.tracksValue.get(armed.track.id);
    this.tracksValue.set(armed.track.id, {
      ...armed.track,
      take: null,
      muted: existing?.muted ?? false,
    });

    this.recorder.start();
    this.recordingValue = armed.track.id;
    this.armed = null;
  }

  private finishRecording(): void {
    const id = this.recordingValue;
    if (id === null) return;

    const take = this.recorder.finish({
      bpm: this.transport.tempo,
      loopBeats: this.transport.loopBeats,
    });

    const existing = this.tracksValue.get(id);
    if (existing) this.tracksValue.set(id, { ...existing, take });

    this.recordingValue = null;
  }

  /**
   * The events whose loop position was crossed since the last tick.
   *
   * Each event recurs every `loopBeats`, so the question is not "is its beat
   * between the last two ticks" but "is its next occurrence", which is what
   * keeps a loop seamless across the seam and a new layer in phase with the
   * ones already playing.
   */
  private dueHits(ctxTime: number): TrackHit[] {
    const now = this.transport.elapsedBeats(ctxTime);
    const loopBeats = this.transport.loopBeats;
    const due: { hit: TrackHit; occurrence: number }[] = [];

    for (const track of this.tracksValue.values()) {
      if (!track.take || track.muted) continue;

      for (const event of track.take.events) {
        const base = this.originBeat + event.beat;
        let occurrence = base + Math.floor((this.lastPlayedBeat - base) / loopBeats) * loopBeats;

        while (occurrence <= this.lastPlayedBeat) occurrence += loopBeats;

        if (occurrence <= now) due.push({ hit: { trackId: track.id, event }, occurrence });
      }
    }

    this.lastPlayedBeat = now;

    // A long frame can span several events — and, at the seam, the end of one
    // pass and the start of the next — so they are ordered by when they fall.
    return due.sort((a, b) => a.occurrence - b.occurrence).map((entry) => entry.hit);
  }
}

/** A short status line for the transport readout. */
export function describeLooper(state: LooperState, loopBars: number, hasTake: boolean): string {
  switch (state) {
    case "armed":
      return "Armed…";
    case "recording":
      return `Recording · ${loopBars} bar${loopBars === 1 ? "" : "s"}`;
    case "playing":
      return `Looping · ${loopBars} bar${loopBars === 1 ? "" : "s"}`;
    default:
      return hasTake ? "Stopped" : "Idle";
  }
}
