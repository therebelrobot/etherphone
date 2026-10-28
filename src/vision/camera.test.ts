import { describe, expect, it } from "vitest";
import { describeCameraError, INSECURE_CONTEXT_MESSAGE } from "./camera";

/** A `DOMException`-ish error, which is what `getUserMedia` rejects with. */
function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

describe("describeCameraError", () => {
  it("blames the page, not the camera, when the context is insecure", () => {
    // The whole point of checking this first: a refusal over plain HTTP has no
    // error name to read, so the message has to come from the context.
    expect(describeCameraError(domError("NotFoundError"), false)).toBe(INSECURE_CONTEXT_MESSAGE);
    expect(describeCameraError(new Error("anything"), false)).toBe(INSECURE_CONTEXT_MESSAGE);
  });

  it("tells the player to allow permission when it was denied", () => {
    for (const name of ["NotAllowedError", "SecurityError"]) {
      expect(describeCameraError(domError(name), true)).toContain("permission");
    }
  });

  it("says there is no camera when there is none", () => {
    for (const name of ["NotFoundError", "OverconstrainedError"]) {
      expect(describeCameraError(domError(name), true)).toContain("No camera was found");
    }
  });

  it("says the camera is busy when another application holds it", () => {
    expect(describeCameraError(domError("NotReadableError"), true)).toContain("already in use");
  });

  it("falls back to something actionable for anything else", () => {
    const message = describeCameraError(domError("WeirdError"), true);
    expect(message).toContain("Reload the page");
  });

  it("survives a thrown non-Error", () => {
    expect(describeCameraError("nope", true)).toContain("Reload the page");
  });
});
