/**
 * Drum voices: kick (also a tunable tom), clap, snare, closed and open hats.
 * All return buffers starting at the hit; mono voices share one array for both channels.
 */

import { TAU, fromMono, type Stereo } from "../core";
import { decayCoef, percEnv } from "../envelope";
import { Biquad } from "../filters";
import { Oscillator, WhiteNoise } from "../osc";
import type { VoiceEnv } from "./types";

export type KickOptions = {
  /** Body pitch at the end of the sweep in Hz: the tuning. */
  readonly tune?: number;
  /** Pitch at the start of the sweep in Hz. */
  readonly punch?: number;
  /** Pitch sweep time constant in seconds. */
  readonly sweep?: number;
  /** Seconds to -60 dB. */
  readonly decay?: number;
  /** Beater click level 0..1. */
  readonly click?: number;
  /** tanh drive, 0 = clean. */
  readonly drive?: number;
  /** 0..1. */
  readonly velocity?: number;
};

export const kick = (o: KickOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const tune = o.tune ?? 49;
  const punch = o.punch ?? 240;
  const sweep = o.sweep ?? 0.028;
  const decay = o.decay ?? 0.42;
  const click = o.click ?? 0.3;
  const drive = o.drive ?? 1.6;
  const vel = o.velocity ?? 1;
  const n = Math.round((decay + 0.02) * sr);
  const out = new Float32Array(n);
  const hold = Math.round(0.012 * sr);
  const k = decayCoef(decay, sr);
  const noise = new WhiteNoise(env.seed);
  const clickHp = new Biquad("highpass", sr, 1400, 0.7);
  const norm = drive > 0 ? Math.tanh(drive) : 1;
  let phase = 0;
  let amp = 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = tune + (punch - tune) * Math.exp(-t / sweep);
    phase += f / sr;
    if (i > hold) {
      amp *= k;
    }
    const attack = Math.min(1, i / (0.0006 * sr));
    const body = Math.sin(TAU * phase) * amp * attack;
    const c =
      click *
      (clickHp.process(noise.next()) * Math.exp(-t / 0.0009) +
        0.5 * Math.sin(TAU * 3100 * t) * Math.exp(-t / 0.0015));
    const x = body + c;
    out[i] = (drive > 0 ? Math.tanh(drive * x) / norm : x) * vel;
  }
  const tail = Math.round(0.004 * sr);
  for (let i = 0; i < tail; i++) {
    out[n - 1 - i] *= i / tail;
  }
  return fromMono(out);
};

export type ClapOptions = {
  /** Band center in Hz. */
  readonly tone?: number;
  /** Tail seconds to -60 dB. */
  readonly decay?: number;
  /** Milliseconds between the bursts. */
  readonly spread?: number;
  readonly bursts?: number;
  /** Stereo decorrelation 0..1. */
  readonly width?: number;
  readonly velocity?: number;
};

export const clap = (o: ClapOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const tone = o.tone ?? 1250;
  const decay = o.decay ?? 0.32;
  const spread = (o.spread ?? 9.5) / 1000;
  const bursts = o.bursts ?? 4;
  const width = o.width ?? 0.35;
  const vel = o.velocity ?? 1;
  const tailStart = spread * (bursts - 1);
  const n = Math.round((tailStart + decay + 0.01) * sr);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const common = new WhiteNoise(env.seed);
  const nl = new WhiteNoise(env.seed + 1);
  const nr = new WhiteNoise(env.seed + 2);
  const filters = [0, 1].map(() => ({
    bp: new Biquad("bandpass", sr, tone, 1.1),
    hp: new Biquad("highpass", sr, 2600, 0.7),
    lo: new Biquad("highpass", sr, 450, 0.7),
  }));
  const tailK = Math.log(1000) / decay;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    let e = 0;
    for (let b = 0; b < bursts - 1; b++) {
      const tb = t - b * spread;
      if (tb >= 0) {
        e += Math.min(1, tb / 0.0003) * Math.exp(-tb / 0.0024);
      }
    }
    const tt = t - tailStart;
    if (tt >= 0) {
      e += Math.min(1, tt / 0.0004) * Math.exp(-tt * tailK);
    }
    const c = common.next();
    const xs = [c * (1 - width) + nl.next() * width, c * (1 - width) + nr.next() * width];
    for (let ch = 0; ch < 2; ch++) {
      const f = filters[ch];
      const body = f.bp.process(xs[ch]) * 2.2 + f.hp.process(xs[ch]) * 0.35;
      (ch === 0 ? l : r)[i] = f.lo.process(body) * e * vel;
    }
  }
  return { l, r };
};

