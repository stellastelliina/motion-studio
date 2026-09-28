/**
 * Score API: a declarative description of a soundtrack on the musical grid.
 *
 *   export default defineScore({
 *     durationSec: 15, grid,
 *     buses: { drums: { gain: -3, sends: { room: -18 } }, sfx: {} },
 *     effects: { room: { type: "reverb", decay: 0.8, size: 0.4 } },
 *     build: (s) => {
 *       s.pattern("x... x... x... x...", { from: 4, step: 0.25 }, (h) => s.kick(h.beat));
 *       s.impact(cues.drop, { bus: "sfx" });
 *     },
 *   });
 *
 * Positions and lengths are in beats (the grid converts them), sound design parameters are in
 * seconds, Hz and dB. `build` only schedules events; `renderScore` renders them.
 */

import type { Grid } from "@/framework/time/grid";
import type { Stereo } from "./core";
import type { CompressorOptions } from "./dynamics";
import type { PingPongOptions } from "./effects";
import type { FilterSpec } from "./filters";
import type { StutterOptions } from "./glitch";
import { hz, type NoteInput } from "./notes";
import { expandPattern, type PatternHit } from "./pattern";
import { hashSeed } from "./random";
import type { ReverbOptions } from "./reverb";
import type { AnalogPadOptions, AnalogPluckOptions } from "./voices/analog";
import type { ReeseOptions, SubOptions } from "./voices/bass";
import type { BellOptions, FmOptions } from "./voices/fm";
import type { MarimbaOptions, VibraphoneOptions } from "./voices/mallets";
import type { PianoOptions } from "./voices/piano";
import type {
  ClapOptions,
  HatOptions,
  KickOptions,
  RimOptions,
  ShakerOptions,
  SnareOptions,
} from "./voices/drums";
import type {
  CrashOptions,
  ImpactOptions,
  ReverseSwellOptions,
  RiserOptions,
  TickOptions,
  WhooshOptions,
} from "./voices/sfx";
import type {
  BlipOptions,
  DroneOptions,
  PluckOptions,
  SupersawOptions,
  SynthOptions,
} from "./voices/synth";
import type { VoiceEnv } from "./voices/types";
import type { ChoirOptions } from "./voices/vocal";
import * as analog from "./voices/analog";
import * as bass from "./voices/bass";
import * as drums from "./voices/drums";
import * as fmVoices from "./voices/fm";
import * as mallets from "./voices/mallets";
import * as pianoVoice from "./voices/piano";
import * as sfx from "./voices/sfx";
import * as synthVoices from "./voices/synth";
import * as vocal from "./voices/vocal";

export type SidechainOptions = {
  /** Key channel name ("kick" is fed by every kick). */
  readonly key: string;
  /** Ducking depth in dB. */
  readonly depth: number;
  /** Milliseconds, default 2. */
  readonly attack?: number;
  /** Milliseconds, default 150. */
  readonly release?: number;
  /** Key level where ducking starts, dBFS, default -26. */
  readonly threshold?: number;
};

export type BusConfig<E extends string> = {
  /** Fader in dB. */
  readonly gain?: number;
  readonly pan?: number;
  /** Mid/side width, 1 = unchanged. */
  readonly width?: number;
  /** Side signal high-passed below this frequency: mono low end. */
  readonly monoBelow?: number;
  readonly eq?: readonly FilterSpec[];
  /** tanh drive on the bus. */
  readonly drive?: number;
  readonly compressor?: CompressorOptions;
  readonly sidechain?: SidechainOptions;
  /** Post-fader send levels in dB, by effect name. */
  readonly sends?: Partial<Record<E, number>>;
};

export type EffectConfig =
  | ({ readonly type: "reverb"; readonly return?: number } & ReverbOptions)
  | ({ readonly type: "delay"; readonly return?: number } & PingPongOptions);

