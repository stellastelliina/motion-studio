/**
 * Analog-style subtractive voices: a warm polyphonic pad and a filtered pluck.
 *
 * Both follow the voice of a classic poly synth: detuned band-limited saws (plus an optional
 * pulse layer with slow width modulation) that wander a few cents like free-running oscillators,
 * one 24 dB/oct low-pass per note (two cascaded zero-delay-feedback SVFs, clean under fast
 * modulation) and a gentle tanh stage for warmth. The pad breathes: its filter blooms open with
 * the attack, moves on a slow LFO of its own for every note and can glide to another cutoff across
 * the gate, so a held chord keeps evolving. Its `air` layer is noise high-passed above the speech
 * band: shimmer that does not compete with a voice over. The pluck is the same voice with a fast
 * filter envelope: bright for a few tens of milliseconds, then round.
 */

import { TAU, clamp, panGains, type Stereo } from "../core";
import { adsr, decayCoef } from "../envelope";
import { Biquad, LowPass24 } from "../filters";
import { Drift, PinkNoise, polyBlep } from "../osc";
import { Rng } from "../random";
import type { VoiceEnv } from "./types";

/** Middle C: the key-tracking reference, where the cutoff is exactly the one requested. */
const KEY_REF = 261.63;

/** Band-limited saw, pulse and sine from one phase. */
const saw = (p: number, dt: number) => 2 * p - 1 - polyBlep(p, dt);
const pulse = (p: number, dt: number, width: number) => {
  const q = p - width;
  return (p < width ? 1 : -1) + polyBlep(p, dt) - polyBlep(q < 0 ? q + 1 : q, dt);
};

export type AnalogPadOptions = {
  /** Chord frequencies in Hz. */
  readonly freqs: readonly number[];
  /** Gate in seconds. */
  readonly length: number;
  /** Seconds, default 1.2 (a slow swell). */
  readonly attack?: number;
  /** Seconds from the peak to the sustain level, default 1. */
  readonly decay?: number;
  /** Default 0.85. */
  readonly sustain?: number;
  /** Seconds, default 1.8. */
  readonly release?: number;
  /** Saws per note, default 3. */
  readonly voices?: number;
  /** Detune of the outermost saws in cents, default 9. */
  readonly detune?: number;
  /** Slow random pitch wander of every oscillator in cents, default 3. */
  readonly drift?: number;
  /** Level of a pulse layer (hollow, woody) with slowly modulated width, 0..1, default 0. */
  readonly pulse?: number;
  /** Low-pass in Hz at the start of the sustain, default 1100. */
  readonly cutoff?: number;
  /** Low-pass in Hz at the end of the gate: the filter glides there exponentially. */
  readonly cutoffTo?: number;
  /** Octaves the filter opens during the attack (it starts that much lower), default 1. */
  readonly bloom?: number;
  /** 0..1, default 0.15. */
  readonly resonance?: number;
  /** How far the cutoff follows each note's pitch, 0..1, default 0.4. */
  readonly keyTrack?: number;
  /** Slow filter movement: rate in Hz (default 0.09) and depth in octaves (default 0.3). */
  readonly lfoRate?: number;
  readonly lfoDepth?: number;
  /** Noise above 5 kHz following the envelope, 0..1, default 0. */
  readonly air?: number;
  /** tanh warmth after the filter, 0 = clean, default 0.7. */
  readonly drive?: number;
  /** High-pass in Hz, default 90. */
  readonly lowCut?: number;
  /** Stereo spread of the saws 0..1, default 0.8. */
  readonly width?: number;
};

