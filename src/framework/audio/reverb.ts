/**
 * Stereo reverb: 8-channel feedback delay network. Input goes through pre-delay and a band-limiting
 * EQ, then a 4-step Hadamard diffuser (dense early reflections), then 8 modulated delay lines mixed
 * by a Householder matrix with per-line RT60 gains and high-frequency damping. Output is 100% wet.
 */

import { Biquad, OnePole } from "./filters";
import { DelayLine } from "./effects";
import { Rng } from "./random";
import { TAU, type Stereo } from "./core";

export type ReverbOptions = {
  /** RT60 in seconds. */
  readonly decay: number;
  /** Scales every delay length: 1 is a large hall, 0.3 a small room. */
  readonly size?: number;
  /** Milliseconds. */
  readonly preDelay?: number;
  /** Low-pass inside the loop in Hz: lower is darker, highs die sooner. */
  readonly damping?: number;
  /** Input high-pass in Hz: keeps the tail out of the low end. */
  readonly lowCut?: number;
  /** Input low-pass in Hz. */
  readonly highCut?: number;
  /** Delay modulation depth in ms, the lushness of the tail. */
  readonly modulation?: number;
  /** Modulation rate in Hz. */
  readonly modRate?: number;
  /** Early reflections level (diffuser output), 0..1. */
  readonly early?: number;
  /** Output width: 1 natural, 0 mono. */
  readonly width?: number;
  readonly seed?: number;
};

const N = 8;
const STEPS = 4;
const INV_SQRT_N = 1 / Math.sqrt(N);

const hadamard = (a: Float64Array): void => {
  for (let h = 1; h < N; h *= 2) {
    for (let i = 0; i < N; i += h * 2) {
      for (let j = i; j < i + h; j++) {
        const x = a[j];
        const y = a[j + h];
        a[j] = x + y;
        a[j + h] = x - y;
      }
    }
  }
  for (let i = 0; i < N; i++) {
    a[i] *= INV_SQRT_N;
  }
};

type DiffusionStep = {
  readonly lines: DelayLine[];
  readonly delays: Int32Array;
  readonly order: Int32Array;
  readonly flips: Float64Array;
};

export class Reverb {
  private readonly pre: [DelayLine, DelayLine];
  private readonly preDelay: number;
  private readonly inFilters: Biquad[];
  private readonly steps: DiffusionStep[] = [];
  private readonly lines: DelayLine[] = [];
  private readonly lengths = new Float64Array(N);
  private readonly gains = new Float64Array(N);
  private readonly damp: OnePole[] = [];
  private readonly modCos = new Float64Array(N);
  private readonly modSin = new Float64Array(N);
  private readonly modRot = new Float64Array(N * 2);
  private readonly modDepth: number;
  private readonly early: number;
  private readonly width: number;
  private readonly a = new Float64Array(N);
  private readonly b = new Float64Array(N);
  private counter = 0;

  constructor(
    o: ReverbOptions,
    private readonly sampleRate: number,
  ) {
    const rng = new Rng(o.seed ?? 0x5eed);
    const size = o.size ?? 1;
    this.preDelay = Math.max(1, Math.round(((o.preDelay ?? 10) / 1000) * sampleRate));
    this.pre = [new DelayLine(this.preDelay + 1), new DelayLine(this.preDelay + 1)];
    this.inFilters = [0, 1].flatMap(() => [
      new Biquad("highpass", sampleRate, o.lowCut ?? 200, 0.6),
      new Biquad("lowpass", sampleRate, o.highCut ?? 9000, 0.6),
    ]);
    let range = 0.045 * size * sampleRate;
    for (let s = 0; s < STEPS; s++) {
      const delays = new Int32Array(N);
      const lines: DelayLine[] = [];
      for (let i = 0; i < N; i++) {
        delays[i] = Math.max(1, Math.round((range * (i + rng.next())) / N));
        lines.push(new DelayLine(delays[i] + 1));
      }
      const order = new Int32Array(N);
      order.forEach((_, i) => (order[i] = i));
      for (let i = N - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        const t = order[i];
        order[i] = order[j];
        order[j] = t;
      }
      const flips = new Float64Array(N).map(() => (rng.next() < 0.5 ? -1 : 1));
      this.steps.push({ lines, delays, order, flips });
      range *= 0.5;
    }
    this.modDepth = ((o.modulation ?? 0.35) / 1000) * sampleRate;
    const base = 0.075 * size * sampleRate;
    for (let i = 0; i < N; i++) {
      const len = base * Math.pow(2, (i + 0.5 * rng.next()) / N);
      this.lengths[i] = len;
      this.lines.push(new DelayLine(len + this.modDepth * 2 + 4));
      this.damp.push(new OnePole(sampleRate, o.damping ?? 6000, "lowpass"));
      const phase = rng.next() * TAU;
      this.modCos[i] = Math.cos(phase);
      this.modSin[i] = Math.sin(phase);
      const w = (TAU * (o.modRate ?? 0.3) * (0.7 + 0.6 * rng.next())) / sampleRate;
      this.modRot[i * 2] = Math.cos(w);
      this.modRot[i * 2 + 1] = Math.sin(w);
    }
    this.setDecay(o.decay);
    this.early = o.early ?? 0.25;
    this.width = o.width ?? 1;
  }

