/**
 * The posed hand, as flat outlines in drawing order.
 *
 * A hand drawn as lines has to answer one question a filled shape never does:
 * which lines are hidden. A finger folded across the palm shows its outline over
 * the palm; a finger held up from the palm shows none where it joins it. Getting
 * that wrong is what makes a drawing read as parts laid on top of each other.
 *
 * So the hand is split into **groups** — the palm, and each digit — each a set of
 * shapes that union into one silhouette, and the groups are ordered back to front.
 * The renderer outlines a group's union and blanks its inside, so whatever a group
 * covers is hidden and only its silhouette is drawn.
 *
 * The one place a group's outline is wrong is where a digit grows out of the
 * palm: there is no line where a finger meets the hand. Each digit carries a
 * **socket** for that — the stretch of its base inside the palm — which the
 * renderer clears of outline. It is a small stretch on purpose: a folded finger in
 * front of the palm keeps its outline everywhere else, which is how a fist reads.
 *
 * Everything is in the skeleton's centimetres, with `y` *down* the way a canvas
 * has it, so the renderer's only job is scale and ink.
 */
import { DIGITS } from "./pose";
import type { Digit } from "./pose";
import type { Limb, PosedDigit, PosedHand, Sphere } from "./skeleton";
import type { Vec2, Vec3 } from "./vec";
import { add, lerp, lerp3, scale, smoothstep, sub } from "./vec";

/** A closed outline. Every shape is wound the same way, so a group's shapes union. */
export type Shape = readonly Vec2[];

/** A line drawn on a group: a crease, a nail, a knuckle. */
export interface FigureDetail {
  readonly points: readonly Vec2[];
  readonly closed: boolean;
  /** 0 is not drawn; the detail fades as its surface turns away. */
  readonly alpha: number;
  /** Its weight relative to the outline. */
  readonly weight: number;
}

/**
 * Where a digit grows out of the palm, and the outline is cleared because the two
 * are one piece of flesh.
 *
 * It belongs to whichever of the two is drawn second, and clears that one's
 * outline inside the other: a finger in front of the palm loses the stub of its
 * outline inside the palm, and a palm in front of a digit loses the stretch of its
 * outline that crosses the digit's base.
 */
export interface FigureSocket {
  /** The shapes drawn first: only the part of the base inside them is cleared. */
  readonly within: readonly Shape[];
  readonly from: Vec2;
  readonly to: Vec2;
  readonly radius: number;
}

export interface FigureGroup {
  readonly id: "palm" | Digit;
  /** Towards the viewer is larger. */
  readonly depth: number;
  readonly shapes: readonly Shape[];
  readonly sockets: readonly FigureSocket[];
  readonly details: readonly FigureDetail[];
}

export interface FigureBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export interface HandFigure {
  /** Back to front: draw them in this order. */
  readonly groups: readonly FigureGroup[];
  readonly bounds: FigureBounds;
  /** The forearm stub fades out between these two points. */
  readonly fade: { readonly from: Vec2; readonly to: Vec2 };
}

/** How many points a full circle is drawn with. Enough to look round at 400px. */
const CIRCLE_STEPS = 40;

const flat = ([x, y]: Vec3): Vec2 => [x, -y];

function signedArea(shape: Shape): number {
  let area = 0;

  for (let i = 0; i < shape.length; i += 1) {
    const [x0, y0] = shape[i];
    const [x1, y1] = shape[(i + 1) % shape.length];
    area += x0 * y1 - x1 * y0;
  }

  return area / 2;
}

/**
 * The shape wound the one way every shape is.
 *
 * Mirroring a hand reverses every outline's winding, and the renderer fills a
 * group's shapes as one path with the non-zero rule — so shapes wound against each
 * other would cut holes where they overlap instead of joining.
 */
export function wound(shape: Shape): Shape {
  return signedArea(shape) < 0 ? [...shape].reverse() : shape;
}

function arc(centre: Vec2, radius: number, start: number, end: number): Vec2[] {
  const steps = Math.max(2, Math.ceil((Math.abs(end - start) / (Math.PI * 2)) * CIRCLE_STEPS));
  const points: Vec2[] = [];

  for (let step = 0; step <= steps; step += 1) {
    const angle = start + ((end - start) * step) / steps;
    points.push([centre[0] + Math.cos(angle) * radius, centre[1] + Math.sin(angle) * radius]);
  }

  return points;
}

/**
 * A tapered capsule's outline: two circles and the lines tangent to both.
 *
 * A sphere-swept bone seen from any angle is exactly this, which is why digits are
 * built from them: a finger pointing at the camera foreshortens to a circle without
 * any special case.
 */
