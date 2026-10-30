/**
 * A bench for the hand engine: every pose the instrument uses, a pose editor, and
 * the animation laid out frame by frame.
 *
 * Nothing here is a mockup — it draws with `src/hand`, the engine the instrument
 * ships — so a pose that looks wrong here looks wrong in the map editor too.
 *
 * `?view=` picks what to draw:
 *
 * - `gallery` (default) — the instrument's shapes, palm and back. `&hand=right`.
 * - `editor` — one hand and a panel of controls; the URL follows the pose, so a
 *   pose worth keeping is a link. `&camera=1` puts the mirrored webcam beside it,
 *   to hold a real hand up against the drawing.
 * - `strip` — an animation as a row of frames, `&from=<shape>&to=<shape>`, or
 *   `&turn=1` to turn an open hand from palm to back, or `&lean=1` to tilt it.
 * - `tilt` — both hands leaning outward, upright and inward, with what the
 *   instrument reads from each.
 *
 * `npm run lab:hand`, then open http://localhost:5197.
 */
import { describePose } from "../../src/music/expression-map";
import { ROCK_SIGN, ROCK_SIGN_THUMB, shapeFromFingers } from "../../src/music/gesture-map";
import { getHandHorizontalTilt, readHandShape } from "../../src/vision/gestures";
import {
  DIGITS,
  HandAnimator,
  HandRenderer,
  handFigure,
  handLandmarks,
  poseHand,
  resolvePose,
  specFromShape,
} from "../../src/hand";
import type { Digit, HandPoseSpec, HandSide } from "../../src/hand";
import type { HandShape } from "../../src/types";

const INK = "#e8a13d";
const MUTED = "#98a2b3";

const params = new URLSearchParams(window.location.search);
const canvas = document.querySelector<HTMLCanvasElement>("#lab");
if (!canvas) throw new Error("no canvas");
const maybeCtx = canvas.getContext("2d");
if (!maybeCtx) throw new Error("no 2d context");
const ctx: CanvasRenderingContext2D = maybeCtx;

const ratio = Math.max(1, Math.round(window.devicePixelRatio || 1));

function size(width: number, height: number): void {
  canvas!.width = width * ratio;
  canvas!.height = height * ratio;
  canvas!.style.width = `${width}px`;
  canvas!.style.height = `${height}px`;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
}

const hand = (params.get("hand") === "right" ? "right" : "left") satisfies HandSide;

/** The instrument's shapes, in the order a player learns them. */
const SHAPES: readonly HandShape[] = [
  0,
  shapeFromFingers({ thumb: true }),
  shapeFromFingers({ index: true }),
  shapeFromFingers({ index: true, thumb: true }),
  shapeFromFingers({ index: true, middle: true }),
  shapeFromFingers({ index: true, middle: true, thumb: true }),
  shapeFromFingers({ index: true, middle: true, ring: true }),
  shapeFromFingers({ index: true, middle: true, ring: true, thumb: true }),
  shapeFromFingers({ index: true, middle: true, ring: true, pinky: true }),
  31,
  ROCK_SIGN,
  ROCK_SIGN_THUMB,
];

/** A shape's name, with the rock signs named as the signs they are. */
function shapeName(shape: HandShape): string {
  if (shape === ROCK_SIGN) return "Rock sign";
  if (shape === ROCK_SIGN_THUMB) return "Rock sign + thumb";
  return describePose(shape);
}

function caption(text: string, x: number, y: number, colour = MUTED): void {
  ctx.save();
  ctx.fillStyle = colour;
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(text, x, y);
  ctx.restore();
}

function gallery(): void {
  const columns = 6;
  const cell = { width: 200, height: 250 };
  const rows = Math.ceil((SHAPES.length * 2) / columns);
  size(columns * cell.width, rows * cell.height + 40);

  ctx.fillStyle = "#e7e9ee";
  ctx.font = "600 15px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText(`${hand} hand, as the mirrored camera shows it — palm, then back`, 16, 26);

  const renderer = new HandRenderer();

  SHAPES.flatMap((shape) =>
    (["palm", "back"] as const).map((facing) => ({ shape, facing })),
  ).forEach(({ shape, facing }, index) => {
    const x = (index % columns) * cell.width + cell.width / 2;
    const y = Math.floor(index / columns) * cell.height + 40;
    const pose = resolvePose(specFromShape(shape, { hand, facing }));

    renderer.draw(ctx, handFigure(poseHand(pose)), {
      x,
      y: y + 112,
      size: 170,
      colour: INK,
      fillAlpha: 0.1,
    });
    caption(`${shapeName(shape)} · ${facing}`, x, y + cell.height - 18);
  });
}

