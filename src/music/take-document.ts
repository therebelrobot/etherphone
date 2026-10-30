/**
 * A take you can carry away.
 *
 * RFC #2 asks for the take to be exported as JSON — "small, diffable,
 * shareable" — and imported back. A take is already a handful of numbers, so
 * the only real work is being strict about what comes back in: an imported file
 * is *input from outside*, and a malformed one must be rejected with something a
 * player can read rather than half-loaded into the looper.
 *
 * This module is pure. It does not know about the looper, the DOM, or audio —
 * it turns a take into text and text back into a take, and nothing else.
 */
import { getQuality } from "./qualities";
import type { ChordNumeral, InstrumentMode, Take, TakeEvent } from "../types";

/** Marks the file, so a random `.json` is rejected with a useful message. */
export const TAKE_DOCUMENT_FORMAT = "etherphone.take";

/**
 * The schema version.
 *
 * A version is written and checked because the alternative is a parser that
 * silently accepts a file it does not understand. Bump this whenever the shape
 * changes; an older file can then be migrated explicitly instead of guessed at.
 *
 * Version 2 replaced the chord's `qualityIndex` and `thumbDown` with a single
 * `quality` id (RFC #19). Version 1 takes are rejected rather than migrated: the
 * instrument has never had a user who keeps one, and a migration nobody needs is
 * a migration nobody tests.
 */
export const TAKE_DOCUMENT_VERSION = 2;

/** One layer, as it is written to the file. */
export interface TakeDocumentTrack {
  readonly label: string;
  readonly mode: InstrumentMode;
  readonly muted: boolean;
  /**
   * The layer's own level, 0..1.
   *
   * Written on export, optional on read: how loud a part sat is part of the
   * performance even though it is not part of the take, and a file written
   * before levels existed must still load. Absent means 1.
   */
  readonly gain?: number;
  readonly take: Take;
}

/**
 * A whole performance: every layer, plus the grid they were played against.
 *
 * Tempo and loop length travel with the take because a take is meaningless
 * without them — the events are positions in a loop, and a loop of eight bars
 * played at the tempo of a two-bar loop is a different piece of music.
 */
export interface TakeDocument {
  readonly format: typeof TAKE_DOCUMENT_FORMAT;
  readonly version: number;
  readonly exportedAt: string;
  readonly bpm: number;
  readonly loopBeats: number;
  readonly tracks: readonly TakeDocumentTrack[];
}

/** Everything {@link serializeTakeDocument} needs, minus the housekeeping. */
export interface TakeDocumentInput {
  readonly bpm: number;
  readonly loopBeats: number;
  readonly tracks: readonly TakeDocumentTrack[];
  /** Overridden in tests, so the output is not clock-dependent. */
  readonly exportedAt?: string;
}

/** Writes a performance as text, indented so it reads and diffs. */
export function serializeTakeDocument(input: TakeDocumentInput): string {
  const document: TakeDocument = {
    format: TAKE_DOCUMENT_FORMAT,
    version: TAKE_DOCUMENT_VERSION,
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    bpm: input.bpm,
    loopBeats: input.loopBeats,
    tracks: input.tracks,
  };

  return `${JSON.stringify(document, null, 2)}\n`;
}

/**
 * A filename that says what the file is without opening it.
 *
 * Dated because a folder of `etherphone-take.json` files is a folder you cannot
 * tell apart, and the bar count because that is the one musical fact that is
 * not obvious from the name.
 */
export function takeDocumentFilename(date = new Date(), loopBeats = 16): string {
  const stamp = date.toISOString().slice(0, 10);
  return `etherphone-take-${stamp}-${loopBeats}beats.json`;
}

/** The same naming, for the rendered audio of a take. */
export function takeAudioFilename(date = new Date(), loopBeats = 16): string {
  const stamp = date.toISOString().slice(0, 10);
  return `etherphone-take-${stamp}-${loopBeats}beats.wav`;
}

/**
 * Reads a performance back, or explains why it cannot.
 *
 * Deliberately strict: every field is checked before anything is built, so a
 * failure leaves the caller with nothing to unwind. The error messages name the
 * field, because "invalid file" tells a player nothing about which file to
 * re-export.
 */
