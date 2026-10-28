import { describe, expect, it } from "vitest";
import { Transport } from "../audio/transport";
import type { InstrumentMode } from "../types";
import { describeLooper, Looper, trackLabel } from "./looper";
import type { LoopLayerSeed, TrackHit } from "./looper";
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
const idOf = (looper: Looper, label: string) =>
  looper.tracks.find((track) => track.label === label)?.id ?? "";

/**
 * Records the first chord layer: armed at 0, a count-in bar to 2.0s, then I on
 * the downbeat and V two beats in. Returns the hits at the closing tick.
 */
function recordChords(looper: Looper): TrackHit[] {
  looper.record(0, "chord");
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

    looper.record(0, "chord");
    expect(looper.state).toBe("armed");
    expect(transport.isPlaying).toBe(true);
    expect(looper.countdownBeats(0)).toBe(4);

    looper.tick(1);
    expect(looper.state).toBe("armed");
    expect(looper.countdownBeats(1)).toBe(2);

    looper.tick(2);
    expect(looper.state).toBe("recording");
  });

  it("shows the layer as soon as it is armed, before it records", () => {
    const { looper } = rig();
    looper.record(0, "chord");

    expect(looper.tracks.map((track) => track.label)).toEqual(["Chords 1"]);
    expect(looper.tracks[0].take).toBeNull();
  });

  it("ignores a second arm while one is pending", () => {
    const { looper } = rig();

    looper.record(0, "chord");
    looper.record(0.5, "mono");

    expect(looper.tracks.map((track) => track.label)).toEqual(["Chords 1"]);
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

  it("names the layer it is recording, for the readout", () => {
    const { looper } = rig();
    looper.record(0, "mono");
    ticks(looper, [1, 2]);

    expect(looper.recordingLabel).toBe("Mono 1");
  });
});

/**
 * Records a melody over the chord bed. The melody is armed at t=10 and begins at
 * the *next bar* — not the top of the loop — so its take is rotated onto the
 * loop's grid instead of waiting four bars for its turn.
 */
function recordMelody(looper: Looper): TrackHit[] {
  looper.record(10, "mono");
  ticks(looper, [10.5, 11, 11.5, 12]);
  looper.capture(C_NOTE, 0.5, 0, 12);
  ticks(looper, [12.5, 13, 13.5, 14, 14.5, 15]);

  // The closing tick plus one more, so each layer's first sound is caught.
  return ticks(looper, [16, 18]);
}

describe("layering", () => {
  it("adds a layer rather than replacing the one already there", () => {
    const { looper } = rig();
    recordChords(looper);
    recordMelody(looper);

    expect(looper.tracks.map((track) => track.label)).toEqual(["Chords 1", "Mono 1"]);
    expect(looper.tracks.every((track) => track.take !== null)).toBe(true);
  });

  it("rotates a later layer onto the loop's grid, so it keeps time", () => {
    const { looper } = rig();
    recordChords(looper);
    recordMelody(looper);

    // The melody began at loop beat 4, so that is where its note belongs — not
    // at 0, and not wherever the recording happened to start.
    expect(looper.tracks[1].take?.events.map((event) => event.beat)).toEqual([4]);
  });

  it("keeps the chords playing while a melody is armed and recorded", () => {
    const { looper } = rig();
    recordChords(looper);

    looper.record(10, "mono");
    const countIn = ticks(looper, [10.5, 11, 11.5, 12]);

    expect(countIn.length).toBeGreaterThan(0);
    expect(countIn.every((hit) => hit.trackId === idOf(looper, "Chords 1"))).toBe(true);
  });

  it("plays every layer together once the second closes", () => {
    const { looper } = rig();
    recordChords(looper);
    const closing = recordMelody(looper);

    expect(new Set(trackIds(closing))).toEqual(
      new Set([idOf(looper, "Chords 1"), idOf(looper, "Mono 1")]),
    );
  });
});

