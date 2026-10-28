import { describe, expect, it } from "vitest";
import { ARTICULATION } from "../config/constants";
import { ArticulationGesture } from "./articulation-gesture";

/** The resting depth the baselines below start from. */
const REST = 0.1;
/** Deep enough to count as a push. */
const PUSHED = REST - ARTICULATION.pushDepth;

describe("ArticulationGesture", () => {
  it("says nothing without a pitch hand", () => {
    expect(new ArticulationGesture().update(null, 0).fired).toBe(false);
  });

  it("never fires on the frame a hand appears, so opening into frame is not a push", () => {
    // The first frame has no baseline to measure against, and a hand that arrives
    // already forward is not a deliberate push.
    expect(new ArticulationGesture().update(REST - 0.5, 0).fired).toBe(false);
  });

  it("fires once when the hand pushes forward", () => {
    const gesture = new ArticulationGesture();
    gesture.update(REST, 0);

    expect(gesture.update(PUSHED, 100).fired).toBe(true);
  });

  it("does not fire again while the hand stays pushed", () => {
    const gesture = new ArticulationGesture();
    gesture.update(REST, 0);
    gesture.update(PUSHED, 100);

    // A drum roll nobody asked for: the baseline must not catch up mid-push.
    for (let t = 200; t < 4000; t += 100) {
      expect(gesture.update(PUSHED, t).fired, `at ${t}ms`).toBe(false);
    }
  });

  it("fires again once the hand comes back out and pushes a second time", () => {
    const gesture = new ArticulationGesture();
    gesture.update(REST, 0);
    expect(gesture.update(PUSHED, 100).fired).toBe(true);

    // Back out past the release threshold, which is what re-arms it.
    gesture.update(REST, 200);

    expect(gesture.update(PUSHED, 400).fired).toBe(true);
  });

  it("will not fire twice inside the minimum interval, however it moves", () => {
    const gesture = new ArticulationGesture();
    gesture.update(REST, 0);
    gesture.update(PUSHED, 100);

    gesture.update(REST, 110);

    expect(gesture.update(PUSHED, 150).fired).toBe(false);
  });

  it("reports how far into the push the hand is", () => {
    const gesture = new ArticulationGesture();
    gesture.update(REST, 0);

    const halfway = gesture.update(REST - ARTICULATION.pushDepth / 2, 100);
    const full = gesture.update(PUSHED, 200);

    expect(halfway.progress).toBeGreaterThan(0.3);
    expect(halfway.progress).toBeLessThan(0.7);
    expect(full.progress).toBe(1);
  });

  it("does not read a hand drifting across the frame as a push", () => {
    const gesture = new ArticulationGesture();
    gesture.update(REST, 0);

    // A slow, shallow drift, the shape of a hand reaching for a low note.
    for (let t = 0; t < 3000; t += 100) {
      expect(gesture.update(REST - 0.01, t).fired, `at ${t}ms`).toBe(false);
    }
  });

  it("forgets the baseline on reset, so the next hand is measured fresh", () => {
    const gesture = new ArticulationGesture();
    gesture.update(REST, 0);

    gesture.reset();

    // The first frame after a reset cannot fire, by the same rule as the first —
    // and it becomes the new resting point.
    expect(gesture.update(PUSHED, 100).fired).toBe(false);
    expect(gesture.update(PUSHED, 200).fired).toBe(false);

    // A push *from there* does fire, which is the thing reset is for: a hand that
    // rests somewhere unusual can still articulate.
    expect(gesture.update(PUSHED - ARTICULATION.pushDepth, 300).fired).toBe(true);
  });

  it("takes its thresholds as options, so the feel is one place to change", () => {
    const gentle = new ArticulationGesture({
      ...ARTICULATION,
      pushDepth: ARTICULATION.pushDepth / 3,
    });
    gentle.update(REST, 0);

    // A push too small for the default cuts it here.
    expect(gentle.update(REST - ARTICULATION.pushDepth / 2, 100).fired).toBe(true);
  });
});
