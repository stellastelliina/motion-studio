/**
 * Filters: RBJ cookbook biquads (Direct Form I, robust under coefficient modulation), one-pole
 * low/high-pass, parameter smoother, DC blocker.
 */

import { TAU, clamp, forEachChannel, type Stereo } from "./core";

export type BiquadType =
  | "lowpass"
  | "highpass"
  | "bandpass"
  | "notch"
  | "peaking"
  | "lowshelf"
  | "highshelf"
  | "allpass";

export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;

  constructor(
    private type: BiquadType,
    private readonly sampleRate: number,
    freq: number,
    q = Math.SQRT1_2,
    gainDb = 0,
  ) {
    this.set(freq, q, gainDb);
  }

  /** Recomputes the coefficients; call it every few samples to modulate. */
  set(freq: number, q = Math.SQRT1_2, gainDb = 0, type: BiquadType = this.type): void {
    this.type = type;
    const f = clamp(freq, 5, this.sampleRate * 0.49);
    const w0 = (TAU * f) / this.sampleRate;
    const cosw = Math.cos(w0);
    const sinw = Math.sin(w0);
    const alpha = sinw / (2 * Math.max(1e-3, q));
    const A = Math.pow(10, gainDb / 40);
    let b0: number;
    let b1: number;
    let b2: number;
    let a0: number;
    let a1: number;
    let a2: number;
    switch (type) {
      case "lowpass":
        b0 = (1 - cosw) / 2;
        b1 = 1 - cosw;
        b2 = b0;
        a0 = 1 + alpha;
        a1 = -2 * cosw;
        a2 = 1 - alpha;
        break;
      case "highpass":
        b0 = (1 + cosw) / 2;
        b1 = -(1 + cosw);
        b2 = b0;
        a0 = 1 + alpha;
        a1 = -2 * cosw;
        a2 = 1 - alpha;
        break;
      case "bandpass":
        b0 = alpha;
        b1 = 0;
        b2 = -alpha;
        a0 = 1 + alpha;
        a1 = -2 * cosw;
        a2 = 1 - alpha;
        break;
      case "notch":
        b0 = 1;
        b1 = -2 * cosw;
        b2 = 1;
        a0 = 1 + alpha;
        a1 = -2 * cosw;
        a2 = 1 - alpha;
        break;
      case "allpass":
        b0 = 1 - alpha;
        b1 = -2 * cosw;
        b2 = 1 + alpha;
        a0 = 1 + alpha;
        a1 = -2 * cosw;
        a2 = 1 - alpha;
        break;
      case "peaking":
        b0 = 1 + alpha * A;
        b1 = -2 * cosw;
        b2 = 1 - alpha * A;
        a0 = 1 + alpha / A;
        a1 = -2 * cosw;
        a2 = 1 - alpha / A;
        break;
      case "lowshelf": {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 - (A - 1) * cosw + s);
        b1 = 2 * A * (A - 1 - (A + 1) * cosw);
        b2 = A * (A + 1 - (A - 1) * cosw - s);
        a0 = A + 1 + (A - 1) * cosw + s;
        a1 = -2 * (A - 1 + (A + 1) * cosw);
        a2 = A + 1 + (A - 1) * cosw - s;
        break;
      }
      default: {
        const s = 2 * Math.sqrt(A) * alpha;
        b0 = A * (A + 1 + (A - 1) * cosw + s);
        b1 = -2 * A * (A - 1 + (A + 1) * cosw);
        b2 = A * (A + 1 + (A - 1) * cosw - s);
        a0 = A + 1 - (A - 1) * cosw + s;
        a1 = 2 * (A - 1 - (A + 1) * cosw);
        a2 = A + 1 - (A - 1) * cosw - s;
      }
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  process(x: number): number {
    const y =
      this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    // Flush denormals: long tails otherwise slow the filter down to a crawl.
    this.y1 = Math.abs(y) < 1e-20 ? 0 : y;
    return this.y1;
  }

  reset(): void {
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
  }
}

export type FilterSpec = {
  readonly type: BiquadType;
  /** Hz. */
  readonly freq: number;
  readonly q?: number;
  /** dB, for peaking and shelves. */
  readonly gain?: number;
};

/** Filters a channel in place with a static biquad. */
export const filterChannel = (ch: Float32Array, spec: FilterSpec, sampleRate: number): void => {
  const f = new Biquad(spec.type, sampleRate, spec.freq, spec.q ?? Math.SQRT1_2, spec.gain ?? 0);
  for (let i = 0; i < ch.length; i++) {
    ch[i] = f.process(ch[i]);
  }
};

/** Filters every channel of a buffer in place (a mono buffer once). */
export const filterStereo = (s: Stereo, spec: FilterSpec, sampleRate: number): void => {
  forEachChannel(s, (ch) => filterChannel(ch, spec, sampleRate));
};

/**
 * Filters a channel in place with a modulated cutoff: `freqAt(i)` is sampled every `every` samples.
 * Direct Form I keeps sweeps click-free.
 */
