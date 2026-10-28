import { describe, expect, it } from "vitest";
import { describeDeviceError, INSECURE_CONTEXT_MESSAGES } from "./media";

function domError(name: string): Error {
  const error = new Error(name);
  error.name = name;
  return error;
}

describe("describeDeviceError", () => {
  it("blames the page, not the device, when the context is insecure", () => {
    for (const device of ["camera", "microphone"] as const) {
      expect(describeDeviceError(domError("NotFoundError"), false, device)).toBe(
        INSECURE_CONTEXT_MESSAGES[device],
      );
    }
  });

  it("names the device it is actually talking about", () => {
    // The two devices must not share a sentence: a player told their camera was
    // blocked when they asked for the microphone has been given a wrong fact.
    expect(describeDeviceError(domError("NotAllowedError"), true, "microphone")).toContain(
      "Microphone permission",
    );
    expect(describeDeviceError(domError("NotAllowedError"), true, "camera")).toContain(
      "Camera permission",
    );
  });

  it("says there is none when there is none", () => {
    expect(describeDeviceError(domError("NotFoundError"), true, "microphone")).toBe(
      "No microphone was found. Connect one, then reload the page.",
    );
  });

  it("says the device is busy when another application holds it", () => {
    expect(describeDeviceError(domError("NotReadableError"), true, "camera")).toContain(
      "already in use",
    );
  });

  it("falls back to something actionable", () => {
    expect(describeDeviceError(domError("WeirdError"), true, "microphone")).toContain(
      "Reload the page",
    );
    expect(describeDeviceError("not an error", true, "microphone")).toContain("Reload the page");
  });
});