export type MasterConfig = {
  /** Integrated loudness target, LUFS. Default -14. */
  readonly targetLufs?: number;
  /** True-peak ceiling in dBTP. Default -1. */
  readonly ceiling?: number;
  /** Glue compressor; thresholds refer to the mix pre-normalized to -20 LUFS. */
  readonly glue?: CompressorOptions | null;
  /** Subtle tanh saturation drive, 0 = off. */
  readonly drive?: number;
  /** High-pass in Hz against subsonic energy. Default 22. */
  readonly lowCut?: number;
  /** Gentle low-pass in Hz that smooths the extreme top (off by default). */
  readonly highCut?: number;
  /** Milliseconds. Default 5. */
  readonly fadeIn?: number;
  /** Milliseconds, ends in exact digital silence. Default 100. */
  readonly fadeOut?: number;
  /** Limiter release in ms. Default 80. */
  readonly release?: number;
};

export type Pitch = NoteInput | { readonly hz: number };

export const pitchHz = (p: Pitch): number => (typeof p === "object" ? p.hz : hz(p));

export type Place<B extends string> = {
  /** Destination bus; defaults to the family bus: drums, bass, music or sfx. */
  readonly bus?: B;
  /** Level in dB. */
  readonly gain?: number;
  /** -1 left .. 1 right. */
  readonly pan?: number;
  /** Salt for the noise seed: another variation of the same hit. */
  readonly seed?: number | string;
  /** Also feed this voice into a sidechain key channel (kicks feed "kick" by default). */
  readonly key?: string;
};

type Tonal = { readonly note: Pitch };
type Gate = { readonly length: number };
type PianoPlay = Omit<PianoOptions, "freq" | "length" | "maxLength">;
type MarimbaPlay = Omit<MarimbaOptions, "freq" | "maxLength">;
type VibesPlay = Omit<VibraphoneOptions, "freq" | "length" | "maxLength" | "clock"> & {
  /** Beats the pedal is held after the stroke (default: the bar rings out). */
  length?: number;
};

