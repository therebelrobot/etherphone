import { describe, expect, it } from "vitest";
import type { Handedness, TakeEvent } from "../types";
import { CUES, SAILOR, SAILOR_BARS, tuneDegreeAt } from "./sailor";
import { SailorRun } from "./sailor-run";
import type { RunStep } from "./sailor-run";
import type { DemoSound } from "./sound";

const FRAME = 1 / 60;
const secondsAt = (beat: number) => (beat * 60) / SAILOR.bpm;

/** Plays the demo through at sixty frames a second, as a browser would. */
function perform(chordHand: Handedness, until: number = CUES.end, sound: DemoSound | null = null) {
  const run = new SailorRun(chordHand, sound);
  const steps: RunStep[] = [];

  for (let t = 0; t <= secondsAt(until); t += FRAME) steps.push(run.step(t));

  return { run, steps, looper: run.performance.looper };
}

const takeOf = (looper: ReturnType<typeof perform>["looper"], label: string) =>
  looper.tracks.find((track) => track.label === label)?.take ?? null;

const sounding = (events: readonly TakeEvent[]) => events.filter((event) => event.kind !== "rest");

describe("the looping demo, played through the instrument's own looper", () => {
  for (const chordHand of ["Left", "Right"] as const) {
    describe(`with the chord hand on the ${chordHand.toLowerCase()}`, () => {
      const { looper } = perform(chordHand);

      it("records two layers, chords and then the tune", () => {
        expect(looper.tracks.map((track) => [track.label, track.mode])).toEqual([
          ["Chords 1", "chord"],
          ["Mono 1", "mono"],
        ]);
      });

      it("records the chords its hands make: ii for two bars, then I", () => {
        // Read off the drawn hands by the instrument's readers, through its
        // stabiliser — so these are the chords a player copying it would record.
        const events = sounding(takeOf(looper, "Chords 1")!.events);

        expect(events.map((event) => event.kind === "chord" && event.numeral)).toEqual(["ii", "I"]);
        expect(events.map((event) => event.kind === "chord" && event.quality)).toEqual([
          "octave",
          "octave",
        ]);
        expect(events[0].beat).toBe(0);
        // On the bar, within the recorder's grid.
        expect(Math.abs(events[1].beat - 8)).toBeLessThanOrEqual(0.25);
      });

      it("records the tune its pitch hand plays, on the beats it plays them", () => {
        const notes = sounding(takeOf(looper, "Mono 1")!.events);
        // The notes held long enough to be heard, which is what a listener hears:
        // a hand jumping between notes crosses the ones between for a frame.
        const held = notes.filter((event, index) => {
          const next = notes[index + 1]?.beat ?? SAILOR.loopBars * 4;
          return next - event.beat >= 0.5;
        });

        const expected = SAILOR_BARS.flatMap((bar, index) =>
          bar.tune.map(([beat, degree]) => [index * 4 + beat, degree] as const),
        ).filter(([, degree], index, all) => index === 0 || all[index - 1][1] !== degree);

        expect(held.map((event) => event.kind === "note" && event.degree)).toEqual(
          expected.map(([, degree]) => degree),
        );

        held.forEach((event, index) => {
          expect(Math.abs(event.beat - expected[index][0])).toBeLessThanOrEqual(0.5);
        });
      });

      it("starts the tune on the loop's first beat, so it lines up with the chords", () => {
        expect(sounding(takeOf(looper, "Mono 1")!.events)[0].beat).toBe(0);
      });

      it("is stopped at the end, with both layers kept", () => {
        expect(looper.state).not.toBe("playing");
        expect(looper.hasTake).toBe(true);
      });
    });
  }

  it("plays both layers while the hands are down", () => {
    const loops: string[] = [];
    const sound: DemoSound = {
      live: () => undefined,
      loop: (trackId) => loops.push(trackId),
      silence: () => undefined,
    };
    const run = new SailorRun("Left", sound);

    for (let t = 0; t <= secondsAt(CUES.handsBack); t += FRAME) {
      const step = run.step(t);
      if (step.beat < CUES.handsDown) loops.length = 0;
    }

    expect(new Set(loops)).toEqual(new Set(["layer-1", "layer-2"]));
  });

  it("plays nothing live while the hands are down: the loop is playing on its own", () => {
    const { steps } = perform("Left", CUES.handsBack);
    const down = steps.filter((step) => step.beat > CUES.handsDown + 1);

    for (const step of down) {
      expect(step.reading.degree).toBeNull();
      expect(step.chord.inFrame).toBe(false);
    }
  });

  it("is silent while both hands are closed for the menu", () => {
    const { steps } = perform("Left", CUES.monoAt);
    const menu = steps.filter((step) => step.beat > CUES.menuFrom + 0.5 && step.beat < CUES.monoAt);

    for (const step of menu) expect(step.reading.chord).toBeNull();
  });

  it("holds the tune's first note through the count-in, as a hand waiting on it would", () => {
    expect(tuneDegreeAt(CUES.tuneFrom)).toBe(SAILOR_BARS[0].tune[0][1]);
  });

  it("asks only for what the instrument offers by default: 100 BPM, four bars", () => {
    expect(SAILOR.bpm).toBe(100);
    expect(SAILOR.loopBars).toBe(4);
  });
});
