import { describe, expect, it } from "vitest";
import { ALL_SHAPES, countFingers, ROCK_SIGN, ROCK_SIGN_THUMB } from "./gesture-map";
import { CLASSIC_GESTURE_MAP, PENTATONIC_GESTURE_MAP, TRIAD_GESTURE_MAP } from "./gesture-map";
import {
  CUSTOM_MAP_ID,
  CUSTOM_MAP_SLOTS,
  describeSlotTarget,
  customMapFromSlots,
  decodeCustomMap,
  EMPTY_SLOTS,
  hashForCustomMap,
  encodeCustomMap,
  isSilentMap,
  slotsFromMap,
  slotsFromHash,
} from "./custom-map";
import type { CustomMapSlots } from "./custom-map";

const TRIAD_SLOTS: CustomMapSlots = {
  byCount: ["I", "IV", "V", null, null],
  rockSign: null,
  rockSignThumb: null,
};

describe("slotsFromMap", () => {
  it("reads the classic map back into seven slots", () => {
    expect(slotsFromMap(CLASSIC_GESTURE_MAP)).toEqual({
      byCount: ["I", "II", "III", "IV", "V"],
      rockSign: "VI",
      rockSignThumb: "VII",
    });
  });

  it("keeps a map's silences, which is the whole point of editing from a preset", () => {
    const slots = slotsFromMap(TRIAD_GESTURE_MAP);

    expect(slots.byCount).toEqual(["I", "IV", "V", null, null]);
  });

  it("lets the rock signs inherit the count rule when the map has no specials", () => {
    // Triad never names the rock signs, so they are just two- and three-finger
    // shapes — which is exactly what the live instrument does with them.
    const slots = slotsFromMap(TRIAD_GESTURE_MAP);

    expect(slots.rockSign).toBe("IV");
    expect(slots.rockSignThumb).toBe("V");
  });

  it("reads a pentatonic map without inventing a numeral for a silent count", () => {
    const slots = slotsFromMap(PENTATONIC_GESTURE_MAP);

    expect(slots.byCount).toHaveLength(5);
    expect(slots.byCount.every((numeral) => numeral !== null)).toBe(true);
  });
});

describe("customMapFromSlots", () => {
  it("is the custom map, and says so by id", () => {
    expect(customMapFromSlots(TRIAD_SLOTS).id).toBe(CUSTOM_MAP_ID);
  });

  it("round-trips through the slots it was built from", () => {
    expect(slotsFromMap(customMapFromSlots(TRIAD_SLOTS))).toEqual(TRIAD_SLOTS);
  });

  it("treats any shape with a count as that count, so a hand does not have to be exact", () => {
    // Two fingers is two fingers, whichever two they are — the forgiving
    // behaviour the presets already have, kept for the map the player builds.
    const map = customMapFromSlots(TRIAD_SLOTS);

    for (const shape of ALL_SHAPES) {
      if (countFingers(shape) !== 2) continue;
      if (shape === ROCK_SIGN || shape === ROCK_SIGN_THUMB) continue;
      expect(map.shapes.get(shape)).toBe("IV");
    }
  });

  it("lets the two rock signs win over the count rule, since both are two fingers", () => {
    const map = customMapFromSlots({ ...TRIAD_SLOTS, rockSign: "vii" });

    expect(map.shapes.get(ROCK_SIGN)).toBe("vii");
    expect(map.shapes.get(ROCK_SIGN_THUMB)).toBeNull();
  });

  it("plays nothing for a slot left empty", () => {
    const map = customMapFromSlots(EMPTY_SLOTS);
    const playable = ALL_SHAPES.filter((shape) => map.shapes.get(shape) !== null);

    expect(playable).toEqual([]);
  });
});

