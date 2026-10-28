import { describe, expect, it } from "vitest";
import type { TakeDocumentTrack } from "./take-document";
import {
  parseTakeDocument,
  takeAudioFilename,
  serializeTakeDocument,
  takeDocumentFilename,
  TAKE_DOCUMENT_FORMAT,
  TAKE_DOCUMENT_VERSION,
} from "./take-document";

const TRACKS: readonly TakeDocumentTrack[] = [
  {
    label: "Chords 1",
    mode: "chord",
    muted: false,
    take: {
      bpm: 100,
      loopBeats: 16,
      events: [
        {
          kind: "chord",
          beat: 0,
          volume: 0.5,
          tilt: 0,
          numeral: "I",
          isMajorMode: true,
          qualityIndex: 0,
          thumbDown: false,
        },
        { kind: "rest", beat: 4, volume: 0, tilt: 0 },
        {
          kind: "chord",
          beat: 8,
          volume: 0.6,
          tilt: 0.2,
          numeral: "IV",
          isMajorMode: true,
          qualityIndex: 1,
          thumbDown: true,
        },
      ],
    },
  },
  {
    label: "Mono 1",
    mode: "mono",
    muted: true,
    take: {
      bpm: 100,
      loopBeats: 16,
      events: [{ kind: "note", beat: 2, volume: 0.4, tilt: 0, degree: 5 }],
    },
  },
];

function written(overrides: Partial<Parameters<typeof serializeTakeDocument>[0]> = {}) {
  return serializeTakeDocument({
    bpm: 100,
    loopBeats: 16,
    tracks: TRACKS,
    exportedAt: "2026-10-28T00:00:00.000Z",
    ...overrides,
  });
}

describe("serializeTakeDocument", () => {
  it("writes the format, the version, and the grid the take was played against", () => {
    const parsed = JSON.parse(written());

    expect(parsed.format).toBe(TAKE_DOCUMENT_FORMAT);
    expect(parsed.version).toBe(TAKE_DOCUMENT_VERSION);
    expect(parsed.bpm).toBe(100);
    expect(parsed.loopBeats).toBe(16);
    expect(parsed.tracks).toHaveLength(2);
  });

  it("ends with a newline, so the file is a well-formed text file", () => {
    expect(written().endsWith("\n")).toBe(true);
  });
});

describe("parseTakeDocument", () => {
  it("round-trips every layer, event for event", () => {
    const parsed = parseTakeDocument(written());

    expect(parsed.tracks).toHaveLength(2);
    expect(parsed.tracks[0].label).toBe("Chords 1");
    expect(parsed.tracks[0].take.events).toEqual(TRACKS[0].take.events);
    expect(parsed.tracks[1].mode).toBe("mono");
    expect(parsed.tracks[1].muted).toBe(true);
    expect(parsed.tracks[1].take.events).toEqual(TRACKS[1].take.events);
  });

  it("gives a track with no level a default of full", () => {
    const parsed = parseTakeDocument(written());

    expect(parsed.tracks.every((track) => track.gain === 1)).toBe(true);
  });

  it("defaults muted to false rather than trusting a missing flag", () => {
    const parsed = parseTakeDocument(
      written({
        tracks: [{ ...TRACKS[0], muted: undefined as unknown as boolean }],
      }),
    );

    expect(parsed.tracks[0].muted).toBe(false);
  });

  it("sorts out-of-order events instead of playing them wrong", () => {
    const parsed = parseTakeDocument(
      written({
        tracks: [
          {
            ...TRACKS[0],
            take: {
              ...TRACKS[0].take,
              events: [TRACKS[0].take.events[2], TRACKS[0].take.events[0]],
            },
          },
        ],
      }),
    );

    expect(parsed.tracks[0].take.events.map((event) => event.beat)).toEqual([0, 8]);
  });

  it("rejects a file that is not JSON", () => {
    expect(() => parseTakeDocument("not json")).toThrow(/not JSON/i);
  });

  it("rejects JSON that is not an Etherphone take", () => {
    expect(() => parseTakeDocument('{"hello":"world"}')).toThrow(/not an Etherphone take/);
  });

  it("rejects a version it does not understand rather than guessing", () => {
    const text = written().replace('"version": 1', '"version": 99');
    expect(() => parseTakeDocument(text)).toThrow(/version 99/);
  });

  it("rejects a take with no layers", () => {
    // The same message as an all-empty take, and that is honest: either way
    // there is nothing to play.
    expect(() => parseTakeDocument(written({ tracks: [] }))).toThrow(/no notes/);
  });

  it("rejects a take whose layers are all empty", () => {
    const empty = { ...TRACKS[0], take: { ...TRACKS[0].take, events: [] } };
    expect(() => parseTakeDocument(written({ tracks: [empty] }))).toThrow(/no notes/);
  });

  it("rejects an event kind it does not know", () => {
    const text = written().replace('"kind": "rest"', '"kind": "drum"');
    expect(() => parseTakeDocument(text)).toThrow(/does not know/);
  });

  it("rejects a chord that is not a numeral", () => {
    const text = written().replace('"numeral": "IV"', '"numeral": "VIII"');
    expect(() => parseTakeDocument(text)).toThrow(/not a chord/);
  });

  it("rejects a layer whose mode it does not know", () => {
    const text = written().replace('"mode": "mono"', '"mode": "drums"');
    expect(() => parseTakeDocument(text)).toThrow(/does not know/);
  });

  it("rejects a take with a nonsense tempo", () => {
    const text = written().replace('"bpm": 100', '"bpm": 0');
    expect(() => parseTakeDocument(text)).toThrow(/positive/);
  });

  it("names the field in the error, so the file can be fixed", () => {
    const text = written().replace('"degree": 5', '"degree": "five"');
    expect(() => parseTakeDocument(text)).toThrow(/"degree" is not a number/);
  });
});

describe("layer levels in a take file", () => {
  it("carries each layer's level, so the mix travels with the performance", () => {
    const parsed = parseTakeDocument(
      written({
        tracks: [
          { ...TRACKS[0], gain: 0.4 },
          { ...TRACKS[1], gain: 0.9 },
        ],
      }),
    );

    expect(parsed.tracks[0].gain).toBe(0.4);
    expect(parsed.tracks[1].gain).toBe(0.9);
  });

  it("reads a file with no levels at all as full, so older takes still load", () => {
    const text = written().replace(/\n\s*"gain": [0-9.]+,/g, "");
    const parsed = parseTakeDocument(text);

    expect(parsed.tracks.every((track) => track.gain === 1)).toBe(true);
  });

  it("clamps a level outside the range rather than refusing the performance", () => {
    const parsed = parseTakeDocument(written({ tracks: [{ ...TRACKS[0], gain: 3 }] }));

    expect(parsed.tracks[0].gain).toBe(1);
  });
});

describe("takeDocumentFilename", () => {
  it("dates the file and says how long the loop is", () => {
    expect(takeDocumentFilename(new Date("2026-10-28T12:00:00Z"), 32)).toBe(
      "etherphone-take-2026-10-28-32beats.json",
    );
  });

  it("names the rendered audio the same way, so the pair sort together", () => {
    expect(takeAudioFilename(new Date("2026-10-28T12:00:00Z"), 32)).toBe(
      "etherphone-take-2026-10-28-32beats.wav",
    );
  });
});
