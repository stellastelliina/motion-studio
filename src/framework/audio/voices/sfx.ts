/**
 * Sound design voices: tick/click, whoosh, riser, crash, reverse swell (reverse reverb), impact.
 */

import {
  TAU,
  clamp,
  createStereo,
  expLerp,
  fromMono,
  panGains,
  reverse,
  type Stereo,
} from "../core";
import { curve, decayCoef, swell } from "../envelope";
import { Biquad, type BiquadType } from "../filters";
import {
  Oscillator,
  WhiteNoise,
  createNoise,
  polyBlep,
  type NoiseColor,
  type Waveform,
} from "../osc";
import { Rng } from "../random";
import { Reverb } from "../reverb";
import type { VoiceEnv } from "./types";

export type TickOptions = {
  /** Main resonance in Hz. */
  readonly freq?: number;
  /** Seconds to -60 dB. */
  readonly decay?: number;
  /** "click" is a bright digital tick, "wood" a two-mode woodblock clack. */
  readonly body?: "click" | "wood";
};

export const tick = (o: TickOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const freq = o.freq ?? 2600;
  const wood = o.body === "wood";
  const decay = o.decay ?? (wood ? 0.09 : 0.018);
  const n = Math.round((decay + 0.004) * sr);
  const out = new Float32Array(n);
  const noise = new WhiteNoise(env.seed);
  const bp = new Biquad("bandpass", sr, freq * (wood ? 1.3 : 1.6), wood ? 3 : 1.5);
  const k = decayCoef(decay, sr);
  const partial = wood ? 2.76 : 2.1;
  let amp = 1;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    amp *= k;
    const ping =
      Math.sin(TAU * freq * t) + (wood ? 0.45 : 0.3) * Math.sin(TAU * freq * partial * t) * amp;
    const burst = bp.process(noise.next()) * Math.exp(-t / 0.0007) * (wood ? 1.2 : 1.8);
    const attack = Math.min(1, i / (0.0002 * sr));
    const fade = i >= n - 48 ? (n - 1 - i) / 48 : 1;
    out[i] = (ping * amp * attack * 0.6 + burst) * fade;
  }
  return fromMono(out);
};

export type ToneLayer = {
  readonly from: number;
  readonly to: number;
  readonly level: number;
  readonly wave?: Waveform;
};

export type Flutter = {
  /** Pulse rate at the start and end in Hz: accelerating whips. */
  readonly from: number;
  readonly to: number;
  /** Amplitude modulation depth 0..1. */
  readonly depth: number;
  /** Pan swing synced to the pulses, 0..1. */
  readonly pan?: number;
};

export type WhooshOptions = {
  /** Seconds. */
  readonly length: number;
  /** Filter frequency at the start and end in Hz (exponential sweep). */
  readonly from?: number;
  readonly to?: number;
  readonly filter?: BiquadType;
  readonly q?: number;
  /** Curvature of the frequency sweep (0 = exponential). */
  readonly sweepCurve?: number;
  /** Where the swell peaks, 0..1 of the length. */
  readonly peak?: number;
  readonly rise?: number;
  readonly fall?: number;
  readonly panFrom?: number;
  readonly panTo?: number;
  readonly noise?: NoiseColor;
  /** Decorrelation between the channels 0..1. */
  readonly width?: number;
  readonly tone?: ToneLayer;
  readonly flutter?: Flutter;
};