export type ScoreContext<B extends string, E extends string> = {
  readonly sampleRate: number;
  readonly frames: number;
  readonly grid: Grid;
  /** Beat to seconds. */
  readonly t: (beat: number) => number;
  /** Beat to sample index. */
  readonly sample: (beat: number) => number;

  readonly kick: (at: number, o?: KickOptions & Place<B>) => void;
  /** A tuned drum: the kick generator pitched to `note`. */
  readonly tom: (at: number, o: KickOptions & Place<B> & Tonal) => void;
  readonly clap: (at: number, o?: ClapOptions & Place<B>) => void;
  readonly snare: (at: number, o?: SnareOptions & Place<B>) => void;
  readonly hat: (at: number, o?: HatOptions & Place<B>) => void;
  readonly shaker: (at: number, o?: ShakerOptions & Place<B>) => void;
  /** Soft rimshot (cross-stick). */
  readonly rim: (at: number, o?: RimOptions & Place<B>) => void;

  /** `length` in beats; `glideFrom` pitch glides into the note. */
  readonly sub: (
    at: number,
    o: Omit<SubOptions, "freq" | "length" | "glideFrom"> &
      Place<B> &
      Tonal &
      Gate & { glideFrom?: Pitch },
  ) => void;
  readonly reese: (
    at: number,
    o: Omit<ReeseOptions, "freq" | "length" | "glideFrom"> &
      Place<B> &
      Tonal &
      Gate & { glideFrom?: Pitch },
  ) => void;

  /** Supersaw chord stab, `length` in beats (default 1/4). */
  readonly stab: (
    at: number,
    o: Omit<SupersawOptions, "freqs" | "length"> &
      Place<B> & { notes: readonly Pitch[]; length?: number },
  ) => void;
  /** Supersaw pad held from `from` to `to` (beats), release after. */
  readonly pad: (
    from: number,
    to: number,
    o: Omit<SupersawOptions, "freqs" | "length"> & Place<B> & { notes: readonly Pitch[] },
  ) => void;
  readonly pluck: (at: number, o: Omit<PluckOptions, "freq"> & Place<B> & Tonal) => void;
  readonly blip: (at: number, o: Omit<BlipOptions, "freq"> & Place<B> & Tonal) => void;
  /** Mono synth, `length` in beats; `to` bends the pitch across the gate. */
  readonly synth: (
    at: number,
    o: Omit<SynthOptions, "freq" | "freqTo" | "length"> & Place<B> & Tonal & Gate & { to?: Pitch },
  ) => void;
  readonly drone: (
    from: number,
    to: number,
    o: Omit<DroneOptions, "freq" | "length"> & Place<B> & Tonal,
  ) => void;
  /** Warm analog pad held from `from` to `to` (beats), release after. */
  readonly analogPad: (
    from: number,
    to: number,
    o: Omit<AnalogPadOptions, "freqs" | "length"> & Place<B> & { notes: readonly Pitch[] },
  ) => void;
  /** Filtered analog pluck; `length` in beats is an optional gate (default: it rings out). */
  readonly analogPluck: (
    at: number,
    o: Omit<AnalogPluckOptions, "freq" | "length"> & Place<B> & Tonal & { length?: number },
  ) => void;
  /** FM note (up to four operators); `length` in beats is the gate (default: it rings out). */
  readonly fm: (
    at: number,
    o: Omit<FmOptions, "freq" | "length" | "maxLength"> & Place<B> & Tonal & { length?: number },
  ) => void;
  /** FM bell or glass strike, rings out. */
  readonly bell: (
    at: number,
    o: Omit<BellOptions, "freq" | "maxLength"> & Place<B> & Tonal,
  ) => void;
  /** Wordless choir held from `from` to `to` (beats); the vowel can morph across the gate. */
  readonly choir: (
    from: number,
    to: number,
    o: Omit<ChoirOptions, "freqs" | "length"> & Place<B> & { notes: readonly Pitch[] },
  ) => void;
  /** Piano note; `length` in beats is how long the key is held (extend it to pedal). */
  readonly piano: (at: number, o: PianoPlay & Place<B> & Tonal & Gate) => void;
  /** Piano chord; `roll` spreads the notes in seconds, low to high (negative: high to low). */
  readonly pianoChord: (
    at: number,
    o: PianoPlay & Place<B> & Gate & { notes: readonly Pitch[]; roll?: number },
  ) => void;

  /** Marimba stroke: no damper, the bar rings out. */
  readonly marimba: (at: number, o: MarimbaPlay & Place<B> & Tonal) => void;
  /** Vibraphone stroke; `length` in beats is the pedal, `motor` the tremolo rate in Hz. */
  readonly vibes: (at: number, o: VibesPlay & Place<B> & Tonal) => void;

  readonly tick: (at: number, o?: Omit<TickOptions, "freq"> & Place<B> & { note?: Pitch }) => void;
  readonly whoosh: (from: number, to: number, o?: Omit<WhooshOptions, "length"> & Place<B>) => void;
  readonly riser: (from: number, to: number, o?: Omit<RiserOptions, "length"> & Place<B>) => void;
  readonly crash: (at: number, o?: CrashOptions & Place<B>) => void;
  /** Reverse-reverb rise ending exactly at `to`; `length` in beats. */
  readonly reverseSwell: (
    to: number,
    o: Omit<ReverseSwellOptions, "length" | "freqs"> &
      Place<B> & { length: number; notes?: readonly Pitch[] },
  ) => void;
  readonly impact: (at: number, o?: ImpactOptions & Place<B>) => void;
  /** Custom voice: `render` returns a buffer that starts at `at`. */
  readonly voice: (
    at: number,
    render: (env: VoiceEnv) => Stereo,
    o: Place<B> & { bus: B; kind?: string },
  ) => void;

  /** Repeats the first `slice` beats of the region on these buses (after their inserts). */
  readonly stutter: (
    from: number,
    to: number,
    o: Omit<StutterOptions, "slice" | "minSlice" | "fade"> & {
      buses: readonly B[];
      slice: number;
      minSlice?: number;
    },
  ) => void;
  /** Filter automation on a bus: [beat, Hz] points, exponential in between, bypassed outside. */
  readonly sweep: (
    bus: B,
    points: readonly (readonly [number, number])[],
    o?: { type?: "lowpass" | "highpass"; q?: number },
  ) => void;
  /** Fader automation on a bus: [beat, dB] points, linear in dB, held outside. */
  readonly volume: (bus: B, points: readonly (readonly [number, number])[]) => void;
  /**
   * Ducks a bus under speech: `depth` dB down during every span (beats), fading in over `attack`
   * beats before it and back over `release` beats after it. Spans closer than attack + release
   * merge, so the bus stays down through short breaths instead of pumping. Composes with
   * `volume` (gains multiply).
   */
  readonly duck: (
    bus: B,
    spans: readonly { readonly start: number; readonly end: number }[],
    o: { depth: number; attack?: number; release?: number },
  ) => void;
  /** Hard cut: every sounding voice stops at `at` (except on `keep` buses) and effect tails die. */
  readonly cut: (at: number, o?: { keep?: readonly B[]; fade?: number }) => void;
  /** Cut plus true digital silence on the master from `from` to `to`. */
  readonly silence: (from: number, to: number) => void;
  /** Effects dry from `from` to `to`: tails killed at `from`, no sends until `to`. */
  readonly dry: (from: number, to: number, o?: { effects?: readonly E[] }) => void;

  /** Expands a step pattern (see pattern.ts) and calls `fn` per hit. */
  readonly pattern: (
    steps: string,
    at: { from: number; step: number },
    fn: (hit: PatternHit) => void,
  ) => void;
  /** Names a moment that must carry an onset, for verification (optionally on one bus). */
  readonly mark: (label: string, beat: number, bus?: B) => void;
};