describe("encoding", () => {
  it("writes seven characters, one per slot", () => {
    expect(encodeCustomMap(TRIAD_SLOTS)).toHaveLength(7);
    expect(encodeCustomMap(TRIAD_SLOTS)).toBe("1450000");
  });

  it("keeps the mode in the case of the numeral", () => {
    const minor: CustomMapSlots = {
      byCount: ["i", "iv", "v", null, null],
      rockSign: "vi",
      rockSignThumb: null,
    };

    // count 1–5, then rock, then rock+thumb: a, d, e, 0, 0, f, 0.
    expect(encodeCustomMap(minor)).toBe("ade00f0");
    expect(decodeCustomMap(encodeCustomMap(minor))).toEqual(minor);
  });

  it("round-trips every map the presets can produce", () => {
    for (const map of [CLASSIC_GESTURE_MAP, TRIAD_GESTURE_MAP, PENTATONIC_GESTURE_MAP]) {
      const slots = slotsFromMap(map);
      expect(decodeCustomMap(encodeCustomMap(slots))).toEqual(slots);
    }
  });

  it("round-trips an empty map, so clearing is representable", () => {
    expect(decodeCustomMap(encodeCustomMap(EMPTY_SLOTS))).toEqual(EMPTY_SLOTS);
  });

  it("refuses a string of the wrong length", () => {
    expect(decodeCustomMap("145")).toBeNull();
    expect(decodeCustomMap("14500000")).toBeNull();
  });

  it("refuses a character it does not know rather than reading it as silence", () => {
    // A silently-misread character would change the map without saying so.
    expect(decodeCustomMap("14500zz")).toBeNull();
  });

  it("ignores surrounding whitespace, so a pasted string works", () => {
    expect(decodeCustomMap("  1450000\n")).toEqual(TRIAD_SLOTS);
  });
});

describe("isSilentMap", () => {
  it("knows an untouched map is not a map yet", () => {
    expect(isSilentMap(EMPTY_SLOTS)).toBe(true);
  });

  it("is satisfied by a single degree", () => {
    expect(isSilentMap({ ...EMPTY_SLOTS, byCount: [null, null, null, "IV", null] })).toBe(false);
  });
});

describe("sharing a map by link", () => {
  it("writes the map into the fragment, so it never reaches a server", () => {
    expect(hashForCustomMap(TRIAD_SLOTS)).toBe("#map=1450000");
  });

  it("reads a map back out of a bare fragment", () => {
    expect(slotsFromHash("#map=1450000")).toEqual(TRIAD_SLOTS);
  });

  it("finds the map among other fragment parameters", () => {
    expect(slotsFromHash("#map=1450000&other=1")).toEqual(TRIAD_SLOTS);
    expect(slotsFromHash("#other=1&map=1450000")).toEqual(TRIAD_SLOTS);
  });

  it("returns null when there is no map in the fragment", () => {
    expect(slotsFromHash("")).toBeNull();
    expect(slotsFromHash("#other=1")).toBeNull();
    expect(slotsFromHash("#map=nonsense")).toBeNull();
  });
});

describe("the modifier slot", () => {
  const WITH_MODIFIER: CustomMapSlots = {
    byCount: ["I", "IV", "V", null, "modifier"],
    rockSign: null,
    rockSignThumb: null,
  };

  it("makes that shape arm a transposition instead of playing", () => {
    const map = customMapFromSlots(WITH_MODIFIER);

    // The shape plays nothing of its own...
    for (const shape of ALL_SHAPES) {
      if (countFingers(shape) !== 5) continue;
      expect(map.shapes.get(shape)).toBeNull();
    }
    // ...and the map says which shape arms instead.
    expect(map.transposeShape).toBe(CUSTOM_MAP_SLOTS.find((slot) => slot.id === "count-5")?.shape);
  });

  it("is not armed by a map that has no modifier", () => {
    expect(customMapFromSlots(TRIAD_SLOTS).transposeShape).toBeNull();
  });

  it("survives the round trip, so editing does not quietly disarm it", () => {
    const slots = slotsFromMap(customMapFromSlots(WITH_MODIFIER));

    expect(slots.byCount[4]).toBe("modifier");
    expect(slots).toEqual(WITH_MODIFIER);
  });

  it("keeps the seven-character encoding, with one more letter in the alphabet", () => {
    const encoded = encodeCustomMap(WITH_MODIFIER);

    expect(encoded).toHaveLength(7);
    expect(encoded).toBe("1450m00");
    expect(decodeCustomMap(encoded)).toEqual(WITH_MODIFIER);
  });

  it("travels in a shared link", () => {
    expect(slotsFromHash(hashForCustomMap(WITH_MODIFIER))).toEqual(WITH_MODIFIER);
  });

  it("still counts as a map that plays nothing on its own", () => {
    expect(isSilentMap({ ...EMPTY_SLOTS, byCount: [null, null, null, null, "modifier"] })).toBe(
      true,
    );
  });

  it("names itself in the editor", () => {
    expect(describeSlotTarget("modifier")).toBe("Modifier");
    expect(describeSlotTarget(null)).toBe("—");
    expect(describeSlotTarget("IV")).toBe("IV");
  });
});