describe("rewriting", () => {
  it("replaces one layer, leaving the others alone", () => {
    const { looper } = rig();
    recordChords(looper);
    recordMelody(looper);
    const chords = idOf(looper, "Chords 1");
    const melody = idOf(looper, "Mono 1");

    looper.rewrite(20, chords);
    expect(looper.state).toBe("armed");

    // Armed at t=20 (beat 40), the bar line is beat 44 — t=22.
    ticks(looper, [20.5, 21, 21.5, 22]);
    looper.capture(V_CHORD, 0.8, 0, 22);
    ticks(looper, [22.5, 23, 23.5, 24, 24.5, 25, 25.5]);
    looper.tick(26);

    expect(looper.tracks).toHaveLength(2);
    expect(looper.tracks.find((track) => track.id === chords)?.take?.events).toHaveLength(1);
    expect(looper.tracks.find((track) => track.id === melody)?.take?.events).toHaveLength(1);
  });

  it("puts back the take a cancelled rewrite displaced, rather than losing it", () => {
    const { looper } = rig();
    recordChords(looper);
    const chords = idOf(looper, "Chords 1");

    looper.rewrite(20, chords);
    ticks(looper, [20.5, 21, 21.5, 22]); // the recording starts, displacing the take

    looper.cancelRecording();

    expect(looper.tracks).toHaveLength(1);
    expect(looper.tracks[0].take?.events.map((event) => event.beat)).toEqual([0, 2]);
  });

  it("drops a cancelled new layer, because it never existed", () => {
    const { looper } = rig();

    looper.record(0, "chord");
    looper.cancelRecording();

    expect(looper.tracks).toHaveLength(0);
    expect(looper.state).toBe("idle");
  });
});

describe("playback", () => {
  it("fires only what came due, and tags each hit with its layer", () => {
    const { looper } = rig();
    recordChords(looper);

    expect(beats(looper.tick(7))).toEqual([2]);
    expect(trackIds(looper.tick(7.5))).toEqual([]);
  });

  it("repeats a layer on the next pass", () => {
    const { looper } = rig();
    recordChords(looper);

    expect(beats(looper.tick(7))).toEqual([2]);
    expect(beats(looper.tick(10))).toEqual([0]);
  });

  it("catches up across a long frame, in the order the events fall", () => {
    const { looper } = rig();
    recordChords(looper);

    expect(beats(looper.tick(12))).toEqual([2, 0]);
  });

  it("reports the playhead relative to the loop, not the transport", () => {
    const { looper } = rig();
    recordChords(looper);

    expect(looper.positionBeats(6)).toBeCloseTo(0, 6);
    expect(looper.positionBeats(7)).toBeCloseTo(2, 6);
  });
});

describe("muting", () => {
  it("drops a layer out of playback and brings it back", () => {
    const { looper } = rig();
    recordChords(looper);
    const chords = idOf(looper, "Chords 1");

    looper.setMuted(chords, true);
    expect(looper.tick(10)).toHaveLength(0);

    looper.setMuted(chords, false);
    expect(looper.currentEvent(chords, 11)?.beat).toBe(2);
  });

  it("has nothing to re-prime with while a layer is muted", () => {
    const { looper } = rig();
    recordChords(looper);
    const chords = idOf(looper, "Chords 1");

    looper.toggleMute(chords);
    expect(looper.tracks[0].muted).toBe(true);
    expect(looper.currentEvent(chords, 10)).toBeNull();
  });
});

describe("clearing", () => {
  it("clears one layer and leaves the rest playing", () => {
    const { looper } = rig();
    recordChords(looper);
    recordMelody(looper);
    const chords = idOf(looper, "Chords 1");

    looper.clearTrack(chords);

    expect(looper.tracks.map((track) => track.label)).toEqual(["Mono 1"]);
    expect(looper.state).toBe("playing");
  });

  it("stops the clock when the last layer goes", () => {
    const { transport, looper } = rig();
    recordChords(looper);

    looper.clearTrack(idOf(looper, "Chords 1"));

    expect(looper.state).toBe("idle");
    expect(transport.isPlaying).toBe(false);
  });

  it("keeps a layer's mute across a re-record, and forgets everything on clear", () => {
    const { looper } = rig();
    recordChords(looper);
    const chords = idOf(looper, "Chords 1");
    looper.setMuted(chords, true);

    looper.rewrite(20, chords);
    expect(looper.tracks[0].muted).toBe(true);

    looper.clear();
    expect(looper.tracks).toHaveLength(0);
    expect(looper.state).toBe("idle");
  });
});

