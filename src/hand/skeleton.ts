/**
 * The hand as bones: a pose in, joint positions out.
 *
 * Forward kinematics over an adult hand's proportions — the phalanx lengths, the
 * knuckle arch, the thumb's offset down the wrist — because what a player has to
 * match is a *hand*, and a hand is not a box with five sticks on it. The lengths
 * are what make "two fingers" look like the two fingers they are holding up.
 *
 * ## Space
 *
 * The hand is built once, in one place: a **right** hand, palm to the camera,
 * fingers up, in centimetres from the wrist crease. From the camera's side a right
 * palm has its thumb on the camera's right, so the thumb is `+x`; `+y` is up and
 * `+z` is towards the camera. Everything else is a transform of that hand:
 *
 * 1. turned about its long axis to face the camera with the back instead,
 * 2. pitched, so the fingers tip towards the camera,
 * 3. reflected, if it is a left hand,
 * 4. reflected again, if the view is mirrored — which the instrument's is,
 * 5. leaned, by the tilt and any roll — on screen, so "inward" is the same
 *    gesture on either hand (see `screenRoll`).
 *
 * Steps 3 and 4 are why a **left** hand in the mirrored view keeps its thumb on the
 * screen's right with the palm out: what the player sees is a mirror, and the
 * drawing has to agree with the mirror or it cannot be followed.
 *
 * The output is in *view* space — `x` right, `y` up, `z` towards the viewer,
 * centred on {@link PIVOT} — so the figure has nothing left to transform.
 */
import type { Hand } from "../types";
import type { Digit, HandPose } from "./pose";
import { DIGITS, screenRoll } from "./pose";
import type { Vec3 } from "./vec";
import {
  add,
  blendDirection,
  cross,
  degrees,
  lerp,
  lerp3,
  normalize,
  orthogonalTo,
  rotate,
  scale,
  smoothstep,
  sub,
} from "./vec";

/** Wrist crease to middle fingertip, in the model's centimetres. */
export const HAND_LENGTH = 19.05;

/**
 * The point a drawing is placed by, in the hand's own space.
 *
 * Between the palm's centre and the knuckles, so an open hand's extent — forearm
 * stub to fingertips — is centred on it. Fixed, rather than the centre of the
 * hand's bounds, because bounds move as fingers fold: a hand centred on its box
 * slides about the screen as it closes, and a player following it is following a
 * moving target.
 */
export const PIVOT: Vec3 = [0, 8, 0];

interface FingerAnatomy {
  /** The knuckle, on the arch the four make across the palm. */
  readonly mcp: Vec3;
  /** Proximal, middle and distal phalanx; the distal one to the very tip. */
  readonly lengths: readonly [number, number, number];
  /** Half the finger's thickness at the knuckle, each joint, and the tip. */
  readonly radii: readonly [number, number, number, number];
  /** Lean off the middle finger, in degrees: towards the thumb is positive. */
  readonly splay: readonly [rest: number, wide: number];
  /**
   * How far the knuckle drops towards the palm as the finger closes. The ring and
   * little finger's metacarpals move — it is what cups a fist — and the other two
   * do not.
   */
  readonly cup: Vec3;
}

/** An adult hand's proportions, in centimetres. */
const FINGERS: Readonly<Record<Exclude<Digit, "thumb">, FingerAnatomy>> = {
  index: {
    mcp: [2.45, 9.0, 0.15],
    lengths: [4.15, 2.45, 2.05],
    radii: [1.0, 0.9, 0.8, 0.7],
    splay: [3, 13],
    cup: [0, 0, 0],
  },
  middle: {
    mcp: [0.55, 9.45, 0],
    lengths: [4.6, 2.85, 2.15],
    radii: [1.02, 0.93, 0.82, 0.72],
    splay: [0, 1.5],
    cup: [0, 0, 0],
  },
  ring: {
    mcp: [-1.35, 9.05, 0.05],
    lengths: [4.3, 2.7, 2.1],
    radii: [0.96, 0.87, 0.77, 0.68],
    splay: [-3.5, -11],
    cup: [0.1, 0, 0.25],
  },
  pinky: {
    mcp: [-3.05, 8.1, 0.2],
    lengths: [3.45, 2.0, 1.9],
    radii: [0.84, 0.76, 0.67, 0.6],
    splay: [-8, -24],
    cup: [0.3, 0.1, 0.5],
  },
};

