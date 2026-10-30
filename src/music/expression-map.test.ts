import { describe, expect, it } from "vitest";
import {
  decodeExpressionMap,
  DEFAULT_EXPRESSION_MAP,
  describePose,
  encodeExpressionMap,
  EXPRESSION_POSES,
  poseShape,
  qualityForPose,
  withPose,
} from "./expression-map";
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

describe("describePose", () => {
  it("counts the long fingers and names the thumb separately", () => {
    // A player counts the fingers that fold; the thumb is out or it is not.
    expect(describePose(shapeFromFingers({ index: true }))).toBe("1 finger");
    expect(describePose(shapeFromFingers({ index: true, middle: true }))).toBe("2 fingers");
    expect(describePose(shapeFromFingers({ thumb: true, index: true }))).toBe("1 finger + thumb");
  });

  it("gives a closed hand and a lone thumb their own names", () => {
    expect(describePose(shapeFromFingers({}))).toBe("Closed hand");
    expect(describePose(shapeFromFingers({ thumb: true }))).toBe("Thumb out");
  });

  it("names every pose the editor offers", () => {
    for (const pose of EXPRESSION_POSES) {
      expect(describePose(poseShape(pose))).toMatch(/finger|thumb/i);
    }
  });
});

describe("withPose", () => {
  it("replaces one pose and leaves the rest alone", () => {
    const before = DEFAULT_EXPRESSION_MAP;
    const after = withPose(before, poseShape({ index: true }), "sus4");

    expect(qualityForPose(after, poseShape({ index: true }))).toBe("sus4");
    expect(after.qualities.size).toBe(before.qualities.size);
    // The map it came from is untouched, so nothing observes a half-edited
    // vocabulary mid-frame.
    expect(qualityForPose(before, poseShape({ index: true }))).toBe("octave");
  });

  it("unmaps a pose when the kind is nothing, which is how a pose goes silent", () => {
    const after = withPose(DEFAULT_EXPRESSION_MAP, poseShape({ index: true }), null);

    expect(qualityForPose(after, poseShape({ index: true }))).toBeNull();
    expect(after.qualities.size).toBe(DEFAULT_EXPRESSION_MAP.qualities.size - 1);
  });
});

describe("stored maps", () => {
  it("round-trips every pose and kind", () => {
    const stored = encodeExpressionMap(DEFAULT_EXPRESSION_MAP);
    const read = decodeExpressionMap(stored);

    expect(read?.qualities).toEqual(DEFAULT_EXPRESSION_MAP.qualities);
  });

  it("round-trips an edit, which is the whole point of storing one", () => {
    const edited = withPose(DEFAULT_EXPRESSION_MAP, poseShape({ middle: true }), "sus4");

    expect(decodeExpressionMap(encodeExpressionMap(edited))?.qualities).toEqual(edited.qualities);
  });

  it("returns null for text that is not a map, so a caller can tell it from an empty one", () => {
    expect(decodeExpressionMap("not json")).toBeNull();
    expect(decodeExpressionMap("[1,2]")).toBeNull();
    expect(decodeExpressionMap("null")).toBeNull();
  });

  it("drops entries a hand cannot make or the catalogue cannot sound", () => {
    // Storage outlives a catalogue. Losing one pose is a smaller failure than
    // losing the whole vocabulary to a single stale id.
    const read = decodeExpressionMap('{"2":"octave","99":"sus2","6":"not-a-kind"}');

    expect(read?.qualities.get(2)).toBe("octave");
    expect(read?.qualities.has(99)).toBe(false);
    expect(read?.qualities.has(6)).toBe(false);
  });
});