export type ScoreDefinition<B extends string, E extends string> = {
  readonly id?: string;
  /** Default 48000. */
  readonly sampleRate?: number;
  readonly durationSec: number;
  readonly grid: Grid;
  readonly seed?: number;
  readonly buses: Record<B, BusConfig<E>>;
  readonly effects?: Record<E, EffectConfig>;
  readonly master?: MasterConfig;
  readonly build: (s: ScoreContext<B, E>) => void;
};

export type Score<B extends string = string, E extends string = string> = ScoreDefinition<B, E> & {
  readonly kind: "score";
};

export const defineScore = <B extends string, E extends string = never>(
  def: ScoreDefinition<B, E>,
): Score<B, E> => ({ ...def, kind: "score" });

export const isScore = (x: unknown): x is Score =>
  typeof x === "object" && x !== null && (x as { kind?: unknown }).kind === "score";

export type VoiceEvent = {
  readonly kind: string;
  readonly bus: string;
  /** Sample index of the buffer start. */
  readonly start: number;
  /** Linear gain. */
  readonly gain: number;
  readonly pan: number;
  readonly key?: string;
  readonly seed: number;
  readonly render: (env: VoiceEnv) => Stereo;
};

export type CutEvent = {
  readonly at: number;
  readonly keep: readonly string[];
  readonly fade: number;
};
export type RangeEvent = { readonly from: number; readonly to: number };
export type DryEvent = RangeEvent & { readonly effects: readonly string[] | null };
export type StutterEvent = RangeEvent & {
  readonly buses: readonly string[];
  readonly options: StutterOptions;
};
export type SweepEvent = {
  readonly bus: string;
  readonly type: "lowpass" | "highpass";
  readonly q: number;
  readonly points: readonly (readonly [number, number])[];
};
export type VolumeEvent = {
  readonly bus: string;
  readonly points: readonly (readonly [number, number])[];
};
export type Mark = { readonly label: string; readonly time: number; readonly bus?: string };

export type Plan = {
  readonly sampleRate: number;
  readonly frames: number;
  readonly voices: VoiceEvent[];
  readonly cuts: CutEvent[];
  readonly silences: RangeEvent[];
  readonly dries: DryEvent[];
  readonly stutters: StutterEvent[];
  readonly sweeps: SweepEvent[];
  readonly volumes: VolumeEvent[];
  readonly marks: Mark[];
};

const FAMILY: Record<string, string> = {
  kick: "drums",
  tom: "drums",
  clap: "drums",
  snare: "drums",
  hat: "drums",
  shaker: "drums",
  rim: "drums",
  sub: "bass",
  reese: "bass",
  stab: "music",
  pad: "music",
  pluck: "music",
  synth: "music",
  drone: "music",
  piano: "music",
  marimba: "music",
  vibes: "music",
  analogPad: "music",
  analogPluck: "music",
  fm: "music",
  bell: "music",
  choir: "music",
  blip: "sfx",
  tick: "sfx",
  whoosh: "sfx",
  riser: "sfx",
  crash: "sfx",
  reverseSwell: "sfx",
  impact: "sfx",
};

