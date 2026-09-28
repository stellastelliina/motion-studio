/**
 * Oscillators and noise. Saw and square are band-limited with PolyBLEP; the triangle is naive
 * (its harmonics fall at 12 dB/oct, aliasing stays far below audibility at musical pitches).
 */

import { TAU } from "./core";
import { Rng } from "./random";

/** Two-sample polynomial band-limited step residual. */
export const polyBlep = (t: number, dt: number): number => {
  if (t < dt) {
    const x = t / dt;
    return x + x - x * x - 1;
  }
  if (t > 1 - dt) {
    const x = (t - 1) / dt;
    return x * x + x + x + 1;
  }
  return 0;
};

export type Waveform = "sine" | "saw" | "square" | "triangle";

export class Oscillator {
  private phase: number;

  constructor(
    private readonly shape: Waveform,
    private readonly sampleRate: number,
    phase = 0,
  ) {
    this.phase = phase - Math.floor(phase);
  }

  /** Next sample at `freq` Hz; `pulseWidth` shapes the square. */
  next(freq: number, pulseWidth = 0.5): number {
    const dt = Math.min(Math.abs(freq) / this.sampleRate, 0.5);
    const t = this.phase;
    let y: number;
    switch (this.shape) {
      case "sine":
        y = Math.sin(TAU * t);
        break;
      case "saw":
        y = 2 * t - 1 - polyBlep(t, dt);
        break;
      case "square": {
        y = t < pulseWidth ? 1 : -1;
        y += polyBlep(t, dt);
        const tf = t - pulseWidth;
        y -= polyBlep(tf < 0 ? tf + 1 : tf, dt);
        break;
      }
      default:
        y = 4 * Math.abs(t - 0.5) - 1;
    }
    this.phase = t + dt;
    if (this.phase >= 1) {
      this.phase -= 1;
    }
    return y;
  }
}

export class WhiteNoise {
  private readonly rng: Rng;

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  next(): number {
    return this.rng.bipolar();
  }
}

/** Paul Kellet's refined pink filter on seeded white noise (about -3 dB/oct, peak near 1). */
export class PinkNoise {
  private readonly rng: Rng;
  private b0 = 0;
  private b1 = 0;
  private b2 = 0;
  private b3 = 0;
  private b4 = 0;
  private b5 = 0;
  private b6 = 0;

  constructor(seed: number) {
    this.rng = new Rng(seed);
  }

  next(): number {
    const w = this.rng.bipolar();
    this.b0 = 0.99886 * this.b0 + w * 0.0555179;
    this.b1 = 0.99332 * this.b1 + w * 0.0750759;
    this.b2 = 0.969 * this.b2 + w * 0.153852;
    this.b3 = 0.8665 * this.b3 + w * 0.3104856;
    this.b4 = 0.55 * this.b4 + w * 0.5329522;
    this.b5 = -0.7616 * this.b5 - w * 0.016898;
    const pink = this.b0 + this.b1 + this.b2 + this.b3 + this.b4 + this.b5 + this.b6 + w * 0.5362;
    this.b6 = w * 0.115926;
    return pink * 0.11;
  }
}

export type NoiseColor = "white" | "pink";

export const createNoise = (color: NoiseColor, seed: number): WhiteNoise | PinkNoise =>
  color === "pink" ? new PinkNoise(seed) : new WhiteNoise(seed);

/**
 * Smooth deterministic wander in about -1..1: three slow sines with seeded rates and phases. It is
 * the slow pitch drift of a free-running analog oscillator, or the unsteadiness of a held voice.
 * `rate` is the mean rate in Hz; the three components spread from 0.45 to 1.6 times it.
 */
export class Drift {
  private readonly c = new Float64Array(3);
  private readonly s = new Float64Array(3);
  private readonly rc = new Float64Array(3);
  private readonly rs = new Float64Array(3);
  private counter = 0;

  constructor(seed: number, rate: number, sampleRate: number) {
    const rng = new Rng(seed);
    const spread = [0.45, 1, 1.6];
    for (let k = 0; k < 3; k++) {
      const phase = rng.next() * 2 * Math.PI;
      const w = (2 * Math.PI * rate * spread[k] * (0.8 + 0.4 * rng.next())) / sampleRate;
      this.c[k] = Math.cos(phase);
      this.s[k] = Math.sin(phase);
      this.rc[k] = Math.cos(w);
      this.rs[k] = Math.sin(w);
    }
  }

  next(): number {
    const { c, s, rc, rs } = this;
    for (let k = 0; k < 3; k++) {
      const nc = c[k] * rc[k] - s[k] * rs[k];
      s[k] = s[k] * rc[k] + c[k] * rs[k];
      c[k] = nc;
    }
    const y = 0.5 * s[0] + 0.3 * s[1] + 0.2 * s[2];
    if (++this.counter === 4096) {
      this.counter = 0;
      for (let k = 0; k < 3; k++) {
        const r = Math.hypot(c[k], s[k]);
        c[k] /= r;
        s[k] /= r;
      }
    }
    return y;
  }
}
