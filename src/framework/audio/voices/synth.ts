/**
 * Tonal voices: supersaw (stabs and pads), Karplus-Strong pluck, FM blip, a generic mono synth
 * with glide, and a hum drone.
 */

import { TAU, fromMono, panGains, type Stereo } from "../core";
import { adsr, curve, decayCoef } from "../envelope";
import { Biquad, OnePole } from "../filters";
import { Oscillator, WhiteNoise, polyBlep, type Waveform } from "../osc";
import { Rng } from "../random";
import type { VoiceEnv } from "./types";

type AmpEnvelope = {
  readonly attack?: number;
  readonly decay?: number;
  readonly sustain?: number;
  readonly release?: number;
};

export type SupersawOptions = AmpEnvelope & {
  /** Chord frequencies in Hz. */
  readonly freqs: readonly number[];
  /** Gate in seconds. */
  readonly length: number;
  /** Saws per note. */
  readonly voices?: number;
  /** Detune spread in cents (outermost voices). */
  readonly detune?: number;
  /** Side voices level relative to the center voice. */
  readonly mix?: number;
  /** Low-pass floor in Hz. */
  readonly cutoff?: number;
  /** Hz added at the attack, decaying with `envDecay` seconds. */
  readonly envAmount?: number;
  readonly envDecay?: number;
  readonly resonance?: number;
  /** High-pass in Hz. */
  readonly lowCut?: number;
  /** Stereo spread of the voices 0..1. */
  readonly width?: number;
};

export const supersaw = (o: SupersawOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const rng = new Rng(env.seed);
  const e = adsr(
    {
      attack: o.attack ?? 0.004,
      decay: o.decay ?? 0.25,
      sustain: o.sustain ?? 0,
      release: o.release ?? 0.08,
    },
    o.length,
    sr,
  );
  const n = e.length;
  const voices = Math.max(1, o.voices ?? 7);
  const detune = o.detune ?? 24;
  const mix = o.mix ?? 0.55;
  const width = o.width ?? 0.85;
  const incs: number[] = [];
  const phases: number[] = [];
  const gl: number[] = [];
  const gr: number[] = [];
  let power = 0;
  for (const f of o.freqs) {
    for (let v = 0; v < voices; v++) {
      const x = voices === 1 ? 0 : (v / (voices - 1)) * 2 - 1;
      const spreadCurve = Math.sign(x) * Math.pow(Math.abs(x), 1.4);
      incs.push((f * Math.pow(2, (spreadCurve * detune) / 1200)) / sr);
      phases.push(rng.next());
      const g = x === 0 ? 1 : mix;
      const [pl, pr] = panGains(spreadCurve * width);
      gl.push(g * pl);
      gr.push(g * pr);
      power += g * g;
    }
  }
  const norm = 1 / Math.sqrt(Math.max(1, power));
  const cutoff = o.cutoff ?? 2800;
  const envAmount = o.envAmount ?? 0;
  const envDecay = o.envDecay ?? 0.2;
  const q = o.resonance ?? 0.75;
  const filters = [0, 1].map(() => ({
    lp: new Biquad("lowpass", sr, cutoff + envAmount, q),
    hp: new Biquad("highpass", sr, o.lowCut ?? 110, 0.7),
  }));
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const count = incs.length;
  for (let i = 0; i < n; i++) {
    if (envAmount !== 0 && i % 16 === 0) {
      const fc = cutoff + envAmount * Math.exp(-i / sr / envDecay);
      filters[0].lp.set(fc, q);
      filters[1].lp.set(fc, q);
    }
    let sl = 0;
    let sR = 0;
    for (let k = 0; k < count; k++) {
      const p = phases[k];
      const dt = incs[k];
      const s = 2 * p - 1 - polyBlep(p, dt);
      phases[k] = p + dt >= 1 ? p + dt - 1 : p + dt;
      sl += s * gl[k];
      sR += s * gr[k];
    }
    l[i] = filters[0].hp.process(filters[0].lp.process(sl * norm)) * e[i];
    r[i] = filters[1].hp.process(filters[1].lp.process(sR * norm)) * e[i];
  }
  return { l, r };
};

export type PluckOptions = {
  /** Hz. */
  readonly freq: number;
  /** Seconds for the fundamental to reach -60 dB. */
  readonly decay?: number;
  /** 0..1: pick brightness and loop damping (low is warm and woody). */
  readonly brightness?: number;
  /** Sine body under the string, 0..1. */
  readonly body?: number;
  /** Mallet click level, 0..1. */
  readonly mallet?: number;
  /** Detune between the left and right strings in cents. */
  readonly spread?: number;
};

