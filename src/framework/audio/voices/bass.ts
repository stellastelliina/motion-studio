/**
 * Bass voices: sine sub with glide, and a reese/saw bass (detuned PolyBLEP saws, enveloped
 * low-pass, drive, mono sub underneath).
 */

import { TAU, fromMono, panGains, type Stereo } from "../core";
import { adsr } from "../envelope";
import { Biquad } from "../filters";
import { polyBlep } from "../osc";
import { Rng } from "../random";
import type { VoiceEnv } from "./types";

export type SubOptions = {
  /** Hz. */
  readonly freq: number;
  /** Gate in seconds. */
  readonly length: number;
  /** Start pitch in Hz: glides into `freq`. */
  readonly glideFrom?: number;
  /** Glide time constant in seconds. */
  readonly glide?: number;
  readonly attack?: number;
  readonly release?: number;
  /** tanh drive for upper harmonics that small speakers can play. */
  readonly drive?: number;
  /** Level of the octave above, 0..1. */
  readonly octave?: number;
};

export const sub = (o: SubOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const e = adsr(
    {
      attack: o.attack ?? 0.004,
      decay: 0.01,
      sustain: 1,
      release: o.release ?? 0.04,
      releaseCurve: 3,
    },
    o.length,
    sr,
  );
  const out = new Float32Array(e.length);
  const drive = o.drive ?? 1.4;
  const octave = o.octave ?? 0.12;
  const glide = o.glide ?? 0.04;
  const norm = drive > 0 ? Math.tanh(drive) : 1;
  let phase = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / sr;
    const f = o.glideFrom ? o.freq + (o.glideFrom - o.freq) * Math.exp(-t / glide) : o.freq;
    phase += f / sr;
    const x = Math.sin(TAU * phase) + octave * Math.sin(2 * TAU * phase);
    out[i] = (drive > 0 ? Math.tanh(drive * x) / norm : x) * e[i];
  }
  return fromMono(out);
};

export type ReeseOptions = {
  /** Hz. */
  readonly freq: number;
  /** Gate in seconds. */
  readonly length: number;
  /** Detune spread in cents. */
  readonly detune?: number;
  /** Low-pass floor in Hz. */
  readonly cutoff?: number;
  /** Hz added at the attack, decaying with `envDecay`. */
  readonly envAmount?: number;
  readonly envDecay?: number;
  readonly resonance?: number;
  readonly drive?: number;
  /** Sine sub level under the saws. */
  readonly sub?: number;
  /** Stereo spread of the saws 0..1 (the sub stays mono). */
  readonly width?: number;
  readonly attack?: number;
  readonly release?: number;
  /** Start pitch in Hz for a glide. */
  readonly glideFrom?: number;
};

export const reese = (o: ReeseOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const rng = new Rng(env.seed);
  const e = adsr(
    { attack: o.attack ?? 0.005, decay: 0.08, sustain: 0.85, release: o.release ?? 0.06 },
    o.length,
    sr,
  );
  const n = e.length;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const detune = o.detune ?? 16;
  const offsets = [-1, -0.35, 0.35, 1];
  const width = o.width ?? 0.7;
  const phases = offsets.map(() => rng.next());
  const ratios = offsets.map((d) => Math.pow(2, (d * detune) / 1200));
  const pans = offsets.map((d) => panGains(d * width));
  const cutoff = o.cutoff ?? 320;
  const envAmount = o.envAmount ?? 1800;
  const envDecay = o.envDecay ?? 0.16;
  const q = o.resonance ?? 1.1;
  const drive = o.drive ?? 2;
  const subLevel = o.sub ?? 0.7;
  const lpL = new Biquad("lowpass", sr, cutoff + envAmount, q);
  const lpR = new Biquad("lowpass", sr, cutoff + envAmount, q);
  const hpL = new Biquad("highpass", sr, 90, 0.7);
  const hpR = new Biquad("highpass", sr, 90, 0.7);
  const norm = Math.tanh(drive);
  let subPhase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = o.glideFrom ? o.freq + (o.glideFrom - o.freq) * Math.exp(-t / 0.05) : o.freq;
    if (i % 16 === 0) {
      const fc = cutoff + envAmount * Math.exp(-t / envDecay);
      lpL.set(fc, q);
      lpR.set(fc, q);
    }
    let sl = 0;
    let sr2 = 0;
    for (let k = 0; k < phases.length; k++) {
      const dt = (f * ratios[k]) / sr;
      const p = phases[k];
      const s = 2 * p - 1 - polyBlep(p, dt);
      phases[k] = p + dt >= 1 ? p + dt - 1 : p + dt;
      sl += s * pans[k][0];
      sr2 += s * pans[k][1];
    }
    subPhase += f / sr;
    const s0 = Math.sin(TAU * subPhase) * subLevel;
    const yl = Math.tanh(drive * hpL.process(lpL.process(sl * 0.5))) / norm;
    const yr = Math.tanh(drive * hpR.process(lpR.process(sr2 * 0.5))) / norm;
    l[i] = (yl * 0.8 + s0) * e[i];
    r[i] = (yr * 0.8 + s0) * e[i];
  }
  return { l, r };
};