export const whoosh = (o: WhooshOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const out = createStereo(Math.max(2, Math.round(o.length * sr)));
  const n = out.l.length;
  const from = o.from ?? 300;
  const to = o.to ?? 3000;
  const type = o.filter ?? "bandpass";
  const q = o.q ?? 1.3;
  const width = o.width ?? 0.4;
  const color = o.noise ?? "pink";
  const common = createNoise(color, env.seed);
  const side = [createNoise(color, env.seed + 1), createNoise(color, env.seed + 2)];
  const filters = [0, 1].map(() => new Biquad(type, sr, from, q));
  const env0 = swell(o.length, sr, o.peak ?? 0.7, o.rise ?? -2.5, o.fall ?? 2.5);
  const tone = o.tone;
  const osc = tone ? new Oscillator(tone.wave ?? "sine", sr) : null;
  const toneLp = new Biquad("lowpass", sr, 4000, 0.7);
  const fl = o.flutter;
  let flPhase = 0;
  const bandGain = type === "bandpass" ? 1.6 + q * 0.6 : 1;
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    if (i % 16 === 0) {
      const fc = expLerp(from, to, curve(x, o.sweepCurve ?? 0));
      filters.forEach((f) => f.set(fc, q));
    }
    let am = 1;
    let swing = 0;
    if (fl) {
      flPhase += expLerp(fl.from, fl.to, x) / sr;
      am = 1 - fl.depth * (0.5 + 0.5 * Math.cos(TAU * flPhase));
      swing = (fl.pan ?? 0) * Math.sin(Math.PI * flPhase);
    }
    const [pl, pr] = panGains(
      clamp((o.panFrom ?? 0) + ((o.panTo ?? 0) - (o.panFrom ?? 0)) * x + swing, -1, 1),
    );
    const c = common.next();
    const t =
      osc && tone ? toneLp.process(osc.next(expLerp(tone.from, tone.to, x))) * tone.level : 0;
    const e = env0[i] * am;
    const nl = filters[0].process(c * (1 - width) + side[0].next() * width) * bandGain;
    const nr = filters[1].process(c * (1 - width) + side[1].next() * width) * bandGain;
    out.l[i] = (nl + t) * e * pl * Math.SQRT2;
    out.r[i] = (nr + t) * e * pr * Math.SQRT2;
  }
  return out;
};

export type RiserOptions = {
  /** Seconds. */
  readonly length: number;
  /** Noise filter sweep in Hz. */
  readonly from?: number;
  readonly to?: number;
  readonly filter?: BiquadType;
  readonly q?: number;
  /** Rising pitched layer: start Hz and rise in semitones. */
  readonly pitch?: { readonly from: number; readonly semitones: number; readonly level: number };
  /** Amplitude curve (negative: slow start). */
  readonly curve?: number;
  readonly flutter?: Flutter;
  /** Final fade in seconds (a riser usually stops dead on the downbeat). */
  readonly endFade?: number;
};

export const riser = (o: RiserOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const n = Math.max(2, Math.round(o.length * sr));
  const out = createStereo(n);
  const from = o.from ?? 200;
  const to = o.to ?? 8000;
  const type = o.filter ?? "highpass";
  const q = o.q ?? 0.9;
  const noises = [new WhiteNoise(env.seed), new WhiteNoise(env.seed + 5)];
  const filters = [0, 1].map(() => new Biquad(type, sr, from, q));
  const rng = new Rng(env.seed + 9);
  const pitch = o.pitch;
  const saws = pitch ? [-1, 0, 1].map((d) => ({ d, phase: rng.next() })) : [];
  const sawLp = [new Biquad("lowpass", sr, 1200, 0.9), new Biquad("lowpass", sr, 1200, 0.9)];
  const endFade = Math.max(1, Math.round((o.endFade ?? 0.004) * sr));
  const fl = o.flutter;
  let flPhase = 0;
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    if (i % 16 === 0) {
      const fc = expLerp(from, to, x);
      filters.forEach((f) => f.set(fc, q));
      sawLp.forEach((f) => f.set(expLerp(900, 6000, x), 0.9));
    }
    const amp = curve(x, o.curve ?? -2.2);
    let am = 1;
    if (fl) {
      flPhase += expLerp(fl.from, fl.to, x) / sr;
      am = 1 - fl.depth * (0.5 + 0.5 * Math.cos(TAU * flPhase));
    }
    let sl = 0;
    let sR = 0;
    if (pitch) {
      const f = pitch.from * Math.pow(2, (pitch.semitones * x) / 12);
      for (const s of saws) {
        const dt = (f * Math.pow(2, (s.d * 18) / 1200)) / sr;
        const v = 2 * s.phase - 1 - polyBlep(s.phase, dt);
        s.phase = s.phase + dt >= 1 ? s.phase + dt - 1 : s.phase + dt;
        sl += v * (s.d <= 0 ? 0.7 : 0.3);
        sR += v * (s.d >= 0 ? 0.7 : 0.3);
      }
      sl = sawLp[0].process(sl) * pitch.level * 0.5;
      sR = sawLp[1].process(sR) * pitch.level * 0.5;
    }
    const fade = i >= n - endFade ? (n - 1 - i) / endFade : 1;
    const g = amp * am * fade;
    out.l[i] = (filters[0].process(noises[0].next()) * 0.7 + sl) * g;
    out.r[i] = (filters[1].process(noises[1].next()) * 0.7 + sR) * g;
  }
  return out;
};