/** Both hands at each end of the tilt, read back through the instrument's own tilt reader. */
function tilts(): void {
  const tilts = ["outward", "upright", "inward"] as const;
  const cell = { width: 220, height: 300 };
  size(cell.width * tilts.length * 2, cell.height + 40);

  ctx.fillStyle = "#e7e9ee";
  ctx.font = "600 15px ui-sans-serif, system-ui, sans-serif";
  ctx.fillText("tilt, as the mirrored camera shows it — left hand, then right", 16, 26);

  const renderer = new HandRenderer();

  (["left", "right"] as const).forEach((side, sideIndex) => {
    tilts.forEach((tilt, index) => {
      const x = (sideIndex * tilts.length + index) * cell.width + cell.width / 2;
      const posed = poseHand(resolvePose(specFromShape(31, { hand: side, tilt })));
      const reading = getHandHorizontalTilt(
        handLandmarks(posed),
        side === "left" ? "Left" : "Right",
      );

      renderer.draw(ctx, handFigure(posed), { x, y: 170, size: 170, colour: INK, fillAlpha: 0.1 });
      caption(`${side} · ${tilt}`, x, cell.height + 2, "#e7e9ee");
      caption(
        `reads ${reading.toFixed(2)} · ${reading >= 0 ? "major" : "minor"}`,
        x,
        cell.height + 20,
      );
    });
  });
}

/** An animation as frames side by side, sampled the way a 60 Hz loop would. */
function strip(): void {
  const turn = params.get("turn") === "1";
  const lean = params.get("lean") === "1";
  const from = Number(params.get("from") ?? 31);
  const to = Number(params.get("to") ?? 0);
  const facing = params.get("facing") === "back" ? "back" : "palm";
  const frames = [0, 50, 100, 150, 200, 300, 450, 700];
  const cell = 170;
  size(frames.length * cell, 260);

  const renderer = new HandRenderer();

  frames.forEach((ms, index) => {
    const start: HandPoseSpec = turn
      ? specFromShape(31, { hand, facing: "palm" })
      : lean
        ? specFromShape(31, { hand, tilt: "outward" })
        : specFromShape(from, { hand, facing });
    const end: HandPoseSpec = turn
      ? specFromShape(31, { hand, facing: "back" })
      : lean
        ? specFromShape(31, { hand, tilt: "inward" })
        : specFromShape(to, { hand, facing });

    const animator = new HandAnimator(start);
    animator.update(0);
    animator.setTarget(end);
    for (let t = 16; t <= ms; t += 16) animator.update(t);
    const pose = animator.update(ms);

    const x = index * cell + cell / 2;
    renderer.draw(ctx, handFigure(poseHand(pose)), { x, y: 120, size: 150, colour: INK });
    caption(`${ms} ms`, x, 245);
  });
}

