/**
 * Piano voice: modal synthesis, one bank of decaying phasors per note.
 *
 * Every partial sits at f_n = n f1 sqrt((1 + B n^2) / (1 + B)): the string stiffness B grows toward
 * the treble, so high partials run sharp. Each partial is a unison of 1-3 slightly mistuned strings
 * (the prompt sound, fast decay) plus a quieter, slowly decaying pair (the aftersound): their sum
 * beats and decays in two stages, like strings coupled at the bridge. Partial levels come from the
 * hammer: a comb from the striking point (about 1/8 of the string), a low-pass whose corner rises
 * with velocity (harder is brighter, not only louder) and a gentle tilt; losses grow with frequency,
 * so the tone darkens as it rings and bass notes last far longer than treble ones.
 *
 * Around the strings: a filtered noise knock and a body thump at the strike, a static soundboard
 * EQ, a damper that closes the note at the end of the gate without a click (keys above E6 have no
 * damper, as on a real piano) and a soft damper noise. String detunings belong to the key, not to
 * the trigger: the same note always beats the same way; only the noises change from hit to hit.
 *
 * The treble, above A4, gets the two flaws that keep a real top octave from sounding like a sine
 * bank. False beats: a string's horizontal polarization rings a little off its vertical one where
 * the termination is not rigid (bridge pins), so the aftersound pulses at a rate of its own; almost
 * every piano has them in the high treble (McMorrow, PTG 2022). And the knock: the hammer head on
 * its flexible shank has a mode near 260 Hz, heard as part of the attack from about A4 up
 * (Conklin, "Piano design factors").
 *
 * Timbres: `grand` (concert grand, bright and long) and `felt` (a felt strip between hammers and
 * strings, the upright sound of intimate film and corporate cues: dark, soft, shorter, with more
 * mechanical noise).
 */

import { clamp, cosRamp, type Stereo } from "../core";
import { Biquad, type FilterSpec } from "../filters";
import { Rng, hashSeed } from "../random";
import { addBurst, addPartial, applyDamper } from "./modal";
import type { VoiceEnv } from "./types";

export type PianoTimbre = "grand" | "felt";

export type PianoOptions = {
  /** Hz. */
  readonly freq: number;
  /** Seconds the key is held: the damper falls at the end (hold it longer for a pedal). */
  readonly length: number;
  /** 0..1, default 0.6: louder and brighter. */
  readonly velocity?: number;
  /** Default "grand". */
  readonly timbre?: PianoTimbre;
  /** Octaves added to (or removed from) the hammer corner, default 0. */
  readonly brightness?: number;
  /** Scales every string decay time, default 1. */
  readonly decay?: number;
  /** Scales the knock, thump and damper noises of the timbre, default 1 (0 = strings only). */
  readonly mechanics?: number;
  /** Stereo image 0..1, default 0.6: keyboard spread (low left) and string decorrelation. */
  readonly width?: number;
  /** Scales the unison mistuning, default 1 (0 = no beating). */
  readonly detune?: number;
  /** Upper bound of the rendered buffer in seconds (the score passes the time left). */
  readonly maxLength?: number;
};

type Preset = {
  /** Hammer low-pass corner in Hz for C4 at velocity 0.6. */
  readonly hammer: number;
  /** Roll-off order above the corner: 1 is 6 dB/oct. */
  readonly slope: number;
  /** Octaves the corner moves from velocity 0 to 1. */
  readonly velocityTone: number;
  /** Amplitude tilt below the corner: n^-tilt. */
  readonly tilt: number;
  /** Floor of the striking-point zeros: a wide hammer fills them in. */
  readonly combFloor: number;
  /** Seconds at velocity 0.6. */
  readonly attack: number;
  /** Scales the decay times. */
  readonly decay: number;
  /** Aftersound level relative to the partial. */
  readonly after: number;
  /** Prompt sound decay rate over aftersound decay rate. */
  readonly prompt: number;
  /** Unison mistuning in cents (outer strings). */
  readonly unison: number;
  /** Soundboard radiation corner in Hz: bass fundamentals radiate poorly. */
  readonly radiation: number;
  readonly knock: number;
  readonly knockFreq: number;
  readonly knockTime: number;
  readonly thump: number;
  readonly thumpFreq: number;
  readonly thumpTime: number;
  /** Seconds between the strike and the keybed thump. */
  readonly thumpDelay: number;
  readonly damperNoise: number;
  /** False-beat rate of the fundamental in Hz at the top of the keyboard. */
  readonly falseBeat: number;
  /** Level of the hammer-shank knock at C7. */
  readonly shank: number;
  readonly body: readonly FilterSpec[];
};

