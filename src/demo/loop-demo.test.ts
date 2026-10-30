import { describe, expect, it } from "vitest";
import type { ScratchFactory } from "../hand";
import { LoopDemo } from "./loop-demo";
import { CUES, SAILOR } from "./sailor";
import type { DemoSound } from "./sound";

/** A context that accepts everything and keeps the text it was asked to write. */
function recordingContext() {
  const text: string[] = [];

  const ctx = new Proxy(
    {},
    {
      get(_target, property: string) {
        return (...values: unknown[]) => {
          if (property === "fillText") text.push(String(values[0]));
          if (property === "measureText") return { width: String(values[0]).length * 8 };
          if (property === "createLinearGradient") return { addColorStop: () => undefined };
          if (property === "getTransform") return { a: 1, b: 0 };
          return undefined;
        };
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;

  return { ctx, text };
}

function harness(sound?: DemoSound) {
  const target = recordingContext();
  const canvas = {
    width: 1280,
    height: 560,
    clientWidth: 1280,
    clientHeight: 560,
    getContext: () => target.ctx,
  } as unknown as HTMLCanvasElement;
  const scratch: ScratchFactory = (width, height) =>
    ({ width, height, getContext: () => recordingContext().ctx }) as unknown as OffscreenCanvas;

  let pending: ((now: number) => void) | null = null;
  const demo = new LoopDemo(canvas, {
    key: "C",
    chordHand: "Left",
    sound,
    instant: true,
    createScratch: scratch,
    requestFrame: (callback) => {
      pending = callback;
      return 1;
    },
    cancelFrame: () => {
      pending = null;
    },
  });

  /** Runs frames at sixty a second up to `beat`, returning the text of the last. */
  const playTo = (beat: number): string[] => {
    const until = (beat * 60_000) / SAILOR.bpm;
    for (let now = 0; now <= until; now += 1000 / 60) {
      target.text.length = 0;
      const frame = pending;
      pending = null;
      frame?.(now);
    }
    return [...target.text];
  };

  return { demo, playTo, isPending: () => pending !== null };
}

describe("LoopDemo", () => {
  it("opens on the chord hand's first chord and how to record", () => {
    const { demo, playTo } = harness();
    demo.start();
    const text = playTo(0.5);

    expect(text).toContain("Dm(ii)");
    expect(text).toContain("Chords mode. Close one hand, then flick it up to record");
  });

  it("says, in the looper's own words, that it is counting in and then recording", () => {
    const { demo, playTo } = harness();
    demo.start();

    expect(playTo(CUES.recordChords + 1).some((line) => line.includes("Armed · Rec in"))).toBe(
      true,
    );
    expect(playTo(CUES.chordsFrom + 1).some((line) => line.includes("Recording · Chords 1"))).toBe(
      true,
    );
  });

  it("draws the layers as lanes once there are any", () => {
    const { demo, playTo } = harness();
    demo.start();
    const text = playTo(CUES.tuneFrom + 2);

    expect(text).toContain("Chords 1");
    expect(text).toContain("Mono 1");
  });

  it("names the note the pitch hand is at, beside it", () => {
    const { demo, playTo } = harness();
    demo.start();
    const text = playTo(CUES.tuneFrom + 0.5);

    // The tune opens on A, the sixth of C, an octave up.
    expect(text).toContain("A +1");
    expect(text).toContain("Mono");
  });

  it("stops asking for frames, and silences itself, once stopped", () => {
    let silenced = 0;
    const sound: DemoSound = {
      live: () => undefined,
      loop: () => undefined,
      silence: () => (silenced += 1),
    };
    const { demo, playTo, isPending } = harness(sound);
    demo.start();
    playTo(2);
    demo.stop();

    expect(isPending()).toBe(false);
    expect(silenced).toBeGreaterThan(0);
  });
});
