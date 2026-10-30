/**
 * The start screen's second demonstration: recording a loop, layering a second
 * part over it, and the mono voice — to a sea shanty.
 *
 * What is drawn is what a {@link SailorRun} produced this frame, and what *that*
 * is comes from the instrument's own readers, transport and looper (see
 * `./performance.ts`). The lanes are the instrument's lanes, the cue is its cue,
 * and the status line is its own words for what the looper is doing, so nothing
 * here can show a looper that behaves differently from the real one.
 */
import { HandRenderer, handFigure, poseHand, shapeOfPose } from "../hand";
import type { HandSide, ScratchFactory } from "../hand";
import { getChordDisplayName } from "../music/harmony";
import { describeLooper } from "../music/looper";
import { heightForDegree, noteNameForDegree } from "../music/mono";
import { getQualityLabel } from "../music/qualities";
import type { Handedness, KeyName } from "../types";
import { drawLoopTracks, looperLanes } from "../visuals/loop-tracks";
import { drawTransportCue, drawTransportFlash } from "../visuals/transport-cue";
import type { TransportCommand } from "../vision/transport-gesture";
import {
  FONT,
  FrameLoop,
  INK,
  MUTED,
  TEXT,
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
import { REST_HEIGHT, SAILOR, SAILOR_BARS, barAtLoopBeat } from "./sailor";
import { SailorRun } from "./sailor-run";
import type { RunHand, RunStep } from "./sailor-run";
import type { DemoSound } from "./sound";
import { chordGesture } from "./start-demo";

export interface LoopDemoOptions {
  readonly key: KeyName;
  readonly chordHand: Handedness;
  readonly sound?: DemoSound;
  readonly instant?: boolean;
  readonly requestFrame?: RequestFrame;
  readonly cancelFrame?: CancelFrame;
  readonly createScratch?: ScratchFactory;
}

/** How long the confirmation of a flick stays up, in milliseconds. */
const FLASH_MS = 700;

/** The degrees the ladder beside the pitch hand names: the octave the tune is in. */
const LADDER = [8, 9, 10, 11, 12, 13, 14];

/** Wrist to palm centre, as a fraction of the hand's length — where a fist is read from. */
const PALM_CENTRE = 4.7 / 19.05;
/** Wrist to the pivot a hand is drawn by, as a fraction of its length. */
const WRIST_TO_PIVOT = 8 / 19.05;

interface Layout {
  readonly size: number;
  /** Canvas y for a frame height, of the wrist. */
  readonly wristY: (height: number) => number;
  readonly x: Record<HandSide, number>;
  readonly captionY: number;
}

export class LoopDemo {
  private run: SailorRun | null = null;
  private readonly renderers: Record<"chord" | "kind", HandRenderer>;
  private readonly loop: FrameLoop;
  private flash: { command: TransportCommand; hand: "chord" | "kind"; at: number } | null = null;
  private readonly instant: boolean;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly options: LoopDemoOptions,
  ) {
    this.renderers = {
      chord: new HandRenderer(options.createScratch),
      kind: new HandRenderer(options.createScratch),
    };
    this.loop = new FrameLoop(options.requestFrame, options.cancelFrame);
    this.instant = options.instant ?? prefersReducedMotion();
  }

  get isRunning(): boolean {
    return this.loop.isRunning;
  }

  start(): void {
    this.loop.start((now, elapsed) => this.draw(now, elapsed));
  }

  /** Back to the first beat, with an empty loop. */
  restart(): void {
    this.run = null;
    this.flash = null;
    this.loop.restart();
  }

  stop(): void {
    this.loop.stop();
    this.run = null;
    this.options.sound?.silence();

    const ctx = this.canvas.getContext("2d");
    ctx?.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private draw(now: number, elapsed: number): void {
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;

    if (!this.run) {
      // A fresh run is a fresh transport and an empty looper: nothing from the
      // last time round is still playing.
      this.options.sound?.silence();
      this.run = new SailorRun(this.options.chordHand, this.options.sound ?? null, {
        instant: this.instant,
      });
    }

    const seconds = elapsed / 1000;
    const step = this.run.step(seconds);

    for (const action of step.fired)
      this.flash = { command: action.command, hand: action.hand, at: now };

    const { width, height } = fitCanvas(this.canvas, ctx);
    ctx.clearRect(0, 0, width, height);

    const layout = this.layout(width, height);

    drawTitle(ctx, width, SAILOR.title, SAILOR.credit);
    this.drawReadout(ctx, width, step);
    drawNote(ctx, width / 2, 150, step.score.caption);
    this.drawStatus(ctx, width, step, seconds);

    if (step.score.mode === "mono") this.drawLadder(ctx, layout, step);

    for (const role of ["chord", "kind"] as const) this.drawHand(ctx, layout, step, role);

    this.drawCue(ctx, width, height, layout, step, now);

    const { looper, transport } = this.run.performance;
    const position = looper.positionBeats(seconds);
    const sounding = looper.state === "playing" || looper.state === "recording";

    if (sounding) {
      const bar = SAILOR_BARS.indexOf(barAtLoopBeat(position));
      const words = (offset: number) => SAILOR_BARS[(bar + offset + 4) % 4].lyric;
      drawTicker(ctx, width, layout.captionY + 52, words(-1), words(0), words(1));
    }

    const beat = sounding ? Math.floor(position) % 4 : Math.floor(step.beat) % 4;
    drawBeatDots(ctx, width, layout.captionY + 74, 4, beat);

    drawLoopTracks(ctx, {
      lanes: looperLanes(looper, transport.loopBeats, seconds),
      positionBeats: position,
      loopBeats: transport.loopBeats,
      isPlaying: transport.isPlaying,
      canvasWidth: width,
      canvasHeight: height,
      bottomOffset: 6,
    });

    if (step.finished) this.restart();
  }

  /**
   * Where things go. The hand's length sets the scale; the frame — the camera's
   * view, top to bottom, which is what height is measured in — is a little taller
   * than a hand, so the pitch hand's travel between notes is easy to see.
   */
  private layout(width: number, height: number): Layout {
    const top = 172;
    // Room underneath for the captions, the words, the beat, and two lanes.
    const lanesTop = height - 6 - 82;
    const bottom = lanesTop - 100;
    const size = Math.max(70, Math.min(200, (bottom - top) / 1.78, width * 0.16));
    const band = size * 1.6;
    // The highest a hand reaches in the demo is a fifth of the way down; put its
    // fingertips at the top of the space.
    const bandTop = top + size - 0.2 * band;
    const wristY = (frameHeight: number) => bandTop + frameHeight * band;
    // Never so close that the two hands' captions meet in the middle.
    const gap = Math.max(size * 1.15, 150);

    return {
      size,
      wristY,
      x: { left: width / 2 - gap, right: width / 2 + gap },
      // Clear of the lanes, with the words and the beat between.
      captionY: Math.min(wristY(REST_HEIGHT) + size * 0.42, lanesTop - 86),
    };
  }

  /** The chord, or the note: what the instrument read off the hands. */
  private drawReadout(ctx: CanvasRenderingContext2D, width: number, step: RunStep): void {
    const { chord, degree } = step.reading;

    if (step.score.mode === "chord" && chord) {
      const name = getChordDisplayName(chord.chord, chord.isMajorMode, this.options.key);
      const kind = chord.quality ? (getQualityLabel(chord.quality) ?? "") : "";
      drawReadout(ctx, width / 2, 100, `${name}(${chord.chord})`, kind);
    } else if (step.score.mode === "mono" && degree !== null) {
      drawReadout(ctx, width / 2, 100, noteNameForDegree(degree, this.options.key), "Mono");
    } else {
      drawReadout(ctx, width / 2, 100, "--", step.score.mode === "mono" ? "Mono" : "Chords");
    }
  }

  /** The looper's own account of itself, and the mode, under the caption. */
  private drawStatus(
    ctx: CanvasRenderingContext2D,
    width: number,
    step: RunStep,
    seconds: number,
  ): void {
    const { looper, transport } = this.run!.performance;
    const status = describeLooper({
      state: looper.state,
      loopBars: transport.loopBars,
      hasTake: looper.hasTake,
      recordingLabel: looper.recordingLabel,
      countdownBeats: looper.countdownBeats(seconds),
      recordKind: looper.recordingKind,
    });
    const recording = looper.state === "recording" || looper.state === "armed";
    const mode = step.score.mode === "mono" ? "MONO" : "CHORDS";

    ctx.save();
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `13px ${FONT}`;
    ctx.fillStyle = recording ? "#ff7a6b" : MUTED;
    ctx.fillText(`${mode}  ·  ${recording ? "● " : ""}${status}`, width / 2, 170);
    ctx.restore();
  }

  private drawHand(
    ctx: CanvasRenderingContext2D,
    layout: Layout,
    step: RunStep,
    role: "chord" | "kind",
  ): void {
    const hand = step[role];
    const x = layout.x[hand.side];
    const wristY = layout.wristY(hand.height);

    this.renderers[role].draw(ctx, handFigure(poseHand(hand.pose)), {
      x,
      y: wristY - layout.size * WRIST_TO_PIVOT,
      size: layout.size,
      colour: INK,
      alpha: Math.max(0, Math.min(1, hand.presence)),
      fillAlpha: 0.1,
    });

    const job =
      step.score.mode === "mono"
        ? role === "chord"
          ? "the note"
          : "how loud"
        : role === "chord"
          ? "which chord"
          : "what kind";

    drawHandCaption(
      ctx,
      x,
      layout.captionY,
      `${hand.side} hand · ${job}`,
      this.gesture(hand, role, step),
      hand.presence > 0.5 ? 1 : 0.45,
    );
  }

  /** What a hand is doing, in a player's words. */
  private gesture(hand: RunHand, role: "chord" | "kind", step: RunStep): string {
    if (!hand.inFrame) return "out of frame";

    const shape = shapeOfPose(hand.pose);
    if (shape === 0) return step.score.menu ? "closed: the menu" : "closed";

    if (step.score.mode === "mono" && role === "chord") return "pointing";

    const gesture = chordGesture(shape);
    return role === "chord" && hand.pose.tilt < -0.5 ? `${gesture}, lean out` : gesture;
  }

  /**
   * The notes beside the pitch hand, at the heights that play them — so the hand
   * moving is visibly the hand choosing a note.
   */
  private drawLadder(ctx: CanvasRenderingContext2D, layout: Layout, step: RunStep): void {
    const hand = step.chord;
    const outward = hand.side === "left" ? -1 : 1;
    const x = layout.x[hand.side] + outward * layout.size * 0.78;
    const current = step.reading.degree;

    ctx.save();
    ctx.globalAlpha = Math.max(0.25, Math.min(1, hand.presence));
    ctx.strokeStyle = MUTED;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, layout.wristY(heightForDegree(LADDER.at(-1)!)) - 8);
    ctx.lineTo(x, layout.wristY(heightForDegree(LADDER[0])) + 8);
    ctx.stroke();

    ctx.font = `12px ${FONT}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = outward < 0 ? "right" : "left";

    for (const degree of LADDER) {
      const y = layout.wristY(heightForDegree(degree));
      const lit = degree === current;

      ctx.fillStyle = lit ? INK : MUTED;
      ctx.beginPath();
      ctx.arc(x, y, lit ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = lit ? TEXT : MUTED;
      ctx.fillText(noteNameForDegree(degree, this.options.key), x + outward * 10, y);
    }

    // The wrist is what is measured, so a line from it to the ladder says so.
    if (hand.inFrame) {
      const y = layout.wristY(hand.height);
      ctx.strokeStyle = INK;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(layout.x[hand.side] + outward * layout.size * 0.2, y);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    ctx.restore();
  }

  /** The instrument's own fist cue, and the flash when a flick fires. */
  private drawCue(
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    layout: Layout,
    step: RunStep,
    now: number,
  ): void {
    const palm = (role: "chord" | "kind", frameHeight: number) => ({
      x: layout.x[step[role].side],
      y: layout.wristY(frameHeight) - layout.size * PALM_CENTRE,
    });

    const fist = step.score.fist;
    if (fist && fist.heldBeats > 0) {
      const hand = step[fist.hand];
      const anchor = palm(fist.hand, REST_HEIGHT);
      const point = palm(fist.hand, hand.height);

      drawTransportCue(ctx, {
        point,
        anchor,
        trail: [anchor, point],
        direction: fist.progress > 0 ? fist.command : null,
        progress: fist.progress,
        readyForMs: fist.heldBeats * (60_000 / SAILOR.bpm),
        canvasWidth: width,
        canvasHeight: height,
      });
    }

    if (this.flash) {
      const age = now - this.flash.at;

      if (age > FLASH_MS) {
        this.flash = null;
      } else {
        drawTransportFlash(ctx, {
          command: this.flash.command,
          point: palm(this.flash.hand, step[this.flash.hand].height),
          ageMs: age,
          durationMs: FLASH_MS,
        });
      }
    }
  }
}
