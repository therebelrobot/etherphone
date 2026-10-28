import { describe, expect, it } from "vitest";
import { CLASSIC_GESTURE_MAP, TRIAD_GESTURE_MAP } from "../music/gesture-map";
import { customMapFromSlots, EMPTY_SLOTS } from "../music/custom-map";
import { PITCH_SPAN_DEGREES } from "../music/mono";
import { chordGuideRows, controlGuideRows, monoGuideRows } from "./gesture-guide";

describe("chordGuideRows", () => {
  it("gives the classic map its seven rows, in scale order", () => {
    const rows = chordGuideRows("C", CLASSIC_GESTURE_MAP);

    expect(rows.map((row) => row.note)).toEqual(["C", "D", "E", "F", "G", "A", "B"]);
    expect(rows.map((row) => row.gesture)).toEqual(["1️⃣", "2️⃣", "3️⃣", "4️⃣", "5️⃣", "🤘", "🤟"]);
  });

  it("follows the selected key", () => {
    expect(chordGuideRows("A", CLASSIC_GESTURE_MAP).map((row) => row.note)).toEqual([
      "A",
      "B",
      "C#",
      "D",
      "E",
      "F#",
      "G#",
    ]);
  });

  it("shrinks with a smaller map, and shows the notes it reaches", () => {
    // Triad is I, IV, and V, so those are the three notes it names.
    const playable = chordGuideRows("C", TRIAD_GESTURE_MAP).filter((row) => !row.silent);
    expect(playable.map((row) => row.note)).toEqual(["C", "F", "G"]);
  });

  it("still lists the shapes that play nothing, rather than omitting them", () => {
    // Triad makes four and five fingers silent. Omitting them leaves a player
    // wondering why the hand stopped working.
    const silent = chordGuideRows("C", TRIAD_GESTURE_MAP).filter((row) => row.silent);

    expect(silent.map((row) => row.gesture)).toEqual(["4️⃣", "5️⃣"]);
    expect(silent.map((row) => row.note)).toEqual(["—", "—"]);
  });

  it("has nothing silent to report for the classic map", () => {
    expect(chordGuideRows("C", CLASSIC_GESTURE_MAP).some((row) => row.silent)).toBe(false);
  });
});

describe("monoGuideRows", () => {
  it("lists every note the pitch hand can reach", () => {
    expect(monoGuideRows("C")).toHaveLength(1 + PITCH_SPAN_DEGREES);
  });

  it("runs highest first, so it reads the way the frame does", () => {
    const rows = monoGuideRows("C");

    expect(rows[0]).toBe("C +2");
    expect(rows.at(-1)).toBe("C");
  });

  it("walks up the key's scale", () => {
    const rows = monoGuideRows("C").slice(-7).reverse();

    expect(rows).toEqual(["C", "D", "E", "F", "G", "A", "B"]);
  });

  it("follows the selected key", () => {
    expect(monoGuideRows("A").slice(-3).reverse()).toEqual(["A", "B", "C#"]);
  });
});

describe("controlGuideRows", () => {
  it("always describes how to open the menu and how to commit", () => {
    const rows = controlGuideRows({ looping: false, singleHanded: false });

    expect(rows.map((row) => row.does)).toEqual(["Menu", "Choose"]);
    expect(rows[0].gesture).toBe("✊✊ hold");
  });

  it("describes one fist, not two, when one hand drives the menu", () => {
    const rows = controlGuideRows({ looping: true, singleHanded: true });

    expect(rows[0].gesture).toBe("✊ hold");
  });

  it("adds the four flicks when the transport is reachable", () => {
    const rows = controlGuideRows({ looping: true, singleHanded: false });

    expect(rows.map((row) => row.does)).toEqual([
      "Menu",
      "Choose",
      "Play",
      "Clear",
      "Record",
      "Stop",
    ]);
  });

  it("leaves the transport out when looping is off, because there is none", () => {
    // The same reasoning the ring's contents follow: commands that would do
    // nothing are worse than no commands.
    expect(controlGuideRows({ looping: false, singleHanded: false })).toHaveLength(2);
  });

  it("leaves it out in one-handed staging, where one fist already means the menu", () => {
    expect(controlGuideRows({ looping: true, singleHanded: true })).toHaveLength(2);
  });
});

describe("the modifier row", () => {
  it("is absent when the map has no modifier", () => {
    const rows = chordGuideRows("C", CLASSIC_GESTURE_MAP);

    expect(rows.some((row) => row.note === "+1")).toBe(false);
  });

  it("lists the shape that shifts the next chord, as +1 rather than a note", () => {
    // Five fingers arms a transposition, so the guide has to say so: a shape
    // that plays nothing and does something else is worse than one that plays.
    const map = customMapFromSlots({
      ...EMPTY_SLOTS,
      byCount: ["I", null, null, null, "modifier"],
    });

    const row = chordGuideRows("C", map).find((candidate) => candidate.note === "+1");

    expect(row).toBeDefined();
    expect(row?.silent).toBe(false);
  });
});

describe("the re-strike row", () => {
  it("is listed when re-articulation is on, because a gesture nobody sees is one nobody finds", () => {
    const rows = controlGuideRows({ looping: true, singleHanded: false, rearticulate: true });

    expect(rows.map((row) => row.does)).toContain("Re-strike");
  });

  it("is absent when it is switched off", () => {
    const rows = controlGuideRows({ looping: true, singleHanded: false });

    expect(rows.map((row) => row.does)).not.toContain("Re-strike");
  });
});
