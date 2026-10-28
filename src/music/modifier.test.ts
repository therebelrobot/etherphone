import { describe, expect, it } from "vitest";
import { shiftNumeral } from "./gesture-map";
import { ModifierArmer } from "./modifier";

const MODIFIER = 31; // five fingers, as an example bitmask
const NEUTRAL = 1; // a shape the map plays nothing for
const CHORD = 3; // two fingers

describe("ModifierArmer", () => {
  it("plays nothing while the modifier is held", () => {
    const reading = new ModifierArmer().read(MODIFIER, null, MODIFIER);

    expect(reading.arming).toBe(true);
    expect(reading.shift).toBe(0);
  });

  it("arms once per visit, not once per frame", () => {
    // The bug this class exists to prevent. The chord hand holds one shape for as
    // long as the chord lasts, so a hand resting in the modifier for a second is
    // one arm — but counting frames would make it one per frame, and the numeral
    // arithmetic wraps at seven, so the shift would be arbitrary rather than
    // merely large.
    const armer = new ModifierArmer();

    for (let frame = 0; frame < 60; frame += 1) armer.read(MODIFIER, null, MODIFIER);

    expect(armer.armed).toBe(1);
  });

  it("gives the next chord one degree", () => {
    const armer = new ModifierArmer();
    armer.read(MODIFIER, null, MODIFIER);

    expect(armer.read(CHORD, "II", MODIFIER).shift).toBe(1);
  });

  it("holds the shift for as long as the chord shape is held", () => {
    // A shift that advanced per frame would snap back mid-chord, so the shift
    // belongs to the *shape*, not the frame — the same rule as the arming.
    const armer = new ModifierArmer();
    armer.read(MODIFIER, null, MODIFIER);

    const shifts = [0, 1, 2, 3].map(() => armer.read(CHORD, "II", MODIFIER).shift);

    expect(shifts).toEqual([1, 1, 1, 1]);
  });

  it("spends the shift on one chord shape, so the next chord is plain", () => {
    const armer = new ModifierArmer();
    armer.read(MODIFIER, null, MODIFIER);
    expect(armer.read(CHORD, "II", MODIFIER).shift).toBe(1);

    // A different chord is a fresh decision, not another shifted chord.
    expect(armer.read(7, "III", MODIFIER).shift).toBe(0);
  });

  it("lets a rest between two arms stand in for a chord", () => {
    // The way to reach the far side of the scale: the neutral shape plays
    // nothing, so it must not spend the arming — otherwise the second arm would
    // land on the rest and the chord after it would be plain.
    const armer = new ModifierArmer();

    armer.read(MODIFIER, null, MODIFIER);
    const rest = armer.read(NEUTRAL, null, MODIFIER);

    expect(rest.arming).toBe(false);
    expect(rest.shift).toBe(0);

    armer.read(MODIFIER, null, MODIFIER);

    expect(armer.armed).toBe(2);
  });

  it("moves two degrees when armed twice, which is how one shape reaches the far side", () => {
    const armer = new ModifierArmer();

    armer.read(MODIFIER, null, MODIFIER);
    armer.read(NEUTRAL, null, MODIFIER);
    armer.read(MODIFIER, null, MODIFIER);

    const shift = armer.read(CHORD, "II", MODIFIER).shift;

    expect(shift).toBe(2);
    expect(shiftNumeral("II", shift)).toBe("IV");
  });

  it("clears the shift in force when the hand leaves, so it cannot be re-applied", () => {
    const armer = new ModifierArmer();
    armer.read(MODIFIER, null, MODIFIER);
    expect(armer.read(CHORD, "II", MODIFIER).shift).toBe(1);

    expect(armer.read(null, null, MODIFIER).shift).toBe(0);
  });

  it("carries an armed shift through a dropout", () => {
    // The arming is a promise about the *next* chord, so a dropped frame must not
    // lose it. The shift in force belongs to a shape that is no longer there.
    const armer = new ModifierArmer();
    armer.read(MODIFIER, null, MODIFIER);

    armer.read(null, null, MODIFIER);

    expect(armer.read(CHORD, "II", MODIFIER).shift).toBe(1);
  });

  it("never arms when the map has no modifier", () => {
    for (const modifier of [null, undefined]) {
      const armer = new ModifierArmer();
      const reading = armer.read(MODIFIER, null, modifier);

      expect(reading.arming).toBe(false);
      expect(reading.shift).toBe(0);
      expect(armer.armed).toBe(0);
    }
  });

  it("forgets an armed shift when the vocabulary or hand changes", () => {
    const armer = new ModifierArmer();
    armer.read(MODIFIER, null, MODIFIER);

    armer.reset();

    expect(armer.armed).toBe(0);
    expect(armer.read(CHORD, "II", MODIFIER).shift).toBe(0);
  });
});
