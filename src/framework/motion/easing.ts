/**
 * Named easing curves, chosen by intent rather than by math.
 * Bezier values read like CSS cubic-bezier().
 */

import { Easing } from "remotion";

export type EasingFn = (t: number) => number;

export const ease = {
  linear: Easing.linear,
  /** Entrances: fast start, long soft landing (expo-out feel). */
  out: Easing.bezier(0.16, 1, 0.3, 1),
  /** Exits: soft start, leaves at full speed. */
  in: Easing.bezier(0.7, 0, 0.84, 0),
  /** Between two rest states. */
  inOut: Easing.bezier(0.83, 0, 0.17, 1),
  /** Gentler in-out for camera moves. */
  camera: Easing.bezier(0.65, 0, 0.35, 1),
  /** Overshoots the target, then settles. */
  back: Easing.bezier(0.34, 1.56, 0.64, 1),
  /** Pulls back before going: anticipation. */
  anticipate: Easing.bezier(0.6, -0.28, 0.735, 0.045),
  /** Violent snap for hits and cuts. */
  snap: Easing.bezier(0.9, 0, 0.1, 1),
  /** Hard deceleration (quint-out feel). */
  punch: Easing.bezier(0.22, 1, 0.36, 1),
  sine: Easing.inOut(Easing.sin),
} as const satisfies Record<string, EasingFn>;

/** Holds, then jumps: `n` discrete steps (stop-motion feel). */
export const steps =
  (n: number): EasingFn =>
  (t) =>
    t >= 1 ? 1 : Math.floor(t * n) / n;

/** Elastic settle; `bounces` sets how many wobbles are visible. */
export const elastic =
  (bounces = 3, decay = 6): EasingFn =>
  (t) =>
    t <= 0 ? 0 : t >= 1 ? 1 : 1 - Math.exp(-decay * t) * Math.cos(bounces * Math.PI * 2 * t);
