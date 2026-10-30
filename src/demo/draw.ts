/**
 * What the start screen's demonstrations have in common: their frame loop, and
 * the few things both draw — the song's title, a readout, a caption under a
 * hand, the words, and the beat.
 *
 * Shared so the two demos look like one feature. A demo that labels its hands in
 * one typeface and the other in another reads as two features that happen to sit
 * on the same screen.
 */

export const INK = "#e8a13d";
export const TEXT = "#ffffff";
export const MUTED = "rgba(255, 255, 255, 0.55)";
export const FONT = "monospace";

/** Whether the player has asked for less motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
    : false;
}

export type RequestFrame = (callback: (now: number) => void) => number;
export type CancelFrame = (handle: number) => void;

/**
 * A demo's animation loop: runs a callback every frame until stopped, and keeps
 * its own clock so a demo can be taken back to its start.
 */
export class FrameLoop {
  private handle: number | null = null;
  private startedAt: number | null = null;
  private readonly request: RequestFrame;
  private readonly cancel: CancelFrame;

  constructor(request?: RequestFrame, cancel?: CancelFrame) {
    this.request = request ?? ((callback) => requestAnimationFrame(callback));
    this.cancel = cancel ?? ((handle) => cancelAnimationFrame(handle));
  }

  get isRunning(): boolean {
    return this.handle !== null;
  }

  /**
   * Starts calling `frame` with the frame's time and the milliseconds since the
   * demo's start. Starting a running loop does nothing.
   */
  start(frame: (now: number, elapsed: number) => void): void {
    if (this.handle !== null) return;

    const tick = (now: number) => {
      this.startedAt ??= now;
      frame(now, now - this.startedAt);
      this.handle = this.request(tick);
    };

    this.handle = this.request(tick);
  }

  /** Takes the clock back to zero, on the next frame. */
  restart(): void {
    this.startedAt = null;
  }

  stop(): void {
    if (this.handle !== null) this.cancel(this.handle);
    this.handle = null;
  }
}

/** Sizes the canvas to its box at the screen's resolution, and returns the box. */
export function fitCanvas(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
): { width: number; height: number } {
  const ratio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1;
  const width = canvas.clientWidth || canvas.width;
  const height = canvas.clientHeight || canvas.height;
  const pixelWidth = Math.round(width * ratio);
  const pixelHeight = Math.round(height * ratio);

  if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
    canvas.width = pixelWidth;
    canvas.height = pixelHeight;
  }

  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  return { width, height };
}

/** The song's title, and where it comes from. */
export function drawTitle(
  ctx: CanvasRenderingContext2D,
  width: number,
  title: string,
  credit: string,
): void {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";

  ctx.fillStyle = TEXT;
  ctx.font = `600 16px ${FONT}`;
  ctx.fillText(title, width / 2, 28);
  ctx.fillStyle = MUTED;
  ctx.font = `12px ${FONT}`;

  // On a phone the credit is wider than the screen, so it breaks where its own
  // separators are rather than running off both edges.
  if (ctx.measureText(credit).width <= width - 24) {
    ctx.fillText(credit, width / 2, 48);
  } else {
    const [origin, ...rest] = credit.split(" · ");
    ctx.fillText(origin, width / 2, 46);
    ctx.fillText(rest.join(" · "), width / 2, 62);
  }

  ctx.restore();
}

/** A large readout — a chord, a note — with a smaller line under it. */
export function drawReadout(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  main: string,
  detail: string,
): void {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK;
  ctx.font = `600 34px ${FONT}`;
  ctx.fillText(main, x, y);
  ctx.fillStyle = MUTED;
  ctx.font = `14px ${FONT}`;
  ctx.fillText(detail, x, y + 22);
  ctx.restore();
}

/** One line, centred: what is happening. */
export function drawNote(ctx: CanvasRenderingContext2D, x: number, y: number, text: string): void {
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = INK;
  ctx.font = `600 18px ${FONT}`;
  ctx.fillText(text, x, y);
  ctx.restore();
}

/** Under a hand: which hand and its job, then what it is doing. */
export function drawHandCaption(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  role: string,
  gesture: string,
  alpha = 1,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = MUTED;
  ctx.font = `12px ${FONT}`;
  ctx.fillText(role, x, y);
  ctx.fillStyle = TEXT;
  ctx.font = `15px ${FONT}`;
  ctx.fillText(gesture, x, y + 20);
  ctx.restore();
}

/**
 * The words, as a line that moves through the song: the bar being sung bright
 * and centred, the bars either side of it dim.
 */
export function drawTicker(
  ctx: CanvasRenderingContext2D,
  width: number,
  y: number,
  previous: string,
  current: string,
  next: string,
): void {
  ctx.save();
  ctx.textBaseline = "alphabetic";
  ctx.font = `18px ${FONT}`;

  const currentWidth = ctx.measureText(current).width;
  const space = ctx.measureText("  ").width;

  ctx.textAlign = "center";
  ctx.fillStyle = TEXT;
  ctx.fillText(current, width / 2, y);

  ctx.fillStyle = MUTED;
  ctx.textAlign = "right";
  ctx.fillText(previous, width / 2 - currentWidth / 2 - space, y);
  ctx.textAlign = "left";
  ctx.fillText(next, width / 2 + currentWidth / 2 + space, y);

  ctx.restore();
}

/** A dot per beat of the bar, the current one lit: the pulse, for when there is no sound. */
export function drawBeatDots(
  ctx: CanvasRenderingContext2D,
  width: number,
  y: number,
  beats: number,
  lit: number,
): void {
  const spacing = 18;
  const first = width / 2 - ((beats - 1) * spacing) / 2;

  ctx.save();
  for (let index = 0; index < beats; index += 1) {
    ctx.beginPath();
    ctx.arc(first + index * spacing, y, index === lit ? 4.5 : 3, 0, Math.PI * 2);
    ctx.fillStyle = index === lit ? INK : MUTED;
    ctx.fill();
  }
  ctx.restore();
}
