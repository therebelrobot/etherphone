import { describe, expect, it } from "vitest";
import { HandAnimator } from "./animator";
import { resolvePose } from "./pose";

const OPEN = { fingers: { thumb: 0, index: 0, middle: 0, ring: 0, pinky: 0 } } as const;
const CLOSED = {} as const;

/** Runs an animator at 60 Hz until `until`, returning the index finger's curl each frame. */
function run(animator: HandAnimator, from: number, until: number): number[] {
  const curls: number[] = [];
  for (let now = from; now <= until; now += 1000 / 60) curls.push(animator.update(now).curl.index);
  return curls;
}

describe("HandAnimator", () => {
  it("starts in the pose it is given rather than animating in", () => {
    const animator = new HandAnimator(OPEN);

    expect(animator.update(0).curl.index).toBe(0);
    expect(animator.isSettled).toBe(true);
  });

  it("closes a hand without overshooting, and arrives", () => {
    const animator = new HandAnimator(OPEN);
    animator.update(0);
    animator.setTarget(CLOSED);

    const curls = run(animator, 0, 1500);

    for (let i = 1; i < curls.length; i += 1) {
      expect(curls[i]).toBeGreaterThanOrEqual(curls[i - 1]);
      // A finger past fully closed would bend backwards into the palm.
      expect(curls[i]).toBeLessThanOrEqual(1);
    }
    expect(curls.at(-1)).toBe(1);
    expect(animator.isSettled).toBe(true);
  });

  it("is most of the way there in a third of a second, so the pose reads at once", () => {
    const animator = new HandAnimator(OPEN);
    animator.update(0);
    animator.setTarget(CLOSED);
    run(animator, 0, 330);

    expect(animator.pose.curl.index).toBeGreaterThan(0.9);
  });

  it("moves the little finger a beat behind the index, as a hand closes", () => {
    const animator = new HandAnimator(OPEN);
    animator.update(0);
    animator.setTarget(CLOSED);
    run(animator, 0, 100);

    expect(animator.pose.curl.index).toBeGreaterThan(animator.pose.curl.pinky);
  });

  it("takes a new target mid-flight without a jump", () => {
    const animator = new HandAnimator(OPEN);
    animator.update(0);
    animator.setTarget(CLOSED);
    run(animator, 0, 100);

    const before = animator.pose.curl.index;
    animator.setTarget(OPEN);
    const after = animator.update(100 + 1000 / 60).curl.index;

    expect(Math.abs(after - before)).toBeLessThan(0.15);
  });

  it("jumps instead of moving when asked to, for less motion", () => {
    const animator = new HandAnimator(OPEN, { instant: true });
    animator.update(0);
    animator.setTarget(CLOSED);

    expect(animator.pose.curl.index).toBe(1);
  });

  it("jumps when the hand changes, because a left hand cannot become a right one", () => {
    const animator = new HandAnimator({ ...OPEN, hand: "left" });
    animator.update(0);
    animator.setTarget({ ...CLOSED, hand: "right" });

    expect(animator.pose.hand).toBe("right");
    expect(animator.pose.curl.index).toBe(1);
  });

  it("does not fling the hand after a stalled frame", () => {
    const animator = new HandAnimator(OPEN);
    animator.update(0);
    animator.setTarget(CLOSED);
    animator.update(10_000);

    // One step, capped: part of the way, not teleported to the end.
    expect(animator.pose.curl.index).toBeLessThan(1);
  });

  it("accepts a resolved pose as well as a spec", () => {
    const animator = new HandAnimator(resolvePose({ facing: "back" }));

    expect(animator.pose.facing).toBe(1);
  });
});

describe("HandAnimator and tilt", () => {
  it("leans the hand over to a new tilt rather than snapping to it", () => {
    const animator = new HandAnimator({ tilt: "upright" });
    animator.update(0);
    animator.setTarget({ tilt: "inward" });
    animator.update(50);

    expect(animator.pose.tilt).toBeGreaterThan(0);
    expect(animator.pose.tilt).toBeLessThan(1);
  });
});
