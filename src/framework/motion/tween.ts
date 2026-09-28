/**
 * Frame-driven tweening primitives. Everything is a pure function of the frame.
 */

import { ease, type EasingFn } from "./easing";

export const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export const invLerp = (a: number, b: number, v: number) => (a === b ? 0 : (v - a) / (b - a));

/** Eased 0-1 progress of `frame` through [from, to], clamped. */
export const progress = (
  frame: number,
  from: number,
  to: number,
  easing: EasingFn = ease.linear,
): number => {
  if (to <= from) {
    return frame >= to ? 1 : 0;
  }
  return easing(clamp((frame - from) / (to - from)));
};

/** Value moving from `a` to `b` while `frame` goes through [from, to]. */
export const tween = (
  frame: number,
  from: number,
  to: number,
  a: number,
  b: number,
  easing: EasingFn = ease.out,
) => lerp(a, b, progress(frame, from, to, easing));

/** A keyframe: [frame, value, easing of the segment that arrives here]. */
export type Key = readonly [frame: number, value: number, easing?: EasingFn];

/** Piecewise keyframes, After Effects style. Holds the first/last value outside the range. */
export const keys = (frame: number, ks: readonly Key[]): number => {
  const first = ks[0];
  if (!first) {
    throw new Error("keys() needs at least one keyframe");
  }
  if (frame <= first[0]) {
    return first[1];
  }
  for (let i = 1; i < ks.length; i++) {
    const [f1, v1, easing] = ks[i];
    if (frame < f1) {
      const [f0, v0] = ks[i - 1];
      return lerp(v0, v1, progress(frame, f0, f1, easing ?? ease.inOut));
    }
  }
  return ks[ks.length - 1][1];
};

/** Start frame of item `i` in a staggered group. */
export const stagger = (i: number, each: number, start = 0) => start + i * each;

/** Stagger radiating from the middle item of `n`. */
export const staggerFromCenter = (i: number, n: number, each: number, start = 0) =>
  start + Math.abs(i - (n - 1) / 2) * each;

/** Smooth 0-1-0 bump over [from, to] (sine window). */
export const bump = (frame: number, from: number, to: number) => {
  const t = progress(frame, from, to);
  return Math.sin(t * Math.PI);
};
