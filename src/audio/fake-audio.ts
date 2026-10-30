/**
 * A pretend `AudioContext`, for tests only: it builds nothing and plays nothing,
 * and records every node made and every value scheduled.
 *
 * The tests run in Node, which has no Web Audio. What a voice *does* is wire nodes
 * and schedule values, so that is what this records; whether the result sounds
 * right is a question for ears, but whether a note fades in from silence is not.
 */

export interface ScheduledValue {
  readonly kind: "set" | "linear" | "target" | "exponential" | "cancel";
  readonly value: number;
  readonly time: number;
}

export class FakeParam {
  readonly events: ScheduledValue[] = [];

  constructor(public value = 0) {}

  setValueAtTime(value: number, time: number): this {
    this.events.push({ kind: "set", value, time });
    this.value = value;
    return this;
  }

  linearRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: "linear", value, time });
    return this;
  }

  exponentialRampToValueAtTime(value: number, time: number): this {
    this.events.push({ kind: "exponential", value, time });
    return this;
  }

  setTargetAtTime(value: number, time: number): this {
    this.events.push({ kind: "target", value, time });
    return this;
  }

  cancelScheduledValues(time: number): this {
    this.events.push({ kind: "cancel", value: 0, time });
    return this;
  }
}

export class FakeNode {
  readonly outputs: unknown[] = [];
  disconnected = false;

  constructor(readonly kind: string) {}

  connect<T>(destination: T): T {
    this.outputs.push(destination);
    return destination;
  }

  disconnect(): void {
    this.disconnected = true;
  }
}

export class FakeOscillator extends FakeNode {
  type = "sine";
  readonly frequency = new FakeParam(440);
  readonly detune = new FakeParam(0);
  startedAt: number | null = null;
  stoppedAt: number | null = null;
  onended: (() => void) | null = null;

  constructor() {
    super("oscillator");
  }

  start(time = 0): void {
    this.startedAt = time;
  }

  stop(time = 0): void {
    this.stoppedAt = time;
  }
}

export class FakeGain extends FakeNode {
  readonly gain = new FakeParam(1);

  constructor() {
    super("gain");
  }
}

export class FakeFilter extends FakeNode {
  type = "lowpass";
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);

  constructor() {
    super("filter");
  }
}

export class FakeCompressor extends FakeNode {
  readonly threshold = new FakeParam(-24);
  readonly knee = new FakeParam(30);
  readonly ratio = new FakeParam(12);
  readonly attack = new FakeParam(0.003);
  readonly release = new FakeParam(0.25);

  constructor() {
    super("compressor");
  }
}

export class FakeAudioContext {
  currentTime = 0;
  readonly destination = new FakeNode("destination");
  readonly oscillators: FakeOscillator[] = [];
  readonly gains: FakeGain[] = [];
  readonly filters: FakeFilter[] = [];
  readonly compressors: FakeCompressor[] = [];

  createOscillator(): FakeOscillator {
    const node = new FakeOscillator();
    this.oscillators.push(node);
    return node;
  }

  createGain(): FakeGain {
    const node = new FakeGain();
    this.gains.push(node);
    return node;
  }

  createBiquadFilter(): FakeFilter {
    const node = new FakeFilter();
    this.filters.push(node);
    return node;
  }

  createDynamicsCompressor(): FakeCompressor {
    const node = new FakeCompressor();
    this.compressors.push(node);
    return node;
  }

  /** The context as the code under test expects to see it. */
  get asContext(): AudioContext {
    return this as unknown as AudioContext;
  }
}