describe("importing a take", () => {
  const seed = (label: string, mode: InstrumentMode, muted = false): LoopLayerSeed => ({
    label,
    mode,
    muted,
    take: {
      bpm: 120,
      loopBeats: 8,
      events: [
        {
          kind: "chord",
          beat: 0,
          volume: 0.5,
          tilt: 0,
          numeral: "I",
          isMajorMode: true,
          qualityIndex: 1,
          thumbDown: false,
        },
      ],
    },
  });

  it("replaces whatever was in play with the imported layers", () => {
    const { looper } = rig();
    recordChords(looper);

    looper.replaceLayers([seed("Chords 1", "chord"), seed("Mono 1", "mono", true)]);

    expect(looper.tracks.map((track) => track.label)).toEqual(["Chords 1", "Mono 1"]);
    expect(looper.tracks[1].muted).toBe(true);
    expect(looper.tracks[0].take?.events).toHaveLength(1);
  });

  it("stops the clock, so an import does not inherit a running transport", () => {
    const { transport, looper } = rig();
    recordChords(looper);
    expect(transport.isPlaying).toBe(true);

    looper.replaceLayers([seed("Chords 1", "chord")]);

    expect(transport.isPlaying).toBe(false);
  });

  it("plays the imported layers from the top", () => {
    const { looper } = rig();

    looper.replaceLayers([seed("Chords 1", "chord")]);
    looper.play(0);

    const hits = ticks(looper, [0, 0.1]);
    expect(beats(hits)).toContain(0);
    expect(trackIds(hits)).toContain(idOf(looper, "Chords 1"));
  });

  it("continues the numbering, so a new layer is not a second Chords 1", () => {
    const { looper } = rig();

    looper.replaceLayers([seed("Chords 1", "chord")]);
    looper.record(0, "chord");

    expect(looper.tracks.map((track) => track.label)).toEqual(["Chords 1", "Chords 2"]);
  });

  it("forgets an armed recording rather than merging it with the import", () => {
    const { looper } = rig();
    looper.record(0, "chord");

    looper.replaceLayers([seed("Chords 1", "chord")]);

    expect(looper.tracks).toHaveLength(1);
    expect(looper.recordingId).toBeNull();
  });

  it("leaves nothing behind when the import is empty", () => {
    const { looper } = rig();
    recordChords(looper);

    looper.replaceLayers([]);

    expect(looper.tracks).toHaveLength(0);
    expect(looper.hasTake).toBe(false);
  });
});

describe("layer levels", () => {
  it("starts every layer at full, so a first recording is not quiet for no reason", () => {
    const { looper } = rig();
    recordChords(looper);

    expect(looper.tracks[0].gain).toBe(1);
  });

  it("clamps a level into the range the fader has", () => {
    const { looper } = rig();
    recordChords(looper);
    const id = idOf(looper, "Chords 1");

    looper.setGain(id, 2);
    expect(looper.tracks[0].gain).toBe(1);

    looper.setGain(id, -1);
    expect(looper.tracks[0].gain).toBe(0);
  });

  it("steps by a tenth, for a hand that cannot drag a fader", () => {
    const { looper } = rig();
    recordChords(looper);
    const id = idOf(looper, "Chords 1");

    looper.nudgeGain(id, -1);
    looper.nudgeGain(id, -1);

    expect(looper.tracks[0].gain).toBeCloseTo(0.8, 5);
  });

  it("keeps a layer's level across a re-record, like its mute", () => {
    const { looper } = rig();
    recordChords(looper);
    const id = idOf(looper, "Chords 1");
    looper.setGain(id, 0.4);

    looper.rewrite(20, id);

    expect(looper.tracks[0].gain).toBe(0.4);
  });

  it("takes a level from an imported layer, defaulting to full", () => {
    const { looper } = rig();
    const take = {
      bpm: 120,
      loopBeats: 8,
      events: [],
    };

    looper.replaceLayers([
      { label: "Chords 1", mode: "chord", muted: false, gain: 0.3, take },
      { label: "Chords 2", mode: "chord", muted: false, take },
    ]);

    expect(looper.tracks[0].gain).toBe(0.3);
    expect(looper.tracks[1].gain).toBe(1);
  });
});

