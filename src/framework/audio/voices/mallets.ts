/**
 * Mallet percussion: marimba and vibraphone, modal synthesis of a tuned bar over a tube resonator.
 *
 * The bar: the undercut tunes its first flexural modes to 1 : 4 : 10 (two octaves, then three
 * octaves and a major third), plus a fourth near 20 on the marimba (Bork 1995, measured by Hill
 * 2011 on a Yamaha YM-5100A). Tuning is never exact: the second mode strays by about 1%, the third
 * and fourth by up to 4.5%. Rosewood has a nearly constant loss factor (eta 0.0036..0.0068, mean
 * 0.0045), so every marimba mode rings for T60 = 2.2 / (eta f): the high modes die first and the top
 * of the keyboard is short. Aluminum rings far longer (about 30 s at F3 to 6 s at F6 on a
 * vibraphone), with extra losses at high frequency.
 *
 * The resonator: a tube closed at the bottom resonates at odd multiples of its tuning, so it only
 * reinforces the fundamental (4, 10 and 20 are even). It is a one-pole complex resonator driven by
 * the bar's fundamental: its build-up rounds the attack, its own slight mistuning beats against the
 * bar in the first milliseconds, and the energy it radiates shortens the fundamental's decay (the
 * system starts louder and ends sooner than the bare bar). On the vibraphone the motor spins discs
 * in the tube mouths on one shared axle: a closing disc detunes and damps the tube, so the
 * fundamental pulses (tremolo) and its phase wobbles (a slight vibrato) while the upper modes,
 * radiated by the bar itself, stay steady. Every bar pulses in phase, as on the instrument.
 *
 * The mallet: a half-sine force pulse whose contact time sets the spectrum. Harder mallets, harder
 * strokes and smaller bars all shorten the contact (a yarn-wrapped core stiffens as it compresses),
 * so they excite the upper modes more: brighter, not only louder. The striking point weights each
 * mode by its shape along a free bar (the center barely excites the second mode, the ends excite
 * all of them); off the center line the stroke also excites the first torsional modes, untuned and
 * about 1.2..1.9 times the fundamental (Rossing). A short band-passed noise is the "tock" of the
 * impact.
 *
 * Imperfections: tuning of each mode, loss factor and resonator tuning belong to the bar (seeded by
 * instrument and key: the same bar always sounds the same way); striking point, lateral offset,
 * contact time, level and small spectral differences change on every stroke (seeded by the
 * trigger). Same score, same samples.
 */

import { clamp, cosRamp, type Stereo } from "../core";
import { Rng, hashSeed } from "../random";
import { addBurst, addPartial, applyDamper } from "./modal";
import type { VoiceEnv } from "./types";

export type MalletHardness = "soft" | "medium" | "hard";

type StrokeOptions = {
  /** Hz. */
  readonly freq: number;
  /** 0..1, default 0.6: louder and brighter. */
  readonly velocity?: number;
  /** Default "medium". */
  readonly mallet?: MalletHardness;
  /** Striking point, 0 = center of the bar (round, fundamental) .. 1 = its end (bright, thin). */
  readonly position?: number;
  /** Octaves of brightness: +1 halves the contact time, default 0. */
  readonly brightness?: number;
  /** Scales every decay time, default 1. */
  readonly decay?: number;
  /** Keyboard spread 0..1, default 0.6: low notes left, high notes right. */
  readonly width?: number;
  /** Upper bound of the rendered buffer in seconds (the score passes the time left). */
  readonly maxLength?: number;
};

export type MarimbaOptions = StrokeOptions;

export type VibraphoneOptions = StrokeOptions & {
  /** Seconds the pedal is held: the damper falls at the end (default: let it ring). */
  readonly length?: number;
  /** Motor speed as tremolo pulses per second, 0 = off (default). Players use about 1..12. */
  readonly motor?: number;
  /** Tremolo depth 0..1, default 0.6 (how far the discs close the tubes). */
  readonly depth?: number;
  /** Seconds on the motor's clock at the strike: the score passes the strike time. */
  readonly clock?: number;
};