export const sweepChannel = (
  ch: Float32Array,
  type: BiquadType,
  freqAt: (i: number) => number,
  sampleRate: number,
  q = Math.SQRT1_2,
  every = 16,
  from = 0,
  to = ch.length,
): void => {
  const f = new Biquad(type, sampleRate, freqAt(from), q);
  for (let i = from; i < to; i++) {
    if ((i - from) % every === 0) {
      f.set(freqAt(i), q);
    }
    ch[i] = f.process(ch[i]);
  }
};

/** One-pole low-pass or high-pass (6 dB/oct). */
export class OnePole {
  private a: number;
  private z = 0;

  constructor(
    private readonly sampleRate: number,
    freq: number,
    private readonly mode: "lowpass" | "highpass" = "lowpass",
  ) {
    this.a = 0;
    this.setFreq(freq);
  }

  setFreq(freq: number): void {
    this.a = 1 - Math.exp((-TAU * clamp(freq, 0.1, this.sampleRate * 0.49)) / this.sampleRate);
  }

  process(x: number): number {
    this.z += this.a * (x - this.z);
    if (Math.abs(this.z) < 1e-20) {
      this.z = 0;
    }
    return this.mode === "lowpass" ? this.z : x - this.z;
  }

  reset(): void {
    this.z = 0;
  }
}

/** Exponential parameter smoother with a time constant in seconds. */
export class Smoother {
  private readonly a: number;

  constructor(
    seconds: number,
    sampleRate: number,
    private value = 0,
  ) {
    this.a = 1 - Math.exp(-1 / Math.max(1, seconds * sampleRate));
  }

  next(target: number): number {
    this.value += this.a * (target - this.value);
    return this.value;
  }
}

/** First-order DC blocker, corner around 5 Hz at 48 kHz. */
export class DcBlocker {
  private x1 = 0;
  private y1 = 0;
  private readonly r: number;

  constructor(sampleRate: number, corner = 5) {
    this.r = 1 - (TAU * corner) / sampleRate;
  }

  process(x: number): number {
    const y = x - this.x1 + this.r * this.y1;
    this.x1 = x;
    this.y1 = Math.abs(y) < 1e-20 ? 0 : y;
    return this.y1;
  }
}

export type SvfMode = "lowpass" | "bandpass" | "highpass";

/**
 * Zero-delay-feedback state variable filter (Simper's trapezoidal SVF): 12 dB/oct, stable and
 * artifact-free under audio-rate cutoff modulation, where a biquad in Direct Form I would zipper or
 * blow up. Cascade two for a 24 dB/oct analog-style low-pass.
 */
export class Svf {
  private k = Math.SQRT2;
  private a1 = 0;
  private a2 = 0;
  private a3 = 0;
  private ic1 = 0;
  private ic2 = 0;

  constructor(
    private readonly mode: SvfMode,
    private readonly sampleRate: number,
    freq: number,
    q = Math.SQRT1_2,
  ) {
    this.set(freq, q);
  }

  set(freq: number, q = Math.SQRT1_2): void {
    const g = Math.tan((Math.PI * clamp(freq, 5, this.sampleRate * 0.45)) / this.sampleRate);
    this.k = 1 / Math.max(1e-3, q);
    this.a1 = 1 / (1 + g * (g + this.k));
    this.a2 = g * this.a1;
    this.a3 = g * this.a2;
  }

  process(x: number): number {
    const v3 = x - this.ic2;
    const v1 = this.a1 * this.ic1 + this.a2 * v3;
    const v2 = this.ic2 + this.a2 * this.ic1 + this.a3 * v3;
    this.ic1 = 2 * v1 - this.ic1;
    this.ic2 = 2 * v2 - this.ic2;
    if (Math.abs(this.ic1) < 1e-20) {
      this.ic1 = 0;
    }
    if (Math.abs(this.ic2) < 1e-20) {
      this.ic2 = 0;
    }
    return this.mode === "lowpass" ? v2 : this.mode === "bandpass" ? v1 : x - this.k * v1 - v2;
  }

  reset(): void {
    this.ic1 = this.ic2 = 0;
  }
}

/**
 * 24 dB/oct low-pass: two cascaded SVFs with Butterworth damping. `resonance` 0..1 raises the Q of
 * the second stage up to a soft, singing peak (never self-oscillating).
 */
export class LowPass24 {
  private readonly a: Svf;
  private readonly b: Svf;

  constructor(sampleRate: number, freq: number, resonance = 0) {
    this.a = new Svf("lowpass", sampleRate, freq, 0.5412);
    this.b = new Svf("lowpass", sampleRate, freq, 1.3066);
    this.set(freq, resonance);
  }

  set(freq: number, resonance = 0): void {
    this.a.set(freq, 0.5412);
    this.b.set(freq, 1.3066 + 5 * clamp(resonance, 0, 1) ** 2);
  }

  process(x: number): number {
    return this.b.process(this.a.process(x));
  }
}
