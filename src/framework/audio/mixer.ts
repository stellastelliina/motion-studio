/**
 * Mixer: renders scheduled voices into buses (applying hard cuts), runs each bus through its
 * inserts, sidechain, automation and stutters, then feeds the send effects.
 */

import {
  addMono,
  createStereo,
  dbToGain,
  forEachChannel,
  isMono,
  mixInto,
  panGains,
  type Stereo,
} from "./core";
import { compress } from "./dynamics";
import { PingPongDelay, saturateStereo, widen } from "./effects";
import { Biquad, filterStereo } from "./filters";
import { stutter } from "./glitch";
import { Reverb } from "./reverb";
import type { BusConfig, EffectConfig, Plan, SweepEvent, VoiceEvent, VolumeEvent } from "./score";

/** Truncates a voice buffer at every cut that falls inside it (fade ending exactly at the cut). */
const applyCuts = (buf: Stereo, ev: VoiceEvent, plan: Plan): Stereo => {
  const end = ev.start + buf.l.length;
  const cuts = plan.cuts.filter((c) => c.at > ev.start && c.at < end && !c.keep.includes(ev.bus));
  if (cuts.length === 0) {
    return buf;
  }
  const at = Math.min(...cuts.map((c) => c.at)) - ev.start;
  const fade = Math.max(1, cuts.find((c) => c.at - ev.start === at)?.fade ?? 1);
  forEachChannel(buf, (ch) => {
    for (let k = 0; k < fade; k++) {
      const i = at - fade + k;
      if (i >= 0) {
        ch[i] *= 1 - (k + 1) / fade;
      }
    }
    ch.fill(0, Math.max(0, at));
  });
  return buf;
};

export type BusRender = {
  readonly buses: Map<string, Stereo>;
  readonly keys: Map<string, Float32Array>;
};

export const renderVoices = (plan: Plan, busNames: readonly string[]): BusRender => {
  const buses = new Map(busNames.map((b) => [b, createStereo(plan.frames)] as const));
  const keys = new Map<string, Float32Array>();
  for (const ev of plan.voices) {
    if (ev.start >= plan.frames) {
      continue;
    }
    const buf = applyCuts(ev.render({ sampleRate: plan.sampleRate, seed: ev.seed }), ev, plan);
    mixInto(buses.get(ev.bus) as Stereo, buf, ev.start, ev.gain, ev.pan);
    if (ev.key) {
      let key = keys.get(ev.key);
      if (!key) {
        key = new Float32Array(plan.frames);
        keys.set(ev.key, key);
      }
      const mono = isMono(buf) ? buf.l : buf.l.map((x, i) => 0.5 * (x + buf.r[i]));
      addMono(key, mono, ev.start, ev.gain);
    }
  }
  return { buses, keys };
};

const applySweep = (s: Stereo, sw: SweepEvent, sampleRate: number): void => {
  const pts = [...sw.points].sort((a, b) => a[0] - b[0]);
  if (pts.length < 2) {
    return;
  }
  const from = Math.max(0, pts[0][0]);
  const to = Math.min(s.l.length, pts[pts.length - 1][0]);
  const freqAt = (i: number) => {
    let k = 0;
    while (k < pts.length - 2 && i >= pts[k + 1][0]) {
      k++;
    }
    const [a, fa] = pts[k];
    const [b, fb] = pts[k + 1];
    const x = b > a ? Math.min(1, Math.max(0, (i - a) / (b - a))) : 1;
    return fa * Math.pow(fb / fa, x);
  };
  const xfade = Math.round(0.005 * sampleRate);
  forEachChannel(s, (ch) => {
    const f = new Biquad(sw.type, sampleRate, freqAt(from), sw.q);
    for (let i = from; i < to; i++) {
      if ((i - from) % 16 === 0) {
        f.set(freqAt(i), sw.q);
      }
      const y = f.process(ch[i]);
      const w = Math.min(1, (i - from) / xfade, (to - 1 - i) / xfade);
      ch[i] = ch[i] + (y - ch[i]) * w;
    }
  });
};