export type SnareOptions = {
  /** Body pitch in Hz. */
  readonly tune?: number;
  /** Noise tail seconds to -60 dB. */
  readonly decay?: number;
  /** Body level 0..1. */
  readonly body?: number;
  /** Noise level 0..1. */
  readonly snappy?: number;
  readonly velocity?: number;
};

export const snare = (o: SnareOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const tune = o.tune ?? 195;
  const decay = o.decay ?? 0.24;
  const bodyLevel = o.body ?? 0.55;
  const snappy = o.snappy ?? 0.85;
  const vel = o.velocity ?? 1;
  const n = Math.round((decay + 0.02) * sr);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const noises = [new WhiteNoise(env.seed), new WhiteNoise(env.seed + 7)];
  const shaping = [0, 1].map(() => ({
    hp: new Biquad("highpass", sr, 1100, 0.7),
    pk: new Biquad("peaking", sr, 5200, 0.9, 4),
  }));
  const envNoise = percEnv(0.0005, decay, n / sr, sr);
  const envBody = percEnv(0.0005, Math.min(decay, 0.14), n / sr, sr);
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const bend = 1 + 0.35 * Math.exp(-t / 0.012);
    p1 += (tune * bend) / sr;
    p2 += (tune * 1.62 * bend) / sr;
    const body = (Math.sin(TAU * p1) + 0.55 * Math.sin(TAU * p2)) * envBody[i] * bodyLevel;
    for (let ch = 0; ch < 2; ch++) {
      const s = shaping[ch];
      const nz = s.pk.process(s.hp.process(noises[ch].next())) * envNoise[i] * snappy;
      (ch === 0 ? l : r)[i] = Math.tanh(1.3 * (body + nz)) * vel;
    }
  }
  return { l, r };
};

export type HatOptions = {
  readonly open?: boolean;
  /** Seconds to -60 dB (defaults: closed 0.07, open 0.5). */
  readonly decay?: number;
  /** High-pass corner in Hz. */
  readonly tone?: number;
  /** Metallic partials vs noise, 0..1. */
  readonly metal?: number;
  readonly velocity?: number;
};

const HAT_RATIOS = [205.3, 304.4, 369.6, 522.7, 540, 800];

export const hat = (o: HatOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const decay = o.decay ?? (o.open ? 0.5 : 0.07);
  const tone = o.tone ?? 7200;
  const metal = o.metal ?? 0.35;
  const vel = o.velocity ?? 1;
  const n = Math.round((decay + 0.01) * sr);
  const out = new Float32Array(n);
  const noise = new WhiteNoise(env.seed);
  const oscs = HAT_RATIOS.map(
    (_, i) => new Oscillator("square", sr, (env.seed % 97) / 97 + i * 0.13),
  );
  const hp1 = new Biquad("highpass", sr, tone, 0.7);
  const hp2 = new Biquad("highpass", sr, tone, 0.7);
  const air = new Biquad("peaking", sr, 11500, 0.8, 3);
  const e = percEnv(0.0002, decay, n / sr, sr, 1);
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (let k = 0; k < oscs.length; k++) {
      m += oscs[k].next(HAT_RATIOS[k] * 1.9);
    }
    const x = noise.next() * (1 - metal) + (m / oscs.length) * metal * 1.6;
    out[i] = air.process(hp2.process(hp1.process(x))) * e[i] * vel * 1.6;
  }
  return fromMono(out);
};

export type ShakerOptions = {
  /** Seconds of the swing into the peak (the beads travel), default 0.012. */
  readonly attack?: number;
  /** Seconds to -60 dB after the peak, default 0.09. */
  readonly decay?: number;
  /** Band center in Hz, default 7000. */
  readonly tone?: number;
  /** Bead collisions: 0 is smooth hiss, 1 is audibly grainy. Default 0.6. */
  readonly grain?: number;
  readonly velocity?: number;
};

