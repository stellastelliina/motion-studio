/**
 * Synthetic choir: source-filter formant synthesis of sung vowels, no words.
 *
 * The source of every singer is a band-limited saw tilted toward the -12 dB/oct slope of the
 * glottal pulse, plus breath: noise gated by the glottal cycle (air flows while the folds are open),
 * high-passed so it reads as aspiration. A few singers per note, each slightly detuned, with a
 * vibrato of their own that fades in after the onset and a slow pitch wander, make the unison a
 * section rather than a machine. The vocal tract is a bank of five parallel band-pass resonators on
 * the formants of the vowel (Csound's tables for soprano, alto and tenor, picked by register), and
 * the vowel can morph across the gate ("oo" opening to "ah"). Left and right go through tracts about
 * 1.5% apart, like two sections of the choir on the two sides of the stage.
 */

import { clamp, panGains, type Stereo } from "../core";
import { adsr } from "../envelope";
import { Biquad, OnePole } from "../filters";
import { Drift, WhiteNoise, polyBlep } from "../osc";
import { Rng } from "../random";
import type { VoiceEnv } from "./types";

export type Vowel = "a" | "e" | "i" | "o" | "u";

type Formants = {
  readonly freq: readonly number[];
  readonly db: readonly number[];
  readonly bw: readonly number[];
};

/** Formant tables (Hz, dB, bandwidth Hz) from the Csound manual, appendix "Formant values". */
const TABLES: Record<"soprano" | "alto" | "tenor", Record<Vowel, Formants>> = {
  soprano: {
    a: {
      freq: [800, 1150, 2900, 3900, 4950],
      db: [0, -6, -32, -20, -50],
      bw: [80, 90, 120, 130, 140],
    },
    e: {
      freq: [350, 2000, 2800, 3600, 4950],
      db: [0, -20, -15, -40, -56],
      bw: [60, 100, 120, 150, 200],
    },
    i: {
      freq: [270, 2140, 2950, 3900, 4950],
      db: [0, -12, -26, -26, -44],
      bw: [60, 90, 100, 120, 120],
    },
    o: {
      freq: [450, 800, 2830, 3800, 4950],
      db: [0, -11, -22, -22, -50],
      bw: [70, 80, 100, 130, 135],
    },
    u: {
      freq: [325, 700, 2700, 3800, 4950],
      db: [0, -16, -35, -40, -60],
      bw: [50, 60, 170, 180, 200],
    },
  },
  alto: {
    a: {
      freq: [800, 1150, 2800, 3500, 4950],
      db: [0, -4, -20, -36, -60],
      bw: [80, 90, 120, 130, 140],
    },
    e: {
      freq: [400, 1600, 2700, 3300, 4950],
      db: [0, -24, -30, -35, -60],
      bw: [60, 80, 120, 150, 200],
    },
    i: {
      freq: [350, 1700, 2700, 3700, 4950],
      db: [0, -20, -30, -36, -60],
      bw: [50, 100, 120, 150, 200],
    },
    o: {
      freq: [450, 800, 2830, 3500, 4950],
      db: [0, -9, -16, -28, -55],
      bw: [70, 80, 100, 130, 135],
    },
    u: {
      freq: [325, 700, 2530, 3500, 4950],
      db: [0, -12, -30, -40, -64],
      bw: [50, 60, 170, 180, 200],
    },
  },
  tenor: {
    a: {
      freq: [650, 1080, 2650, 2900, 3250],
      db: [0, -6, -7, -8, -22],
      bw: [80, 90, 120, 130, 140],
    },
    e: {
      freq: [400, 1700, 2600, 3200, 3580],
      db: [0, -14, -12, -14, -20],
      bw: [70, 80, 100, 120, 120],
    },
    i: {
      freq: [290, 1870, 2800, 3250, 3540],
      db: [0, -15, -18, -20, -30],
      bw: [40, 90, 100, 120, 120],
    },
    o: {
      freq: [400, 800, 2600, 2800, 3000],
      db: [0, -10, -12, -12, -26],
      bw: [40, 80, 100, 120, 120],
    },
    u: {
      freq: [350, 600, 2700, 2900, 3300],
      db: [0, -20, -17, -14, -26],
      bw: [40, 60, 100, 120, 120],
    },
  },
};

