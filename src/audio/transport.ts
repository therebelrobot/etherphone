/**
 * The shared clock.
 *
 * Every time-based feature needs the same two answers: what tempo is this, and
 * where are the bar lines. The transport is that answer in one place, so the
 * looper, the voice loops (#9), and the percussion sequencer (#10) share one
 * clock rather than three that drift apart.
 *
 * Position is counted in *beats* against the `AudioContext`'s own clock — not
 * `performance.now()` and not the frame loop — because the context clock does
 * not drift when inference is heavy. The class is nonetheless pure: it is
 * *handed* the context time rather than reading it, so the timing maths is
 * testable without a browser.
 */
import { TRANSPORT } from "../config/constants";

export interface TransportOptions {
  readonly bpm?: number;
  readonly beatsPerBar?: number;
  readonly loopBars?: number;
}

export class Transport {
  private bpmValue: number;
  private readonly beatsPerBarValue: number;
  private loopBarsValue: number;

  private playing = false;
  /** Context time the current tempo epoch is anchored to. */
  private originCtx = 0;
  /** Elapsed beats at {@link originCtx}. */
  private originBeat = 0;

  constructor(options: TransportOptions = {}) {
    this.bpmValue = options.bpm ?? TRANSPORT.defaultBpm;
    this.beatsPerBarValue = options.beatsPerBar ?? TRANSPORT.beatsPerBar;
    this.loopBarsValue = options.loopBars ?? TRANSPORT.defaultBars;
  }

  get tempo(): number {
    return this.bpmValue;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  get beatsPerBar(): number {
    return this.beatsPerBarValue;
  }

  get loopBars(): number {
    return this.loopBarsValue;
  }

  /** The loop's length in beats, which is the grid everything else lands on. */
  get loopBeats(): number {
    return this.loopBarsValue * this.beatsPerBarValue;
  }

  get secondsPerBeat(): number {
    return 60 / this.bpmValue;
  }

  /**
   * Changes tempo without moving the playhead.
   *
   * The elapsed beat count is re-anchored at the moment of the change, so the
   * position already reached is carried over rather than recomputed at the new
   * tempo — otherwise a tempo change would jump the loop backwards or forwards.
   */
  setTempo(bpm: number, ctxTime: number): void {
    if (bpm === this.bpmValue) return;

    this.originBeat = this.elapsedBeats(ctxTime);
    this.originCtx = ctxTime;
    this.bpmValue = bpm;
  }

  /** Sets the loop length. Takes effect on the next recording. */
  setLoopBars(bars: number): void {
    this.loopBarsValue = Math.max(1, Math.round(bars));
  }

  /** Starts the clock at `ctxTime`, with the playhead at `atBeat`. */
  start(ctxTime: number, atBeat = 0): void {
    this.playing = true;
    this.originCtx = ctxTime;
    this.originBeat = atBeat;
  }

  /** Stops the clock. The position is frozen until the next {@link start}. */
  stop(): void {
    this.playing = false;
  }

  /** Beats since the transport started, unwrapped and frozen while stopped. */
  elapsedBeats(ctxTime: number): number {
    if (!this.playing) return this.originBeat;

    return this.originBeat + (ctxTime - this.originCtx) / this.secondsPerBeat;
  }

  /** Position within the loop, wrapped into `[0, loopBeats)`. */
  positionBeats(ctxTime: number): number {
    const wrapped = this.elapsedBeats(ctxTime) % this.loopBeats;

    return wrapped < 0 ? wrapped + this.loopBeats : wrapped;
  }

  /** The first bar line strictly after `ctxTime`, as an absolute beat count. */
  nextBarBeat(ctxTime: number): number {
    const bars = Math.floor(this.elapsedBeats(ctxTime) / this.beatsPerBarValue) + 1;

    return bars * this.beatsPerBarValue;
  }

  /** The context time at which an absolute beat occurs. */
  ctxTimeForBeat(beat: number): number {
    return this.originCtx + (beat - this.originBeat) * this.secondsPerBeat;
  }
}