export function parseTakeDocument(text: string): TakeDocument {
  let raw: unknown;

  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("That file is not JSON, so it is not an Etherphone take.");
  }

  if (!isRecord(raw)) throw new Error("That file is not an Etherphone take.");

  if (raw.format !== TAKE_DOCUMENT_FORMAT) {
    throw new Error(
      `That file is not an Etherphone take (expected format "${TAKE_DOCUMENT_FORMAT}").`,
    );
  }

  const version = requireNumber(raw, "version");
  if (version !== TAKE_DOCUMENT_VERSION) {
    throw new Error(
      `That take is version ${version}, and this instrument reads version ${TAKE_DOCUMENT_VERSION}.`,
    );
  }

  const bpm = requirePositive(raw, "bpm");
  const loopBeats = requirePositive(raw, "loopBeats");

  if (!Array.isArray(raw.tracks)) throw new Error("That take has no layers in it.");

  const tracks = raw.tracks.map((track, index) => parseTrack(track, index));

  if (tracks.every((track) => track.take.events.length === 0)) {
    throw new Error("That take has no notes in it.");
  }

  return {
    format: TAKE_DOCUMENT_FORMAT,
    version: TAKE_DOCUMENT_VERSION,
    exportedAt: typeof raw.exportedAt === "string" ? raw.exportedAt : "",
    bpm,
    loopBeats,
    tracks,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireNumber(source: Record<string, unknown>, field: string): number {
  const value = source[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`That take's "${field}" is not a number.`);
  }
  return value;
}

function requirePositive(source: Record<string, unknown>, field: string): number {
  const value = requireNumber(source, field);
  if (value <= 0) throw new Error(`That take's "${field}" is not a positive number.`);
  return value;
}

const NUMERALS = new Set<string>([
  "I",
  "II",
  "III",
  "IV",
  "V",
  "VI",
  "VII",
  "i",
  "ii",
  "iii",
  "iv",
  "v",
  "vi",
  "vii",
]);

function parseTrack(raw: unknown, index: number): TakeDocumentTrack {
  const label = `layer ${index + 1}`;
  if (!isRecord(raw)) throw new Error(`That take's ${label} is not an object.`);

  const mode = raw.mode;
  if (mode !== "chord" && mode !== "mono") {
    throw new Error(`That take's ${label} has a mode this instrument does not know.`);
  }

  if (typeof raw.label !== "string") {
    throw new Error(`That take's ${label} has no name.`);
  }

  if (!isRecord(raw.take)) throw new Error(`That take's ${label} holds no take.`);

  const bpm = requirePositive(raw.take, "bpm");
  const loopBeats = requirePositive(raw.take, "loopBeats");

  if (!Array.isArray(raw.take.events)) {
    throw new Error(`That take's ${label} has no events.`);
  }

  const events = raw.take.events.map((event, at) => parseEvent(event, label, at));

  // Out-of-order events would play wrong rather than fail, so they are sorted
  // here rather than trusted: a hand-edited file is the expected way to get it
  // wrong, and the fix is obvious.
  events.sort((a, b) => a.beat - b.beat);

  return {
    label: raw.label,
    mode,
    muted: raw.muted === true,
    // Clamped rather than rejected: a level outside the range is a bug in
    // whatever wrote the file, not a reason to refuse a performance.
    gain: raw.gain === undefined ? 1 : clampLevel(requireNumber(raw, "gain")),
    take: { bpm, loopBeats, events },
  };
}

/** Holds a level inside the range the fader has. */
function clampLevel(level: number): number {
  return Math.min(1, Math.max(0, level));
}

function parseEvent(raw: unknown, label: string, at: number): TakeEvent {
  const where = `${label}, event ${at + 1}`;
  if (!isRecord(raw)) throw new Error(`That take's ${where} is not an object.`);

  const beat = requireNumber(raw, "beat");
  const volume = requireNumber(raw, "volume");
  const tilt = requireNumber(raw, "tilt");

  if (beat < 0) throw new Error(`That take's ${where} lands before the loop starts.`);

  switch (raw.kind) {
    case "rest":
      return { kind: "rest", beat, volume, tilt };

    case "note": {
      const degree = requireNumber(raw, "degree");
      if (degree < 1) throw new Error(`That take's ${where} has a degree below 1.`);
      return { kind: "note", beat, volume, tilt, degree };
    }

    case "chord": {
      const numeral = raw.numeral;
      if (typeof numeral !== "string" || !NUMERALS.has(numeral)) {
        throw new Error(`That take's ${where} is not a chord this instrument knows.`);
      }

      const quality = raw.quality;
      // Checked against the catalogue, not merely for being a string: an id the
      // instrument cannot sound is a typo, and this is the only moment a take can
      // be told so. A quality removed from the catalogue later would make old
      // takes unreadable, which is the right way round — the error names the
      // problem instead of the chord silently losing its kind.
      if (typeof quality !== "string" || getQuality(quality) === undefined) {
        throw new Error(`That take's ${where} is not a chord kind this instrument knows.`);
      }

      return {
        kind: "chord",
        beat,
        volume,
        tilt,
        numeral: numeral as ChordNumeral,
        isMajorMode: raw.isMajorMode === true,
        quality,
      };
    }

    default:
      throw new Error(`That take's ${where} has a kind this instrument does not know.`);
  }
}