type Instrument = {
  readonly name: string;
  /** Nominal flexural mode ratios. */
  readonly ratios: readonly number[];
  /** Per-bar tuning spread of each mode above the first, as a fraction of its frequency. */
  readonly tolerance: readonly number[];
  /** Radiated level of each mode for an impulse at the end of the bar. */
  readonly weights: readonly number[];
  /** Per-bar tuning spread of the fundamental in cents. */
  readonly cents: number;
  /** Loss in dB/s of a bar mode at `f` Hz; `grain` is the per-bar material factor. */
  readonly loss: (f: number, grain: number) => number;
  /** Spread of the material factor across bars (0.2 = +-20%). */
  readonly grain: number;
  /** Extra loss of the fundamental radiated through the tube, dB/s. */
  readonly radiation: number;
  /** Share of the fundamental radiated by the tube; the rest leaves the bar directly. */
  readonly tube: number;
  readonly tubeQ: number;
  /** Per-bar tuning spread of the tube, fraction. */
  readonly tubeTolerance: number;
  /** Contact time in seconds at C4, velocity 0.6. */
  readonly contact: Record<MalletHardness, number>;
  /** First torsional mode over the fundamental at the bottom and at the top of the range. */
  readonly torsion: readonly [number, number];
  readonly torsionLevel: number;
  /** MIDI range used to scale the keyboard-dependent properties. */
  readonly range: readonly [number, number];
  /** Impact noise: center over 1/contact, clamped to [lo, hi] Hz, its Q, time and level. */
  readonly knock: {
    readonly ratio: number;
    readonly lo: number;
    readonly hi: number;
    readonly q: number;
    readonly time: number;
    readonly level: number;
  };
  /** Seconds to -60 dB under the damper at C4 (vibraphone only). */
  readonly damper: number;
};

const MARIMBA: Instrument = {
  name: "marimba",
  ratios: [1, 4, 9.95, 19.6],
  tolerance: [0, 0.008, 0.025, 0.03],
  weights: [1, 0.5, 0.34, 0.2],
  cents: 3,
  // Hill 2011: T60 = 2.2 / (eta f), eta about 0.0045.
  loss: (f, grain) => (60 * 0.0045 * grain * f) / 2.2,
  grain: 0.25,
  // Tuned so the fundamental rings about 2 s at C2, 1.1 s at C4, 0.45 s at C6.
  radiation: 24,
  tube: 0.8,
  tubeQ: 34,
  tubeTolerance: 0.008,
  contact: { soft: 0.0013, medium: 0.00075, hard: 0.00038 },
  torsion: [1.9, 1.2],
  torsionLevel: 0.3,
  range: [36, 96],
  knock: { ratio: 0.6, lo: 450, hi: 4500, q: 0.7, time: 0.0025, level: 0.1 },
  damper: 0,
};

const VIBRAPHONE: Instrument = {
  name: "vibraphone",
  ratios: [1, 4, 10.08],
  tolerance: [0, 0.004, 0.012],
  weights: [1, 0.55, 0.3],
  cents: 2,
  // The fundamental rings about 30 s at F3 and 6 s at F6; air losses grow with f^2 on top.
  loss: (f, grain) => (2 * Math.pow(f / 174.6, 0.6) + 1.5 * (f / 1000) ** 2) * grain,
  grain: 0.1,
  radiation: 0,
  tube: 0.75,
  tubeQ: 40,
  tubeTolerance: 0.006,
  contact: { soft: 0.0011, medium: 0.00065, hard: 0.00035 },
  torsion: [1.8, 1.3],
  torsionLevel: 0.12,
  range: [53, 89],
  knock: { ratio: 1.1, lo: 1500, hi: 9000, q: 1.2, time: 0.002, level: 0.06 },
  damper: 0.25,
};

/** Free-free beam: eigenvalues and shape constants of the first four flexural modes. */
const BETA = [4.73004, 7.8532, 10.99561, 14.13717];
const SIGMA = [0.982502, 1.000777, 0.999966, 1.000001];

/** Shape of flexural mode `m` at `x` (0 = end, 0.5 = center), 1 at the end of the bar. */
const flexShape = (m: number, x: number): number => {
  const b = BETA[m] ?? ((2 * m + 3) * Math.PI) / 2;
  const s = SIGMA[m] ?? 1;
  const bx = b * x;
  return Math.abs(Math.cosh(bx) + Math.cos(bx) - s * (Math.sinh(bx) + Math.sin(bx))) / 2;
};

/**
 * Spectrum of a half-sine force pulse of duration `tau`, 1 at 0 Hz. Its zeros are filled in a
 * little: a real mallet is not an ideal half-sine.
 */
const malletSpectrum = (f: number, tau: number): number => {
  const x = 2 * f * tau;
  const d = 1 - x * x;
  const halfSine = Math.abs(d) < 1e-6 ? Math.PI / 4 : Math.abs(Math.cos(Math.PI * f * tau) / d);
  return Math.hypot(halfSine, 0.15 / (1 + x * x));
};

/** Resonator build-up is updated every this many samples (motor modulation). */
const BLOCK = 16;