/** One Karplus-Strong string with a tuned loop (allpass fractional delay, linear-phase damping). */
const ksString = (
  freq: number,
  o: PluckOptions,
  n: number,
  sr: number,
  seed: number,
): Float32Array => {
  const out = new Float32Array(n);
  const brightness = o.brightness ?? 0.4;
  const period = sr / freq;
  const g1 = 0.25 * (1 - brightness);
  const g0 = 1 - 2 * g1;
  const nInt = Math.max(2, Math.floor(period - 1 - 0.1));
  const frac = period - 1 - nInt;
  const apA = (1 - frac) / (1 + frac);
  const w0 = (TAU * freq) / sr;
  const loss = Math.abs(g0 + 2 * g1 * Math.cos(w0));
  const rho = Math.min(
    0.99995,
    Math.pow(10, -3 / ((o.decay ?? 1.1) * freq)) / Math.max(1e-3, loss),
  );
  // Read-before-write on one slot: the delay equals the buffer length. Loop = nInt + frac + 1 (FIR).
  const line = new Float64Array(nInt);
  const noise = new WhiteNoise(seed);
  const pick = new OnePole(sr, 400 + 5200 * brightness * brightness, "lowpass");
  const excN = Math.round(period);
  const exc = new Float64Array(excN);
  let mean = 0;
  for (let i = 0; i < excN; i++) {
    exc[i] = pick.process(noise.next()) * Math.sin((Math.PI * (i + 0.5)) / excN);
    mean += exc[i];
  }
  mean /= excN;
  let peak = 1e-9;
  for (let i = 0; i < excN; i++) {
    exc[i] -= mean * Math.sin((Math.PI * (i + 0.5)) / excN);
    peak = Math.max(peak, Math.abs(exc[i]));
  }
  let w = 0;
  let apX1 = 0;
  let apY1 = 0;
  let p1 = 0;
  let p2 = 0;
  for (let i = 0; i < n; i++) {
    const y = line[w];
    const ap = apA * y + apX1 - apA * apY1;
    apX1 = y;
    apY1 = ap;
    const lf = g1 * ap + g0 * p1 + g1 * p2;
    p2 = p1;
    p1 = ap;
    line[w] = rho * lf + (i < excN ? exc[i] / peak : 0);
    w = w + 1 === line.length ? 0 : w + 1;
    out[i] = y;
  }
  return out;
};

export const pluck = (o: PluckOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const decay = o.decay ?? 1.1;
  const n = Math.round((decay + 0.05) * sr);
  const spread = o.spread ?? 4;
  const strings = [-1, 1].map((s, i) =>
    ksString(o.freq * Math.pow(2, (s * spread) / 2400), o, n, sr, env.seed + i * 131),
  );
  const body = o.body ?? 0.35;
  const mallet = o.mallet ?? 0.25;
  const bodyK = decayCoef(decay * 0.35, sr);
  const clickNoise = new WhiteNoise(env.seed + 977);
  const clickBp = new Biquad("bandpass", sr, 1800, 1.2);
  const warmth = [new OnePole(sr, 5200), new OnePole(sr, 5200)];
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  let amp = 1;
  let phase = 0;
  const fadeN = Math.round(0.01 * sr);
  for (let i = 0; i < n; i++) {
    phase += o.freq / sr;
    amp *= bodyK;
    const attack = Math.min(1, i / (0.0015 * sr));
    const b = Math.sin(TAU * phase) * amp * attack * body;
    const c = clickBp.process(clickNoise.next()) * Math.exp(-i / (0.0025 * sr)) * mallet * 2;
    const f = i >= n - fadeN ? (n - 1 - i) / fadeN : 1;
    l[i] = warmth[0].process(strings[0][i] * 0.55 + b + c) * f;
    r[i] = warmth[1].process(strings[1][i] * 0.55 + b + c) * f;
  }
  return { l, r };
};

export type BlipOptions = {
  /** Hz. */
  readonly freq: number;
  /** Seconds to -60 dB. */
  readonly decay?: number;
  /** Modulator ratio. */
  readonly ratio?: number;
  /** FM index at the attack, decaying with `indexDecay` seconds. */
  readonly index?: number;
  readonly indexDecay?: number;
  /** Semitones above the note at the attack, settling within 15 ms. */
  readonly chirp?: number;
};

export const blip = (o: BlipOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const decay = o.decay ?? 0.22;
  const n = Math.round((decay + 0.01) * sr);
  const out = new Float32Array(n);
  const ratio = o.ratio ?? 2;
  const index = o.index ?? 2.2;
  const indexDecay = o.indexDecay ?? 0.025;
  const chirp = o.chirp ?? 2;
  const k = decayCoef(decay, sr);
  let amp = 1;
  let pc = 0;
  let pm = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = o.freq * Math.pow(2, (chirp * Math.exp(-t / 0.012)) / 12);
    pc += f / sr;
    pm += (f * ratio) / sr;
    amp *= k;
    const attack = Math.min(1, i / (0.0008 * sr));
    const mod = index * Math.exp(-t / indexDecay) * Math.sin(TAU * pm);
    const fade = i >= n - 96 ? (n - 1 - i) / 96 : 1;
    out[i] = Math.sin(TAU * pc + mod) * amp * attack * fade;
  }
  return fromMono(out);
};