export const analogPad = (o: AnalogPadOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const rng = new Rng(env.seed);
  const attack = o.attack ?? 1.2;
  const e = adsr(
    {
      attack,
      decay: o.decay ?? 1,
      sustain: o.sustain ?? 0.85,
      release: o.release ?? 1.8,
      attackCurve: -0.8,
      decayCurve: 2,
      releaseCurve: 3,
    },
    o.length,
    sr,
  );
  const n = e.length;
  const gateN = Math.max(1, Math.round(o.length * sr));
  const attN = Math.max(1, Math.round(attack * sr));
  const voices = Math.max(1, Math.round(o.voices ?? 3));
  const detune = o.detune ?? 9;
  const driftCents = o.drift ?? 3;
  const pulseLevel = o.pulse ?? 0;
  const width = o.width ?? 0.8;
  const cutoff = o.cutoff ?? 1100;
  const cutoffTo = o.cutoffTo ?? cutoff;
  const bloom = o.bloom ?? 1;
  const res = o.resonance ?? 0.15;
  const keyTrack = o.keyTrack ?? 0.4;
  const lfoDepth = o.lfoDepth ?? 0.3;
  const drive = o.drive ?? 0.7;
  const driveNorm = drive > 0 ? drive / Math.tanh(drive) : 1;

  type Osc = { phase: number; ratio: number; drift: Drift; gl: number; gr: number };
  type Note = {
    freq: number;
    oscs: Osc[];
    pw: Drift;
    pwPhase: number;
    lfo: Drift;
    key: number;
    fl: LowPass24;
    fr: LowPass24;
  };
  let power = 0;
  const notes: Note[] = o.freqs.map((freq, j) => {
    const oscs: Osc[] = [];
    for (let v = 0; v < voices; v++) {
      const x = voices === 1 ? 0 : (v / (voices - 1)) * 2 - 1;
      const [pl, pr] = panGains(x * width);
      const g = x === 0 ? 1 : 0.75;
      power += g * g;
      oscs.push({
        phase: rng.next(),
        ratio: Math.pow(2, (x * detune) / 1200),
        drift: new Drift(env.seed + j * 97 + v * 13, 0.12, sr),
        gl: g * pl * Math.SQRT2,
        gr: g * pr * Math.SQRT2,
      });
    }
    power += pulseLevel * pulseLevel;
    return {
      freq,
      oscs,
      pw: new Drift(env.seed + j * 97 + 71, 0.2, sr),
      pwPhase: rng.next(),
      lfo: new Drift(env.seed + j * 97 + 53, o.lfoRate ?? 0.09, sr),
      key: Math.pow(freq / KEY_REF, keyTrack),
      fl: new LowPass24(sr, cutoff, res),
      fr: new LowPass24(sr, cutoff, res),
    };
  });
  const norm = 0.42 / Math.sqrt(Math.max(1, power));
  const air = o.air ?? 0;
  const airNoise = [new PinkNoise(env.seed + 5), new PinkNoise(env.seed + 6)];
  // Fourth-order high-pass: the air must not leak into the speech band.
  const airHp = [0, 1].map(() => [
    new Biquad("highpass", sr, 5200, 0.54),
    new Biquad("highpass", sr, 5200, 1.31),
  ]);
  const airLp = [0, 1].map(() => new Biquad("lowpass", sr, 13000, 0.6));
  const hp = [0, 1].map(() => new Biquad("highpass", sr, o.lowCut ?? 90, 0.7));
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  let fc = cutoff;
  for (let i = 0; i < n; i++) {
    if (i % 16 === 0) {
      const g = Math.min(1, i / gateN);
      const bloomOct = -bloom * (1 - Math.min(1, i / attN)) ** 2;
      fc = cutoff * Math.pow(cutoffTo / cutoff, g) * Math.pow(2, bloomOct);
    }
    let sl = 0;
    let sR = 0;
    for (let j = 0; j < notes.length; j++) {
      const nt = notes[j];
      const lfo = nt.lfo.next();
      if (i % 16 === 0) {
        const f = clamp(fc * nt.key * Math.pow(2, lfoDepth * lfo), 20, 18000);
        nt.fl.set(f, res);
        nt.fr.set(f, res);
      }
      let nl = 0;
      let nr = 0;
      for (const osc of nt.oscs) {
        const dt = (nt.freq * osc.ratio * Math.pow(2, (driftCents * osc.drift.next()) / 1200)) / sr;
        const s = saw(osc.phase, dt);
        osc.phase += dt;
        if (osc.phase >= 1) {
          osc.phase -= 1;
        }
        nl += s * osc.gl;
        nr += s * osc.gr;
      }
      if (pulseLevel > 0) {
        const dt = nt.freq / sr;
        const w = 0.5 + 0.32 * nt.pw.next();
        const s = pulse(nt.pwPhase, dt, w) * pulseLevel;
        nt.pwPhase += dt;
        if (nt.pwPhase >= 1) {
          nt.pwPhase -= 1;
        }
        nl += s;
        nr += s;
      }
      sl += nt.fl.process(nl * norm);
      sR += nt.fr.process(nr * norm);
    }
    let yl = drive > 0 ? Math.tanh(drive * sl) * (driveNorm / drive) : sl;
    let yr = drive > 0 ? Math.tanh(drive * sR) * (driveNorm / drive) : sR;
    if (air > 0) {
      yl +=
        airLp[0].process(airHp[0][1].process(airHp[0][0].process(airNoise[0].next()))) * air * 0.6;
      yr +=
        airLp[1].process(airHp[1][1].process(airHp[1][0].process(airNoise[1].next()))) * air * 0.6;
    }
    l[i] = hp[0].process(yl) * e[i];
    r[i] = hp[1].process(yr) * e[i];
  }
  return { l, r };
};

