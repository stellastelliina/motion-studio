/**
 * Dynamics: feed-forward compressor with sidechain input, and an offline lookahead brickwall
 * limiter with true-peak detection. Both process in place.
 */

import { dbToGain, gainToDb, type Stereo } from "./core";
import { truePeakEnvelope } from "./meter";

export type CompressorOptions = {
  /** dBFS. */
  readonly threshold: number;
  readonly ratio: number;
  /** Milliseconds. */
  readonly attack: number;
  /** Milliseconds. */
  readonly release: number;
  /** Soft knee width in dB, default 6. */
  readonly knee?: number;
  /** dB. */
  readonly makeup?: number;
  /** Largest gain reduction in dB: turns the compressor into a ducker with a fixed depth. */
  readonly range?: number;
  /** "peak" follows the key's peaks; "rms" averages over `rmsWindow` ms. */
  readonly detector?: "peak" | "rms";
  readonly rmsWindow?: number;
  /** Parallel mix, 1 = fully compressed. */
  readonly mix?: number;
};

export type DynamicsStats = { readonly maxReduction: number; readonly meanReduction: number };

/**
 * Stereo-linked compressor. With `key`, the detector listens to the key instead of the input:
 * that is the sidechain used to duck bass and pads under the kick.
 */
export const compress = (
  s: Stereo,
  o: CompressorOptions,
  sampleRate: number,
  key?: Float32Array,
): DynamicsStats => {
  const n = s.l.length;
  const knee = o.knee ?? 6;
  const slope = 1 / o.ratio - 1;
  const range = o.range ?? Infinity;
  const makeup = o.makeup ?? 0;
  const mix = o.mix ?? 1;
  const att = 1 - Math.exp(-1 / Math.max(1, (o.attack / 1000) * sampleRate));
  const rel = 1 - Math.exp(-1 / Math.max(1, (o.release / 1000) * sampleRate));
  const rmsCoef = 1 - Math.exp(-1 / Math.max(1, ((o.rmsWindow ?? 10) / 1000) * sampleRate));
  const rms = o.detector === "rms";
  const mono = s.l === s.r;
  let ms = 0;
  let gr = 0;
  let maxRed = 0;
  let sumRed = 0;
  for (let i = 0; i < n; i++) {
    let d = key ? Math.abs(key[i]) : Math.max(Math.abs(s.l[i]), Math.abs(s.r[i]));
    if (rms) {
      ms += rmsCoef * (d * d - ms);
      d = Math.sqrt(ms);
    }
    const over = gainToDb(d + 1e-12) - o.threshold;
    let target: number;
    if (2 * over < -knee) {
      target = 0;
    } else if (2 * Math.abs(over) <= knee) {
      target = (slope * (over + knee / 2) * (over + knee / 2)) / (2 * knee);
    } else {
      target = slope * over;
    }
    if (target < -range) {
      target = -range;
    }
    gr += (target < gr ? att : rel) * (target - gr);
    const g = dbToGain(gr + makeup);
    const k = mix * g + (1 - mix);
    s.l[i] *= k;
    if (!mono) {
      s.r[i] *= k;
    }
    if (-gr > maxRed) {
      maxRed = -gr;
    }
    sumRed -= gr;
  }
  return { maxReduction: maxRed, meanReduction: n > 0 ? sumRed / n : 0 };
};

export type LimiterOptions = {
  /** Ceiling in dBFS (true peak when `truePeak` is on). */
  readonly ceiling: number;
  /** Milliseconds, default 1.5. */
  readonly lookahead?: number;
  /** Milliseconds, default 80. */
  readonly release?: number;
  /** Detect inter-sample peaks with 4x oversampling, default true. */
  readonly truePeak?: boolean;
};

/**
 * Required gain per sample to keep a detection envelope under the ceiling.
 * Exposed so a loudness search can reuse one detection pass at several input gains.
 */
export const limiterDetect = (s: Stereo, truePeak = true): Float32Array => {
  const n = s.l.length;
  const envL = truePeak ? truePeakEnvelope(s.l) : s.l.map(Math.abs);
  const envR = s.l === s.r ? envL : truePeak ? truePeakEnvelope(s.r) : s.r.map(Math.abs);
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    env[i] = Math.max(envL[i], envR[i]);
  }
  return env;
};

/**
 * Zero-latency offline limiter. The gain at each sample is the minimum required gain over the
 * next `lookahead` samples, smoothed by a release follower and a box average of the same length:
 * every gain in the average already satisfies the peak it protects, so the ceiling holds exactly
 * on the detection envelope while attacks ramp linearly.
 */
export const limit = (
  s: Stereo,
  o: LimiterOptions,
  sampleRate: number,
  detection?: Float32Array,
  inputGain = 1,
): DynamicsStats => {
  const n = s.l.length;
  const env = detection ?? limiterDetect(s, o.truePeak ?? true);
  const ceiling = dbToGain(o.ceiling);
  const D = Math.max(1, Math.round(((o.lookahead ?? 1.5) / 1000) * sampleRate));
  const relCoef = 1 - Math.exp(-1 / Math.max(1, ((o.release ?? 80) / 1000) * sampleRate));
  const required = (i: number) => {
    const e = i < n ? env[i] * inputGain : 0;
    return e > ceiling ? ceiling / e : 1;
  };
  // Sliding minimum over [i, i + D] with a monotonic deque.
  const minAhead = new Float32Array(n);
  const dq = new Int32Array(n + D + 1);
  const dv = new Float32Array(n + D + 1);
  let head = 0;
  let tail = 0;
  for (let e = 0; e < n + D; e++) {
    const v = required(e);
    while (tail > head && dv[tail - 1] >= v) {
      tail--;
    }
    dq[tail] = e;
    dv[tail] = v;
    tail++;
    const start = e - D;
    if (start >= 0) {
      while (dq[head] < start) {
        head++;
      }
      minAhead[start] = dv[head];
    }
  }
  // Release follower: falls instantly, recovers exponentially, never above minAhead.
  const smooth = new Float32Array(n);
  let r = 1;
  for (let i = 0; i < n; i++) {
    const m = minAhead[i];
    r = m <= r ? m : r + (m - r) * relCoef;
    smooth[i] = r;
  }
  // Box average over [i - D, i].
  const mono = s.l === s.r;
  let acc = smooth[0] * (D + 1);
  let minG = 1;
  let sumRed = 0;
  for (let i = 0; i < n; i++) {
    if (i > 0) {
      acc += smooth[i] - (i - D - 1 >= 0 ? smooth[i - D - 1] : smooth[0]);
    }
    const g = Math.min(1, acc / (D + 1));
    const k = g * inputGain;
    s.l[i] *= k;
    if (!mono) {
      s.r[i] *= k;
    }
    if (g < minG) {
      minG = g;
    }
    sumRed -= gainToDb(g);
  }
  return { maxReduction: -gainToDb(minG), meanReduction: n > 0 ? sumRed / n : 0 };
};
