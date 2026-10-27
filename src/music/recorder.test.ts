import { describe, expect, it } from "vitest";
import { quantiseBeat, Recorder } from "./recorder";
import type { RecordedIntent } from "./recorder";

const I_CHORD: RecordedIntent = {
  kind: "chord",
  numeral: "I",
  isMajorMode: true,
  qualityIndex: 1,
  thumbDown: false,
};

const V_CHORD: RecordedIntent = {
  kind: "chord",
  numeral: "V",
  isMajorMode: true,
  qualityIndex: 1,
  thumbDown: false,
};

const C_NOTE: RecordedIntent = { kind: "note", degree: 1 };
const D_NOTE: RecordedIntent = { kind: "note", degree: 2 };

const finished = (recorder: Recorder, loopBeats = 8) => recorder.finish({ bpm: 100, loopBeats });

describe("quantiseBeat", () => {
  it("snaps to the sixteenth-note grid", () => {
    expect(quantiseBeat(0)).toBe(0);
    expect(quantiseBeat(0.1)).toBe(0);
    expect(quantiseBeat(1.2)).toBeCloseTo(1.25, 6);
    expect(quantiseBeat(1.9)).toBeCloseTo(2, 6);
  });
});

describe("Recorder", () => {
  it("stores a change, not every frame of a held chord", () => {
    const recorder = new Recorder();
    recorder.start();

    recorder.capture(I_CHORD, 0.8, 0, 0);
    recorder.capture(I_CHORD, 0.8, 0, 0.5);
    recorder.capture(I_CHORD, 0.9, 0.1, 1);

    expect(finished(recorder).events).toHaveLength(1);
  });

  it("stamps each change with the beat it happened on", () => {
    const recorder = new Recorder();
    recorder.start();

    recorder.capture(I_CHORD, 0.8, 0, 0);
    recorder.capture(V_CHORD, 0.8, 0, 2);

    const { events } = finished(recorder);
    expect(events.map((event) => event.beat)).toEqual([0, 2]);
    expect(events.map((event) => event.kind)).toEqual(["chord", "chord"]);
  });

  it("records a rest only when it silences something", () => {
    const recorder = new Recorder();
    recorder.start();

    // Nothing sounding yet, so this rest is not worth a slot.
    recorder.capture(null, 0, 0, 0);
    expect(finished(recorder).events).toHaveLength(0);

    recorder.start();
    recorder.capture(I_CHORD, 0.8, 0, 0);
    recorder.capture(null, 0, 0, 4);

    const { events } = finished(recorder);
    expect(events.map((event) => event.kind)).toEqual(["chord", "rest"]);
    expect(events[1].beat).toBe(4);
  });

  it("records a mono note by degree", () => {
    const recorder = new Recorder();
    recorder.start();

    recorder.capture(C_NOTE, 0.5, 0, 0);
    recorder.capture(D_NOTE, 0.5, 0, 1);

    const { events } = finished(recorder);
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ kind: "note", degree: 1 });
  });

  it("drops onsets past the loop's end rather than wrapping them", () => {
    const recorder = new Recorder();
    recorder.start();

    recorder.capture(I_CHORD, 0.8, 0, 0);
    recorder.capture(V_CHORD, 0.8, 0, 8.2);

    expect(finished(recorder, 8).events).toHaveLength(1);
  });

  it("ignores frames once the take is closed", () => {
    const recorder = new Recorder();
    recorder.start();
    recorder.capture(I_CHORD, 0.8, 0, 0);

    const take = finished(recorder);
    recorder.capture(V_CHORD, 0.8, 0, 2);

    expect(take.events).toHaveLength(1);
  });
});
