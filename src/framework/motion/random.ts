/**
 * Deterministic randomness: same seed, same value, on every render and every machine.
 * Never use Math.random() in a composition.
 */

import { noise2D, noise3D } from "@remotion/noise";
import { random } from "remotion";

/** Uniform in [min, max). */
export const rand = (seed: string | number, min = 0, max = 1) => min + random(seed) * (max - min);

/** Uniform integer in [min, max]. */
export const randInt = (seed: string | number, min: number, max: number) =>
  Math.floor(rand(seed, min, max + 1));

export const pick = <T>(seed: string | number, items: readonly T[]): T => {
  if (items.length === 0) {
    throw new Error("pick() needs a non-empty list");
  }
  return items[randInt(seed, 0, items.length - 1)];
};

/** Smooth wobble in [-amp, amp]; `speed` is noise units per frame. */
export const wiggle = (seed: string, frame: number, speed = 0.02, amp = 1, lane = 0) =>
  noise2D(seed, frame * speed, lane) * amp;

/** Fractal noise (sum of octaves), roughly in [-1, 1]. */
export const fbm = (seed: string, x: number, y: number, z = 0, octaves = 4) => {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise3D(`${seed}-${o}`, x * freq, y * freq, z);
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
};

/** Fast seeded PRNG (mulberry32) for bulk generation (textures, particle fields). */
export const prng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};
