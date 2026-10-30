/**
 * The start screen's first demonstration: the two hands playing a song's chords,
 * before the player has done anything.
 *
 * The start screen is the one moment a player is guaranteed to be looking and not
 * yet playing, which makes it the right place to show what the hands do. It is
 * silent unless the player asks to listen — a browser will not make a sound
 * before a click — so the song is carried by its words, on the beat, under the
 * hands.
 *
 * It draws on its own canvas rather than the instrument's: the instrument's is
 * dimmed behind the start screen, and the demo is the thing to look at.
 */
import { HandView, sideOf } from "../hand";
import type { HandSide, ScratchFactory } from "../hand";
import { describePose } from "../music/expression-map";
import { ROCK_SIGN, ROCK_SIGN_THUMB, countFingers } from "../music/gesture-map";
import { getChordDisplayName } from "../music/harmony";
import { getQualityLabel } from "../music/qualities";
import type { Handedness, HandShape, KeyName } from "../types";
import { volumeForHeight } from "../vision/gestures";
import {
  FrameLoop,
  INK,
  drawBeatDots,
  drawHandCaption,
  drawNote,
  drawReadout,
  drawTicker,
  drawTitle,
  fitCanvas,
  prefersReducedMotion,
} from "./draw";
import type { CancelFrame, RequestFrame } from "./draw";
import {
  DEMO_SONG,
  LEAD_MS,
  chordShape,
  chordStateOf,
  isMinor,
  kindShape,
  momentAt,
  stepHands,
} from "./song";
import type { DemoSong, DemoStep } from "./song";
import type { DemoSound } from "./sound";

export interface StartDemoOptions {
  /** The key the instrument is in, so the chords are named as they will sound. */
  readonly key: KeyName;
  /** Which hand the player has chosen to play chords with. */
  readonly chordHand: Handedness;
  readonly song?: DemoSong;
  /** Where the demo's hands are heard, when the player is listening. */
  readonly sound?: DemoSound;
  /** Jump between poses rather than moving, for a player who has asked for less motion. */
  readonly instant?: boolean;
  /** Swappable for tests, which have neither animation frames nor a DOM. */
  readonly requestFrame?: RequestFrame;
  readonly cancelFrame?: CancelFrame;
  readonly createScratch?: ScratchFactory;
}

/** A chord hand's shape, named the way a player counts it. */
export function chordGesture(shape: HandShape): string {
  if (shape === ROCK_SIGN) return "rock sign";
  if (shape === ROCK_SIGN_THUMB) return "rock sign + thumb";
  if (shape === 0) return "closed";

  const count = countFingers(shape);
  return `${count} finger${count === 1 ? "" : "s"}`;
}

/**
 * The height the demo's hands are held at: the middle of the frame, which is
 * what sets how loud they are heard.
 */
const HAND_HEIGHT = 0.5;

export class StartDemo {
  private readonly song: DemoSong;
  private readonly chordSide: HandSide;
  private readonly kindSide: HandSide;
  private readonly hands: Record<"chord" | "kind", HandView>;
  private readonly loop: FrameLoop;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: StartDemoOptions,
  ) {
    this.song = options.song ?? DEMO_SONG;
    this.chordSide = sideOf(options.chordHand);
    this.kindSide = this.chordSide === "left" ? "right" : "left";

    const first = stepHands(this.song.steps[0], this.chordSide);
    const view = {
      instant: options.instant ?? prefersReducedMotion(),
      createScratch: options.createScratch,
    };
    this.hands = { chord: new HandView(first.chord, view), kind: new HandView(first.kind, view) };
    this.loop = new FrameLoop(options.requestFrame, options.cancelFrame);
  }

  get isRunning(): boolean {
    return this.loop.isRunning;
  }

  start(): void {
    this.loop.start((now, elapsed) => this.draw(now, elapsed));
  }

  /**
   * Takes the song back to its first beat, on the next frame. For when the sound
   * comes on: a song joined in the middle is harder to follow than one heard from
   * the top.
   */
  restart(): void {
    this.loop.restart();
  }

  /** Stops the loop and clears the drawing. Nothing runs once the player has started. */
  stop(): void {
    this.loop.stop();

    const ctx = this.canvas.getContext("2d");
    ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private draw(now: number, elapsed: number): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;

    const { width, height } = fitCanvas(this.canvas, ctx);
    const moment = momentAt(this.song, elapsed);
    const step = moment.step;

    // Sounded every frame, as a player's hands are read every frame, and with the
    // step on the beat — the hands go for each shape a little early, below.
    const state = chordStateOf(step);
    this.options.sound?.live(
      { kind: "chord", state },
      { volume: volumeForHeight(HAND_HEIGHT), fingers: 1, octaveDown: false },
    );

    const targets = stepHands(momentAt(this.song, elapsed + LEAD_MS).step, this.chordSide);
    this.hands.chord.setPose(targets.chord);
    this.hands.kind.setPose(targets.kind);

    ctx.clearRect(0, 0, width, height);

    // A hand's length is what everything else is measured by, so the layout keeps
    // its proportions from a phone to a wall. Room above for the title and the
    // chord, below for the captions, words and beat.
    const size = Math.max(80, Math.min(240, (height - 260) / 1.36, width * 0.22));
    const handY = 150 + size * 0.62;
    const gap = size * 0.95;

    drawTitle(ctx, width, this.song.title, this.song.credit);

    if (step.chord !== null) {
      const name = getChordDisplayName(step.chord, !isMinor(step.chord), this.options.key);
      const kind = step.kind === null ? "" : (getQualityLabel(step.kind) ?? "");
      drawReadout(ctx, width / 2, 104, `${name}(${step.chord})`, kind);
    } else if (step.note) {
      drawNote(ctx, width / 2, 112, step.note);
    }

    // As a mirror shows them: the left hand on the left.
    for (const role of ["chord", "kind"] as const) {
      const side = role === "chord" ? this.chordSide : this.kindSide;
      const x = width / 2 + (side === "left" ? -gap : gap);

      this.hands[role].draw(ctx, { x, y: handY, size, colour: INK, fillAlpha: 0.1 }, now);
      drawHandCaption(
        ctx,
        x,
        handY + size * 0.74,
        `${side} hand · ${role === "chord" ? "which chord" : "what kind"}`,
        this.gesture(role, step),
      );
    }

    const words = (offset: number) => this.song.steps[moment.index + offset]?.lyric ?? "";
    drawTicker(ctx, width, handY + size * 0.74 + 62, words(-1), words(0), words(1));
    drawBeatDots(ctx, width, handY + size * 0.74 + 90, step.beats, moment.beat);
  }

  /** What a hand is doing at a step, in the words a player would use. */
  private gesture(role: "chord" | "kind", step: DemoStep): string {
    if (role === "chord") {
      const gesture = chordGesture(chordShape(step));
      return step.chord !== null && isMinor(step.chord) ? `${gesture}, lean out` : gesture;
    }

    const shape = step.kind === null ? 0 : (kindShape(step.kind) ?? 0);
    return shape === 0 ? "closed" : describePose(shape).toLowerCase();
  }
}