/** Runs `build` and collects every scheduled event. */
export const planScore = <B extends string, E extends string>(score: Score<B, E>): Plan => {
  const sr = score.sampleRate ?? 48000;
  const frames = Math.round(score.durationSec * sr);
  const grid = score.grid;
  const busNames = new Set(Object.keys(score.buses));
  const effectNames = new Set(Object.keys(score.effects ?? {}));
  const plan: Plan = {
    sampleRate: sr,
    frames,
    voices: [],
    cuts: [],
    silences: [],
    dries: [],
    stutters: [],
    sweeps: [],
    volumes: [],
    marks: [],
  };
  const sample = (beat: number) => Math.round(grid.seconds(beat) * sr);
  const secs = (from: number, to: number) => grid.seconds(to) - grid.seconds(from);
  const occupancy = new Map<string, number>();
  const checkBus = (bus: string, what: string) => {
    if (!busNames.has(bus)) {
      throw new Error(`${what}: unknown bus "${bus}" (buses: ${[...busNames].join(", ")})`);
    }
    return bus;
  };

  const schedule = (
    kind: string,
    start: number,
    p: Place<B>,
    render: (env: VoiceEnv) => Stereo,
    key?: string,
  ) => {
    const bus = checkBus(p.bus ?? FAMILY[kind] ?? "sfx", kind);
    const slot = `${kind}@${start}`;
    const dup = occupancy.get(slot) ?? 0;
    occupancy.set(slot, dup + 1);
    plan.voices.push({
      kind,
      bus,
      start,
      gain: Math.pow(10, (p.gain ?? 0) / 20),
      pan: p.pan ?? 0,
      key: p.key ?? key,
      seed: hashSeed(score.seed ?? 0, kind, start, dup, p.seed ?? 0),
      render,
    });
  };

  const playPiano = (start: number, length: number, freq: number, o: PianoPlay & Place<B>) => {
    const opts = { ...o, freq, length, maxLength: (frames - start) / sr };
    schedule("piano", start, o, (env) => pianoVoice.piano(opts, env));
  };

  const s: ScoreContext<B, E> = {
    sampleRate: sr,
    frames,
    grid,
    t: (beat) => grid.seconds(beat),
    sample,
    kick: (at, o = {}) => schedule("kick", sample(at), o, (env) => drums.kick(o, env), "kick"),
    tom: (at, o) => {
      const tune = pitchHz(o.note);
      const opts = {
        punch: tune * 2.4,
        sweep: 0.02,
        decay: 0.32,
        click: 0.4,
        drive: 1.3,
        ...o,
        tune,
      };
      schedule("tom", sample(at), o, (env) => drums.kick(opts, env));
    },
    clap: (at, o = {}) => schedule("clap", sample(at), o, (env) => drums.clap(o, env)),
    snare: (at, o = {}) => schedule("snare", sample(at), o, (env) => drums.snare(o, env)),
    hat: (at, o = {}) => schedule("hat", sample(at), o, (env) => drums.hat(o, env)),
    shaker: (at, o = {}) => schedule("shaker", sample(at), o, (env) => drums.shaker(o, env)),
    rim: (at, o = {}) => schedule("rim", sample(at), o, (env) => drums.rim(o, env)),
    sub: (at, o) => {
      const opts = {
        ...o,
        freq: pitchHz(o.note),
        length: secs(at, at + o.length),
        glideFrom: o.glideFrom === undefined ? undefined : pitchHz(o.glideFrom),
      };
      schedule("sub", sample(at), o, (env) => bass.sub(opts, env));
    },
    reese: (at, o) => {
      const opts = {
        ...o,
        freq: pitchHz(o.note),
        length: secs(at, at + o.length),
        glideFrom: o.glideFrom === undefined ? undefined : pitchHz(o.glideFrom),
      };
      schedule("reese", sample(at), o, (env) => bass.reese(opts, env));
    },
    stab: (at, o) => {
      const opts = { ...o, freqs: o.notes.map(pitchHz), length: secs(at, at + (o.length ?? 0.25)) };
      schedule("stab", sample(at), o, (env) => synthVoices.supersaw(opts, env));
    },
    pad: (from, to, o) => {
      const opts = {
        attack: 0.35,
        decay: 0.5,
        sustain: 0.85,
        release: 0.8,
        cutoff: 1800,
        ...o,
        freqs: o.notes.map(pitchHz),
        length: secs(from, to),
      };
      schedule("pad", sample(from), o, (env) => synthVoices.supersaw(opts, env));
    },
    pluck: (at, o) => {
      const opts = { ...o, freq: pitchHz(o.note) };
      schedule("pluck", sample(at), o, (env) => synthVoices.pluck(opts, env));
    },
    blip: (at, o) => {
      const opts = { ...o, freq: pitchHz(o.note) };
      schedule("blip", sample(at), o, (env) => synthVoices.blip(opts, env));
    },
    synth: (at, o) => {
      const opts = {
        ...o,
        freq: pitchHz(o.note),
        freqTo: o.to === undefined ? undefined : pitchHz(o.to),
        length: secs(at, at + o.length),
      };
      schedule("synth", sample(at), o, (env) => synthVoices.synth(opts, env));
    },
    drone: (from, to, o) => {
      const opts = { ...o, freq: pitchHz(o.note), length: secs(from, to) };
      schedule("drone", sample(from), o, (env) => synthVoices.drone(opts, env));
    },
    analogPad: (from, to, o) => {
      const opts = { ...o, freqs: o.notes.map(pitchHz), length: secs(from, to) };
      schedule("analogPad", sample(from), o, (env) => analog.analogPad(opts, env));
    },
    analogPluck: (at, o) => {
      const opts = {
        ...o,
        freq: pitchHz(o.note),
        length: o.length === undefined ? undefined : secs(at, at + o.length),
      };
      schedule("analogPluck", sample(at), o, (env) => analog.analogPluck(opts, env));
    },
    fm: (at, o) => {
      const start = sample(at);
      const opts = {
        ...o,
        freq: pitchHz(o.note),
        length: o.length === undefined ? undefined : secs(at, at + o.length),
        maxLength: (frames - start) / sr,
      };
      schedule("fm", start, o, (env) => fmVoices.fm(opts, env));
    },
    bell: (at, o) => {
      const start = sample(at);
      const opts = { ...o, freq: pitchHz(o.note), maxLength: (frames - start) / sr };
      schedule("bell", start, o, (env) => fmVoices.bell(opts, env));
    },
    choir: (from, to, o) => {
      const opts = { ...o, freqs: o.notes.map(pitchHz), length: secs(from, to) };
      schedule("choir", sample(from), o, (env) => vocal.choir(opts, env));
    },
    piano: (at, o) => playPiano(sample(at), secs(at, at + o.length), pitchHz(o.note), o),
    pianoChord: (at, o) => {
      const freqs = o.notes.map(pitchHz).sort((a, b) => a - b);
      const roll = o.roll ?? 0;
      const length = secs(at, at + o.length);
      freqs.forEach((freq, i) => {
        const step = roll >= 0 ? i : freqs.length - 1 - i;
        const start = sample(at) + Math.round(step * Math.abs(roll) * sr);
        playPiano(start, length - (start - sample(at)) / sr, freq, o);
      });
    },
    marimba: (at, o) => {
      const start = sample(at);
      const opts = { ...o, freq: pitchHz(o.note), maxLength: (frames - start) / sr };
      schedule("marimba", start, o, (env) => mallets.marimba(opts, env));
    },
    vibes: (at, o) => {
      const start = sample(at);
      const opts = {
        ...o,
        freq: pitchHz(o.note),
        length: o.length === undefined ? undefined : secs(at, at + o.length),
        clock: start / sr,
        maxLength: (frames - start) / sr,
      };
      schedule("vibes", start, o, (env) => mallets.vibraphone(opts, env));
    },
    tick: (at, o = {}) => {
      const opts = { ...o, freq: o.note === undefined ? undefined : pitchHz(o.note) };
      schedule("tick", sample(at), o, (env) => sfx.tick(opts, env));
    },
    whoosh: (from, to, o = {}) => {
      const opts = { ...o, length: secs(from, to) };
      schedule("whoosh", sample(from), o, (env) => sfx.whoosh(opts, env));
    },
    riser: (from, to, o = {}) => {
      const opts = { ...o, length: secs(from, to) };
      schedule("riser", sample(from), o, (env) => sfx.riser(opts, env));
    },
    crash: (at, o = {}) => schedule("crash", sample(at), o, (env) => sfx.crash(o, env)),
    reverseSwell: (to, o) => {
      const from = to - o.length;
      const opts = { ...o, length: secs(from, to), freqs: o.notes?.map(pitchHz) };
      schedule("reverseSwell", sample(from), o, (env) => sfx.reverseSwell(opts, env));
    },
    impact: (at, o = {}) => schedule("impact", sample(at), o, (env) => sfx.impact(o, env)),
    voice: (at, render, o) => schedule(o.kind ?? "voice", sample(at), o, render),
    stutter: (from, to, o) => {
      o.buses.forEach((b) => checkBus(b, "stutter"));
      const beatSamples = grid.secondsPerBeat * sr;
      plan.stutters.push({
        from: sample(from),
        to: sample(to),
        buses: [...o.buses],
        options: {
          ...o,
          slice: Math.round(o.slice * beatSamples),
          minSlice: Math.round((o.minSlice ?? o.slice / 8) * beatSamples),
          fade: Math.round(0.0015 * sr),
        },
      });
    },
    sweep: (bus, points, o = {}) => {
      plan.sweeps.push({
        bus: checkBus(bus, "sweep"),
        type: o.type ?? "lowpass",
        q: o.q ?? 0.707,
        points: points.map(([b, f]) => [sample(b), f] as const),
      });
    },
    volume: (bus, points) => {
      plan.volumes.push({
        bus: checkBus(bus, "volume"),
        points: points.map(([b, d]) => [sample(b), d] as const),
      });
    },
    duck: (bus, spans, o) => {
      const attack = o.attack ?? 0.25;
      const release = o.release ?? 0.5;
      const merged: { start: number; end: number }[] = [];
      for (const span of [...spans].sort((x, y) => x.start - y.start)) {
        const last = merged[merged.length - 1];
        if (last && span.start - attack <= last.end + release) {
          last.end = Math.max(last.end, span.end);
        } else {
          merged.push({ start: span.start, end: span.end });
        }
      }
      if (merged.length === 0) {
        return;
      }
      const points = merged.flatMap(({ start, end }) => [
        [sample(start - attack), 0] as const,
        [sample(start), -o.depth] as const,
        [sample(end), -o.depth] as const,
        [sample(end + release), 0] as const,
      ]);
      plan.volumes.push({ bus: checkBus(bus, "duck"), points });
    },
    cut: (at, o = {}) => {
      (o.keep ?? []).forEach((b) => checkBus(b, "cut"));
      plan.cuts.push({
        at: sample(at),
        keep: [...(o.keep ?? [])],
        fade: Math.round(((o.fade ?? 2) / 1000) * sr),
      });
    },
    silence: (from, to) => {
      plan.cuts.push({ at: sample(from), keep: [], fade: Math.round(0.001 * sr) });
      plan.silences.push({ from: sample(from), to: sample(to) });
    },
    dry: (from, to, o = {}) => {
      (o.effects ?? []).forEach((e) => {
        if (!effectNames.has(e)) {
          throw new Error(`dry: unknown effect "${e}"`);
        }
      });
      plan.dries.push({
        from: sample(from),
        to: sample(to),
        effects: o.effects ? [...o.effects] : null,
      });
    },
    pattern: (steps, at, fn) => expandPattern(steps, at.from, at.step).forEach(fn),
    mark: (label, beat, bus) => {
      plan.marks.push({
        label,
        time: sample(beat) / sr,
        bus: bus === undefined ? undefined : checkBus(bus, "mark"),
      });
    },
  };

  score.build(s);
  return plan;
};