export function capsule(a: Vec2, b: Vec2, radiusA: number, radiusB: number): Shape {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const distance = Math.hypot(dx, dy);

  // One end inside the other: seen end-on, the capsule is its larger circle.
  if (distance <= Math.abs(radiusA - radiusB) + 1e-6) {
    return wound(
      radiusA >= radiusB ? arc(a, radiusA, 0, Math.PI * 2) : arc(b, radiusB, 0, Math.PI * 2),
    ).slice(0, -1);
  }

  const heading = Math.atan2(dy, dx);
  const spread = Math.acos((radiusA - radiusB) / distance);

  return wound([
    ...arc(a, radiusA, heading + spread, heading + Math.PI * 2 - spread),
    ...arc(b, radiusB, heading - spread, heading + spread),
  ]);
}

/** The convex hull of a set of points, by monotone chain. */
export function convexHull(points: readonly Vec2[]): Shape {
  const sorted = [...points].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  if (sorted.length < 3) return sorted;

  const turn = (o: Vec2, a: Vec2, b: Vec2) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

  const lower: Vec2[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && turn(lower[lower.length - 2], lower[lower.length - 1], point) <= 0)
      lower.pop();
    lower.push(point);
  }

  const upper: Vec2[] = [];
  for (const point of [...sorted].reverse()) {
    while (upper.length >= 2 && turn(upper[upper.length - 2], upper[upper.length - 1], point) <= 0)
      upper.pop();
    upper.push(point);
  }

  return wound([...lower.slice(0, -1), ...upper.slice(0, -1)]);
}

/** The palm's outline: the hull of the balls it is built from, seen from the front. */
function hullOfSpheres(spheres: readonly Sphere[]): Shape {
  return convexHull(
    spheres.flatMap(({ centre, radius }) =>
      arc(flat(centre), radius, 0, Math.PI * 2 * (1 - 1 / CIRCLE_STEPS)),
    ),
  );
}

const limbShape = (limb: Limb): Shape =>
  capsule(flat(limb.from), flat(limb.to), limb.fromRadius, limb.toRadius);

/** How much thinner a bone is in the middle than at its joints. */
const WAIST = 0.93;

/** A digit's flesh: each bone as two capsules, narrower between the joints. */
function digitShapes(digit: PosedDigit): Shape[] {
  const shapes: Shape[] = [];

  for (let i = 0; i < digit.joints.length - 1; i += 1) {
    const a = digit.joints[i];
    const b = digit.joints[i + 1];
    const middle = lerp3(a, b, 0.5);
    const waist = ((digit.radii[i] + digit.radii[i + 1]) / 2) * WAIST;

    shapes.push(capsule(flat(a), flat(middle), digit.radii[i], waist));
    shapes.push(capsule(flat(middle), flat(b), waist, digit.radii[i + 1]));
  }

  return shapes;
}

/**
 * A point on a bone's surface.
 *
 * `across` runs -1..1 from one side of the bone to the other over the face
 * `facing` points at, so a line laid with it curves round the bone the way a
 * crease does — and foreshortens as the bone turns, which a flat line would not.
 */
function onSurface(
  axis: Vec3,
  radius: number,
  facing: Vec3,
  lateral: Vec3,
  across: number,
  lift = 0.97,
): Vec3 {
  const sideways = Math.max(-1, Math.min(1, across));
  const height = Math.sqrt(1 - sideways * sideways);

  return add(axis, add(scale(facing, radius * height * lift), scale(lateral, radius * sideways)));
}

/** A line around a bone at one point along it, `width` of the way to each side. */
function band(
  axis: Vec3,
  radius: number,
  facing: Vec3,
  lateral: Vec3,
  width: number,
): readonly Vec2[] {
  const points: Vec2[] = [];

  for (let step = 0; step <= 6; step += 1) {
    const across = -width + (2 * width * step) / 6;
    points.push(flat(onSurface(axis, radius, facing, lateral, across)));
  }

  return points;
}

/** Visibility of a surface whose outward normal is `normal`. */
const facingViewer = (normal: Vec3, from = 0.2, to = 0.65): number =>
  smoothstep(from, to, normal[2]);

const negate = (v: Vec3): Vec3 => scale(v, -1);

