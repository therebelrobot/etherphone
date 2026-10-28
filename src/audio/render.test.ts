import { describe, expect, it } from "vitest";
import type { Take } from "../types";
import { encodeWav, renderSeconds, scheduleTake } from "./render";

/** 120 BPM, so a beat is exactly half a second. */
const SECONDS_PER_BEAT = 0.5;

const TAKE: Take = {
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
    { kind: "rest", beat: 2, volume: 0, tilt: 0 },
    { kind: "note", beat: 4, volume: 0.8, tilt: 0.5, degree: 3 },
  ],
};

describe("scheduleTake", () => {
  it("places every event at its beat, in seconds", () => {
    const notes = scheduleTake(TAKE, 261.63, SECONDS_PER_BEAT);

    expect(notes.map((note) => note.when)).toEqual([0, 1, 2]);
  });

  it("resolves a chord into the frequencies it should sound", () => {
    const [first] = scheduleTake(TAKE, 261.63, SECONDS_PER_BEAT);

    expect(first.notes.length).toBeGreaterThan(0);
    expect(first.notes[0]).toBeCloseTo(261.63, 1);
  });

  it("gives a rest no notes, so the renderer silences instead of playing", () => {
    const rest = scheduleTake(TAKE, 261.63, SECONDS_PER_BEAT)[1];

    expect(rest.notes).toEqual([]);
  });

  it("carries the expression each event was played with", () => {
    const note = scheduleTake(TAKE, 261.63, SECONDS_PER_BEAT)[2];

    expect(note.volume).toBe(0.8);
    expect(note.tilt).toBe(0.5);
  });

  it("transposes with the tonic, which is what makes a render follow the key", () => {
    const low = scheduleTake(TAKE, 261.63, SECONDS_PER_BEAT)[2].notes[0];
    const high = scheduleTake(TAKE, 523.26, SECONDS_PER_BEAT)[2].notes[0];

    expect(high).toBeCloseTo(low * 2, 1);
  });
});

describe("renderSeconds", () => {
  it("is the loop's own length plus the tail a last note needs", () => {
    // Eight beats at 120 BPM is four seconds.
    expect(renderSeconds(8, 120, 1.5)).toBeCloseTo(5.5, 5);
  });

  it("gets shorter as the tempo rises", () => {
    expect(renderSeconds(8, 240, 0)).toBeLessThan(renderSeconds(8, 120, 0));
  });
});

describe("encodeWav", () => {
  /** Reads the header back out, which is the part that is silently wrong. */
  async function header(blob: Blob) {
    const view = new DataView(await blob.arrayBuffer());
    const ascii = (offset: number, length: number) =>
      Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join("");

    return {
      riff: ascii(0, 4),
      wave: ascii(8, 4),
      fmt: ascii(12, 4),
      data: ascii(36, 4),
      riffSize: view.getUint32(4, true),
      format: view.getUint16(20, true),
      channels: view.getUint16(22, true),
      sampleRate: view.getUint32(24, true),
      bits: view.getUint16(34, true),
      dataSize: view.getUint32(40, true),
      bytes: view.byteLength,
    };
  }

  it("writes a RIFF/WAVE header a player will accept", async () => {
    const wav = await header(encodeWav([new Float32Array(4)], 44100));

    expect(wav.riff).toBe("RIFF");
    expect(wav.wave).toBe("WAVE");
    expect(wav.fmt).toBe("fmt ");
    expect(wav.data).toBe("data");
    expect(wav.format).toBe(1); // PCM
    expect(wav.bits).toBe(16);
    expect(wav.sampleRate).toBe(44100);
  });

  it("sizes the container and the data chunk to the samples it holds", async () => {
    const frames = 100;
    const wav = await header(encodeWav([new Float32Array(frames)], 44100));

    // One channel, two bytes a sample.
    expect(wav.channels).toBe(1);
    expect(wav.dataSize).toBe(frames * 2);
    expect(wav.bytes).toBe(44 + frames * 2);
    expect(wav.riffSize).toBe(wav.bytes - 8);
  });

  it("writes one sample per channel per frame for a stereo render", async () => {
    const wav = await header(encodeWav([new Float32Array(10), new Float32Array(10)], 48000));

    expect(wav.channels).toBe(2);
    expect(wav.dataSize).toBe(10 * 2 * 2);
  });

  it("clamps rather than wrapping, so a loud mix is not heard as damage", async () => {
    const loud = encodeWav([Float32Array.from([2, -2])], 44100);
    const view = new DataView(await loud.arrayBuffer());

    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });

  it("round-trips a known sample", async () => {
    const wav = encodeWav([Float32Array.from([0, 0.5, -0.5])], 44100);
    const view = new DataView(await wav.arrayBuffer());

    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(16384);
    expect(view.getInt16(48, true)).toBe(-16384);
  });
});