const applyVolume = (s: Stereo, v: VolumeEvent): void => {
  const pts = [...v.points].sort((a, b) => a[0] - b[0]);
  if (pts.length === 0) {
    return;
  }
  let k = 0;
  for (let i = 0; i < s.l.length; i++) {
    while (k < pts.length - 1 && i >= pts[k + 1][0]) {
      k++;
    }
    let db: number;
    if (i <= pts[0][0]) {
      db = pts[0][1];
    } else if (k >= pts.length - 1) {
      db = pts[pts.length - 1][1];
    } else {
      const [a, da] = pts[k];
      const [b, dbb] = pts[k + 1];
      db = da + (dbb - da) * ((i - a) / (b - a));
    }
    const g = dbToGain(db);
    s.l[i] *= g;
    s.r[i] *= g;
  }
};

/** Runs a bus through EQ, sweeps, drive, compressor, sidechain, width, stutters, faders. */
export const processBus = (
  name: string,
  s: Stereo,
  cfg: BusConfig<string>,
  plan: Plan,
  keys: Map<string, Float32Array>,
): void => {
  const sr = plan.sampleRate;
  for (const spec of cfg.eq ?? []) {
    filterStereo(s, spec, sr);
  }
  plan.sweeps.filter((w) => w.bus === name).forEach((w) => applySweep(s, w, sr));
  if (cfg.drive) {
    saturateStereo(s, cfg.drive);
  }
  if (cfg.compressor) {
    compress(s, cfg.compressor, sr);
  }
  if (cfg.sidechain) {
    const key = keys.get(cfg.sidechain.key);
    if (key) {
      compress(
        s,
        {
          threshold: cfg.sidechain.threshold ?? -26,
          ratio: 30,
          knee: 6,
          attack: cfg.sidechain.attack ?? 2,
          release: cfg.sidechain.release ?? 150,
          range: cfg.sidechain.depth,
        },
        sr,
        key,
      );
    }
  }
  if (cfg.width !== undefined || cfg.monoBelow) {
    widen(s, cfg.width ?? 1, sr, cfg.monoBelow ?? 0);
  }
  plan.stutters
    .filter((st) => st.buses.includes(name))
    .forEach((st) => stutter(s, st.from, st.to, st.options));
  plan.volumes.filter((v) => v.bus === name).forEach((v) => applyVolume(s, v));
  const g = dbToGain(cfg.gain ?? 0);
  const [pl, pr] = cfg.pan ? panGains(cfg.pan).map((x) => x * Math.SQRT2) : [1, 1];
  for (let i = 0; i < s.l.length; i++) {
    s.l[i] *= g * Math.min(1, pl);
    s.r[i] *= g * Math.min(1, pr);
  }
};

/** Renders one send effect from the processed buses; returns its wet output. */
export const renderEffect = (
  name: string,
  cfg: EffectConfig,
  buses: Map<string, Stereo>,
  busConfigs: Record<string, BusConfig<string>>,
  plan: Plan,
): Stereo => {
  const n = plan.frames;
  const input = createStereo(n);
  for (const [bus, s] of buses) {
    const send = busConfigs[bus]?.sends?.[name];
    if (send !== undefined) {
      mixInto(input, s, 0, dbToGain(send));
    }
  }
  const dries = plan.dries.filter((d) => d.effects === null || d.effects.includes(name));
  for (const d of dries) {
    input.l.fill(0, d.from, d.to);
    input.r.fill(0, d.from, d.to);
  }
  const resets = [
    ...plan.cuts.map((c) => ({ at: c.at, fade: c.fade })),
    ...dries.map((d) => ({ at: d.from, fade: Math.round(0.003 * plan.sampleRate) })),
  ]
    .filter((r) => r.at > 0 && r.at < n)
    .sort((a, b) => a.at - b.at);
  const fx =
    cfg.type === "reverb"
      ? new Reverb(cfg, plan.sampleRate)
      : new PingPongDelay(cfg, plan.sampleRate);
  const out = createStereo(n);
  let pos = 0;
  for (const r of resets) {
    fx.processRange(input, out, pos, r.at);
    fx.reset();
    for (let k = 0; k < r.fade; k++) {
      const i = r.at - r.fade + k;
      if (i >= 0) {
        const g = 1 - (k + 1) / r.fade;
        out.l[i] *= g;
        out.r[i] *= g;
      }
    }
    pos = r.at;
  }
  fx.processRange(input, out, pos, n);
  const g = dbToGain(cfg.return ?? 0);
  for (let i = 0; i < n; i++) {
    out.l[i] *= g;
    out.r[i] *= g;
  }
  return out;
};
