/**
 * Offline analysis for verification: onset detection around expected times, silence checks.
 */

import { gainToDb, type Stereo } from "./core";

export type OnsetMatch = {
  /** Expected time in seconds. */
  readonly expected: number;
  /** Detected onset time in seconds, or null when nothing rises near it. */
  readonly detected: number | null;
  /** detected - expected, in milliseconds. */
  readonly errorMs: number | null;
  /** Energy rise in dB across the onset. */
  readonly riseDb: number;
};

/**
 * Finds the energy onset nearest to `expected`: the steepest rise of short-window energy
 * (0.5 ms hop) within `searchMs`, refined back to where the rise begins.
 */
export const findOnset = (
  s: Stereo,
  sampleRate: number,
  expected: number,
  searchMs = 25,
): OnsetMatch => {
  const hop = Math.max(1, Math.round(0.0005 * sampleRate));
  const win = Math.max(hop, Math.round(0.003 * sampleRate));
  const center = Math.round(expected * sampleRate);
  const reach = Math.round((searchMs / 1000) * sampleRate);
  const energyAt = (start: number) => {
    let e = 0;
    for (let i = start; i < start + win; i++) {
      if (i >= 0 && i < s.l.length) {
        e += s.l[i] * s.l[i] + s.r[i] * s.r[i];
      }
    }
    return e / win;
  };
  const lag = Math.round(0.006 * sampleRate);
  let best = -Infinity;
  let bestAt = -1;
  for (let p = center - reach; p <= center + reach; p += hop) {
    const after = energyAt(p);
    const before = energyAt(p - lag);
    const rise = 10 * Math.log10((after + 1e-12) / (before + 1e-12));
    if (rise > best) {
      best = rise;
      bestAt = p;
    }
  }
  if (bestAt < 0 || best < 3) {
    return { expected, detected: null, errorMs: null, riseDb: best };
  }
  // The window starting at bestAt contains the attack; walk back to the first sample of it.
  const floor = energyAt(bestAt - lag);
  let start = bestAt;
  const peakAbs = Math.sqrt(energyAt(bestAt));
  const threshold = Math.max(Math.sqrt(floor) * 2, peakAbs * 0.1);
  for (let i = bestAt - lag; i < bestAt + win; i++) {
    if (i >= 0 && Math.max(Math.abs(s.l[i]), Math.abs(s.r[i])) > threshold) {
      start = i;
      break;
    }
  }
  const detected = start / sampleRate;
  return { expected, detected, errorMs: (detected - expected) * 1000, riseDb: best };
};

/** Peak level in dBFS over a time range (seconds): -Infinity is true digital silence. */
export const peakDbIn = (s: Stereo, sampleRate: number, fromSec: number, toSec: number): number => {
  const a = Math.max(0, Math.round(fromSec * sampleRate));
  const b = Math.min(s.l.length, Math.round(toSec * sampleRate));
  let p = 0;
  for (let i = a; i < b; i++) {
    p = Math.max(p, Math.abs(s.l[i]), Math.abs(s.r[i]));
  }
  return gainToDb(p);
};
