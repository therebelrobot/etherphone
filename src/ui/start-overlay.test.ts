import { describe, expect, it, vi } from "vitest";
import { StartOverlay } from "./start-overlay";

/** Just enough of an element for the overlay: listeners, attributes, and text. */
function fakeElement() {
  const listeners = new Map<string, ((event: { stopPropagation(): void }) => void)[]>();
  const attributes = new Map<string, string>();

  return {
    textContent: "",
    style: {} as Record<string, string>,
    classList: { add: vi.fn(), remove: vi.fn() },
    querySelector: () => null,
    attributes,
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    addEventListener: (type: string, listener: (event: { stopPropagation(): void }) => void) => {
      listeners.set(type, [...(listeners.get(type) ?? []), listener]);
    },
    /** A click on this element, which bubbles to `parent` unless it is stopped. */
    click(parent?: { click(): void }) {
      let stopped = false;
      for (const listener of listeners.get("click") ?? []) {
        listener({ stopPropagation: () => (stopped = true) });
      }
      if (!stopped) parent?.click();
    },
  };
}

function setup() {
  const root = fakeElement();
  const button = fakeElement();
  const canvas = { classList: { remove: vi.fn() } };
  const order: string[] = [];
  const show = { start: vi.fn(), stop: vi.fn(() => order.push("show stopped")) };
  const onStart = vi.fn(() => order.push("started"));
  const onToggle = vi.fn((listening: boolean) => order.push(`listening ${listening}`));

  const overlay = new StartOverlay(
    root as unknown as HTMLElement,
    canvas as unknown as HTMLCanvasElement,
    onStart,
    show,
    { button: button as unknown as HTMLButtonElement, onToggle },
  );

  return { overlay, root, button, show, onStart, onToggle, order };
}

describe("StartOverlay", () => {
  it("starts the demonstration as soon as it is up", () => {
    expect(setup().show.start).toHaveBeenCalledOnce();
  });

  it("turns the demo's sound on without starting the instrument", () => {
    const { root, button, onStart, onToggle } = setup();

    button.click(root);

    expect(onToggle).toHaveBeenCalledWith(true);
    expect(onStart).not.toHaveBeenCalled();
    expect(button.attributes.get("aria-pressed")).toBe("true");
  });

  it("turns it off again on a second press", () => {
    const { root, button, onToggle } = setup();

    button.click(root);
    button.click(root);

    expect(onToggle).toHaveBeenLastCalledWith(false);
    expect(button.attributes.get("aria-pressed")).toBe("false");
  });

  it("silences the demo before the instrument starts, so the first sound is the player's", () => {
    const { root, button, order } = setup();

    button.click(root);
    root.click();

    expect(order).toEqual(["listening true", "listening false", "show stopped", "started"]);
  });

  it("does not report a silence that was never a sound", () => {
    const { root, onToggle } = setup();

    root.click();

    expect(onToggle).not.toHaveBeenCalled();
  });

  it("stops the demo and its sound when the camera fails", () => {
    const { overlay, root, button, show, onToggle, onStart } = setup();

    button.click(root);
    overlay.showError("no camera");
    root.click();

    expect(onToggle).toHaveBeenLastCalledWith(false);
    expect(show.stop).toHaveBeenCalled();
    // A failed start screen stays up: there is nothing to start.
    expect(onStart).not.toHaveBeenCalled();
  });
});