const PRESETS: Record<PianoTimbre, Preset> = {
  grand: {
    hammer: 1400,
    slope: 1.5,
    velocityTone: 2.4,
    tilt: 0.45,
    combFloor: 0.08,
    attack: 0.0012,
    decay: 1,
    after: 0.2,
    prompt: 3.2,
    unison: 0.35,
    radiation: 85,
    knock: 0.09,
    knockFreq: 2600,
    knockTime: 0.003,
    thump: 0.07,
    thumpFreq: 110,
    thumpTime: 0.022,
    thumpDelay: 0,
    damperNoise: 0.012,
    falseBeat: 1.6,
    shank: 0.07,
    body: [
      { type: "peaking", freq: 105, q: 0.9, gain: 2 },
      { type: "peaking", freq: 420, q: 0.8, gain: -1.5 },
      { type: "peaking", freq: 3000, q: 0.8, gain: 1.5 },
    ],
  },
  felt: {
    hammer: 560,
    slope: 2.2,
    velocityTone: 1.6,
    tilt: 0.65,
    combFloor: 0.18,
    attack: 0.005,
    decay: 0.72,
    after: 0.26,
    prompt: 3,
    unison: 0.7,
    radiation: 105,
    knock: 0.05,
    knockFreq: 1100,
    knockTime: 0.007,
    thump: 0.16,
    thumpFreq: 170,
    thumpTime: 0.03,
    thumpDelay: 0.004,
    damperNoise: 0.045,
    falseBeat: 1.3,
    shank: 0.05,
    body: [
      { type: "peaking", freq: 170, q: 0.8, gain: 2.5 },
      { type: "peaking", freq: 750, q: 1, gain: -1.5 },
      { type: "highshelf", freq: 3500, q: 0.7, gain: -5 },
    ],
  },
};

/** First key without a damper (E6), as on a concert grand. */
const NO_DAMPER_KEY = 88;
/** First key of the treble flaws (A4): false beats and the hammer-shank knock. */
const TREBLE_KEY = 69;
const SHANK_FREQ = 260;
const MAX_PARTIALS = 90;