export type CrashOptions = {
  /** Seconds to -60 dB. */
  readonly decay?: number;
  /** High-pass in Hz. */
  readonly lowCut?: number;
  /** Low-pass in Hz. */
  readonly brightness?: number;
};

export const crash = (o: CrashOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const decay = o.decay ?? 1.8;
  const n = Math.round((decay + 0.02) * sr);
  const out = createStereo(n);
  const noises = [new WhiteNoise(env.seed), new WhiteNoise(env.seed + 3)];
  const metal = [310, 457, 523, 689, 797, 1043].map((f, i) => ({
    f,
    osc: new Oscillator("square", sr, (i * 0.37) % 1),
  }));
  const shape = [0, 1].map(() => ({
    hp: new Biquad("highpass", sr, o.lowCut ?? 450, 0.7),
    lp: new Biquad("lowpass", sr, o.brightness ?? 12000, 0.7),
    pk: new Biquad("peaking", sr, 5500, 0.7, 3),
  }));
  const k = decayCoef(decay, sr);
  let amp = 1;
  for (let i = 0; i < n; i++) {
    amp *= k;
    let m = 0;
    for (const p of metal) {
      m += p.osc.next(p.f * 2.3);
    }
    m /= metal.length;
    const attack = Math.min(1, i / (0.0008 * sr));
    const fade = i >= n - 96 ? (n - 1 - i) / 96 : 1;
    for (let ch = 0; ch < 2; ch++) {
      const s = shape[ch];
      const x = noises[ch].next() * 0.75 + m * 0.5;
      (ch === 0 ? out.l : out.r)[i] =
        s.pk.process(s.lp.process(s.hp.process(x))) * amp * attack * fade;
    }
  }
  return out;
};

export type ReverseSwellOptions = {
  /** Seconds: the swell ends exactly at the end of this span. */
  readonly length: number;
  /** What gets reverse-reverbed: a crash, or a chord (Hz) played as a short stab. */
  readonly source?: "crash" | "chord";
  readonly freqs?: readonly number[];
  /** Reverb RT60 of the reversed tail. */
  readonly decay?: number;
  /** Portion of dry reversed source mixed with the reversed tail, 0..1. */
  readonly dry?: number;
  readonly lowCut?: number;
};

/** Renders a source through a long reverb and reverses the result: a reverse-reverb rise. */
export const reverseSwell = (o: ReverseSwellOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const n = Math.max(2, Math.round(o.length * sr));
  let src: Stereo;
  if (o.source === "chord" && o.freqs && o.freqs.length > 0) {
    const m = new Float32Array(Math.round(0.25 * sr));
    o.freqs.forEach((f, j) => {
      let p = (j * 0.21) % 1;
      for (let i = 0; i < m.length; i++) {
        const dt = f / sr;
        m[i] += ((2 * p - 1 - polyBlep(p, dt)) * Math.exp(-i / (0.08 * sr))) / o.freqs!.length;
        p = p + dt >= 1 ? p + dt - 1 : p + dt;
      }
    });
    const lp = new Biquad("lowpass", sr, 3500, 0.7);
    for (let i = 0; i < m.length; i++) {
      m[i] = lp.process(m[i]);
    }
    src = { l: m, r: m };
  } else {
    src = crash({ decay: 0.5, lowCut: o.lowCut ?? 600 }, env);
  }
  const verb = new Reverb(
    {
      decay: o.decay ?? Math.max(0.6, o.length * 1.3),
      size: 0.9,
      preDelay: 0,
      early: 0.15,
      lowCut: o.lowCut ?? 300,
      highCut: 11000,
      seed: env.seed,
    },
    sr,
  );
  const padded = createStereo(n);
  padded.l.set(src.l.subarray(0, Math.min(n, src.l.length)));
  padded.r.set(src.r.subarray(0, Math.min(n, src.r.length)));
  const wet = createStereo(n);
  verb.processRange(padded, wet, 0, n);
  const dry = o.dry ?? 0.25;
  for (let i = 0; i < n; i++) {
    wet.l[i] = wet.l[i] * 2 + padded.l[i] * dry;
    wet.r[i] = wet.r[i] * 2 + padded.r[i] * dry;
  }
  const out = reverse(wet);
  const fadeIn = Math.round(n * 0.3);
  const fadeOut = Math.round(0.003 * sr);
  for (let i = 0; i < n; i++) {
    const g =
      (i < fadeIn ? curve(i / fadeIn, -2) : 1) * (i >= n - fadeOut ? (n - 1 - i) / fadeOut : 1);
    out.l[i] *= g;
    out.r[i] *= g;
  }
  return out;
};

