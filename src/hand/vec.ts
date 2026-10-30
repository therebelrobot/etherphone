/**
 * The little vector arithmetic the hand needs, and nothing more.
 *
 * Tuples rather than objects so a joint chain reads as arithmetic, and readonly so
 * a skeleton cannot be edited behind the figure built from it.
 */

export type Vec3 = readonly [number, number, number];
export type Vec2 = readonly [number, number];

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

export function normalize(a: Vec3): Vec3 {
  const size = length(a);
  return size === 0 ? [0, 0, 0] : scale(a, 1 / size);
}

export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const lerp3 = (a: Vec3, b: Vec3, t: number): Vec3 => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
  lerp(a[2], b[2], t),
];

/**
 * A direction part-way between two directions.
 *
 * Normalised lerp rather than a true slerp: the directions it blends are never
 * more than a right angle apart, and over that range the two are indistinguishable
 * in a drawing.
 */
export const blendDirection = (a: Vec3, b: Vec3, t: number): Vec3 => normalize(lerp3(a, b, t));

/** `a` with its component along the unit vector `axis` removed, renormalised. */
export function orthogonalTo(a: Vec3, axis: Vec3): Vec3 {
  return normalize(sub(a, scale(axis, dot(a, axis))));
}

/** Rotates `v` about the unit vector `axis` by `angle` radians (Rodrigues). */
export function rotate(v: Vec3, axis: Vec3, angle: number): Vec3 {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);

  return add(add(scale(v, cos), scale(cross(axis, v), sin)), scale(axis, dot(axis, v) * (1 - cos)));
}

export const degrees = (value: number): number => (value * Math.PI) / 180;

/** 0 below `edge0`, 1 above `edge1`, and a smooth ramp between. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}