function editor(): void {
  const width = window.innerWidth || 1100;
  const height = window.innerHeight || 760;
  size(width, height);

  const spec = specFromParams();
  const animator = new HandAnimator(spec);
  const renderer = new HandRenderer();
  let current: HandPoseSpec = spec;
  let showLandmarks = params.get("landmarks") === "1";
  const video = params.get("camera") === "1" ? startCamera() : null;

  const panel = document.querySelector<HTMLDivElement>("#controls")!;
  panel.hidden = false;

  const update = (next: HandPoseSpec) => {
    current = next;
    animator.setTarget(next);
    history.replaceState(null, "", `?${paramsFromSpec(next)}`);
    code.textContent = JSON.stringify(next);
  };

  const slider = (
    label: string,
    value: number,
    min: number,
    max: number,
    onInput: (v: number) => void,
  ) => {
    const row = document.createElement("label");
    const input = Object.assign(document.createElement("input"), {
      type: "range",
      min: String(min),
      max: String(max),
      step: "0.01",
      value: String(value),
    });
    const output = document.createElement("output");
    output.textContent = value.toFixed(2);
    input.addEventListener("input", () => {
      output.textContent = Number(input.value).toFixed(2);
      onInput(Number(input.value));
    });
    row.append(label, input, output);
    panel.append(row);
    return input;
  };

  const resolved = resolvePose(spec);
  const curlInputs = Object.fromEntries(
    DIGITS.map((digit) => [
      digit,
      slider(digit, resolved.curl[digit], 0, 1, (value) =>
        update({ ...current, fingers: { ...current.fingers, [digit]: value } }),
      ),
    ]),
  ) as Record<Digit, HTMLInputElement>;

  slider("facing", resolved.facing, 0, 1, (value) => update({ ...current, facing: value }));
  slider("spread", resolved.spread, 0, 1, (value) => update({ ...current, spread: value }));
  slider("tilt", resolved.tilt, -1, 1, (value) => update({ ...current, tilt: value }));
  slider("roll", resolved.roll, -1, 1, (value) => update({ ...current, roll: value }));
  slider("pitch", resolved.pitch, -1, 1, (value) => update({ ...current, pitch: value }));

  const buttons = document.createElement("div");
  buttons.className = "row";
  panel.append(buttons);

  const select = document.createElement("select");
  select.append(
    ...SHAPES.map((shape) =>
      Object.assign(document.createElement("option"), {
        value: String(shape),
        textContent: shapeName(shape),
      }),
    ),
  );
  select.addEventListener("change", () => {
    const next = specFromShape(Number(select.value), { ...current });
    for (const digit of DIGITS) {
      curlInputs[digit].value = String(resolvePose(next).curl[digit]);
      curlInputs[digit].dispatchEvent(new Event("input"));
    }
    update(next);
  });
  buttons.append(select);

  const button = (label: string, onClick: () => void) => {
    const element = Object.assign(document.createElement("button"), { textContent: label });
    element.addEventListener("click", onClick);
    buttons.append(element);
  };

  button("left/right", () =>
    update({ ...current, hand: (current.hand ?? "left") === "left" ? "right" : "left" }),
  );
  button("landmarks", () => {
    showLandmarks = !showLandmarks;
  });

  let cycling: number | null = null;
  button("cycle", () => {
    if (cycling !== null) {
      clearInterval(cycling);
      cycling = null;
      return;
    }
    let index = 0;
    cycling = window.setInterval(() => {
      index = (index + 1) % SHAPES.length;
      select.value = String(SHAPES[index]);
      select.dispatchEvent(new Event("change"));
    }, 1400);
  });

  const code = document.createElement("code");
  code.textContent = JSON.stringify(spec);
  panel.append(code);

  const frame = (now: number) => {
    ctx.clearRect(0, 0, width, height);
    const pose = animator.update(now);
    const posed = poseHand(pose);
    const handSize = Math.min(height * 0.62, width * 0.4);
    const centre = { x: video ? width * 0.3 : width * 0.42, y: height * 0.48 };

    if (video && video.videoWidth) {
      // Mirrored, the way the instrument shows the camera.
      const videoHeight = height * 0.8;
      const videoWidth = (video.videoWidth / video.videoHeight) * videoHeight;
      ctx.save();
      ctx.translate(width * 0.58 + videoWidth, height * 0.1);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, videoWidth, videoHeight);
      ctx.restore();
    }

    renderer.draw(ctx, handFigure(posed), {
      x: centre.x,
      y: centre.y,
      size: handSize,
      colour: INK,
      fillAlpha: 0.08,
    });

    const landmarks = handLandmarks(posed);
    const handedness = posed.pose.hand === "left" ? "Left" : "Right";
    const read = readHandShape(landmarks, handedness);
    const tilt = getHandHorizontalTilt(landmarks, handedness);
    caption(
      `${pose.hand} hand · the instrument would read: ${shapeName(read)}, tilt ${tilt.toFixed(2)} (${tilt >= 0 ? "major" : "minor"})`,
      centre.x,
      height - 24,
      "#e7e9ee",
    );

    if (showLandmarks) {
      const unit = handSize / 0.3;
      ctx.fillStyle = "#4fd1c5";
      for (const point of landmarks) {
        // Back into the mirrored view the drawing is in.
        const x = centre.x - (point.x - 0.5) * unit;
        const y = centre.y + (point.y - 0.5) * unit;
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    requestAnimationFrame(frame);
  };

  requestAnimationFrame(frame);
}

function specFromParams(): HandPoseSpec {
  const shape = params.get("shape");
  const facingParam = params.get("facing");
  const facing =
    facingParam === "back" || facingParam === "palm"
      ? facingParam
      : facingParam
        ? Number(facingParam)
        : "palm";
  const base: HandPoseSpec =
    shape !== null
      ? specFromShape(Number(shape), { hand, facing })
      : specFromShape(31, { hand, facing });
  const fingers = { ...base.fingers };

  for (const digit of DIGITS) {
    const value = params.get(digit);
    if (value !== null) fingers[digit] = Number(value);
  }

  const number = (key: string) => (params.get(key) === null ? undefined : Number(params.get(key)));

  return {
    ...base,
    fingers,
    spread: number("spread"),
    roll: number("roll"),
    pitch: number("pitch"),
  };
}

function paramsFromSpec(spec: HandPoseSpec): string {
  const pose = resolvePose(spec);
  const out = new URLSearchParams({
    view: "editor",
    hand: pose.hand,
    facing: pose.facing.toFixed(2),
  });
  for (const digit of DIGITS) out.set(digit, pose.curl[digit].toFixed(2));
  out.set("spread", pose.spread.toFixed(2));
  if (pose.tilt) out.set("tilt", pose.tilt.toFixed(2));
  if (pose.roll) out.set("roll", pose.roll.toFixed(2));
  if (pose.pitch) out.set("pitch", pose.pitch.toFixed(2));
  if (params.get("camera") === "1") out.set("camera", "1");
  return out.toString();
}

function startCamera(): HTMLVideoElement {
  const video = Object.assign(document.createElement("video"), { muted: true, playsInline: true });
  navigator.mediaDevices
    .getUserMedia({ video: true })
    .then((stream) => {
      video.srcObject = stream;
      return video.play();
    })
    .catch((error: unknown) => console.error("hand lab: no camera", error));
  return video;
}

const view = params.get("view") ?? "gallery";

if (view === "gallery") gallery();
else if (view === "strip") strip();
else if (view === "editor") editor();
else if (view === "tilt") tilts();
else throw new Error(`unknown view "${view}"; try gallery, editor, strip, tilt`);

(window as unknown as { shotReady: boolean }).shotReady = true;
