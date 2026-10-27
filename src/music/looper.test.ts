import { describe, expect, it } from "vitest";
import { Transport } from "../audio/transport";
import { describeLooper, Looper, trackLabel } from "./looper";
import type { TrackHit, TrackRequest } from "./looper";
import type { RecordedIntent } from "./recorder";

const CHORDS: TrackRequest = { id: "chord", label: "Chords", mode: "chord" };
const MONO: TrackRequest = { id: "mono", label: "Mono", mode: "mono" };

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

/**
 * 120 BPM is half a second per beat, so every beat count lands on a tidy time.
 * A two-bar loop is eight beats, four seconds.
 */
function rig() {
  const transport = new Transport({ bpm: 120, beatsPerBar: 4, loopBars: 2 });
  return { transport, looper: new Looper(transport) };
}

/** Ticks the looper at each time, collecting every hit. */
function ticks(looper: Looper, times: number[]): TrackHit[] {
  return times.flatMap((time) => looper.tick(time));
}

const beats = (hits: TrackHit[]) => hits.map((hit) => hit.event.beat);
const trackIds = (hits: TrackHit[]) => hits.map((hit) => hit.trackId);

/**
 * Records the chord layer: armed at 0, a count-in bar to 2.0s, then I on the
 * downbeat and V two beats in. Returns the hits at the closing tick.
 */
function recordChords(looper: Looper): TrackHit[] {
  looper.record(0, CHORDS);
  ticks(looper, [1, 2]);
  looper.capture(I_CHORD, 0.8, 0, 2);
  ticks(looper, [2.5, 3]);
  looper.capture(V_CHORD, 0.8, 0, 3);
  ticks(looper, [3.5, 4.5, 5.5]);

  return ticks(looper, [6]);
}

describe("arming", () => {
  it("waits for the next bar line before recording", () => {
    const { transport, looper } = rig();

    looper.record(0, CHORDS);
    expect(looper.state).toBe("armed");
    expect(transport.isPlaying).toBe(true);

    looper.tick(1);
    expect(looper.state).toBe("armed");

    looper.tick(2);
    expect(looper.state).toBe("recording");
  });

  it("shows the layer as soon as it is armed, before it records", () => {
    const { looper } = rig();
    looper.record(0, CHORDS);

    expect(looper.tracks.map((track) => track.id)).toEqual(["chord"]);
    expect(looper.tracks[0].take).toBeNull();
  });

  it("ignores a second arm while one is pending", () => {
    const { looper } = rig();

    looper.record(0, CHORDS);
    looper.record(0.5, MONO);

    expect(looper.state).toBe("armed");
    expect(looper.tracks.map((track) => track.id)).toEqual(["chord"]);
  });
});

describe("recording", () => {
  it("closes after exactly one loop and begins playing", () => {
    const { looper } = rig();
    recordChords(looper);

    expect(looper.state).toBe("playing");
    expect(looper.tracks[0].take?.events.map((event) => event.beat)).toEqual([0, 2]);
    expect(looper.tracks[0].take?.loopBeats).toBe(8);
  });

  it("stamps events against the loop's own start, not the count-in", () => {
    const { looper } = rig();
    recordChords(looper);

    // The count-in put the loop's beat 0 at t=2; the take is measured from
    // there, so it holds 0 and 2 rather than 4 and 6.
    expect(looper.tracks[0].take?.events.map((event) => event.beat)).toEqual([0, 2]);
  });
});

describe("playback", () => {
  it("fires only what came due, and tags each hit with its track", () => {
    const { looper } = rig();
    recordChords(looper);

    expect(beats(looper.tick(7))).toEqual([2]);
    expect(trackIds(looper.tick(7.5))).toEqual([]);
  });

  it("repeats the layer on the next pass", () => {
    const { looper } = rig();
    recordChords(looper);

    expect(beats(looper.tick(7))).toEqual([2]);
    expect(beats(looper.tick(10))).toEqual([0]);
  });

  it("catches up across a long frame, in the order the events fall", () => {
    const { looper } = rig();
    recordChords(looper);

    // One frame spanning a beat change and the seam.
    expect(beats(looper.tick(12))).toEqual([2, 0]);
  });

  it("reports the playhead relative to the loop, not the transport", () => {
    const { looper } = rig();
    recordChords(looper);

    // The loop's origin is the bar line at beat 4; a pass later is back to 0.
    expect(looper.positionBeats(6)).toBeCloseTo(0, 6);
    expect(looper.positionBeats(7)).toBeCloseTo(2, 6);
  });
});

