/**
 * Envelopes rendered to arrays: ADSR with curved segments, attack-decay shapes, exponential decays.
 * Curves: 0 is linear, positive values move fast at the start (natural decays), negative values
 * move slowly at the start (swells).
 */

import { clamp } from "./core";

/** Maps 0..1 to 0..1 with curvature `c`. */
export const curve = (x: number, c: number): number => {
  const t = clamp(x, 0, 1);
  if (Math.abs(c) < 1e-6) {
    return t;
  }
  return (1 - Math.exp(-c * t)) / (1 - Math.exp(-c));
};

export type AdsrOptions = {
  /** Seconds. */
  readonly attack: number;
  /** Seconds from peak to sustain. */
  readonly decay: number;
  /** Level 0..1. */
  readonly sustain: number;
  /** Seconds from gate end to zero. */
  readonly release: number;
  readonly attackCurve?: number;
  readonly decayCurve?: number;
  readonly releaseCurve?: number;
};

/** ADSR for a gate of `gate` seconds; the array covers gate plus release. */
export const adsr = (o: AdsrOptions, gate: number, sampleRate: number): Float32Array => {
  const gateN = Math.max(1, Math.round(gate * sampleRate));
  const relN = Math.max(1, Math.round(o.release * sampleRate));
  const attN = Math.max(1, Math.round(o.attack * sampleRate));
  const decN = Math.max(1, Math.round(o.decay * sampleRate));
  const ac = o.attackCurve ?? 1.5;
  const dc = o.decayCurve ?? 4;
  const rc = o.releaseCurve ?? 4;
  const env = new Float32Array(gateN + relN);
  let level = 0;
  for (let i = 0; i < gateN; i++) {
    if (i < attN) {
      level = curve(i / attN, ac);
    } else if (i < attN + decN) {
      level = 1 + (o.sustain - 1) * curve((i - attN) / decN, dc);
    } else {
      level = o.sustain;
    }
    env[i] = level;
  }
  const from = level;
  for (let i = 0; i < relN; i++) {
    env[gateN + i] = from * (1 - curve((i + 1) / relN, rc));
  }
  return env;
};

/**
 * Attack then exponential decay reaching -60 dB at `t60`: the shape of most percussive voices.
 * The array is `length` seconds long and fades to exactly zero over its last 2 ms.
 */
export const percEnv = (
  attack: number,
  t60: number,
  length: number,
  sampleRate: number,
  attackCurve = 1,
): Float32Array => {
  const n = Math.max(1, Math.round(length * sampleRate));
  const attN = Math.max(1, Math.round(attack * sampleRate));
  const k = Math.log(1000) / Math.max(1e-4, t60 * sampleRate);
  const tailN = Math.min(n, Math.round(0.002 * sampleRate));
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = i < attN ? curve(i / attN, attackCurve) : Math.exp(-k * (i - attN));
    const f = i >= n - tailN ? (n - 1 - i) / Math.max(1, tailN - 1) : 1;
    env[i] = a * f;
  }
  return env;
};

/** Multiplier for a per-sample exponential decay reaching -60 dB after `t60` seconds. */
export const decayCoef = (t60: number, sampleRate: number): number =>
  Math.exp(-Math.log(1000) / Math.max(1e-5, t60 * sampleRate));

/** Swell: rises with curve `rise` to 1 at fraction `peak` of the span, then falls with `fall`. */
export const swell = (
  length: number,
  sampleRate: number,
  peak = 0.8,
  rise = -3,
  fall = 3,
): Float32Array => {
  const n = Math.max(2, Math.round(length * sampleRate));
  const p = clamp(peak, 0, 1);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    env[i] =
      x <= p ? curve(p === 0 ? 1 : x / p, rise) : 1 - curve((x - p) / Math.max(1e-6, 1 - p), fall);
  }
  return env;
};
