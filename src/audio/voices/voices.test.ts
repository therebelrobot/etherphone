import { describe, expect, it } from "vitest";
import { AUDIO } from "../../config/constants";
import { FakeAudioContext, FakeNode } from "../fake-audio";
import type { FakeGain } from "../fake-audio";
import { getVoice } from "../voice";
import { createOscillatorVoice } from "./oscillator-voice";
import { createPadVoice } from "./pad-voice";
import "./index";

const CHORD = [220, 277.18, 329.63];

function connected(make: typeof createPadVoice) {
  const ctx = new FakeAudioContext();
  const destination = new FakeNode("bus");
  const voice = make();
  voice.connect(ctx.asContext, destination as unknown as AudioNode);
  return { ctx, voice, destination };
}

/** Where each envelope's gain is headed first: a note's swell. */
const firstTarget = (envelope: FakeGain) =>
  envelope.gain.events.find((event) => event.kind !== "set")?.value;

describe("oscillator banks", () => {
  const make = () => createOscillatorVoice("triangle");

  it("fades each note in from silence, so a chord does not start with a click", () => {
    const { ctx, voice } = connected(make);
    voice.play(CHORD);

    const envelopes = ctx.gains;
    expect(envelopes).toHaveLength(CHORD.length);

    for (const envelope of envelopes) {
      expect(envelope.gain.events[0]).toMatchObject({ kind: "set", value: 0, time: 0 });
      expect(firstTarget(envelope)).toBe(1);
    }
  });

  it("fades the old chord out when the next one comes, rather than cutting it", () => {
    const { ctx, voice } = connected(make);
    voice.play(CHORD);
    const first = [...ctx.gains];
    const firstOscillators = [...ctx.oscillators];

    ctx.currentTime = 1;
    voice.play([246.94, 311.13, 369.99]);

    for (const envelope of first) {
      expect(envelope.gain.events.at(-1)).toMatchObject({ kind: "target", value: 0, time: 1 });
    }
    for (const oscillator of firstOscillators) {
      // Stopped once faded, not at the moment of the change.
      expect(oscillator.stoppedAt).toBeCloseTo(1 + AUDIO.oscillatorReleaseSeconds, 9);
    }
  });

  it("does nothing for the chord already sounding, so it can be called every frame", () => {
    const { ctx, voice } = connected(make);
    voice.play(CHORD);
    voice.play(CHORD);

    expect(ctx.oscillators).toHaveLength(CHORD.length);
  });

  it("schedules a change at its moment, not now", () => {
    const { ctx, voice } = connected(make);
    voice.playAt!(CHORD, 2);

    for (const oscillator of ctx.oscillators) expect(oscillator.startedAt).toBe(2);
    for (const envelope of ctx.gains) expect(envelope.gain.events[0].time).toBe(2);
  });
});

describe("the pad", () => {
  it("sounds each note as two oscillators either side of the pitch", () => {
    const { ctx, voice } = connected(createPadVoice);
    voice.play([220]);

    expect(ctx.oscillators).toHaveLength(2);
    expect(ctx.oscillators.map((oscillator) => oscillator.frequency.value)).toEqual([220, 220]);
    expect(ctx.oscillators.map((oscillator) => oscillator.detune.value)).toEqual([
      -AUDIO.padDetuneCents,
      AUDIO.padDetuneCents,
    ]);
  });

  it("keeps a note at one wave's level, so the chord level treats it like any voice", () => {
    const { ctx, voice } = connected(createPadVoice);
    voice.play([220]);

    // Two halves, then the note's envelope.
    const halves = ctx.gains.filter((gain) => gain.gain.value === 0.5);
    expect(halves).toHaveLength(2);
  });

  it("goes through a soft lowpass to the bus it was given", () => {
    const { ctx, destination } = connected(createPadVoice);
    const [filter] = ctx.filters;

    expect(filter.type).toBe("lowpass");
    expect(filter.frequency.value).toBe(AUDIO.padCutoffHz);
    expect(filter.outputs).toEqual([destination]);
  });

  it("swells in, and crossfades into the next chord instead of cutting", () => {
    const { ctx, voice } = connected(createPadVoice);
    voice.play(CHORD);
    const envelopes = ctx.gains.filter((gain) => gain.gain.value !== 0.5);

    for (const envelope of envelopes) {
      expect(envelope.gain.events[0]).toMatchObject({ kind: "set", value: 0 });
      expect(firstTarget(envelope)).toBe(1);
    }

    ctx.currentTime = 2;
    voice.play([246.94, 311.13, 369.99]);

    for (const envelope of envelopes) {
      expect(envelope.gain.events.at(-1)).toMatchObject({ kind: "target", value: 0, time: 2 });
    }
  });

  it("retunes both oscillators of a note together", () => {
    const { ctx, voice } = connected(createPadVoice);
    voice.play([220]);
    voice.retune!([233.08]);

    for (const oscillator of ctx.oscillators) {
      expect(oscillator.frequency.events.at(-1)).toMatchObject({ kind: "target", value: 233.08 });
    }
  });

  it("is in the picker, with the synths", () => {
    expect(getVoice("synth-pad")).toMatchObject({ label: "Soft Pad", kind: "oscillator" });
  });
});