type Tube = {
  readonly freq: number;
  readonly q: number;
  /** Radiated level of the tube at resonance. */
  readonly gain: number;
  /** Level of the fundamental radiated by the bar itself. */
  readonly direct: number;
  readonly motor: number;
  readonly depth: number;
  readonly clock: number;
};

/**
 * Drives the tube with the bar's fundamental `drive` and adds tube and direct radiation into `out`.
 * A closing disc lowers the tube tuning by up to 6% and damps its mouth by up to 35%.
 */
const resonate = (out: Float64Array, drive: Float64Array, t: Tube, sr: number): void => {
  let zr = 0;
  let zi = 0;
  for (let from = 0; from < drive.length; from += BLOCK) {
    const closed =
      t.motor > 0 ? t.depth * Math.cos(Math.PI * t.motor * (t.clock + from / sr)) ** 2 : 0;
    const f = t.freq * (1 - 0.06 * closed);
    const rho = Math.exp((-Math.PI * f) / (t.q * sr));
    const w = (2 * Math.PI * f) / sr;
    const pr = rho * Math.cos(w);
    const pi = rho * Math.sin(w);
    const g = 2 * (1 - rho) * t.gain * (1 - 0.35 * closed);
    const to = Math.min(drive.length, from + BLOCK);
    for (let i = from; i < to; i++) {
      const x = drive[i];
      const nzr = pr * zr - pi * zi + x;
      zi = pr * zi + pi * zr;
      zr = nzr;
      out[i] += g * zr + t.direct * x;
    }
  }
};

type Stroke = {
  readonly freq: number;
  readonly velocity: number;
  readonly mallet: MalletHardness;
  readonly position: number;
  readonly brightness: number;
  readonly decay: number;
  readonly width: number;
  readonly maxLength: number;
  /** Seconds of pedal, Infinity without a damper. */
  readonly length: number;
  readonly motor: number;
  readonly depth: number;
  readonly clock: number;
};

