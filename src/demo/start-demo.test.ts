import { describe, expect, it } from "vitest";
import type { ScratchFactory } from "../hand";
import { StartDemo } from "./start-demo";

/** A context that accepts every call and records which were made. */
function recordingContext() {
  const calls: string[] = [];
  const text: string[] = [];

  const ctx = new Proxy(
    {},
    {
      get(_target, property: string) {
        return (...values: unknown[]) => {
          calls.push(property);
          if (property === "fillText") text.push(String(values[0]));
          if (property === "measureText") return { width: String(values[0]).length * 10 };
          if (property === "createLinearGradient") return { addColorStop: () => undefined };
          if (property === "getTransform") return { a: 1, b: 0 };
          return undefined;
        };
      },
      set: () => true,
    },
  ) as unknown as CanvasRenderingContext2D;

  return { ctx, calls, text };
}

function harness() {
  return harnessWith({});
}

function harnessWith(extra: Partial<ConstructorParameters<typeof StartDemo>[1]>) {
  const target = recordingContext();
  const canvas = {
    width: 1200,
    height: 600,
    clientWidth: 1200,
    clientHeight: 600,
    getContext: () => target.ctx,
  } as unknown as HTMLCanvasElement;

  const frames = new Map<number, (now: number) => void>();
  let next = 1;
  const scratch: ScratchFactory = (width, height) =>
    ({ width, height, getContext: () => recordingContext().ctx }) as unknown as OffscreenCanvas;

  const demo = new StartDemo(canvas, {
    key: "C",
    chordHand: "Left",
    instant: true,
    createScratch: scratch,
    requestFrame: (callback) => {
      frames.set(next, callback);
      return next++;
    },
    cancelFrame: (handle) => frames.delete(handle),
    ...extra,
  });

  /** Runs whichever frame is waiting, at `now`. */
  const step = (now: number) => {
    const [handle, callback] = [...frames.entries()][0] ?? [];
    if (handle === undefined || !callback) return false;
    frames.delete(handle);
    callback(now);
    return true;
  };

  return { demo, target, frames, step };
}

describe("StartDemo", () => {
  it("draws both hands and names the chord they are playing", () => {
    const { demo, target, step } = harness();

    demo.start();
    step(0);

    // Two hands, each composited as a faint fill and then its outline.
    expect(target.calls.filter((name) => name === "drawImage")).toHaveLength(4);
    // The pickup is on vi, which is A minor in C — named the way the HUD names it.
    expect(target.text).toContain("Am(vi)");
    expect(target.text).toContain("Soon May the Wellerman Come");
  });

  it("says which hand is which, and what each is doing", () => {
    const { demo, target, step } = harness();

    demo.start();
    step(0);

    expect(target.text).toContain("left hand · which chord");
    expect(target.text).toContain("right hand · what kind");
    expect(target.text).toContain("rock sign, lean out");
  });

  it("stops asking for frames once stopped, so nothing runs after the player starts", () => {
    const { demo, frames, step } = harness();

    demo.start();
    step(0);
    expect(frames.size).toBe(1);

    demo.stop();

    expect(frames.size).toBe(0);
    expect(demo.isRunning).toBe(false);
  });

  it("sounds the step on the beat every frame, and the first again after a restart", () => {
    const chords: (string | null)[] = [];
    const sound = {
      live: (play: { kind: string; state?: { chord: string } | null }) =>
        chords.push(play.state?.chord ?? null),
      loop: () => undefined,
      silence: () => undefined,
    };
    const { demo, step } = harnessWith({ sound: sound as never });
    const beat = 60_000 / 100;

    demo.start();
    step(0);
    // The pickup is one beat on vi; the next bar is vi too, and then ii.
    step(beat * 0.5);
    step(beat * 5.5);
    demo.restart();
    step(beat * 6);

    expect(chords).toEqual(["vi", "vi", "ii", "vi"]);
  });

  it("does not start twice", () => {
    const { demo, frames } = harness();

    demo.start();
    demo.start();

    expect(frames.size).toBe(1);
  });
});
