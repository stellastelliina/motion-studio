/**
 * FM synthesis with up to four sine operators (phase modulation, as on the DX7), and a bell built on
 * it.
 *
 * Every operator has its own frequency (a ratio of the note or a fixed Hz), level and envelope: an
 * attack, an exponential decay toward a sustain level and, past the gate, a release. A carrier's
 * level is its output amplitude; a modulator's level is its peak modulation index in radians, so
 * its envelope shapes the timbre over time: an index that decays faster than the carrier gives the
 * classic bright strike that settles into a pure tone. Routes say who modulates whom; a modulator
 * must have a higher index than its target, so one pass from the last operator to the first
 * computes the whole algorithm. Left and right are two copies detuned by `spread` cents: slow beats
 * and width without a chorus.
 */

import { clamp, type Stereo } from "../core";
import { OnePole } from "../filters";
import { Rng } from "../random";
import type { VoiceEnv } from "./types";

export type FmOperator = {
  /** Frequency as a ratio of the note, default 1. Ignored when `fixed` is set. */
  readonly ratio?: number;
  /** Fixed frequency in Hz, independent of the note. */
  readonly fixed?: number;
  /** Cents, default 0. */
  readonly detune?: number;
  /** Carrier: output amplitude. Modulator: peak modulation index in radians. */
  readonly level: number;
  /** Seconds, default 0.002. */
  readonly attack?: number;
  /** Seconds to fall 60 dB toward the sustain level (default: no decay). */
  readonly decay?: number;
  /** Level held while the gate is open, 0..1 of the peak, default 0 when `decay` is set, else 1. */
  readonly sustain?: number;
  /** Seconds to -60 dB after the gate, default 0.3. */
  readonly release?: number;
  /** Self-modulation 0..1 (a saw-like edge on a sine). */
  readonly feedback?: number;
  /** How much the level follows the velocity, 0..1 (default 0.7 for modulators, 0 for carriers). */
  readonly velocitySens?: number;
};

/** A route from an operator to a lower operator (modulation) or to the output. */
export type FmRoute = readonly [from: number, to: number | "out"];

export type FmOptions = {
  /** Hz. */
  readonly freq: number;
  readonly operators: readonly FmOperator[];
  /** Default: a chain, the last operator modulates the one before, operator 0 is the output. */
  readonly routes?: readonly FmRoute[];
  /** Gate in seconds: past it every operator releases (default: the note rings out). */
  readonly length?: number;
  /** 0..1, default 0.7. */
  readonly velocity?: number;
  /** Modulation index scaling with pitch: index * (261.6 / freq) ^ keyScale, default 0.3. */
  readonly keyScale?: number;
  /** Detune between the left and right copies in cents, default 3. */
  readonly spread?: number;
  /** Final one-pole low-pass in Hz, default 14000: tames the highest sidebands. */
  readonly tone?: number;
  /** Upper bound of the buffer in seconds (the score passes the time left), default 30. */
  readonly maxLength?: number;
};

const FLOOR_DB = -90;

type Op = {
  readonly inc: number;
  readonly peak: number;
  readonly attN: number;
  readonly k: number;
  readonly sustain: number;
  readonly kr: number;
  readonly fb: number;
  readonly out: boolean;
  readonly targets: readonly number[];
  readonly phase: number;
};

const prepare = (
  o: FmOptions,
  cents: number,
  sr: number,
  seed: number,
): { ops: Op[]; n: number } => {
  if (o.operators.length < 1 || o.operators.length > 4) {
    throw new Error(`fm: 1 to 4 operators, got ${o.operators.length}`);
  }
  const count = o.operators.length;
  const routes: readonly FmRoute[] =
    o.routes ?? o.operators.map((_, i): FmRoute => (i === 0 ? [0, "out"] : ([i, i - 1] as const)));
  for (const [from, to] of routes) {
    if (from < 0 || from >= count || (to !== "out" && (to < 0 || to >= from))) {
      throw new Error(`fm: invalid route ${from} -> ${to} (a modulator targets a lower index)`);
    }
  }
  const vel = clamp(o.velocity ?? 0.7, 0, 1);
  const keyScale = Math.pow(261.63 / o.freq, o.keyScale ?? 0.3);
  const rng = new Rng(seed);
  const gate = o.length === undefined ? Infinity : o.length;
  let seconds = 0;
  const ops = o.operators.map((op, i): Op => {
    const out = routes.some(([f, t]) => f === i && t === "out");
    const targets = routes.filter(([f, t]) => f === i && t !== "out").map(([, t]) => t as number);
    const sens = op.velocitySens ?? (out ? 0 : 0.7);
    const velGain = 1 - sens + sens * vel;
    const freq =
      (op.fixed ?? o.freq * (op.ratio ?? 1)) * Math.pow(2, ((op.detune ?? 0) + cents) / 1200);
    const decay = op.decay ?? Infinity;
    const sustain = op.sustain ?? (Number.isFinite(decay) ? 0 : 1);
    const release = op.release ?? 0.3;
    if (out) {
      const attack = op.attack ?? 0.002;
      const ring = Number.isFinite(gate)
        ? gate + release
        : sustain > 0 || !Number.isFinite(decay)
          ? Infinity
          : attack + decay * (-FLOOR_DB / 60);
      seconds = Math.max(seconds, ring);
    }
    return {
      inc: Math.min(0.5, freq / sr),
      peak: op.level * velGain * (out ? 1 : keyScale),
      attN: Math.max(1, Math.round((op.attack ?? 0.002) * sr)),
      k: Number.isFinite(decay) ? Math.exp(-Math.log(1000) / (decay * sr)) : 1,
      sustain,
      kr: Math.exp(-Math.log(1000) / (Math.max(0.001, release) * sr)),
      fb: clamp(op.feedback ?? 0, 0, 1) * 1.2,
      out,
      targets,
      phase: rng.next(),
    };
  });
  const cap = o.maxLength ?? 30;
  if (!Number.isFinite(seconds) && o.maxLength === undefined) {
    throw new Error("fm: a sustaining carrier needs a gate (`length`) or a `maxLength`");
  }
  const n = Math.max(2, Math.round(Math.min(cap, seconds + 0.01) * sr));
  return { ops, n };
};