/** Knuckle, middle joint and end joint, from straight to a fist, in degrees. */
const FLEX_STRAIGHT = [2, 5, 3] as const;
const FLEX_CLOSED = [86, 100, 66] as const;

const THUMB_CMC: Vec3 = [1.95, 1.9, 0.55];
/** Metacarpal, proximal phalanx, distal phalanx to the tip. */
const THUMB_LENGTHS = [4.4, 3.1, 2.75] as const;
/** At the thumb's knuckle, its end joint, and its tip. */
const THUMB_RADII = [1.12, 1.02, 0.88] as const;

/**
 * The thumb's bones, as directions, in three positions.
 *
 * The thumb does not hinge in one plane the way a finger does — it swings across
 * the palm and rotates as it goes — so it is described by where each bone points
 * rather than by joint angles. `out` is held away from the hand, `tuck` is folded
 * across an open palm, `fist` is wrapped over fingers that are folded: the thumb
 * cannot lie flat on a palm the fingers are in front of.
 *
 * `pad` is which way each bone's pad faces, so its nail can be put on the back.
 */
interface ThumbPosition {
  readonly bones: readonly [Vec3, Vec3, Vec3];
  readonly pad: Vec3;
}

const THUMB_OUT: ThumbPosition = {
  bones: [
    [0.7, 0.68, 0.2],
    [0.8, 0.58, 0.12],
    [0.82, 0.56, 0.06],
  ],
  pad: [-0.35, 0.25, 0.9],
};

const THUMB_TUCK: ThumbPosition = {
  bones: [
    [0.18, 0.92, 0.36],
    [-0.9, 0.42, -0.05],
    [-0.88, 0.22, -0.32],
  ],
  pad: [-0.1, 0.25, -0.95],
};

const THUMB_FIST: ThumbPosition = {
  bones: [
    [0.25, 0.82, 0.5],
    [-0.72, 0.5, 0.48],
    [-0.97, 0.18, -0.12],
  ],
  pad: [0, -0.2, -1],
};

/** A ball, for the palm's volume. Drawn as the hull of their outlines. */
export interface Sphere {
  readonly centre: Vec3;
  readonly radius: number;
}

/** A tapered cylinder with round ends — a bone with its flesh on. */
export interface Limb {
  readonly from: Vec3;
  readonly to: Vec3;
  readonly fromRadius: number;
  readonly toRadius: number;
}

export interface PosedDigit {
  readonly digit: Digit;
  /**
   * The drawn joints, base first. A finger's base is its knuckle; the thumb's is
   * *its* knuckle too — the bone below that is inside the palm, as the thenar.
   * The last joint is where the tip's round end is centred, not the tip itself.
   */
  readonly joints: readonly Vec3[];
  readonly radii: readonly number[];
  /** Per drawn segment: which way its pad faces, and the axis it bends about. */
  readonly palmar: readonly Vec3[];
  readonly lateral: readonly Vec3[];
  /** The very end of the digit, the way MediaPipe places a tip. */
  readonly tip: Vec3;
}

export interface PosedHand {
  readonly pose: HandPose;
  readonly mirrored: boolean;
  readonly wrist: Vec3;
  readonly thumbCmc: Vec3;
  readonly digits: Readonly<Record<Digit, PosedDigit>>;
  /** Out of the palm, towards whatever the palm faces. */
  readonly palmNormal: Vec3;
  /** The middle of the palm, on the plane of its bones. */
  readonly palmCentre: Vec3;
  /** The hand's own across (towards the thumb) and up (towards the fingers). */
  readonly across: Vec3;
  readonly up: Vec3;
  /** The top of each knuckle on the back of the hand, for the fingers in order. */
  readonly knuckles: readonly { readonly centre: Vec3; readonly radius: number }[];
  readonly palm: readonly Sphere[];
  /** The ball of the thumb, which carries its metacarpal. */
  readonly thenar: Limb;
  readonly forearm: Limb;
  /** Where the forearm fades out: drawn solid at `from`, gone by `to`. */
  readonly fade: { readonly from: Vec3; readonly to: Vec3 };
  /**
   * The skin between thumb and index, as a fan of triangles. Triangles because the
   * web folds over itself as the hand turns, and a folded outline filled as one
   * shape cuts a hole where it crosses; each triangle on its own cannot.
   */
  readonly thumbWeb: readonly (readonly Vec3[])[];
  /** Lines in the palm: they belong to the palm, so they turn with it. */
  readonly palmCreases: readonly (readonly Vec3[])[];
}