describe("stopping mid-recording", () => {
  it("closes the recording and keeps what was played", () => {
    const { looper } = rig();

    looper.record(0, "chord");
    ticks(looper, [1, 2]);
    looper.capture(I_CHORD, 0.8, 0, 2);
    ticks(looper, [2.5]);

    // Stop arrives well before the loop is up. That is "close it here", not
    // "throw it away": a transport move must never destroy a take.
    looper.stop();

    expect(looper.tracks).toHaveLength(1);
    expect(looper.tracks[0].take?.events.map((event) => event.beat)).toEqual([0]);
    expect(looper.state).toBe("idle");
    expect(looper.hasTake).toBe(true);
  });

  it("keeps the earlier take when a rewrite is stopped before playing anything", () => {
    const { looper } = rig();
    recordChords(looper);
    const chords = idOf(looper, "Chords 1");

    looper.rewrite(20, chords);
    ticks(looper, [20.5, 21, 21.5, 22]); // the recording starts, displacing the take
    looper.stop();

    expect(looper.tracks).toHaveLength(1);
    expect(looper.tracks[0].take?.events.map((event) => event.beat)).toEqual([0, 2]);
  });

  it("leaves nothing behind for a layer that was stopped before playing", () => {
    const { looper } = rig();

    looper.record(0, "chord");
    ticks(looper, [1, 2]); // the recording begins, but nothing is played
    looper.stop();

    expect(looper.tracks).toHaveLength(0);
    expect(looper.state).toBe("idle");
  });

  it("leaves nothing behind for an arm that never became a recording", () => {
    const { looper } = rig();

    looper.record(0, "chord");
    looper.stop();

    expect(looper.tracks).toHaveLength(0);
  });
});

describe("stop and play", () => {
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
});

describe("trackLabel", () => {
  it("names a layer after the mode that plays it", () => {
    expect(trackLabel("chord")).toBe("Chords");
    expect(trackLabel("mono")).toBe("Mono");
  });
});

describe("describeLooper", () => {
  it("counts an armed recording in, so the wait is not a guess", () => {
    expect(describeLooper({ state: "armed", loopBars: 4, hasTake: false, countdownBeats: 3 })).toBe(
      "Armed · Rec in 3",
    );
    expect(describeLooper({ state: "armed", loopBars: 4, hasTake: false })).toBe("Armed…");
  });

  it("names the layer being recorded", () => {
    expect(
      describeLooper({
        state: "recording",
        loopBars: 4,
        hasTake: false,
        recordingLabel: "Chords 2",
      }),
    ).toBe("Recording · Chords 2");
  });

  it("says what the transport is doing", () => {
    expect(describeLooper({ state: "idle", loopBars: 4, hasTake: false })).toBe("Idle");
    expect(describeLooper({ state: "idle", loopBars: 4, hasTake: true })).toBe("Stopped");
    expect(describeLooper({ state: "playing", loopBars: 1, hasTake: true })).toBe(
      "Looping · 1 bar",
    );
  });
});

