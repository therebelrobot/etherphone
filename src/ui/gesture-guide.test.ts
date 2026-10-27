import { describe, expect, it } from "vitest";
import { CLASSIC_GESTURE_MAP, TRIAD_GESTURE_MAP } from "../music/gesture-map";
import { PITCH_SPAN_DEGREES } from "../music/mono";
import { chordGuideRows, monoGuideRows } from "./gesture-guide";

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
    // Triad is I, IV, and V, so the guide lists those three and nothing else.
    expect(chordGuideRows("C", TRIAD_GESTURE_MAP).map((row) => row.note)).toEqual(["C", "F", "G"]);
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