export type ImpactOptions = {
  /** Sine sweep: start and end in Hz, over `sweepTime` seconds (exponential). */
  readonly sweepFrom?: number;
  readonly sweepTo?: number;
  readonly sweepTime?: number;
  /** Seconds for the sine body to reach -60 dB: the sub tail. */
  readonly subDecay?: number;
  readonly subLevel?: number;
  /** Full-band noise burst length in seconds and level. */
  readonly burst?: number;
  readonly burstLevel?: number;
  /** Crash layer level and decay. */
  readonly crash?: number;
  readonly crashDecay?: number;
  /** Drive on the transient and body; it relaxes to clean within about 0.5 s so the tail decays naturally. */
  readonly drive?: number;
};

export const impact = (o: ImpactOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const sweepFrom = o.sweepFrom ?? 800;
  const sweepTo = o.sweepTo ?? 40;
  const sweepTime = o.sweepTime ?? 0.15;
  const subDecay = o.subDecay ?? 1.2;
  const subLevel = o.subLevel ?? 1;
  const burstN = Math.round((o.burst ?? 0.017) * sr);
  const burstLevel = o.burstLevel ?? 0.7;
  const crashLevel = o.crash ?? 0.45;
  const crashDecay = o.crashDecay ?? 1.6;
  const drive = o.drive ?? 2.5;
  const n = Math.round((Math.max(subDecay, crashLevel > 0 ? crashDecay : 0) + 0.05) * sr);
  const out = createStereo(n);
  const noises = [new WhiteNoise(env.seed), new WhiteNoise(env.seed + 11)];
  const k = decayCoef(subDecay, sr);
  const hold = Math.round(0.03 * sr);
  let amp = 1;
  let phase = 0;
  const burstFade = Math.max(1, Math.round(0.003 * sr));
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = t < sweepTime ? sweepFrom * Math.pow(sweepTo / sweepFrom, t / sweepTime) : sweepTo;
    phase += f / sr;
    if (i > hold) {
      amp *= k;
    }
    const attack = Math.min(1, i / (0.0004 * sr));
    const body = Math.sin(TAU * phase) * amp * attack * subLevel;
    // Time-varying drive: hard on the transient, clean on the tail (tanh(d x) / tanh(d) keeps
    // full-scale peaks at 1, and its small-signal gain d / tanh(d) falls back to 1 with d).
    const d = 1e-3 + (drive - 1e-3) * Math.exp(-t / 0.15);
    const norm = Math.tanh(d);
    for (let ch = 0; ch < 2; ch++) {
      let b = 0;
      if (i < burstN) {
        const g =
          Math.min(1, i / (0.0002 * sr)) *
          (i >= burstN - burstFade ? (burstN - 1 - i) / burstFade : 1);
        b = noises[ch].next() * g * burstLevel;
      }
      const x = body + b;
      (ch === 0 ? out.l : out.r)[i] = Math.tanh(d * x) / norm;
    }
  }
  if (crashLevel > 0) {
    const c = crash({ decay: crashDecay, lowCut: 380 }, { sampleRate: sr, seed: env.seed + 23 });
    for (let i = 0; i < Math.min(n, c.l.length); i++) {
      out.l[i] += c.l[i] * crashLevel;
      out.r[i] += c.r[i] * crashLevel;
    }
  }
  const tail = Math.round(0.01 * sr);
  for (let i = 0; i < tail; i++) {
    const g = i / tail;
    out.l[n - 1 - i] *= g;
    out.r[n - 1 - i] *= g;
  }
  return out;
};