const strike = (inst: Instrument, o: Stroke, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const top = Math.min(0.45 * sr, 18000);
  const key = 69 + 12 * Math.log2(o.freq / 440);
  const [lowKey, highKey] = inst.range;
  const span = clamp((key - lowKey) / (highKey - lowKey), 0, 1);
  // The bar: identical on every stroke.
  const bar = new Rng(hashSeed(inst.name, Math.round(key * 100)));
  // The stroke: different every time.
  const hit = new Rng(env.seed);

  const f1 = o.freq * Math.pow(2, (inst.cents * bar.bipolar()) / 1200);
  const grain = 1 + inst.grain * bar.bipolar();
  const tubeFreq = f1 * (1 + inst.tubeTolerance * bar.bipolar());
  const tubeQ = inst.tubeQ * (0.85 + 0.3 * bar.next());
  const torsion1 = f1 * (inst.torsion[0] + (inst.torsion[1] - inst.torsion[0]) * span);
  const torsionFreqs = [torsion1 * (0.95 + 0.1 * bar.next()), torsion1 * (2 + 0.3 * bar.next())];
  const ratios = inst.ratios.map((r, m) => r * (1 + inst.tolerance[m] * bar.bipolar()));

  const v = clamp(o.velocity * (1 + 0.04 * hit.bipolar()), 0.01, 1);
  // Contact time: shorter with a harder mallet, a harder stroke and a smaller (higher) bar.
  const tau =
    inst.contact[o.mallet] *
    Math.pow(2, -(key - 60) / 30) *
    Math.pow(v / 0.6, -0.4) *
    Math.pow(2, -o.brightness) *
    (1 + 0.06 * hit.bipolar());
  const x = 0.5 * (1 - clamp(o.position + 0.05 * hit.bipolar(), 0, 1));
  const lateral = 0.1 + 0.3 * hit.next();

  // Mode table: frequency, loss, amplitude.
  const freqs: number[] = [];
  const losses: number[] = [];
  const amps: number[] = [];
  const decayScale = 1 / Math.max(0.05, o.decay);
  ratios.forEach((r, m) => {
    const f = f1 * r;
    if (f > top) {
      return;
    }
    const radiation = m === 0 ? inst.radiation : 0;
    freqs.push(f);
    losses.push((inst.loss(f, grain) + radiation) * decayScale);
    amps.push(
      inst.weights[m] * flexShape(m, x) * malletSpectrum(f, tau) * (1 + 0.06 * hit.bipolar()),
    );
  });
  torsionFreqs.forEach((f, k) => {
    if (f > top) {
      return;
    }
    freqs.push(f);
    losses.push(inst.loss(f, grain) * 1.5 * decayScale);
    const shape = Math.abs(Math.cos(Math.PI * x * (k + 1)));
    amps.push((inst.torsionLevel * lateral * shape * malletSpectrum(f, tau)) / (k + 1));
  });
  let power = 0;
  for (const a of amps) {
    power += a * a;
  }
  const norm = 1 / Math.sqrt(power);

  // Length: the fundamental is the slowest mode; the damper may end the note sooner.
  const naturalN = Math.round((95 / losses[0]) * sr);
  const gateN = Number.isFinite(o.length) ? Math.max(1, Math.round(o.length * sr)) : Infinity;
  const damperT60 = clamp(inst.damper * Math.pow(2, -(key - 60) / 36), 0.08, 0.5);
  const releaseN = gateN + Math.round(damperT60 * 1.5 * sr);
  const n = Math.max(
    Math.round(0.05 * sr),
    Math.min(Math.round(o.maxLength * sr), naturalN, releaseN),
  );

  const out = new Float64Array(n);
  // Fundamental: the bar mode drives the tube.
  const drive = new Float64Array(n);
  addPartial(drive, null, freqs[0], losses[0], amps[0] * norm, 1, 0, n, sr);
  resonate(
    out,
    drive,
    {
      freq: tubeFreq,
      q: tubeQ,
      gain: inst.tube,
      direct: 1 - inst.tube,
      motor: Math.max(0, o.motor),
      depth: clamp(o.depth, 0, 1),
      clock: o.clock,
    },
    sr,
  );
  for (let m = 1; m < freqs.length; m++) {
    addPartial(out, null, freqs[m], losses[m], amps[m] * norm, 1, 0, n, sr);
  }

  // Mallet contact: the modes build up over about half the contact time.
  const attackN = Math.max(1, Math.round(0.5 * tau * sr));
  for (let i = 0; i < Math.min(attackN, n); i++) {
    out[i] *= cosRamp((i + 1) / attackN);
  }

  // Impact noise: its band follows the contact, it grows with the stroke and up the keyboard.
  const k = inst.knock;
  addBurst(
    out,
    null,
    env.seed + 3,
    0,
    clamp(k.ratio / tau, k.lo, k.hi) * (1 + 0.1 * hit.bipolar()),
    k.q,
    k.time + 0.5 * tau,
    k.level * Math.pow(v, 0.8) * Math.pow(2, (key - 60) / 36),
    sr,
  );

  if (gateN < n) {
    applyDamper([out], gateN, damperT60, Math.max(3 * f1, 400), sr);
    addBurst(out, null, env.seed + 11, gateN, 380, 0.7, 0.02, 0.005 * (0.5 + 0.5 * v), sr);
  }

  // Keyboard position, loudness, and an exact zero at the end.
  const a = clamp((span * 2 - 1) * 0.6 * o.width, -0.95, 0.95);
  const gain = 0.32 * Math.pow(v, 1.6);
  const gl = Math.sqrt(1 - a) * gain;
  const gr = Math.sqrt(1 + a) * gain;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const fadeN = Math.min(n, Math.round(0.005 * sr));
  for (let i = 0; i < n; i++) {
    const tail = i >= n - fadeN ? (n - 1 - i) / Math.max(1, fadeN - 1) : 1;
    const y = tail > 0 ? out[i] * tail : 0;
    l[i] = y * gl;
    r[i] = y * gr;
  }
  return { l, r };
};

const stroke = (o: StrokeOptions) => ({
  freq: o.freq,
  velocity: o.velocity ?? 0.6,
  mallet: o.mallet ?? "medium",
  position: o.position ?? 0.2,
  brightness: o.brightness ?? 0,
  decay: o.decay ?? 1,
  width: clamp(o.width ?? 0.6, 0, 1),
  maxLength: o.maxLength ?? 30,
});

/** Rosewood marimba: no damper, the bar rings out (about 2 s at C2, 0.4 s at C6). */
export const marimba = (o: MarimbaOptions, env: VoiceEnv): Stereo =>
  strike(MARIMBA, { ...stroke(o), length: Infinity, motor: 0, depth: 0, clock: 0 }, env);

/** Aluminum vibraphone with pedal (`length`) and motor (`motor`, `depth`, `clock`). */
export const vibraphone = (o: VibraphoneOptions, env: VoiceEnv): Stereo =>
  strike(
    VIBRAPHONE,
    {
      ...stroke(o),
      length: o.length ?? Infinity,
      motor: o.motor ?? 0,
      depth: o.depth ?? 0.6,
      clock: o.clock ?? 0,
    },
    env,
  );