const registerOf = (freq: number) => (freq < 220 ? "tenor" : freq < 440 ? "alto" : "soprano");

export type ChoirOptions = {
  /** Chord frequencies in Hz, one sung part each. */
  readonly freqs: readonly number[];
  /** Gate in seconds. */
  readonly length: number;
  /** Default "a" ("ah"). */
  readonly vowel?: Vowel;
  /** Vowel reached at the end of the gate (default: `vowel` throughout). */
  readonly vowelTo?: Vowel;
  /** Singers per part, default 3. */
  readonly singers?: number;
  /** Spread of the singers' tuning in cents, default 9. */
  readonly detune?: number;
  /** Vibrato depth in cents, default 14. */
  readonly vibrato?: number;
  /** Aspiration noise 0..1, default 0.12. */
  readonly breath?: number;
  /** 0..1, default 0.4: the slope of the source (a pressed, bright voice vs a soft, covered one). */
  readonly brightness?: number;
  /** Seconds, defaults 0.9 and 1.6. */
  readonly attack?: number;
  readonly release?: number;
  /** Stereo spread of the singers 0..1, default 0.7. */
  readonly width?: number;
};

/** The five resonators of the tract at morph position `m` (0 = `from`, 1 = `to`). */
type Tract = { readonly freq: number[]; readonly q: number[]; readonly amp: number[] };

const tractAt = (
  table: Record<Vowel, Formants>,
  from: Vowel,
  to: Vowel,
  m: number,
  scale: number,
  f0: number,
): Tract => {
  const tract: Tract = { freq: [], q: [], amp: [] };
  for (let k = 0; k < 5; k++) {
    const fa = table[from].freq[k];
    const fb = table[to].freq[k];
    let f = fa * Math.pow(fb / fa, m) * scale;
    // Formant tuning: singers open the jaw so the first formant stays above a high fundamental,
    // and the second keeps clear of the first.
    if (k === 0) {
      f = Math.max(f, f0 * 1.12);
    } else if (k === 1) {
      f = Math.max(f, tract.freq[0] * 1.35);
    }
    const bw = table[from].bw[k] + (table[to].bw[k] - table[from].bw[k]) * m;
    const db = table[from].db[k] + (table[to].db[k] - table[from].db[k]) * m;
    tract.freq.push(f);
    tract.q.push(f / bw);
    tract.amp.push(Math.pow(10, db / 20));
  }
  return tract;
};

/**
 * Power of the tract output for a saw at `f0` through the source tilt: the sum over harmonics of
 * the source spectrum times the resonators' combined response (analog band-pass prototypes).
 */
const tractPower = (tract: Tract, f0: number, tiltHz: number): number => {
  let p = 0;
  for (let h = 1; h * f0 < 8000; h++) {
    const f = h * f0;
    let re = 0;
    let im = 0;
    for (let k = 0; k < 5; k++) {
      const x = f / tract.freq[k];
      const a = 1 - x * x;
      const b = x / tract.q[k];
      // (j b) / (a + j b)
      const d = a * a + b * b;
      re += (tract.amp[k] * (b * b)) / d;
      im += (tract.amp[k] * (b * a)) / d;
    }
    const src = (2 / (Math.PI * h)) ** 2 / (1 + (f / tiltHz) ** 2);
    p += 0.5 * src * (re * re + im * im);
  }
  return p;
};

type Singer = {
  phase: number;
  readonly ratio: number;
  readonly vibRate: number;
  vibPhase: number;
  readonly vibDelay: number;
  readonly drift: Drift;
  readonly gl: number;
  readonly gr: number;
};