/** Turns the hand built in its own space into view space. */
interface ViewTransform {
  point(p: Vec3): Vec3;
  direction(v: Vec3): Vec3;
}

function viewTransform(pose: HandPose, mirrored: boolean): ViewTransform {
  // The thumb leads the turn towards the camera: palm to back is the forearm
  // rolling, thumb first, which is how a hand turns over to show its back.
  const yaw = pose.facing * Math.PI;
  const roll = screenRoll(pose);
  const flip = (pose.hand === "left" ? -1 : 1) * (mirrored ? -1 : 1);

  const direction = ([x0, y0, z0]: Vec3): Vec3 => {
    const x1 = x0 * Math.cos(yaw) - z0 * Math.sin(yaw);
    const z1 = x0 * Math.sin(yaw) + z0 * Math.cos(yaw);

    const y2 = y0 * Math.cos(pose.pitch) - z1 * Math.sin(pose.pitch);
    const z2 = y0 * Math.sin(pose.pitch) + z1 * Math.cos(pose.pitch);

    const x3 = x1 * flip;

    // Clockwise on screen, with y up.
    const x4 = x3 * Math.cos(roll) + y2 * Math.sin(roll);
    const y4 = -x3 * Math.sin(roll) + y2 * Math.cos(roll);

    return [x4, y4, z2];
  };

  return {
    direction,
    point: (p) => direction(sub(p, PIVOT)),
  };
}

interface LocalDigit {
  readonly joints: Vec3[];
  readonly radii: number[];
  readonly palmar: Vec3[];
  readonly lateral: Vec3[];
  readonly tip: Vec3;
}

function buildFinger(anatomy: FingerAnatomy, curl: number, spread: number): LocalDigit {
  const base = add(anatomy.mcp, scale(anatomy.cup, curl));
  // Folded fingers draw together, which is what makes a fist a fist rather than
  // four fingers folded separately.
  const splay = degrees(lerp(anatomy.splay[0], anatomy.splay[1], spread) * (1 - 0.85 * curl));

  let forward: Vec3 = [Math.sin(splay), Math.cos(splay), 0];
  let palmar: Vec3 = [0, 0, 1];
  // The axis a finger hinges about. It does not change along the finger: the
  // three joints bend in the one plane.
  const lateral = normalize(cross(forward, palmar));

  const joints: Vec3[] = [base];
  const palmars: Vec3[] = [];
  let point = base;

  anatomy.lengths.forEach((boneLength, index) => {
    const angle = degrees(lerp(FLEX_STRAIGHT[index], FLEX_CLOSED[index], curl));

    forward = rotate(forward, lateral, angle);
    palmar = rotate(palmar, lateral, angle);

    // The last bone stops short by the tip's radius, so the round end of the
    // drawn finger lands on the fingertip rather than past it.
    const reach = index === 2 ? boneLength - anatomy.radii[3] : boneLength;
    point = add(point, scale(forward, reach));
    joints.push(point);
    palmars.push(palmar);
  });

  return {
    joints,
    radii: [...anatomy.radii],
    palmar: palmars,
    lateral: palmars.map(() => lateral),
    tip: add(point, scale(forward, anatomy.radii[3])),
  };
}

interface LocalThumb extends LocalDigit {
  readonly cmc: Vec3;
}

function buildThumb(curl: number, fistness: number): LocalThumb {
  const folded = (index: number): Vec3 =>
    blendDirection(THUMB_TUCK.bones[index], THUMB_FIST.bones[index], fistness);
  const bone = (index: number): Vec3 => blendDirection(THUMB_OUT.bones[index], folded(index), curl);

  const padFolded = blendDirection(THUMB_TUCK.pad, THUMB_FIST.pad, fistness);
  const pad = blendDirection(THUMB_OUT.pad, padFolded, curl);

  const mcp = add(THUMB_CMC, scale(bone(0), THUMB_LENGTHS[0]));
  const ipDirection = bone(1);
  const ip = add(mcp, scale(ipDirection, THUMB_LENGTHS[1]));
  const tipDirection = bone(2);
  const tipBone = add(ip, scale(tipDirection, THUMB_LENGTHS[2] - THUMB_RADII[2]));

  const palmar = [orthogonalTo(pad, ipDirection), orthogonalTo(pad, tipDirection)];
  const lateral = [
    normalize(cross(ipDirection, palmar[0])),
    normalize(cross(tipDirection, palmar[1])),
  ];

  return {
    cmc: THUMB_CMC,
    joints: [mcp, ip, tipBone],
    radii: [...THUMB_RADII],
    palmar,
    lateral,
    tip: add(tipBone, scale(tipDirection, THUMB_RADII[2])),
  };
}