/**
 * Shaker: many small beads hitting the shell. Noise band-passed high, shaped by a short swell
 * (the stroke) and modulated by a sparse train of decaying grains (the collisions).
 */
export const shaker = (o: ShakerOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const attack = o.attack ?? 0.012;
  const decay = o.decay ?? 0.09;
  const tone = o.tone ?? 7000;
  const grain = o.grain ?? 0.6;
  const vel = o.velocity ?? 1;
  const n = Math.round((attack + decay + 0.01) * sr);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const noises = [new WhiteNoise(env.seed), new WhiteNoise(env.seed + 1)];
  const beads = new WhiteNoise(env.seed + 2);
  const bands = [0, 1].map(() => ({
    bp: new Biquad("bandpass", sr, tone, 1.2),
    hp: new Biquad("highpass", sr, tone * 0.55, 0.7),
    lp: new Biquad("lowpass", sr, Math.min(sr * 0.45, tone * 2), 0.7),
  }));
  const attN = Math.max(1, Math.round(attack * sr));
  const k = decayCoef(decay, sr);
  const grainK = Math.exp(-1 / (0.0012 * sr));
  const fadeN = Math.round(0.003 * sr);
  let amp = 1;
  let g = 0;
  for (let i = 0; i < n; i++) {
    const shape = i < attN ? Math.pow(i / attN, 1.6) : (amp *= k);
    // About 2500 collisions per second at the peak, fewer as the stroke dies.
    if ((beads.next() + 1) * 0.5 < (2500 * Math.sqrt(shape)) / sr) {
      g = 1;
    }
    g *= grainK;
    const mod = 1 - grain + grain * g * 2.2;
    const f = i >= n - fadeN ? (n - 1 - i) / fadeN : 1;
    for (let c = 0; c < 2; c++) {
      const b = bands[c];
      const x = b.lp.process(b.hp.process(b.bp.process(noises[c].next()))) * 0.9;
      (c === 0 ? l : r)[i] = x * shape * mod * vel * f;
    }
  }
  return { l, r };
};

export type RimOptions = {
  /** Shell resonance in Hz, default 480. */
  readonly tune?: number;
  /** Seconds to -60 dB, default 0.07. */
  readonly decay?: number;
  /** Stick click level 0..1, default 0.5. */
  readonly click?: number;
  /** Shell body level 0..1, default 0.7. */
  readonly body?: number;
  readonly velocity?: number;
};

/**
 * Rimshot, played soft as a cross-stick: the stick on the rim gives a woody click, the shell
 * rings in two short modes (the second 3.4 times the first, like a thin wooden plate).
 */
export const rim = (o: RimOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const tune = o.tune ?? 480;
  const decay = o.decay ?? 0.07;
  const click = o.click ?? 0.5;
  const body = o.body ?? 0.7;
  const vel = o.velocity ?? 1;
  const n = Math.round((decay + 0.01) * sr);
  const out = new Float32Array(n);
  const noise = new WhiteNoise(env.seed);
  const clickBp = new Biquad("bandpass", sr, 3200, 1.1);
  const k1 = decayCoef(decay, sr);
  const k2 = decayCoef(decay * 0.45, sr);
  const attN = Math.max(1, Math.round(0.0004 * sr));
  const fadeN = Math.round(0.003 * sr);
  let a1 = 1;
  let a2 = 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    a1 *= k1;
    a2 *= k2;
    const bend = 1 + 0.06 * Math.exp(-t / 0.006);
    const shell =
      (Math.sin(TAU * tune * bend * t) * a1 + 0.5 * Math.sin(TAU * tune * 3.4 * t) * a2) * body;
    const c = clickBp.process(noise.next()) * Math.exp(-t / 0.0015) * click * 3;
    const att = Math.min(1, (i + 1) / attN);
    const f = i >= n - fadeN ? (n - 1 - i) / fadeN : 1;
    out[i] = Math.tanh(1.2 * (shell + c)) * att * f * vel;
  }
  return fromMono(out);
};