/** The nail, on the back of the last bone, curved over the bone and its round end. */
function nail(digit: PosedDigit): FigureDetail {
  const last = digit.joints.length - 1;
  const base = digit.joints[last - 1];
  const end = digit.joints[last];
  const radius = digit.radii[last];
  const segment = last - 1;
  const back = negate(digit.palmar[segment]);
  const lateral = digit.lateral[segment];
  const forward = sub(end, base);
  const reach = Math.hypot(...forward);
  const unit = scale(forward, 1 / Math.max(reach, 1e-6));
  const halfWidth = 0.56;

  const along = (s: number, across: number): Vec3 =>
    onSurface(lerp3(base, end, s), radius, back, lateral, across, 1.0);

  const points: Vec2[] = [];

  // One side, from the cuticle to the end of the bone.
  for (let step = 0; step <= 4; step += 1)
    points.push(flat(along(0.3 + 0.7 * (step / 4), -halfWidth)));

  // Round the tip, over the sphere the finger ends in.
  for (let step = 1; step < 8; step += 1) {
    const angle = -Math.PI / 2 + (Math.PI * step) / 8;
    const forwardBy = radius * 0.45 * Math.cos(angle);
    const sideways = radius * halfWidth * Math.sin(angle);
    const lift = Math.sqrt(
      Math.max(0, radius * radius - forwardBy * forwardBy - sideways * sideways),
    );

    points.push(
      flat(add(end, add(scale(unit, forwardBy), add(scale(lateral, sideways), scale(back, lift))))),
    );
  }

  // Back down the other side, and the cuticle's curve home.
  for (let step = 0; step <= 4; step += 1)
    points.push(flat(along(1 - 0.7 * (step / 4), halfWidth)));
  for (let step = 1; step < 4; step += 1) {
    const across = halfWidth - (2 * halfWidth * step) / 4;
    points.push(flat(along(0.3 - 0.05 * (1 - across * across * 3), across)));
  }

  return {
    points,
    closed: true,
    alpha: facingViewer(back, 0.15, 0.6),
    weight: 0.6,
  };
}

function digitDetails(digit: PosedDigit, curl: number): FigureDetail[] {
  const details: FigureDetail[] = [];
  const segments = digit.joints.length - 1;
  const isThumb = digit.digit === "thumb";

  /**
   * A point a little way from a joint towards a neighbour: `-0.06` is 6% of the way
   * back down the bone below it, `0.06` the same up the bone above.
   */
  const nearJoint = (joint: number, offset: number): Vec3 =>
    offset === 0
      ? digit.joints[joint]
      : lerp3(
          digit.joints[joint],
          digit.joints[offset > 0 ? joint + 1 : joint - 1],
          Math.abs(offset),
        );

  // Palm side: a crease at each joint — two at a finger's middle joint, as a
  // finger has — and one where the finger leaves the palm.
  for (let joint = 1; joint < segments; joint += 1) {
    const palmar = lerp3(digit.palmar[joint - 1], digit.palmar[joint], 0.5);
    const offsets = !isThumb && joint === 1 ? [-0.06, 0.06] : [0];

    for (const offset of offsets) {
      details.push({
        points: band(
          nearJoint(joint, offset),
          digit.radii[joint],
          palmar,
          digit.lateral[joint],
          0.6,
        ),
        closed: false,
        alpha: facingViewer(palmar),
        weight: 0.5,
      });
    }
  }

  const baseAxis = lerp3(digit.joints[0], digit.joints[1], isThumb ? 0.18 : 0.32);
  details.push({
    points: band(baseAxis, digit.radii[0], digit.palmar[0], digit.lateral[0], 0.62),
    closed: false,
    alpha: facingViewer(digit.palmar[0]) * 0.85,
    weight: 0.5,
  });

  // Back: the skin that wrinkles over a straight finger's middle joint — a longer
  // line just below it and a shorter one just above.
  if (!isThumb) {
    const back = negate(lerp3(digit.palmar[0], digit.palmar[1], 0.5));
    const straightness = 1 - smoothstep(0.3, 0.8, curl);

    for (const [offset, width] of [
      [-0.06, 0.42],
      [0.06, 0.3],
    ] as const) {
      details.push({
        points: band(nearJoint(1, offset), digit.radii[1], back, digit.lateral[1], width),
        closed: false,
        alpha: facingViewer(back) * straightness * 0.7,
        weight: 0.42,
      });
    }
  }

  details.push(nail(digit));

  return details;
}

/**
 * The knuckles, as the back of the hand shows them: a curve over each bone's head.
 *
 * They are what tells the back of a fist from a mitten. Stronger as the finger
 * folds, because a folded finger is what pushes the knuckle up.
 */