/** How far in front of the bones the palm's skin is, for the lines drawn on it. */
const PALM_SURFACE = 1.15;

/**
 * The three big palm lines and the wrist crease, on a right palm.
 *
 * Traced from the anatomy rather than invented: the thenar crease circles the
 * ball of the thumb, the head line crosses from the same start, and the heart
 * line runs in from under the little finger to end between index and middle.
 */
const PALM_CREASES: readonly (readonly [number, number][])[] = [
  // Thenar crease, the "life line".
  [
    [2.85, 6.7],
    [2.0, 5.5],
    [1.2, 3.9],
    [0.85, 2.4],
    [0.95, 1.1],
  ],
  // Proximal transverse crease, the "head line".
  [
    [2.8, 6.6],
    [1.2, 6.25],
    [-0.6, 5.7],
    [-2.3, 5.0],
  ],
  // Distal transverse crease, the "heart line".
  [
    [-3.85, 7.05],
    [-2.4, 7.35],
    [-0.7, 7.6],
    [0.7, 8.05],
    [1.45, 8.6],
  ],
  // Wrist crease.
  [
    [-1.9, 0.75],
    [0, 0.6],
    [1.9, 0.75],
  ],
];

/**
 * The hand, posed and in view space.
 *
 * @param mirrored - Draw the hand as a mirror shows it. The instrument's camera
 *   view is mirrored, so this is true wherever a player compares the drawing with
 *   their own hand on screen.
 */
