/**
 * Building blocks of the modal voices (piano, marimba, vibraphone): an instrument is a sum of
 * exponentially decaying sinusoids, one per vibration mode, plus a few filtered noise bursts for the
 * mechanics. Decaying phasors are exact and cost two multiplies per sample, so a note is cheap even
 * with dozens of modes; every mode stops as soon as it falls under the floor.
 */

import { cosRamp } from "../core";
import { Biquad } from "../filters";
import { WhiteNoise } from "../osc";

/** Components are dropped once they fall under this amplitude (about -110 dB). */
export const FLOOR = 3e-6;

/**
 * Decaying phasor: adds `amp * r^i * sin(w i)` over at most `maxCount` samples, into `l` with gain
 * `gl` and, when `r` is given, into `r` with gain `gr`.
 */
export const addPartial = (
  l: Float64Array,
  r: Float64Array | null,
  freq: number,
  lossDbPerSec: number,
  amp: number,
  gl: number,
  gr: number,
  maxCount: number,
  sr: number,
): void => {
  if (amp <= FLOOR) {
    return;
  }
  const decay = Math.pow(10, -lossDbPerSec / 20 / sr);
  const count = Math.min(maxCount, Math.ceil(Math.log(amp / FLOOR) / -Math.log(decay)));
  const w = (2 * Math.PI * freq) / sr;
  const c = decay * Math.cos(w);
  const s = decay * Math.sin(w);
  let re = amp;
  let im = 0;
  if (r === null) {
    for (let i = 0; i < count; i++) {
      l[i] += im * gl;
      const nre = re * c - im * s;
      im = re * s + im * c;
      re = nre;
    }
    return;
  }
  for (let i = 0; i < count; i++) {
    l[i] += im * gl;
    r[i] += im * gr;
    const nre = re * c - im * s;
    im = re * s + im * c;
    re = nre;
  }
};

/**
 * Band-passed noise burst with an exponential decay, normalized to about unit RMS at its start,
 * added from sample `from` into `l` (and `r` when given).
 */
export const addBurst = (
  l: Float64Array,
  r: Float64Array | null,
  seed: number,
  from: number,
  freq: number,
  q: number,
  time: number,
  level: number,
  sr: number,
): void => {
  if (level <= 0) {
    return;
  }
  const noise = new WhiteNoise(seed);
  const bp = new Biquad("bandpass", sr, freq, q);
  const bp2 = new Biquad("bandpass", sr, freq, q);
  const bandwidth = Math.min(1, freq / q / (sr / 2));
  const norm = (level * Math.sqrt(3)) / Math.sqrt(bandwidth);
  const count = Math.min(l.length - from, Math.round(time * 8 * sr));
  const k = Math.exp(-1 / (time * sr));
  const rise = Math.max(1, Math.round(0.0004 * sr));
  let env = 1;
  for (let i = 0; i < count; i++) {
    const y = bp2.process(bp.process(noise.next())) * norm * env * Math.min(1, (i + 1) / rise);
    l[from + i] += y;
    if (r !== null) {
      r[from + i] += y;
    }
    env *= k;
  }
};

/**
 * Felt damper from sample `gate` to the end of the channels: the decay rate ramps in over 20 ms
 * of contact (no click) toward a T60 of `t60` seconds, while a low-pass closes from 9 kHz to `lpTo`
 * Hz: the felt stops the high modes first.
 */
export const applyDamper = (
  channels: readonly Float64Array[],
  gate: number,
  t60: number,
  lpTo: number,
  sr: number,
): void => {
  const rampN = Math.round(0.02 * sr);
  const k = Math.log(1000) / (t60 * sr);
  const lpFrom = 9000;
  for (const ch of channels) {
    const n = ch.length;
    if (gate >= n) {
      continue;
    }
    let z = ch[gate];
    let g = 1;
    for (let i = gate; i < n; i++) {
      const x = i - gate;
      const w = cosRamp(x / rampN);
      g *= Math.exp(-k * w);
      const fc = lpFrom * Math.pow(lpTo / lpFrom, Math.min(1, x / (t60 * 0.6 * sr)));
      const c = 1 - Math.exp((-2 * Math.PI * fc) / sr);
      z += c * (ch[i] - z);
      ch[i] = (ch[i] + (z - ch[i]) * w) * g;
    }
  }
};
