import { describe, expect, it } from "vitest";
import type { TakeEvent } from "../types";
import { trackSegments } from "./loop-tracks";

const chord = (beat: number, numeral: "I" | "V" = "I"): TakeEvent => ({
  kind: "chord",
  beat,
  volume: 0.8,
  tilt: 0,
  numeral,
  isMajorMode: true,
  quality: "octave",
});

const note = (beat: number, degree = 1): TakeEvent => ({
  kind: "note",
  beat,
  volume: 0.5,
  tilt: 0,
  degree,
});

const rest = (beat: number): TakeEvent => ({ kind: "rest", beat, volume: 0, tilt: 0 });

describe("trackSegments", () => {
  it("runs a held event until the next one", () => {
    const segments = trackSegments([chord(0), chord(2, "V")], 8);

    expect(segments).toHaveLength(2);
    expect(segments[0]).toMatchObject({ startBeat: 0, endBeat: 2 });
    expect(segments[1]).toMatchObject({ startBeat: 2, endBeat: 8 });
  });

  it("carries the last event to the end of the loop", () => {
    const segments = trackSegments([chord(0), chord(3, "V")], 8);

    expect(segments.at(-1)).toMatchObject({ startBeat: 3, endBeat: 8 });
  });

  it("leaves a gap where a rest holds nothing", () => {
    const segments = trackSegments([chord(0), rest(4), chord(6, "V")], 8);

    expect(segments.map((segment) => [segment.startBeat, segment.endBeat])).toEqual([
      [0, 4],
      [6, 8],
    ]);
  });

  it("draws a note segment in its own kind, with no numeral", () => {
    const [segment] = trackSegments([note(0, 3)], 8);

    expect(segment.kind).toBe("note");
    expect(segment.numeral).toBeNull();
  });

  it("keeps the numeral, for the colour", () => {
    const [segment] = trackSegments([chord(0, "V")], 8);

    expect(segment.kind).toBe("chord");
    expect(segment.numeral).toBe("V");
  });

  it("orders the events before laying them out", () => {
    const segments = trackSegments([chord(4, "V"), chord(0)], 8);

    expect(segments.map((segment) => segment.startBeat)).toEqual([0, 4]);
  });

  it("has nothing to draw for an empty take", () => {
    expect(trackSegments([], 8)).toEqual([]);
  });

  it("draws only as far as the limit, for a lane still being recorded", () => {
    const segments = trackSegments([chord(0), chord(4, "V")], 8, 5);

    expect(segments.map((segment) => [segment.startBeat, segment.endBeat])).toEqual([
      [0, 4],
      [4, 5],
    ]);
  });

  it("draws nothing before the playhead has reached the first note", () => {
    expect(trackSegments([chord(2)], 8, 1)).toEqual([]);
  });

  it("wraps a take's last note round the seam when it starts part-way in", () => {
    const segments = trackSegments([chord(4, "V")], 8);

    // Nothing silences a layer at the seam, so the note that is sounding when
    // the loop wraps is still sounding over the loop's opening beats.
    expect(segments.map((segment) => [segment.startBeat, segment.endBeat])).toEqual([
      [0, 4],
      [4, 8],
    ]);
    expect(segments[0].numeral).toBe("V");
  });

  it("leaves the seam open while a take is still being recorded", () => {
    const segments = trackSegments([chord(2, "V")], 8, 5);

    expect(segments.map((segment) => [segment.startBeat, segment.endBeat])).toEqual([[2, 5]]);
  });

  it("does not wrap a take that already starts on the downbeat", () => {
    const segments = trackSegments([chord(0), chord(4, "V")], 8);

    expect(segments.map((segment) => [segment.startBeat, segment.endBeat])).toEqual([
      [0, 4],
      [4, 8],
    ]);
    expect(segments).toHaveLength(2);
  });
});
