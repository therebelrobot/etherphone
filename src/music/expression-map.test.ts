import { describe, expect, it } from "vitest";
import { DEFAULT_EXPRESSION_MAP, qualityForPose } from "./expression-map";
import { shapeFromFingers } from "./gesture-map";
import { getQuality } from "./qualities";

describe("DEFAULT_EXPRESSION_MAP", () => {
  it("keeps the inherited bank exactly as it was: one to four fingers, unchanged", () => {
    // The default must not be a new instrument wearing the old one's clothes. These
    // four ids are the four voicings one to four fingers used to select.
    expect(qualityForPose(DEFAULT_EXPRESSION_MAP, shapeFromFingers({ index: true }))).toBe(
      "octave",
    );
    expect(
      qualityForPose(DEFAULT_EXPRESSION_MAP, shapeFromFingers({ index: true, middle: true })),
    ).toBe("inv1");
    expect(
      qualityForPose(
        DEFAULT_EXPRESSION_MAP,
        shapeFromFingers({ index: true, middle: true, ring: true }),
      ),
    ).toBe("add7");
    expect(
      qualityForPose(
        DEFAULT_EXPRESSION_MAP,
        shapeFromFingers({ index: true, middle: true, ring: true, pinky: true }),
      ),
    ).toBe("seventh");
  });

  it("gives the thumb out a second bank of four", () => {
    // This is what freeing the thumb buys: four poses became eight, which is
    // enough for a vocabulary rather than a choice of four.
    expect(
      qualityForPose(DEFAULT_EXPRESSION_MAP, shapeFromFingers({ thumb: true, index: true })),
    ).toBe("sus2");
    expect(
      qualityForPose(
        DEFAULT_EXPRESSION_MAP,
        shapeFromFingers({ thumb: true, index: true, middle: true }),
      ),
    ).toBe("sus4");
    expect(
      qualityForPose(
        DEFAULT_EXPRESSION_MAP,
        shapeFromFingers({ thumb: true, index: true, middle: true, ring: true }),
      ),
    ).toBe("add9");
    expect(
      qualityForPose(
        DEFAULT_EXPRESSION_MAP,
        shapeFromFingers({ thumb: true, index: true, middle: true, ring: true, pinky: true }),
      ),
    ).toBe("add7-9");
  });

  it("names only qualities the catalogue actually has", () => {
    // A map is stored data, so a typo in an id is a silent failure: the pose would
    // simply play nothing, with no error anywhere. This is the test that makes the
    // two tables agree.
    for (const [pose, id] of DEFAULT_EXPRESSION_MAP.qualities) {
      expect(getQuality(id), `pose ${pose} names "${id}"`).toBeDefined();
    }
  });

  it("reaches every quality a suspended chord needs, which the count alone could not", () => {
    const ids = new Set(DEFAULT_EXPRESSION_MAP.qualities.values());

    expect(ids).toContain("sus2");
    expect(ids).toContain("sus4");
  });

  it("does not give one pose two qualities", () => {
    // A Map cannot hold the same key twice, so this is really a guard on
    // `posesFrom`: two specs that happen to describe the same shape must not
    // silently overwrite each other.
    const specs = DEFAULT_EXPRESSION_MAP.qualities;

    expect(specs.size).toBe(8);
  });
});

describe("qualityForPose", () => {
  it("plays nothing for a pose the map does not name", () => {
    // A closed hand is the resting pose, and it must stay silent.
    expect(qualityForPose(DEFAULT_EXPRESSION_MAP, shapeFromFingers({}))).toBeNull();
    expect(qualityForPose(DEFAULT_EXPRESSION_MAP, shapeFromFingers({ middle: true }))).toBeNull();
  });
});