export const choir = (o: ChoirOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const rng = new Rng(env.seed);
  const e = adsr(
    {
      attack: o.attack ?? 0.9,
      decay: 0.5,
      sustain: 1,
      release: o.release ?? 1.6,
      attackCurve: -0.8,
      releaseCurve: 3,
    },
    o.length,
    sr,
  );
  const n = e.length;
  const gateN = Math.max(1, Math.round(o.length * sr));
  const count = Math.max(1, Math.round(o.singers ?? 3));
  const detune = o.detune ?? 9;
  const vibrato = o.vibrato ?? 14;
  const breath = o.breath ?? 0.12;
  const width = o.width ?? 0.7;
  const bright = clamp(o.brightness ?? 0.4, 0, 1);
  const from = o.vowel ?? "a";
  const to = o.vowelTo ?? from;
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const partL = new Float32Array(n);
  const partR = new Float32Array(n);
  o.freqs.forEach((freq, j) => {
    const table = TABLES[registerOf(freq)];
    const singers: Singer[] = Array.from({ length: count }, (_, v) => {
      const x = count === 1 ? 0 : (v / (count - 1)) * 2 - 1;
      const [pl, pr] = panGains(clamp(x * width + (rng.next() - 0.5) * 0.2, -1, 1));
      return {
        phase: rng.next(),
        ratio: Math.pow(2, ((x + (rng.next() - 0.5) * 0.5) * detune) / 1200),
        vibRate: 4.7 + 1 * rng.next(),
        vibPhase: rng.next(),
        vibDelay: 0.25 + 0.4 * rng.next(),
        drift: new Drift(env.seed + j * 131 + v * 17, 0.7, sr),
        gl: pl,
        gr: pr,
      };
    });
    const tiltHz = 300 + 2400 * bright * bright;
    const tilt = [new OnePole(sr, tiltHz), new OnePole(sr, tiltHz)];
    const noise = new WhiteNoise(env.seed + j * 7 + 1);
    const breathHp = new Biquad("highpass", sr, 1400, 0.7);
    // Same loudness in every register and vowel: a harmonic that lands on a narrow formant would
    // otherwise make one part 10 dB louder than its neighbour.
    const power =
      [0, 0.5, 1].reduce(
        (acc, m) => acc + tractPower(tractAt(table, from, to, m, 1, freq), freq, tiltHz),
        0,
      ) / 3;
    const gain = 0.3 / Math.sqrt(Math.max(1e-9, power));
    partL.fill(0);
    partR.fill(0);
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let sl = 0;
      let sR = 0;
      let open = 0;
      for (const s of singers) {
        const vibEnv = clamp((t - s.vibDelay) / 0.6, 0, 1);
        const cents = vibrato * vibEnv * Math.sin(2 * Math.PI * s.vibPhase) + 5 * s.drift.next();
        s.vibPhase += s.vibRate / sr;
        const dt = (freq * s.ratio * Math.pow(2, cents / 1200)) / sr;
        const y = 2 * s.phase - 1 - polyBlep(s.phase, dt);
        open += 0.5 - 0.5 * Math.cos(2 * Math.PI * s.phase);
        s.phase += dt;
        if (s.phase >= 1) {
          s.phase -= 1;
        }
        sl += y * s.gl;
        sR += y * s.gr;
      }
      const b = breathHp.process(noise.next()) * (open / count) * breath * 1.5;
      partL[i] = (tilt[0].process(sl) + b) / Math.sqrt(count);
      partR[i] = (tilt[1].process(sR) + b) / Math.sqrt(count);
    }
    [partL, partR].forEach((part, c) => {
      const scale = c === 0 ? 0.985 : 1.015;
      const bank = [0, 1, 2, 3, 4].map(() => new Biquad("bandpass", sr, 500, 5));
      let amps: readonly number[] = [];
      const dst = c === 0 ? l : r;
      for (let i = 0; i < n; i++) {
        if (i % 32 === 0) {
          const x = Math.min(1, i / gateN);
          const m = 0.5 - 0.5 * Math.cos(Math.PI * x);
          const tract = tractAt(table, from, to, m, scale, freq);
          for (let k = 0; k < 5; k++) {
            bank[k].set(tract.freq[k], tract.q[k]);
          }
          amps = tract.amp;
        }
        const v = part[i];
        let y = 0;
        for (let k = 0; k < 5; k++) {
          y += bank[k].process(v) * amps[k];
        }
        dst[i] += y * gain * e[i];
      }
    });
  });
  return { l, r };
};
