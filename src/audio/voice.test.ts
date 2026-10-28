import { describe, expect, it } from "vitest";
import {
  frequenciesKey,
  getVoice,
  listVoices,
  listVoicesFor,
  registerVoice,
  voiceSupportsMode,
} from "./voice";
import type { Voice, VoiceDefinition } from "./voice";

/** A voice that does nothing, so the registry can be exercised in isolation. */
function silentVoice(): Voice {
  return {
    connect: () => undefined,
    play: () => true,
    release: () => undefined,
    dispose: () => undefined,
  };
}

describe("voice registry", () => {
  it("keeps registration order, which is picker order", () => {
    registerVoice({ id: "test-first", label: "First", kind: "oscillator", create: silentVoice });
    registerVoice({ id: "test-second", label: "Second", kind: "sampler", create: silentVoice });

    const ids = listVoices().map((voice) => voice.id);

    expect(ids.indexOf("test-first")).toBeLessThan(ids.indexOf("test-second"));
  });

  it("finds a registered voice by id", () => {
    registerVoice({ id: "test-lookup", label: "Lookup", kind: "wavetable", create: silentVoice });

    expect(getVoice("test-lookup")?.label).toBe("Lookup");
    expect(getVoice("test-lookup")?.kind).toBe("wavetable");
  });

  it("is undefined for an unknown id", () => {
    expect(getVoice("test-does-not-exist")).toBeUndefined();
  });

  it("refuses an id without a name", () => {
    expect(() =>
      registerVoice({ id: "", label: "Nameless", kind: "oscillator", create: silentVoice }),
    ).toThrow(/non-empty id/);
  });

  it("refuses to silently replace an existing voice", () => {
    registerVoice({
      id: "test-duplicate",
      label: "Original",
      kind: "oscillator",
      create: silentVoice,
    });

    expect(() =>
      registerVoice({
        id: "test-duplicate",
        label: "Impostor",
        kind: "oscillator",
        create: silentVoice,
      }),
    ).toThrow(/already registered/);

    expect(getVoice("test-duplicate")?.label).toBe("Original");
  });

  it("hands out a fresh voice on every create", () => {
    registerVoice({ id: "test-fresh", label: "Fresh", kind: "oscillator", create: silentVoice });

    const definition = getVoice("test-fresh")!;

    expect(definition.create()).not.toBe(definition.create());
  });
});

describe("frequenciesKey", () => {
  it("is stable across frames for the same notes", () => {
    expect(frequenciesKey([110, 220, 330])).toBe(frequenciesKey([110, 220, 330]));
  });

  it("separates different chords", () => {
    expect(frequenciesKey([110, 220])).not.toBe(frequenciesKey([220, 110]));
  });

  it("ignores sub-audible float noise", () => {
    expect(frequenciesKey([220])).toBe(frequenciesKey([220.00001]));
  });
});

describe("modes", () => {
  const definition = (id: string, modes?: readonly ("chord" | "mono")[]): VoiceDefinition => ({
    id,
    label: id,
    kind: "oscillator",
    ...(modes ? { modes } : {}),
    create: () => ({ connect: () => {}, play: () => true, release: () => {}, dispose: () => {} }),
  });

  it("lets a voice that says nothing play either mode", () => {
    const anything = definition("anything");

    expect(voiceSupportsMode(anything, "chord")).toBe(true);
    expect(voiceSupportsMode(anything, "mono")).toBe(true);
  });

  it("keeps a voice to the modes it names", () => {
    const monoOnly = definition("mono-only", ["mono"]);

    expect(voiceSupportsMode(monoOnly, "mono")).toBe(true);
    expect(voiceSupportsMode(monoOnly, "chord")).toBe(false);
  });

  it("offers only what can play the mode in force, in registration order", () => {
    // A kit is the case this exists for: it has no pitch, so the chord picker
    // must not offer it.
    registerVoice(definition("test-kit", ["mono"]));
    registerVoice(definition("test-lead", ["mono"]));
    registerVoice(definition("test-both"));

    const mono = listVoicesFor("mono").map((voice) => voice.id);
    const chord = listVoicesFor("chord").map((voice) => voice.id);

    expect(mono).toContain("test-kit");
    expect(mono).toContain("test-lead");
    expect(chord).not.toContain("test-kit");
    expect(chord).toContain("test-both");
  });
});
