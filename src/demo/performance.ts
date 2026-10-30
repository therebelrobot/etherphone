/**
 * The looping demo's performance: drawn hands in, the instrument's reading out.
 *
 * Everything here is the instrument's own machinery run on drawn hands instead of
 * a camera's. Each frame the hands, as they are drawn, are turned into the 21
 * landmarks MediaPipe would report for them and read by the same functions that
 * read a player — the shape, the tilt, the expression pose, the stabiliser, the
 * wrist's height. What that reading says is recorded by a real `Looper` on a real
 * `Transport`, and played back by them.
 *
 * Nothing is scripted below the hands. If the score's hands are wrong, the demo
 * plays the wrong thing — which is the point, because then so would a player
 * copying them.
 *
 * Its own transport and looper, not the instrument's: the demo must not leave
 * layers behind in the player's loop.
 */
import { Transport } from "../audio/transport";
import { handLandmarks, poseHand } from "../hand";
import type { HandPose } from "../hand";
import { DEFAULT_EXPRESSION_MAP, qualityForPose } from "../music/expression-map";
import { CLASSIC_GESTURE_MAP } from "../music/gesture-map";
import { Looper } from "../music/looper";
import { degreePositionAtHeight } from "../music/mono";
import { ChordStabilizer } from "../music/stabilizer";
import type { ChordState, Hand, Handedness, InstrumentMode } from "../types";
import {
  classifyChord,
  getHandHeight,
  getHandHorizontalTilt,
  getRightHandQualityIndex,
  isThumbExtended,
  readHandShape,
  volumeForHeight,
} from "../vision/gestures";
import type { TransportCommand } from "../vision/transport-gesture";
import type { DemoSound } from "./sound";

/** One hand as it is drawn this frame. */
export interface PerformedHand {
  readonly pose: HandPose;
  /** Wrist height in the frame, 0 at the top. */
  readonly height: number;
  /** Whether the hand is in frame at all — a camera sees nothing of one that is not. */
  readonly inFrame: boolean;
}

/** What the instrument read off the hands this frame. */
export interface PerformanceReading {
  readonly chord: ChordState | null;
  /** The mono voice's degree, or `null` when it has no pitch hand. */
  readonly degree: number | null;
  readonly volume: number;
}

/** A hand's landmarks with its wrist at `height`, as the camera would report them. */
function landmarksAt(pose: HandPose, height: number): Hand {
  const posed = poseHand(pose);
  const size = 0.3;
  // `handLandmarks` places the pose's pivot; put it wherever puts the wrist here.
  const k = size / 19.05;

  return handLandmarks(posed, { y: height + posed.wrist[1] * k, size });
}

export class Performance {
  readonly transport: Transport;
  readonly looper: Looper;
  private readonly stabilizer = new ChordStabilizer();

  constructor(
    private readonly chordHand: Handedness,
    private readonly sound: DemoSound | null,
    options: { readonly bpm: number; readonly loopBars: number },
  ) {
    this.transport = new Transport({ bpm: options.bpm, loopBars: options.loopBars });
    this.looper = new Looper(this.transport);
  }

  private get kindHand(): Handedness {
    return this.chordHand === "Left" ? "Right" : "Left";
  }

  /** A transport command, as a flick would give it. */
  act(command: TransportCommand, mode: InstrumentMode, seconds: number): void {
    switch (command) {
      case "record":
        this.looper.record(seconds, mode);
        break;
      case "play":
        this.looper.play(seconds);
        break;
      case "stop":
        this.looper.stop();
        break;
      case "clear":
        this.looper.clear();
        break;
    }
  }

  /**
   * One frame: read the hands, record what they play, and sound it and the loop.
   *
   * @param seconds - The demo's clock. The transport and looper keep time by it,
   *   exactly as the instrument's keep time by the audio context's.
   */
  frame(
    seconds: number,
    mode: InstrumentMode,
    hands: { readonly chord: PerformedHand; readonly kind: PerformedHand },
  ): PerformanceReading {
    const chord = hands.chord.inFrame ? landmarksAt(hands.chord.pose, hands.chord.height) : null;
    const kind = hands.kind.inFrame ? landmarksAt(hands.kind.pose, hands.kind.height) : null;

    // The loop first, as the instrument does it: advancing it is what opens and
    // closes a recording, so capturing before it would record a frame into a take
    // that has already ended — and that frame, wrapped, lands on the loop's start.
    for (const hit of this.looper.tick(seconds)) {
      const gain = this.looper.tracks.find((track) => track.id === hit.trackId)?.gain ?? 1;
      this.sound?.loop(hit.trackId, hit.event, gain);
    }

    // Then expression, then the voice.
    const volume = kind ? volumeForHeight(getHandHeight(kind)) : 0;
    const expression = {
      volume,
      fingers: kind ? getRightHandQualityIndex(kind) : 0,
      octaveDown: kind !== null && isThumbExtended(kind, this.kindHand),
    };

    let reading: PerformanceReading;

    if (mode === "chord") {
      const state = this.stabilizer.update(this.readChord(chord, kind), seconds * 1000);
      const quality = state?.quality ?? null;

      this.looper.capture(
        state && quality !== null
          ? { kind: "chord", numeral: state.chord, isMajorMode: state.isMajorMode, quality }
          : null,
        volume,
        0,
        seconds,
      );
      this.sound?.live({ kind: "chord", state }, expression);
      reading = { chord: state, degree: null, volume };
    } else {
      const height = chord ? getHandHeight(chord) : null;
      // The degree the mono voice would choose: the nearest to the hand's position.
      const degree = height === null ? null : Math.round(degreePositionAtHeight(height));

      this.looper.capture(degree === null ? null : { kind: "note", degree }, volume, 0, seconds);
      this.sound?.live({ kind: "mono", height }, expression);
      reading = { chord: null, degree, volume };
    }

    return reading;
  }

  /** The chord hand's chord and the expression hand's kind — `readIntent`, on drawn hands. */
  private readChord(chord: Hand | null, kind: Hand | null): ChordState | null {
    if (!chord) return null;

    const numeral = classifyChord(chord, this.chordHand, CLASSIC_GESTURE_MAP);
    if (!numeral) return null;

    const quality = kind
      ? qualityForPose(DEFAULT_EXPRESSION_MAP, readHandShape(kind, this.kindHand))
      : null;

    return {
      chord: numeral,
      isMajorMode: getHandHorizontalTilt(chord, this.chordHand) >= 0,
      quality,
    };
  }
}
