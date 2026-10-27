import { describe, expect, it } from "vitest";
import { TRANSPORT_GESTURE } from "../config/constants";
import type { Hand } from "../types";
import { commandForDirection, TransportGesture } from "./transport-gesture";

const ARM = TRANSPORT_GESTURE.armMs;
const FLICK = TRANSPORT_GESTURE.flickMs;
const TRAVEL = TRANSPORT_GESTURE.travel;

/** The joint pair that decides whether a finger is extended. */
const FINGERS = [
  { pip: 6, tip: 8 },
  { pip: 10, tip: 12 },
  { pip: 14, tip: 16 },
  { pip: 18, tip: 20 },
] as const;

/**
 * A closed fist whose palm centre sits at `(cx, cy)`.
 *
 * `getHandCenter` is the midpoint of the wrist and the middle knuckle, so those
 * straddle the centre and every finger tip sits below its joint.
 */
function fist(cx: number, cy: number): Hand {
  const hand: Hand = Array.from({ length: 21 }, () => ({ x: cx, y: cy, z: 0, visibility: 1 }));
  const set = (index: number, x: number, y: number): void => {
    hand[index] = { x, y, z: 0, visibility: 1 };
  };

  set(0, cx, cy + 0.075);
  set(9, cx, cy - 0.075);
  set(13, cx + 0.02, cy - 0.075);

  for (const { pip, tip } of FINGERS) {
    set(pip, cx, cy + 0.02);
    set(tip, cx, cy + 0.06);
  }

  return hand;
}

/** A fist that has settled: armed, waiting to flick. */
function settled(reader: TransportGesture): void {
  reader.update(fist(0.5, 0.5), 0);
  reader.update(fist(0.5, 0.5), ARM);
}

describe("commandForDirection", () => {
  it("reads the four screen directions", () => {
    expect(commandForDirection(0, -0.2)).toBe("record");
    expect(commandForDirection(0, 0.2)).toBe("stop");
    expect(commandForDirection(0.2, 0)).toBe("play");
    expect(commandForDirection(-0.2, 0)).toBe("clear");
  });

  it("lets the dominant axis win", () => {
    expect(commandForDirection(0.05, -0.2)).toBe("record");
    expect(commandForDirection(0.2, -0.05)).toBe("play");
  });

  it("treats an exact diagonal as vertical, so the common pair wins", () => {
    expect(commandForDirection(0.2, -0.2)).toBe("record");
  });
});

describe("TransportGesture", () => {
  it("does nothing without a hand", () => {
    const reader = new TransportGesture();
    const reading = reader.update(null, 0);

    expect(reading.command).toBeNull();
    expect(reading.ready).toBe(false);
  });

  it("arms on the close before it will read anything", () => {
    const reader = new TransportGesture();

    expect(reader.update(fist(0.5, 0.5), 0).ready).toBe(false);
    expect(reader.update(fist(0.5, 0.5), ARM - 1).ready).toBe(false);
    expect(reader.update(fist(0.5, 0.5), ARM).ready).toBe(true);
  });

  it("does not read the motion of closing the hand as a flick", () => {
    const reader = new TransportGesture();

    // The wrist travels a long way as the hand closes.
    reader.update(fist(0.5, 0.5), 0);
    reader.update(fist(0.5, 0.3), 20);
    expect(reader.update(fist(0.5, 0.1), 40).command).toBeNull();

    // Settled here, so this is where a flick is measured from.
    reader.update(fist(0.5, 0.1), ARM + 50);
    expect(reader.update(fist(0.5, 0.05), ARM + 60).command).toBeNull();
  });

  it("reads a short move inside the threshold as nothing", () => {
    const reader = new TransportGesture();
    settled(reader);

    const reading = reader.update(fist(0.5, 0.5 - TRAVEL / 2), ARM + 50);
    expect(reading.command).toBeNull();
    expect(reading.ready).toBe(true);
  });

  it("reads up as record and down as stop", () => {
    const up = new TransportGesture();
    settled(up);
    expect(up.update(fist(0.5, 0.28), ARM + 80).command).toBe("record");

    const down = new TransportGesture();
    settled(down);
    expect(down.update(fist(0.5, 0.72), ARM + 80).command).toBe("stop");
  });

  it("reads a flick to the player's right as play, past the mirrored frame", () => {
    const reader = new TransportGesture();
    settled(reader);

    // The frame is drawn mirrored, so a flick to the player's own right is a
    // *falling* landmark x.
    expect(reader.update(fist(0.5 - 0.25, 0.5), ARM + 80).command).toBe("play");
  });

  it("reads a flick to the player's left as clear", () => {
    const reader = new TransportGesture();
    settled(reader);

    expect(reader.update(fist(0.5 + 0.25, 0.5), ARM + 80).command).toBe("clear");
  });

  it("fires once for one flick, and only after the hand opens", () => {
    const reader = new TransportGesture();
    settled(reader);

    expect(reader.update(fist(0.5, 0.28), ARM + 80).command).toBe("record");
    expect(reader.update(fist(0.5, 0.1), ARM + 120).command).toBeNull();
    expect(reader.update(fist(0.5, 0.05), ARM + 160).ready).toBe(false);

    // Opening the hand re-arms it.
    expect(reader.update(null, ARM + 200).command).toBeNull();
    reader.update(fist(0.5, 0.5), 400);
    reader.update(fist(0.5, 0.5), 400 + ARM);
    expect(reader.update(fist(0.5, 0.28), 400 + ARM + 80).command).toBe("record");
  });

  it("treats a slow drift as no flick, and re-anchors so the fist can stay closed", () => {
    const reader = new TransportGesture();
    settled(reader);

    // Far past the flick window: this is a drift, so it re-anchors rather than
    // firing on the distance travelled.
    expect(reader.update(fist(0.5, 0.65), ARM + FLICK + 50).command).toBeNull();
    // And a small move from the new anchor is still nothing.
    expect(reader.update(fist(0.5, 0.68), ARM + FLICK + 100).command).toBeNull();
  });

  it("forgets the fist on reset", () => {
    const reader = new TransportGesture();
    settled(reader);
    reader.reset();

    expect(reader.update(fist(0.5, 0.28), ARM + 80).command).toBeNull();
  });
});