describe("layering", () => {
  /** Records a melody layer over the chord bed, and returns the closing hits. */
  function recordMelody(looper: Looper): TrackHit[] {
    looper.record(10, MONO);
    // Armed at t=10 (beat 20), the loop top is the bar line at beat 28.
    ticks(looper, [10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14]);
    looper.capture(C_NOTE, 0.5, 0, 14);
    ticks(looper, [14.5, 15, 15.5, 16, 16.5, 17, 17.5]);

    return ticks(looper, [18]);
  }

  it("keeps the chords playing while a melody is armed and recorded", () => {
    const { looper } = rig();
    recordChords(looper);

    looper.record(10, MONO);
    const countIn = ticks(looper, [10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14]);

    expect(countIn.every((hit) => hit.trackId === "chord")).toBe(true);
    expect(countIn.length).toBeGreaterThan(0);
  });

  it("records the melody loop-relative, so the layers line up", () => {
    const { looper } = rig();
    recordChords(looper);
    recordMelody(looper);

    expect(looper.tracks.map((track) => track.id)).toEqual(["chord", "mono"]);

    const melody = looper.tracks[1];
    expect(melody.take?.events.map((event) => event.beat)).toEqual([0]);
  });

  it("plays both layers together, in phase, once the second closes", () => {
    const { looper } = rig();
    recordChords(looper);
    const closing = recordMelody(looper);

    expect(trackIds(closing).sort()).toEqual(["chord", "mono"]);
    expect(closing.every((hit) => hit.event.beat === 0)).toBe(true);
  });
});

describe("muting", () => {
  it("drops a layer out of playback and brings it back", () => {
    const { looper } = rig();
    recordChords(looper);

    looper.setMuted("chord", true);
    expect(looper.tick(10)).toHaveLength(0);

    looper.setMuted("chord", false);
    expect(beats(looper.tick(10.5))).toEqual([]);
    // The playhead is two beats into the loop, on the V chord.
    expect(looper.currentEvent("chord", 11)?.beat).toBe(2);
  });

  it("has nothing to re-prime with while a layer is muted", () => {
    const { looper } = rig();
    recordChords(looper);

    looper.toggleMute("chord");
    expect(looper.tracks[0].muted).toBe(true);
    expect(looper.currentEvent("chord", 10)).toBeNull();
  });

  it("shows what a recording has captured so far, before the take closes", () => {
    const { looper } = rig();

    looper.record(0, CHORDS);
    ticks(looper, [1, 2]);
    looper.capture(I_CHORD, 0.8, 0, 2);

    // The take does not exist yet, but the lane has something to draw.
    expect(looper.tracks[0].take).toBeNull();
    expect(looper.eventsFor("chord")).toHaveLength(1);
    expect(looper.eventsFor("mono")).toEqual([]);

    looper.capture(V_CHORD, 0.8, 0, 3);
    ticks(looper, [3.5, 4.5, 5.5, 6]);

    expect(looper.eventsFor("chord").map((event) => event.beat)).toEqual([0, 2]);
  });

  it("keeps a layer's mute across a re-record, and forgets it on clear", () => {
    const { looper } = rig();
    recordChords(looper);
    looper.setMuted("chord", true);

    looper.record(20, CHORDS);
    expect(looper.tracks[0].muted).toBe(true);

    looper.clear();
    expect(looper.tracks).toHaveLength(0);
    expect(looper.state).toBe("idle");
  });
});

describe("stop, play, and clear", () => {
  it("stops without forgetting the layers, then replays from the top", () => {
    const { looper } = rig();
    recordChords(looper);

    looper.stop();
    expect(looper.state).toBe("idle");
    expect(looper.hasTake).toBe(true);

    looper.play(20);
    expect(looper.state).toBe("playing");
    expect(beats(looper.tick(20))).toEqual([0]);
  });

  it("will not play when there is nothing recorded", () => {
    const { looper } = rig();

    looper.play(0);
    expect(looper.state).toBe("idle");
  });

  it("cancels a recording without touching the finished layers", () => {
    const { looper } = rig();
    recordChords(looper);

    looper.record(20, MONO);
    looper.cancelRecording();

    // The chord bed keeps playing; only the half-made melody is dropped.
    expect(looper.state).toBe("playing");
    expect(looper.tracks.map((track) => track.id)).toEqual(["chord", "mono"]);
    expect(looper.tracks[1].take).toBeNull();
  });
});

describe("trackLabel", () => {
  it("names a track after the mode that plays it", () => {
    expect(trackLabel("chord")).toBe("Chords");
    expect(trackLabel("mono")).toBe("Mono");
  });
});

describe("describeLooper", () => {
  it("says what the transport is doing", () => {
    expect(describeLooper("idle", 4, false)).toBe("Idle");
    expect(describeLooper("idle", 4, true)).toBe("Stopped");
    expect(describeLooper("armed", 4, false)).toBe("Armed…");
    expect(describeLooper("recording", 4, false)).toBe("Recording · 4 bars");
    expect(describeLooper("playing", 1, true)).toBe("Looping · 1 bar");
  });
});
