/**
 * Effects: saturation, bitcrush, stereo width (mid/side), Haas widening, delay lines,
 * tempo-synced ping-pong delay.
 */

import { clamp, forEachChannel, type Stereo } from "./core";
import { Biquad, OnePole } from "./filters";

/** tanh waveshaper with unity small-signal gain; `asym` adds even harmonics (and DC, block it). */
export const saturate = (x: number, drive: number, asym = 0): number => {
  if (drive <= 0) {
    return x;
  }
  return Math.tanh(drive * (x + asym)) / drive - Math.tanh(drive * asym) / drive;
};

/** Saturates a buffer in place with a dry/wet mix. */
export const saturateStereo = (s: Stereo, drive: number, mix = 1, asym = 0): void => {
  if (drive <= 0 || mix <= 0) {
    return;
  }
  forEachChannel(s, (ch) => {
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      ch[i] = x + mix * (saturate(x, drive, asym) - x);
    }
  });
};

/** Bit depth and sample-rate reduction over `[from, to)`, in place. */
export const bitcrush = (
  s: Stereo,
  { bits = 8, downsample = 1, mix = 1 }: { bits?: number; downsample?: number; mix?: number },
  from = 0,
  to = s.l.length,
): void => {
  const levels = Math.pow(2, bits - 1);
  const hold = Math.max(1, Math.round(downsample));
  forEachChannel(s, (ch) => {
    let held = 0;
    for (let i = from; i < to; i++) {
      if ((i - from) % hold === 0) {
        held = Math.round(ch[i] * levels) / levels;
      }
      ch[i] += mix * (held - ch[i]);
    }
  });
};

/**
 * Mid/side width in place: 0 mono, 1 unchanged, above 1 wider. With `monoBelow` the side signal
 * is high-passed so the low end stays mono.
 */
export const widen = (s: Stereo, width: number, sampleRate: number, monoBelow = 0): void => {
  if (s.l === s.r) {
    return;
  }
  const hp = monoBelow > 0 ? new Biquad("highpass", sampleRate, monoBelow, 0.707) : null;
  for (let i = 0; i < s.l.length; i++) {
    const m = 0.5 * (s.l[i] + s.r[i]);
    let side = 0.5 * (s.l[i] - s.r[i]) * width;
    if (hp) {
      side = hp.process(side);
    }
    s.l[i] = m + side;
    s.r[i] = m - side;
  }
};

/** Haas widening: delays one side by a few milliseconds. Returns a new true-stereo buffer. */
export const haas = (
  s: Stereo,
  ms: number,
  sampleRate: number,
  side: "left" | "right" = "right",
): Stereo => {
  const d = Math.round((ms / 1000) * sampleRate);
  const l = s.l.slice();
  const r = s.r.slice();
  const target = side === "left" ? l : r;
  const source = side === "left" ? s.l : s.r;
  target.fill(0, 0, Math.min(d, target.length));
  for (let i = d; i < target.length; i++) {
    target[i] = source[i - d];
  }
  return { l, r };
};

/** Circular delay line with linear-interpolated fractional reads. */
export class DelayLine {
  private readonly buf: Float32Array;
  private pos = 0;

  constructor(maxSamples: number) {
    this.buf = new Float32Array(Math.max(2, Math.ceil(maxSamples) + 2));
  }

  write(x: number): void {
    this.buf[this.pos] = x;
    this.pos = this.pos + 1 === this.buf.length ? 0 : this.pos + 1;
  }

  /** Sample written `delay` samples ago (fractional allowed, at least 1 when read after write). */
  read(delay: number): number {
    const size = this.buf.length;
    let p = this.pos - delay;
    while (p < 0) {
      p += size;
    }
    const i = Math.floor(p);
    const f = p - i;
    const a = this.buf[i % size];
    const b = this.buf[(i + 1) % size];
    return a + (b - a) * f;
  }

  /** Integer-delay read, the fast path. */
  tap(delay: number): number {
    let p = this.pos - delay;
    if (p < 0) {
      p += this.buf.length;
    }
    return this.buf[p];
  }

  clear(): void {
    this.buf.fill(0);
  }
}

export type PingPongOptions = {
  /** Echo time in seconds (use grid spans for tempo sync). */
  readonly time: number;
  /** Round-trip feedback 0..0.95. */
  readonly feedback?: number;
  /** Low-pass in the loop, Hz: each repeat gets darker. */
  readonly damping?: number;
  /** High-pass in the loop, Hz: keeps repeats out of the low end. */
  readonly lowCut?: number;
};

/** Ping-pong delay: mono input, first echo left, then alternating. Output is 100% wet. */
export class PingPongDelay {
  private readonly left: DelayLine;
  private readonly right: DelayLine;
  private readonly d: number;
  private readonly fb: number;
  private readonly lp: OnePole;
  private readonly hp: OnePole;

  constructor(o: PingPongOptions, sampleRate: number) {
    this.d = Math.max(1, Math.round(o.time * sampleRate));
    this.left = new DelayLine(this.d + 1);
    this.right = new DelayLine(this.d + 1);
    this.fb = Math.sqrt(clamp(o.feedback ?? 0.35, 0, 0.95));
    this.lp = new OnePole(sampleRate, o.damping ?? 5000, "lowpass");
    this.hp = new OnePole(sampleRate, o.lowCut ?? 250, "highpass");
  }

  processRange(input: Stereo, output: Stereo, from: number, to: number): void {
    for (let i = from; i < to; i++) {
      const dl = this.left.tap(this.d);
      const dr = this.right.tap(this.d);
      const inMono = 0.5 * (input.l[i] + input.r[i]);
      const back = this.hp.process(this.lp.process(dr * this.fb));
      this.left.write(inMono + back);
      this.right.write(dl * this.fb);
      output.l[i] += dl;
      output.r[i] += dr;
    }
  }

  reset(): void {
    this.left.clear();
    this.right.clear();
    this.lp.reset();
    this.hp.reset();
  }
}