function knuckleDetails(hand: PosedHand): FigureDetail[] {
  const back = negate(hand.palmNormal);
  const visible = facingViewer(back);
  if (visible <= 0) return [];

  const fingers = ["index", "middle", "ring", "pinky"] as const;

  return hand.knuckles.map(({ centre, radius }, index) => {
    const curl = hand.pose.curl[fingers[index]];
    const points: Vec2[] = [];

    for (let step = 0; step <= 8; step += 1) {
      const angle = -Math.PI / 2 + (Math.PI * step) / 8;
      const point = add(
        add(centre, scale(back, radius * 0.9)),
        add(
          scale(hand.across, radius * 0.62 * Math.sin(angle)),
          scale(hand.up, radius * (0.42 * Math.cos(angle) - 0.62)),
        ),
      );
      points.push(flat(point));
    }

    return {
      points,
      closed: false,
      alpha: visible * lerp(0.3, 0.75, curl),
      weight: 0.5,
    };
  });
}

const meanDepth = (points: readonly Vec3[]): number =>
  points.reduce((total, point) => total + point[2], 0) / points.length;

/**
 * How far to the far side of the palm a digit has to reach before it is drawn
 * behind it. A straight finger is level with the palm and is drawn over it, so its
 * base can be joined to it; a finger folded with the back of the hand to the
 * camera is well behind.
 */
const BEHIND = 0.9;

/**
 * How far a digit's joints sit to the viewer's side of the palm, on average.
 *
 * Measured against the palm's plane, not the digit's own base: a thumb tucked
 * across the palm is level with its own knuckle, but its knuckle is already on the
 * palm side — so from the back the whole thumb is hidden, which is the point.
 */
function viewerSideOfPalm(hand: PosedHand, points: readonly Vec3[]): number {
  const [nx, ny, nz] = hand.palmNormal;
  const side = Math.sign(nz) || 1;

  const total = points.reduce((sum, point) => {
    const offset = sub(point, hand.palmCentre);
    return sum + (offset[0] * nx + offset[1] * ny + offset[2] * nz) * side;
  }, 0);

  return total / points.length;
}

/** Turns a posed hand into groups of outlines, back to front. */
export function handFigure(hand: PosedHand): HandFigure {
  const palmHull = hullOfSpheres(hand.palm);
  const palmFacing = facingViewer(hand.palmNormal);

  const palmShapes: Shape[] = [
    limbShape(hand.forearm),
    palmHull,
    limbShape(hand.thenar),
    ...hand.thumbWeb.map((triangle) => wound(triangle.map(flat))),
  ];
  const palmSockets: FigureSocket[] = [];

  const palm: FigureGroup = {
    id: "palm",
    depth: meanDepth(hand.palm.map((sphere) => sphere.centre)),
    shapes: palmShapes,
    sockets: palmSockets,
    details: [
      ...hand.palmCreases.map((line, index) => ({
        points: line.map(flat),
        closed: false,
        // The wrist crease is the faintest; the three palm lines are the ones that
        // say "this is a palm".
        alpha: palmFacing * (index === 3 ? 0.5 : 0.8),
        weight: 0.55,
      })),
      ...knuckleDetails(hand),
    ],
  };

  const behind: FigureGroup[] = [];
  const inFront: FigureGroup[] = [];

  for (const digit of DIGITS) {
    const posed = hand.digits[digit];
    const reach = posed.joints.slice(1);
    const shapes = digitShapes(posed);
    const isBehind = viewerSideOfPalm(hand, reach) < -BEHIND;

    const socket = (within: readonly Shape[]): FigureSocket => ({
      within,
      from: flat(posed.joints[0]),
      // Over half the first bone: the web between two fingers sits higher up the
      // shorter one, and the clearing has to reach it. It only ever clears inside
      // the other shapes, so reaching further costs nothing.
      to: flat(lerp3(posed.joints[0], posed.joints[1], 0.55)),
      radius: posed.radii[0],
    });

    const group: FigureGroup = {
      id: digit,
      depth: meanDepth(reach),
      shapes,
      sockets: isBehind ? [] : [socket(palmShapes)],
      details: digitDetails(posed, hand.pose.curl[digit]),
    };

    if (isBehind) {
      // The palm is drawn over this digit, so the palm's outline is what has to
      // give way where they join — or the edge of the thumb's ball cuts straight
      // across a thumb held out with the back to the camera.
      palmSockets.push(socket(shapes));
      behind.push(group);
    } else {
      inFront.push(group);
    }
  }

  const byDepth = (a: FigureGroup, b: FigureGroup) => a.depth - b.depth;
  const groups = [...behind.sort(byDepth), palm, ...inFront.sort(byDepth)];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const group of groups) {
    for (const shape of group.shapes) {
      for (const [x, y] of shape) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
  }

  return {
    groups,
    bounds: { minX, minY, maxX, maxY },
    fade: { from: flat(hand.fade.from), to: flat(hand.fade.to) },
  };
}