export type SynthOptions = AmpEnvelope & {
  readonly wave: Waveform;
  /** Hz at the start. */
  readonly freq: number;
  /** Hz at the end of the gate: a bend. */
  readonly freqTo?: number;
  /** Bend curvature (see envelope curve), 0 = exponential in pitch. */
  readonly bendCurve?: number;
  /** Gate in seconds. */
  readonly length: number;
  readonly cutoff?: number;
  readonly envAmount?: number;
  readonly envDecay?: number;
  readonly resonance?: number;
  readonly drive?: number;
  readonly pulseWidth?: number;
  /** Two detuned copies spread in stereo, in cents (0 = mono). */
  readonly unison?: number;
};

export const synth = (o: SynthOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const e = adsr(
    {
      attack: o.attack ?? 0.005,
      decay: o.decay ?? 0.2,
      sustain: o.sustain ?? 0.7,
      release: o.release ?? 0.08,
    },
    o.length,
    sr,
  );
  const n = e.length;
  const gateN = Math.round(o.length * sr);
  const unison = o.unison ?? 0;
  const rng = new Rng(env.seed);
  const oscs =
    unison > 0
      ? [new Oscillator(o.wave, sr, rng.next()), new Oscillator(o.wave, sr, rng.next())]
      : [new Oscillator(o.wave, sr, 0)];
  const ratios = unison > 0 ? [Math.pow(2, -unison / 2400), Math.pow(2, unison / 2400)] : [1];
  const cutoff = o.cutoff ?? 5000;
  const envAmount = o.envAmount ?? 0;
  const envDecay = o.envDecay ?? 0.12;
  const q = o.resonance ?? 0.8;
  const lps = oscs.map(() => new Biquad("lowpass", sr, cutoff + envAmount, q));
  const drive = o.drive ?? 0;
  const norm = drive > 0 ? Math.tanh(drive) : 1;
  const l = new Float32Array(n);
  const r = unison > 0 ? new Float32Array(n) : l;
  for (let i = 0; i < n; i++) {
    const x = Math.min(1, i / Math.max(1, gateN));
    const f = o.freqTo ? o.freq * Math.pow(o.freqTo / o.freq, curve(x, o.bendCurve ?? 0)) : o.freq;
    if (i % 16 === 0) {
      const fc = cutoff + envAmount * Math.exp(-i / sr / envDecay);
      lps.forEach((lp) => lp.set(fc, q));
    }
    for (let k = 0; k < oscs.length; k++) {
      let y = lps[k].process(oscs[k].next(f * ratios[k], o.pulseWidth ?? 0.5));
      if (drive > 0) {
        y = Math.tanh(drive * y) / norm;
      }
      (k === 0 ? l : r)[i] = y * e[i];
    }
  }
  return { l, r };
};

export type DroneOptions = {
  /** Hz. */
  readonly freq: number;
  /** Gate in seconds. */
  readonly length: number;
  readonly attack?: number;
  readonly release?: number;
  /** Level of the 2nd and 3rd harmonics, 0..1. */
  readonly harmonics?: number;
  /** Seconds of pitch rising from half speed: a power-up. */
  readonly powerUp?: number;
  /** Low-pass in Hz. */
  readonly cutoff?: number;
  /** Slow beating between two detuned copies, Hz. */
  readonly beat?: number;
};

export const drone = (o: DroneOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const e = adsr(
    {
      attack: o.attack ?? 0.35,
      decay: 0.01,
      sustain: 1,
      release: o.release ?? 0.3,
      attackCurve: -1.5,
      releaseCurve: 2,
    },
    o.length,
    sr,
  );
  const n = e.length;
  const harm = o.harmonics ?? 0.35;
  const powerUp = o.powerUp ?? 0;
  const beat = o.beat ?? 0.35;
  const lpL = new Biquad("lowpass", sr, o.cutoff ?? 700, 0.7);
  const lpR = new Biquad("lowpass", sr, o.cutoff ?? 700, 0.7);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  let pa = 0;
  let pb = 0.25;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const rise = powerUp > 0 && t < powerUp ? 0.5 + 0.5 * curve(t / powerUp, 3) : 1;
    const f = o.freq * rise;
    pa += f / sr;
    pb += (f + beat) / sr;
    const tone = (p: number) =>
      Math.sin(TAU * p) + harm * 0.5 * Math.sin(2 * TAU * p) + harm * 0.3 * Math.sin(3 * TAU * p);
    const a = tone(pa);
    const b = tone(pb);
    l[i] = lpL.process(0.6 * a + 0.4 * b) * e[i] * 0.7;
    r[i] = lpR.process(0.4 * a + 0.6 * b) * e[i] * 0.7;
  }
  return { l, r };
};