const renderChannel = (
  o: FmOptions,
  cents: number,
  sr: number,
  seed: number,
  n: number,
): Float32Array => {
  const { ops } = prepare(o, cents, sr, seed);
  const count = ops.length;
  const out = new Float32Array(n);
  const phase = Float64Array.from(ops, (op) => op.phase);
  const decayEnv = new Float64Array(count).fill(1);
  const relEnv = new Float64Array(count).fill(1);
  const mod = new Float64Array(count);
  const prev = new Float64Array(count);
  const gateN =
    o.length === undefined ? Infinity : Math.max(1, Math.round(Math.max(0, o.length) * sr));
  const lp = new OnePole(sr, o.tone ?? 14000);
  const fadeN = Math.round(0.008 * sr);
  const velAmp = 0.3 + 0.7 * clamp(o.velocity ?? 0.7, 0, 1);
  for (let i = 0; i < n; i++) {
    mod.fill(0);
    let y = 0;
    for (let j = count - 1; j >= 0; j--) {
      const op = ops[j];
      const att = i < op.attN ? 0.5 - 0.5 * Math.cos((Math.PI * i) / op.attN) : 1;
      if (i >= op.attN) {
        decayEnv[j] *= op.k;
      }
      if (i >= gateN) {
        relEnv[j] *= op.kr;
      }
      const level = op.peak * att * (op.sustain + (1 - op.sustain) * decayEnv[j]) * relEnv[j];
      const s = Math.sin(2 * Math.PI * phase[j] + mod[j] + op.fb * prev[j]);
      prev[j] = s;
      phase[j] += op.inc;
      if (phase[j] >= 1) {
        phase[j] -= 1;
      }
      const v = s * level;
      for (const t of op.targets) {
        mod[t] += v;
      }
      if (op.out) {
        y += v;
      }
    }
    const f = i >= n - fadeN ? (n - 1 - i) / fadeN : 1;
    out[i] = lp.process(y) * velAmp * f;
  }
  return out;
};

export const fm = (o: FmOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const spread = o.spread ?? 3;
  const { n } = prepare(o, 0, sr, env.seed);
  return {
    l: renderChannel(o, -spread / 2, sr, env.seed, n),
    r: renderChannel(o, spread / 2, sr, env.seed + 1, n),
  };
};

export type BellOptions = {
  /** Hz. */
  readonly freq: number;
  /** 0..1, default 0.7. */
  readonly velocity?: number;
  /** Seconds for the fundamental to reach -60 dB, default 6. */
  readonly decay?: number;
  /** 0..1, default 0.5: strength of the inharmonic strike. */
  readonly brightness?: number;
  /** Level of the glassy upper partial pair, 0..1, default 0.5. */
  readonly glass?: number;
  /** Detune between left and right in cents, default 2.5: the slow beating of a real bell. */
  readonly spread?: number;
  readonly maxLength?: number;
};

/**
 * Bell and glass: two FM pairs. The first is the tubular-bell pair of the DX7 (modulator at 3.5
 * times the carrier: partials at 1, 2.5, 4.5, 6, 8...), the second a carrier on the inharmonic
 * 2.76 mode of a struck free plate, modulated at 5.4. Both indices die much faster than the
 * carriers: the strike is complex and bright, the tail a near-pure, slowly beating tone.
 */
export const bell = (o: BellOptions, env: VoiceEnv): Stereo => {
  const decay = o.decay ?? 6;
  const bright = clamp(o.brightness ?? 0.5, 0, 1);
  const glass = clamp(o.glass ?? 0.5, 0, 1);
  return fm(
    {
      freq: o.freq,
      velocity: o.velocity,
      spread: o.spread ?? 2.5,
      maxLength: o.maxLength,
      keyScale: 0.45,
      tone: 12000,
      operators: [
        { ratio: 1, level: 0.8, attack: 0.003, decay },
        { ratio: 3.5, level: 0.6 + 2.6 * bright, attack: 0.002, decay: decay * 0.22 },
        { ratio: 2.76, level: 0.32 * glass, attack: 0.003, decay: decay * 0.4 },
        { ratio: 5.4, level: 0.3 + 1.6 * bright, attack: 0.002, decay: decay * 0.08 },
      ],
      routes: [
        [0, "out"],
        [1, 0],
        [2, "out"],
        [3, 2],
      ],
    },
    env,
  );
};