  /** Changes RT60 on the fly (per-line feedback gains). */
  setDecay(rt60: number): void {
    for (let i = 0; i < N; i++) {
      this.gains[i] = Math.pow(
        10,
        (-3 * this.lengths[i]) / (Math.max(0.05, rt60) * this.sampleRate),
      );
    }
  }

  /** Adds the wet signal of `input[from, to)` into `output`. */
  processRange(input: Stereo, output: Stereo, from: number, to: number): void {
    const a = this.a;
    const b = this.b;
    const [hpL, lpL, hpR, lpR] = this.inFilters;
    for (let n = from; n < to; n++) {
      this.pre[0].write(input.l[n]);
      this.pre[1].write(input.r[n]);
      const inL = lpL.process(hpL.process(this.pre[0].tap(this.preDelay)));
      const inR = lpR.process(hpR.process(this.pre[1].tap(this.preDelay)));
      for (let i = 0; i < N; i++) {
        a[i] = i % 2 === 0 ? inL : inR;
      }
      for (const step of this.steps) {
        for (let i = 0; i < N; i++) {
          step.lines[i].write(a[i]);
        }
        for (let i = 0; i < N; i++) {
          const src = step.order[i];
          b[i] = step.lines[src].tap(step.delays[src]) * step.flips[i];
        }
        hadamard(b);
        a.set(b);
      }
      let outL = 0;
      let outR = 0;
      let sum = 0;
      for (let i = 0; i < N; i++) {
        const c = this.modCos[i];
        const s = this.modSin[i];
        const rc = this.modRot[i * 2];
        const rs = this.modRot[i * 2 + 1];
        this.modCos[i] = c * rc - s * rs;
        this.modSin[i] = s * rc + c * rs;
        const delay = this.lengths[i] - this.modDepth * (1 + s);
        const y = this.damp[i].process(this.lines[i].read(delay)) * this.gains[i];
        b[i] = y;
        sum += y;
        if (i % 2 === 0) {
          outL += y;
        } else {
          outR += y;
        }
      }
      const house = (sum * 2) / N;
      for (let i = 0; i < N; i++) {
        this.lines[i].write(b[i] - house + a[i]);
      }
      let eL = 0;
      let eR = 0;
      for (let i = 0; i < N; i += 2) {
        eL += a[i];
        eR += a[i + 1];
      }
      outL = 0.5 * outL + this.early * 0.5 * eL;
      outR = 0.5 * outR + this.early * 0.5 * eR;
      const m = 0.5 * (outL + outR);
      const side = 0.5 * (outL - outR) * this.width;
      output.l[n] += m + side;
      output.r[n] += m - side;
      if (++this.counter === 4096) {
        this.counter = 0;
        this.renormalize();
      }
    }
  }

  /** Kills the tail: clears every line and filter state. */
  reset(): void {
    this.pre.forEach((d) => d.clear());
    this.inFilters.forEach((f) => f.reset());
    this.steps.forEach((s) => s.lines.forEach((d) => d.clear()));
    this.lines.forEach((d) => d.clear());
    this.damp.forEach((f) => f.reset());
  }

  private renormalize(): void {
    for (let i = 0; i < N; i++) {
      const r = Math.hypot(this.modCos[i], this.modSin[i]);
      this.modCos[i] /= r;
      this.modSin[i] /= r;
    }
  }
}