export type AnalogPluckOptions = {
  /** Hz. */
  readonly freq: number;
  /** 0..1, default 0.7: louder and brighter. */
  readonly velocity?: number;
  /** Seconds for the note to reach -60 dB, default 0.9. */
  readonly decay?: number;
  /** Gate in seconds: past it the note is released over `release` (default: it rings out). */
  readonly length?: number;
  /** Seconds, default 0.12. */
  readonly release?: number;
  /** Detune between the left and right saws in cents, default 7. */
  readonly detune?: number;
  /** Pulse layer level (square at 35% width, hollower), 0..1, default 0.3. */
  readonly pulse?: number;
  /** Sine at the fundamental under the saws, 0..1, default 0.25: roundness once the filter closes. */
  readonly body?: number;
  /** Filter floor in Hz at middle C, default 380. */
  readonly cutoff?: number;
  /** Octaves the filter opens at the attack, default 3.5 (scaled by velocity). */
  readonly envAmount?: number;
  /** Filter envelope time constant in seconds, default 0.07. */
  readonly envDecay?: number;
  /** 0..1, default 0.25. */
  readonly resonance?: number;
  /** How far the cutoff follows the pitch, 0..1, default 0.6. */
  readonly keyTrack?: number;
  /** Stereo spread 0..1, default 0.5. */
  readonly width?: number;
};

export const analogPluck = (o: AnalogPluckOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const rng = new Rng(env.seed);
  const vel = clamp(o.velocity ?? 0.7, 0, 1);
  const decay = o.decay ?? 0.9;
  const release = o.release ?? 0.12;
  const gate = o.length === undefined ? Infinity : Math.max(0.005, o.length);
  const end = Math.min(decay, gate + release);
  const n = Math.max(2, Math.round((end + 0.01) * sr));
  const detune = o.detune ?? 7;
  const pulseLevel = o.pulse ?? 0.3;
  const body = o.body ?? 0.25;
  const res = o.resonance ?? 0.25;
  const envAmount = (o.envAmount ?? 3.5) * (0.45 + 0.55 * vel);
  const envDecay = o.envDecay ?? 0.07;
  const key = Math.pow(o.freq / KEY_REF, o.keyTrack ?? 0.6);
  const floor = (o.cutoff ?? 380) * key;
  const width = o.width ?? 0.5;
  const [wl, wr] = panGains(-width);
  const [vl, vr] = panGains(width);
  const ratios = [Math.pow(2, -detune / 2400), Math.pow(2, detune / 2400)];
  const phases = [rng.next(), rng.next()];
  const pulsePhase = [rng.next(), rng.next()];
  const drift = new Drift(env.seed + 3, 0.3, sr);
  const filters = [new LowPass24(sr, floor, res), new LowPass24(sr, floor, res)];
  const k = decayCoef(decay, sr);
  const kr = decayCoef(release, sr);
  const attN = Math.max(1, Math.round(0.0015 * sr));
  const gateN = Number.isFinite(gate) ? Math.round(gate * sr) : Infinity;
  const fadeN = Math.round(0.006 * sr);
  const level = 0.6 * (0.35 + 0.65 * vel);
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const out = new Float64Array(2);
  let amp = 1;
  let bodyPhase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    if (i % 8 === 0) {
      const fc = clamp(floor * Math.pow(2, envAmount * Math.exp(-t / envDecay)), 30, 18000);
      filters[0].set(fc, res);
      filters[1].set(fc, res);
    }
    const bend = Math.pow(2, (1.5 * drift.next()) / 1200);
    for (let c = 0; c < 2; c++) {
      const dt = (o.freq * ratios[c] * bend) / sr;
      let x = saw(phases[c], dt) * 0.8;
      phases[c] += dt;
      if (phases[c] >= 1) {
        phases[c] -= 1;
      }
      if (pulseLevel > 0) {
        const dp = o.freq / sr;
        x += pulse(pulsePhase[c], dp, 0.35) * pulseLevel * 0.6;
        pulsePhase[c] += dp;
        if (pulsePhase[c] >= 1) {
          pulsePhase[c] -= 1;
        }
      }
      out[c] = filters[c].process(x);
    }
    bodyPhase += o.freq / sr;
    const b = Math.sin(TAU * bodyPhase) * body;
    amp *= i >= gateN ? k * kr : k;
    const a = amp * Math.min(1, (i + 1) / attN) * (i >= n - fadeN ? (n - 1 - i) / fadeN : 1);
    l[i] = (out[0] * wl + out[1] * vl + b) * a * level;
    r[i] = (out[0] * wr + out[1] * vr + b) * a * level;
  }
  return { l, r };
};