describe("scheduling ahead", () => {
  /**
   * One layer holding a single chord on beat 4, on the rig's grid: 120 BPM, so
   * a beat is half a second and beat 4 falls at 2.0s.
   */
  function oneChordAtFour() {
    const { transport, looper } = rig();

    looper.replaceLayers([
      {
        label: "Chords 1",
        mode: "chord",
        muted: false,
        take: {
          bpm: 120,
          loopBeats: 8,
          events: [
            {
              kind: "chord",
              beat: 4,
              volume: 0.5,
              tilt: 0,
              numeral: "I",
              isMajorMode: true,
              qualityIndex: 1,
              thumbDown: false,
            },
          ],
        },
      },
    ]);
    looper.play(0);

    return { transport, looper };
  }

  it("hands an event over before it is due, with the time it should sound at", () => {
    const { transport, looper } = oneChordAtFour();

    // 1.95s is beat 3.9; a 50ms lookahead reaches beat 4.0 exactly.
    const hits = looper.schedule(1.95, 0.05);

    expect(hits).toHaveLength(1);
    expect(hits[0].when).toBeCloseTo(transport.ctxTimeForBeat(4), 6);
    expect(hits[0].when).toBeCloseTo(2, 6);
  });

  it("does not return the same event twice once the window has passed it", () => {
    const { looper } = oneChordAtFour();

    expect(looper.schedule(1.95, 0.05)).toHaveLength(1);
    expect(looper.schedule(2.0, 0.05)).toHaveLength(0);
    expect(looper.schedule(2.05, 0.05)).toHaveLength(0);
  });

  it("still returns nothing when the event is further off than the window", () => {
    const { looper } = oneChordAtFour();

    // 1.0s is beat 2; beat 4 is a whole second away.
    expect(looper.schedule(1.0, 0.05)).toHaveLength(0);
  });

  it("behaves exactly like tick when the window is zero", () => {
    const scheduled = oneChordAtFour();
    const ticked = oneChordAtFour();

    expect(scheduled.looper.schedule(2.0, 0).map((hit) => hit.event)).toEqual(
      ticked.looper.tick(2.0).map((hit) => hit.event),
    );
  });
});

describe("overdubbing", () => {
  it("keeps the layer sounding while the new pass is recorded", () => {
    const { looper } = rig();
    recordChords(looper);
    const chords = idOf(looper, "Chords 1");

    looper.overdub(20, chords);

    // The whole point: you play along with what you are adding to.
    expect(looper.tracks[0].take).not.toBeNull();
    expect(looper.tracks[0].take?.events.length).toBeGreaterThan(0);
  });

  it("adds the new pass to the take instead of replacing it", () => {
    const { looper } = rig();
    recordChords(looper);
    const chords = idOf(looper, "Chords 1");
    const before = looper.tracks[0].take?.events.length ?? 0;

    // Armed at 20s: a bar line at 22s, then a pass over the top.
    // Beat 4 of the loop: clear of the I on 0 and the V on 2, so this adds
    // rather than landing on top of one of them.
    looper.overdub(20, chords);
    ticks(looper, [21, 22]);
    looper.capture(C_NOTE, 0.5, 0, 24);
    ticks(looper, [26]);

    expect(looper.tracks[0].take?.events.length).toBe(before + 1);
  });

  it("leaves the layer alone when the pass plays nothing", () => {
    const { looper } = rig();
    recordChords(looper);
    const chords = idOf(looper, "Chords 1");
    const before = looper.tracks[0].take?.events;

    looper.overdub(20, chords);
    ticks(looper, [21, 22, 26]);

    expect(looper.tracks[0].take?.events).toEqual(before);
  });

  it("refuses to overdub a layer that holds nothing", () => {
    const { looper } = rig();
    looper.replaceLayers([
      {
        label: "Chords 1",
        mode: "chord",
        muted: false,
        take: { bpm: 120, loopBeats: 8, events: [] },
      },
    ]);

    looper.overdub(20, looper.tracks[0].id);

    // Nothing to add to, so nothing is armed and the clock stays put.
    expect(looper.state).toBe("idle");
  });

  it("still replaces on a rewrite, so the two are not the same control", () => {
    const { looper } = rig();
    recordChords(looper);
    const chords = idOf(looper, "Chords 1");
    const before = looper.tracks[0].take?.events.length ?? 0;

    looper.rewrite(20, chords);
    ticks(looper, [21, 22]);
    looper.capture(C_NOTE, 0.5, 0, 23);
    ticks(looper, [26]);

    expect(looper.tracks[0].take?.events.length).toBeLessThan(before);
  });
});
