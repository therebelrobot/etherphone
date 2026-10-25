import { describe, expect, it } from "vitest";
import { defineUserWavetable } from "./user-voices";

/** One cycle of a sine, sampled `length` times. */
function sineCycle(length: number): Float32Array {
  const samples = new Float32Array(length);
  for (let n = 0; n < length; n += 1) {
    samples[n] = Math.sin((2 * Math.PI * n) / length);
  }
  return samples;
}

describe("defineUserWavetable", () => {
  it("wraps a loaded cycle as a playable definition", () => {
    const definition = defineUserWavetable("cello-body.wav", sineCycle(512));

    expect(definition.kind).toBe("wavetable");
    expect(definition.label).toBe("cello-body.wav");
    expect(definition.id).toMatch(/^wavetable-user-\d+$/);
  });

  it("gives every loaded table its own id", () => {
    const first = defineUserWavetable("one.wav", sineCycle(512));
    const second = defineUserWavetable("two.wav", sineCycle(512));

    expect(first.id).not.toBe(second.id);
  });

  it("builds a voice with no audio context in sight", () => {
    // Everything but `connect` is context-free by design, which is what lets a
    // definition be registered before the start gate is clicked.
    const voice = defineUserWavetable("a.wav", sineCycle(512)).create();

    expect(typeof voice.connect).toBe("function");
    expect(typeof voice.play).toBe("function");
    voice.release();
    voice.dispose();
  });
});