export const piano = (o: PianoOptions, env: VoiceEnv): Stereo => {
  const sr = env.sampleRate;
  const timbre = o.timbre ?? "grand";
  const p = PRESETS[timbre];
  const v = clamp(o.velocity ?? 0.6, 0.01, 1);
  const key = 69 + 12 * Math.log2(o.freq / 440);
  const width = clamp(o.width ?? 0.6, 0, 1);
  const decayScale = p.decay * (o.decay ?? 1);
  const mechanics = o.mechanics ?? 1;
  // The instrument: everything that belongs to the key, identical on every strike.
  const inst = new Rng(hashSeed("piano", timbre, Math.round(key * 100)));

  const strings = key < 29 ? 1 : key < 43 ? 2 : 3;
  const stiffness = Math.pow(
    10,
    -3.55 + (key >= 48 ? 0.027 * (key - 60) : -0.324 + 0.01 * (48 - key)),
  );
  // Mild Railsback stretch: the treble a little sharp, the bass a little flat.
  const stretch = key >= 64 ? 0.02 * Math.pow(key - 64, 1.6) : -0.012 * Math.pow(64 - key, 1.6);
  const f1 = o.freq * Math.pow(2, stretch / 1200);
  const strike = clamp(0.125 - 0.0009 * (key - 60), 1 / 12, 1 / 6.5);
  const corner =
    p.hammer *
    Math.pow(2, (key - 60) / 20) *
    Math.pow(2, p.velocityTone * (v - 0.6)) *
    Math.pow(2, o.brightness ?? 0);
  // T60 of the fundamental's aftersound: about 37 s at D2, 24 s at C4, 8 s at A5, 1.8 s at C8.
  // With the prompt ratio, a C4 falls about 8 dB/s at first and 2.5 dB/s after (Weinreich).
  const t60 = 24 * decayScale * Math.pow(2, -(key - 60) / (key > 60 ? 13 : 34));
  const baseLoss = 60 / t60;
  // The prompt sound falls several times faster than the aftersound, less so in the treble.
  const promptRatio = 1 + (p.prompt - 1) * clamp(1.2 - (key - 40) / 60, 0.5, 1.2);

  const damped = key < NO_DAMPER_KEY;
  const gateN = Math.max(1, Math.round(o.length * sr));
  const damperT60 =
    clamp(0.35 * Math.pow(2, -(key - 60) / 30), 0.12, 1) * (timbre === "felt" ? 1.1 : 1);
  const naturalN = Math.round(t60 * 1.1 * sr);
  const releaseN = damped ? gateN + Math.round(damperT60 * 1.4 * sr) : naturalN;
  const n = Math.max(
    Math.round(0.05 * sr),
    Math.min(Math.round((o.maxLength ?? 30) * sr), naturalN, releaseN),
  );

  // Partial levels: striking-point comb, hammer low-pass, tilt, soundboard radiation.
  const top = Math.min(0.45 * sr, 18000);
  const freqs: number[] = [];
  const amps: number[] = [];
  let power = 0;
  for (let h = 1; h <= MAX_PARTIALS; h++) {
    const f = h * f1 * Math.sqrt((1 + stiffness * h * h) / (1 + stiffness));
    if (f > top) {
      break;
    }
    const comb = Math.hypot(Math.sin(h * Math.PI * strike), p.combFloor);
    const hammer = 1 / Math.sqrt(1 + Math.pow(f / corner, 2 * p.slope));
    const radiation = f / Math.hypot(f, p.radiation);
    const a = comb * hammer * radiation * Math.pow(h, -p.tilt);
    freqs.push(f);
    amps.push(a);
    power += a * a;
  }
  const norm = 1 / Math.sqrt(power);

  const acc = { l: new Float64Array(n), r: new Float64Array(n) };
  const pan = (x: number) => {
    const a = clamp(x * width, -0.95, 0.95);
    return [Math.sqrt(1 - a), Math.sqrt(1 + a)] as const;
  };
  const unison = p.unison * (o.detune ?? 1);
  const stringDetune = Array.from({ length: strings }, (_, s) =>
    strings === 1 ? 0 : ((s / (strings - 1)) * 2 - 1) * unison * (0.6 + 0.8 * inst.next()),
  );
  const center = stringDetune.reduce((sum, d) => sum + d, 0) / strings;
  // False beats, a property of the key (own generator: the lower keys keep their tuning draws).
  const treble = clamp((key - TREBLE_KEY) / (96 - TREBLE_KEY), 0, 1.3);
  const falseHz =
    treble > 0
      ? p.falseBeat *
        treble *
        (0.5 + new Rng(hashSeed("piano-false", timbre, Math.round(key * 100))).next())
      : 0;
  const falseCents = 1200 * Math.log2(1 + falseHz / f1);
  const cents = (c: number) => Math.pow(2, c / 1200);
  for (let h = 0; h < freqs.length; h++) {
    const a = amps[h] * norm;
    const fk = freqs[h] / 1000;
    const jitter = 0.85 + 0.3 * inst.next();
    // Air and internal friction: losses in dB/s grow with frequency, the tone darkens as it rings.
    const afterLoss = (baseLoss + (fk + 2.5 * fk * fk) / decayScale) * jitter;
    const promptLoss = afterLoss * promptRatio;
    for (let s = 0; s < strings; s++) {
      const d = stringDetune[s] + 0.15 * unison * inst.bipolar();
      const [gl, gr] = pan(strings === 1 ? 0 : ((s / (strings - 1)) * 2 - 1) * 0.6);
      addPartial(acc.l, acc.r, freqs[h] * cents(d), promptLoss, a / strings, gl, gr, n, sr);
    }
    // Two unequal aftersound modes: they beat slowly without ever cancelling out.
    for (const side of [-1, 1]) {
      const d =
        center + side * (0.25 * Math.max(0.3, unison) * (0.5 + inst.next()) + falseCents / 2);
      const [gl, gr] = pan(side * 0.7);
      const share = side < 0 ? 0.62 : 0.38;
      addPartial(acc.l, acc.r, freqs[h] * cents(d), afterLoss, a * p.after * share, gl, gr, n, sr);
    }
  }

  // Hammer contact: harder strikes are shorter.
  const attackN = Math.max(1, Math.round(p.attack * Math.pow(2, 1.5 * (0.6 - v)) * sr));
  for (let i = 0; i < Math.min(attackN, n); i++) {
    const g = cosRamp((i + 1) / attackN);
    acc.l[i] *= g;
    acc.r[i] *= g;
  }

  // Damper: the felt stops the strings at the end of the gate, high partials first.
  if (damped && gateN < n) {
    applyDamper([acc.l, acc.r], gateN, damperT60, Math.max(2.5 * f1, 300), sr);
    addBurst(
      acc.l,
      acc.r,
      env.seed + 17,
      gateN,
      420,
      0.6,
      0.035,
      p.damperNoise * mechanics * (0.5 + 0.5 * v),
      sr,
    );
  }

  // Strike noises: the hammer knock (brighter in the treble) and the keybed thump.
  const hit = mechanics * Math.pow(v, 1.3);
  addBurst(acc.l, acc.r, env.seed + 5, 0, SHANK_FREQ, 4, 0.012, p.shank * hit * treble, sr);
  addBurst(
    acc.l,
    acc.r,
    env.seed + 3,
    0,
    Math.min(0.4 * sr, p.knockFreq * Math.pow(2, (key - 60) / 36)),
    0.9,
    p.knockTime,
    p.knock * hit * Math.pow(2, (key - 60) / 30),
    sr,
  );
  addBurst(
    acc.l,
    acc.r,
    env.seed + 7,
    Math.round(p.thumpDelay * sr),
    p.thumpFreq,
    1.1,
    p.thumpTime,
    p.thump * hit,
    sr,
  );

  // Soundboard EQ, keyboard panning, velocity loudness, and an exact zero at the end.
  const l = new Float32Array(n);
  const r = new Float32Array(n);
  const eqs = [0, 1].map(() => p.body.map((b) => new Biquad(b.type, sr, b.freq, b.q, b.gain)));
  const [kl, kr] = pan(clamp((key - 64) / 36, -1, 1) * 0.5);
  const gain = 0.3 * Math.pow(v, 1.7);
  const fadeN = Math.min(n, Math.round(0.005 * sr));
  for (let i = 0; i < n; i++) {
    let yl = acc.l[i];
    let yr = acc.r[i];
    for (const f of eqs[0]) {
      yl = f.process(yl);
    }
    for (const f of eqs[1]) {
      yr = f.process(yr);
    }
    const tail = i >= n - fadeN ? (n - 1 - i) / Math.max(1, fadeN - 1) : 1;
    l[i] = yl * kl * gain * tail;
    r[i] = yr * kr * gain * tail;
  }
  return { l, r };
};
