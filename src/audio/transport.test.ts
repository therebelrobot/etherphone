import { describe, expect, it } from "vitest";
import { Transport } from "./transport";
import type { TransportOptions } from "./transport";

/** 120 BPM: half a second per beat, so beat counts land on tidy times. */
const transport = (overrides: TransportOptions = {}) =>
  new Transport({ bpm: 120, beatsPerBar: 4, loopBars: 2, ...overrides });

describe("elapsedBeats", () => {
  it("is frozen while stopped", () => {
    const clock = transport();

    expect(clock.isPlaying).toBe(false);
    expect(clock.elapsedBeats(100)).toBe(0);
    expect(clock.elapsedBeats(200)).toBe(0);
  });

  it("counts beats from the start time", () => {
    const clock = transport();
    clock.start(10);

    expect(clock.elapsedBeats(10)).toBe(0);
    expect(clock.elapsedBeats(10.5)).toBeCloseTo(1, 6);
    expect(clock.elapsedBeats(12)).toBeCloseTo(4, 6);
  });

  it("can start part-way through, for a count-in", () => {
    const clock = transport();
    clock.start(0, 8);

    expect(clock.elapsedBeats(0)).toBeCloseTo(8, 6);
    expect(clock.elapsedBeats(0.5)).toBeCloseTo(9, 6);
  });

  it("carries the position over a tempo change instead of jumping", () => {
    const clock = transport();
    clock.start(0);

    expect(clock.elapsedBeats(1)).toBeCloseTo(2, 6);

    clock.setTempo(60, 1);
    expect(clock.elapsedBeats(1)).toBeCloseTo(2, 6);

    // At 60 BPM a beat now takes a whole second.
    expect(clock.elapsedBeats(2)).toBeCloseTo(3, 6);
  });
});

describe("positionBeats", () => {
  it("wraps into the loop", () => {
    const clock = transport();
    clock.start(0);

    // A two-bar loop at 120 BPM is eight beats, so four seconds.
    expect(clock.positionBeats(3.5)).toBeCloseTo(7, 6);
    expect(clock.positionBeats(4.5)).toBeCloseTo(1, 6);
    expect(clock.positionBeats(8.5)).toBeCloseTo(1, 6);
  });
});

describe("nextBarBeat", () => {
  // 120 BPM is half a second per beat, so a bar of four beats is two seconds.
  it("returns the next bar line, never the current one", () => {
    const clock = transport();
    clock.start(0);

    expect(clock.nextBarBeat(0)).toBe(4);
    expect(clock.nextBarBeat(1.5)).toBe(4);
    // Exactly on a bar line, the next one is a whole bar later.
    expect(clock.nextBarBeat(2)).toBe(8);
  });

  it("advances as the clock runs", () => {
    const clock = transport();
    clock.start(0);

    expect(clock.nextBarBeat(2.1)).toBe(8);
    expect(clock.nextBarBeat(6.1)).toBe(16);
  });
});

describe("nextArmBeat", () => {
  it("waits for the bar line by default", () => {
    const clock = transport();
    clock.start(0);

    expect(clock.armUnit).toBe("bar");
    expect(clock.nextArmBeat(0)).toBe(4);
  });

  it("waits only for the next beat when asked to", () => {
    const clock = transport();
    clock.start(0);
    clock.setArmUnit("beat");

    // 120 BPM: one beat is half a second, so every 0.5s is a line.
    expect(clock.nextArmBeat(0)).toBe(1);
    expect(clock.nextArmBeat(0.6)).toBe(2);
    // One second is beat 2, and a line is never the current one — so beat 3.
    expect(clock.nextArmBeat(1)).toBe(3);
  });

  it("can be set at construction, for a remembered choice", () => {
    const clock = new Transport({ bpm: 120, beatsPerBar: 4, loopBars: 2, armUnit: "beat" });
    clock.start(0);

    expect(clock.nextArmBeat(0)).toBe(1);
  });
});

describe("ctxTimeForBeat", () => {
  it("is the inverse of elapsedBeats", () => {
    const clock = transport();
    clock.start(3);

    expect(clock.ctxTimeForBeat(4)).toBeCloseTo(5, 6);
    expect(clock.elapsedBeats(clock.ctxTimeForBeat(4))).toBeCloseTo(4, 6);
  });
});

describe("setLoopBars", () => {
  it("keeps at least one bar, and rounds", () => {
    const clock = transport();

    clock.setLoopBars(0);
    expect(clock.loopBars).toBe(1);
    expect(clock.loopBeats).toBe(4);

    clock.setLoopBars(3.4);
    expect(clock.loopBeats).toBe(12);
  });
});