export function poseHand(pose: HandPose, mirrored = true): PosedHand {
  const view = viewTransform(pose, mirrored);

  const fingers = Object.fromEntries(
    (["index", "middle", "ring", "pinky"] as const).map((digit) => [
      digit,
      buildFinger(FINGERS[digit], pose.curl[digit], pose.spread),
    ]),
  ) as Record<Exclude<Digit, "thumb">, LocalDigit>;

  // A thumb folds over the fingers once they are folded, and onto the palm when
  // they are not — the first two fingers decide it, because those are what it
  // lies across.
  const fistness = smoothstep(0.35, 0.85, (pose.curl.index + pose.curl.middle) / 2);
  const thumb = buildThumb(pose.curl.thumb, fistness);

  const local: Record<Digit, LocalDigit> = { thumb, ...fingers };

  const digits = {} as Record<Digit, PosedDigit>;

  for (const digit of DIGITS) {
    const chain = local[digit];

    digits[digit] = {
      digit,
      joints: chain.joints.map(view.point),
      radii: chain.radii,
      palmar: chain.palmar.map(view.direction),
      lateral: chain.lateral.map(view.direction),
      tip: view.point(chain.tip),
    };
  }

  const knuckleBall = (digit: Exclude<Digit, "thumb">): Sphere => ({
    centre: view.point(fingers[digit].joints[0]),
    // Exactly the finger's own radius, so the palm's edge runs on into the
    // finger's side without a step where they meet.
    radius: fingers[digit].radii[0],
  });

  // The skin between two fingers reaches a third of the way up the first bone,
  // which is why a finger looks shorter from the palm than from the back.
  const web = (a: Exclude<Digit, "thumb">, b: Exclude<Digit, "thumb">): Sphere => {
    const along = (digit: Exclude<Digit, "thumb">) =>
      lerp3(fingers[digit].joints[0], fingers[digit].joints[1], 0.3);

    return { centre: view.point(lerp3(along(a), along(b), 0.5)), radius: 0.5 };
  };

  const palm: Sphere[] = [
    { centre: view.point([1.75, 0.35, 0]), radius: 1.3 },
    { centre: view.point([-1.75, 0.35, 0]), radius: 1.3 },
    { centre: view.point([0, 0.4, 0]), radius: 1.5 },
    // The heel of the hand on the little finger's side, which is what makes a palm
    // wider at the bottom than a rectangle is.
    { centre: view.point([-2.75, 3.8, 0.25]), radius: 1.42 },
    { centre: view.point([0, 5, 0]), radius: 1.6 },
    { centre: view.point([2.25, 5.5, 0.1]), radius: 1.1 },
    knuckleBall("index"),
    knuckleBall("middle"),
    knuckleBall("ring"),
    knuckleBall("pinky"),
    web("index", "middle"),
    web("middle", "ring"),
    web("ring", "pinky"),
  ];

  const thumbMcp = thumb.joints[0];
  const thumbIp = thumb.joints[1];
  const indexMcp = fingers.index.joints[0];

  // The thumb's web: from its knuckle a quarter up its first bone, sagging in to
  // the side of the index knuckle. Sampled as a curve so it reads as skin.
  const webStart = lerp3(thumbMcp, thumbIp, 0.22);
  const webEnd = add(indexMcp, [0.7, -0.75, 0]);
  const sag = lerp3(lerp3(webStart, webEnd, 0.5), [1.2, 5.6, 0.4], 0.38);
  const webCurve: Vec3[] = [];

  for (let step = 0; step <= 8; step += 1) {
    const t = step / 8;
    webCurve.push(lerp3(lerp3(webStart, sag, t), lerp3(sag, webEnd, t), t));
  }

  const anchor = add(indexMcp, [0.4, -2.4, 0]);
  // The first triangle fills between the ball of the thumb and the web, which the
  // hull and the thenar otherwise leave as a sliver of gap — and a gap inside a
  // union is outlined, as a hole.
  const thumbWeb = [
    [[1.45, 1.5, 0.4] as Vec3, thumbMcp, anchor],
    [thumbMcp, webStart, anchor],
    ...webCurve.slice(1).map((point, index) => [webCurve[index], point, anchor]),
  ].map((triangle) => triangle.map(view.point));

  return {
    pose,
    mirrored,
    wrist: view.point([0, 0, 0]),
    thumbCmc: view.point(thumb.cmc),
    digits,
    palmNormal: view.direction([0, 0, 1]),
    palmCentre: view.point([0, 5, 0]),
    across: view.direction([1, 0, 0]),
    up: view.direction([0, 1, 0]),
    knuckles: (["index", "middle", "ring", "pinky"] as const).map((digit) => ({
      centre: view.point(fingers[digit].joints[0]),
      radius: fingers[digit].radii[0],
    })),
    palm,
    thenar: {
      from: view.point([1.45, 1.5, 0.4]),
      to: view.point(thumbMcp),
      fromRadius: 1.55,
      toRadius: THUMB_RADII[0],
    },
    forearm: {
      from: view.point([0, 0.6, 0]),
      to: view.point([0, -5.5, -0.2]),
      fromRadius: 2.6,
      toRadius: 2.8,
    },
    fade: { from: view.point([0, -0.6, 0]), to: view.point([0, -4.6, 0]) },
    thumbWeb,
    palmCreases: PALM_CREASES.map((line) => line.map(([x, y]) => view.point([x, y, PALM_SURFACE]))),
  };
}

export interface LandmarkPlacement {
  /** Where the pivot lands in the image, normalised. */
  readonly x?: number;
  readonly y?: number;
  /** The hand's length as a fraction of the image's width. */
  readonly size?: number;
}

/**
 * The posed hand as MediaPipe's 21 landmarks, in the *camera's* image.
 *
 * MediaPipe sees the unmirrored frame, so a mirrored view is reflected back first.
 * This is what lets the drawing be checked against the instrument: the test feeds
 * these to the very function that reads a player's hand, and asks whether it reads
 * the shape that was drawn.
 */
export function handLandmarks(hand: PosedHand, placement: LandmarkPlacement = {}): Hand {
  const { x = 0.5, y = 0.5, size = 0.3 } = placement;
  const k = size / HAND_LENGTH;
  const unmirror = hand.mirrored ? -1 : 1;

  const toImage = ([px, py, pz]: Vec3): Hand[number] => ({
    x: x + px * unmirror * k,
    y: y - py * k,
    // MediaPipe's depth is relative to the wrist and negative towards the camera.
    z: -(pz - hand.wrist[2]) * k,
    visibility: 1,
  });

  const thumb = hand.digits.thumb;
  const points: Vec3[] = [hand.wrist, hand.thumbCmc, thumb.joints[0], thumb.joints[1], thumb.tip];

  for (const digit of ["index", "middle", "ring", "pinky"] as const) {
    const { joints, tip } = hand.digits[digit];
    points.push(joints[0], joints[1], joints[2], tip);
  }

  return points.map(toImage);
}
