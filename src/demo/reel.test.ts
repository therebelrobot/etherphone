import { describe, expect, it, vi } from "vitest";
import { DemoReel } from "./reel";

function tab() {
  const listeners: ((event: { stopPropagation(): void }) => void)[] = [];
  const attributes = new Map<string, string>();

  return {
    attributes,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    addEventListener: (_type: string, listener: (event: { stopPropagation(): void }) => void) =>
      listeners.push(listener),
    /** Clicks the tab; reports whether the click would have reached the overlay. */
    click(): boolean {
      let stopped = false;
      for (const listener of listeners) listener({ stopPropagation: () => (stopped = true) });
      return !stopped;
    },
  };
}

function setup() {
  const demos = [0, 1].map(() => ({ start: vi.fn(), stop: vi.fn(), restart: vi.fn() }));
  const tabs = [tab(), tab()];
  const canvas = tab();
  const onSwitch = vi.fn();

  const reel = new DemoReel(
    demos.map((demo, index) => ({
      demo,
      tab: tabs[index] as unknown as HTMLButtonElement,
      description: `demo ${index}`,
    })),
    canvas as unknown as HTMLElement,
    onSwitch,
  );

  return { reel, demos, tabs, canvas, onSwitch };
}

describe("DemoReel", () => {
  it("runs the first demo, and says so to the tabs and to a screen reader", () => {
    const { reel, demos, tabs, canvas } = setup();
    reel.start();

    expect(demos[0].start).toHaveBeenCalled();
    expect(demos[1].start).not.toHaveBeenCalled();
    expect(tabs[0].attributes.get("aria-selected")).toBe("true");
    expect(canvas.attributes.get("aria-label")).toBe("demo 0");
  });

  it("switches demo on a tab without the click starting the instrument", () => {
    const { reel, tabs } = setup();
    reel.start();

    expect(tabs[1].click()).toBe(false);
  });

  it("stops the old demo, silences it, and starts the new one from the top", () => {
    const { reel, demos, tabs, onSwitch, canvas } = setup();
    reel.start();
    tabs[1].click();

    expect(demos[0].stop).toHaveBeenCalled();
    expect(onSwitch).toHaveBeenCalled();
    expect(demos[1].restart).toHaveBeenCalled();
    expect(demos[1].start).toHaveBeenCalled();
    expect(tabs[1].attributes.get("aria-selected")).toBe("true");
    expect(tabs[0].attributes.get("aria-selected")).toBe("false");
    expect(canvas.attributes.get("aria-label")).toBe("demo 1");
  });

  it("reaches whichever demo is showing", () => {
    const { reel, demos, tabs } = setup();
    reel.start();
    tabs[1].click();
    reel.restart();
    reel.stop();

    expect(demos[1].restart).toHaveBeenCalledTimes(2);
    expect(demos[1].stop).toHaveBeenCalled();
  });

  it("does not start a demo the overlay has stopped", () => {
    const { reel, demos, tabs } = setup();
    reel.start();
    reel.stop();
    tabs[1].click();

    expect(demos[1].start).not.toHaveBeenCalled();
  });
});
