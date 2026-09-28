/**
 * Meters: ITU-R BS.1770-4 loudness (K-weighting, 400 ms blocks with 75% overlap, absolute and
 * relative gating), 4x oversampled true peak, sample peak, DC offset.
 */

import { forEachChannel, type Stereo } from "./core";

type Coefs = { b0: number; b1: number; b2: number; a1: number; a2: number };

/** K-weighting for any sample rate, with the same derivation as libebur128. */
const kWeighting = (sampleRate: number): readonly [Coefs, Coefs] => {
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * 1681.974450955533) / sampleRate);
  const vh = Math.pow(10, G / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  let a0 = 1 + K / Q + K * K;
  const shelf = {
    b0: (vh + (vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - vh)) / a0,
    b2: (vh - (vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * 38.13547087602444) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const highpass = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  return [shelf, highpass];
};

const runBiquad = (input: Float64Array, c: Coefs): void => {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < input.length; i++) {
    const x = input[i];
    const y = c.b0 * x + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    input[i] = y;
  }
};

/** Prefix sums of the K-weighted power summed over channels (L/R weights are 1). */
const weightedPowerPrefix = (s: Stereo, sampleRate: number): Float64Array => {
  const n = s.l.length;
  const [shelf, highpass] = kWeighting(sampleRate);
  const power = new Float64Array(n);
  for (const ch of [s.l, s.r]) {
    const w = Float64Array.from(ch);
    runBiquad(w, shelf);
    runBiquad(w, highpass);
    for (let i = 0; i < n; i++) {
      power[i] += w[i] * w[i];
    }
  }
  const prefix = new Float64Array(n + 1);
  for (let i = 0; i < n; i++) {
    prefix[i + 1] = prefix[i] + power[i];
  }
  return prefix;
};

const toLufs = (meanPower: number): number =>
  meanPower > 0 ? -0.691 + 10 * Math.log10(meanPower) : -Infinity;

export type LoudnessMeter = {
  /** Gated integrated loudness in LUFS. */
  readonly integrated: () => number;
  /** Highest momentary (400 ms) loudness. */
  readonly momentaryMax: () => number;
  /** Highest short-term (3 s) loudness. */
  readonly shortTermMax: () => number;
  /** Loudness range in LU (EBU Tech 3342): spread of gated short-term loudness, 10th to 95th percentile. */
  readonly loudnessRange: () => number;
  /** Ungated loudness of a time range in seconds, for per-section and per-bus balance. */
  readonly range: (fromSec: number, toSec: number) => number;
};

export const loudnessMeter = (s: Stereo, sampleRate: number): LoudnessMeter => {
  const prefix = weightedPowerPrefix(s, sampleRate);
  const n = s.l.length;
  const mean = (a: number, b: number) => (b > a ? (prefix[b] - prefix[a]) / (b - a) : 0);
  const blocks = (windowSec: number): number[] => {
    const size = Math.round(windowSec * sampleRate);
    const step = Math.round(0.1 * sampleRate);
    const out: number[] = [];
    for (let start = 0; start + size <= n; start += step) {
      out.push(mean(start, start + size));
    }
    return out;
  };
  const maxLufs = (powers: number[]) => powers.reduce((m, p) => Math.max(m, toLufs(p)), -Infinity);
  return {
    integrated: () => {
      const z = blocks(0.4);
      const absolute = z.filter((p) => toLufs(p) > -70);
      if (absolute.length === 0) {
        return -Infinity;
      }
      const relGate = toLufs(absolute.reduce((a, b) => a + b, 0) / absolute.length) - 10;
      const gated = absolute.filter((p) => toLufs(p) > relGate);
      return toLufs(gated.reduce((a, b) => a + b, 0) / gated.length);
    },
    momentaryMax: () => maxLufs(blocks(0.4)),
    loudnessRange: () => {
      const st = blocks(3).filter((p) => toLufs(p) > -70);
      if (st.length === 0) {
        return 0;
      }
      const gate = toLufs(st.reduce((a, b) => a + b, 0) / st.length) - 20;
      const values = st
        .map(toLufs)
        .filter((l) => l > gate)
        .sort((a, b) => a - b);
      const pct = (q: number) =>
        values[Math.min(values.length - 1, Math.max(0, Math.round(q * (values.length - 1))))];
      return pct(0.95) - pct(0.1);
    },
    shortTermMax: () => maxLufs(blocks(3)),
    range: (fromSec, toSec) =>
      toLufs(
        mean(
          Math.max(0, Math.round(fromSec * sampleRate)),
          Math.min(n, Math.round(toSec * sampleRate)),
        ),
      ),
  };
};

export const integratedLoudness = (s: Stereo, sampleRate: number): number =>
  loudnessMeter(s, sampleRate).integrated();

// 4x oversampling (192 kHz at 48 kHz, as ffmpeg's ebur128 true-peak mode) with a long, sharp
// interpolator: short filters under-read peaks driven by content near Nyquist.
const TAPS = 32;
const HALF = TAPS / 2;
const PHASES = 4;

const besselI0 = (x: number): number => {
  let sum = 1;
  let term = 1;
  for (let k = 1; k < 32; k++) {
    term *= (x / (2 * k)) * (x / (2 * k));
    sum += term;
  }
  return sum;
};

/** Kaiser-windowed sinc interpolators for the fractional positions 1/4, 2/4, 3/4. */
const INTERPOLATORS: readonly Float64Array[] = (() => {
  const beta = 9;
  const phases: Float64Array[] = [];
  for (let p = 1; p < PHASES; p++) {
    const c = new Float64Array(TAPS);
    let sum = 0;
    for (let j = 0; j < TAPS; j++) {
      const tau = p / PHASES - (j - (HALF - 1));
      const sinc = Math.sin(Math.PI * tau) / (Math.PI * tau);
      const r = tau / HALF;
      const w = besselI0(beta * Math.sqrt(Math.max(0, 1 - r * r))) / besselI0(beta);
      c[j] = sinc * w;
      sum += c[j];
    }
    for (let j = 0; j < TAPS; j++) {
      c[j] /= sum;
    }
    phases.push(c);
  }
  return phases;
})();

/**
 * Per-sample true-peak envelope of a channel: the largest absolute value among the sample and the
 * 4x interpolated points on both sides of it.
 */
export const truePeakEnvelope = (ch: Float32Array): Float32Array => {
  const n = ch.length;
  const padded = new Float64Array(n + TAPS * 2);
  padded.set(ch, TAPS);
  // between[i] = max |interpolated| on the interval (i, i + 1).
  const between = new Float64Array(n + 1);
  for (let i = -1; i < n; i++) {
    const base = i + TAPS - (HALF - 1);
    let m = 0;
    for (const c of INTERPOLATORS) {
      let acc = 0;
      for (let j = 0; j < TAPS; j++) {
        acc += c[j] * padded[base + j];
      }
      const a = Math.abs(acc);
      if (a > m) {
        m = a;
      }
    }
    between[i + 1] = m;
  }
  const env = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    env[i] = Math.max(Math.abs(ch[i]), between[i], between[i + 1]);
  }
  return env;
};

/** True peak (linear) with 4x oversampling. */
export const truePeak = (s: Stereo): number => {
  let peak = 0;
  forEachChannel(s, (ch) => {
    const env = truePeakEnvelope(ch);
    for (let i = 0; i < env.length; i++) {
      if (env[i] > peak) {
        peak = env[i];
      }
    }
  });
  return peak;
};

export const samplePeak = (s: Stereo): number => {
  let peak = 0;
  forEachChannel(s, (ch) => {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i]);
      if (a > peak) {
        peak = a;
      }
    }
  });
  return peak;
};

/** Mean value of each channel. */
export const dcOffset = (s: Stereo): readonly [number, number] => {
  const mean = (ch: Float32Array) => {
    let sum = 0;
    for (let i = 0; i < ch.length; i++) {
      sum += ch[i];
    }
    return ch.length > 0 ? sum / ch.length : 0;
  };
  return [mean(s.l), mean(s.r)];
};
