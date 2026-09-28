/**
 * Procedural audio engine: deterministic, dependency-free, offline. Pure TypeScript (no DOM, no
 * Node APIs). Author a score with `defineScore`, render it with `renderScore`, encode with
 * `encodeWav`. `pnpm audio` renders every `src/videos/<id>/score.ts`.
 */

export * from "./core";
export { findOnset, peakDbIn, type OnsetMatch } from "./analysis";
export { compress, limit, type CompressorOptions, type LimiterOptions } from "./dynamics";
export { PingPongDelay, bitcrush, haas, saturate, saturateStereo, widen } from "./effects";
export { adsr, curve, percEnv, swell } from "./envelope";
export {
  Biquad,
  LowPass24,
  OnePole,
  Smoother,
  Svf,
  type SvfMode,
  filterStereo,
  type BiquadType,
  type FilterSpec,
} from "./filters";
export { stutter, type StutterOptions } from "./glitch";
export { dcOffset, integratedLoudness, loudnessMeter, samplePeak, truePeak } from "./meter";
export { chord, hz, invert, midi, mtof, shepard, transpose, type NoteInput } from "./notes";
export { Drift, Oscillator, PinkNoise, WhiteNoise, type Waveform } from "./osc";
export { beatRange, expandPattern, type PatternHit } from "./pattern";
export { Rng, hashSeed } from "./random";
export { renderScore, type RenderOptions, type RenderResult } from "./render";
export { Reverb, type ReverbOptions } from "./reverb";
export {
  defineScore,
  isScore,
  pitchHz,
  type BusConfig,
  type EffectConfig,
  type MasterConfig,
  type Pitch,
  type Place,
  type Score,
  type ScoreContext,
} from "./score";
export type { MasterStats } from "./master";
export {
  analogPad,
  analogPluck,
  type AnalogPadOptions,
  type AnalogPluckOptions,
} from "./voices/analog";
export { rim, shaker, type RimOptions, type ShakerOptions } from "./voices/drums";
export {
  bell,
  fm,
  type BellOptions,
  type FmOperator,
  type FmOptions,
  type FmRoute,
} from "./voices/fm";
export {
  marimba,
  vibraphone,
  type MalletHardness,
  type MarimbaOptions,
  type VibraphoneOptions,
} from "./voices/mallets";
export { piano, type PianoOptions, type PianoTimbre } from "./voices/piano";
export { choir, type ChoirOptions, type Vowel } from "./voices/vocal";
export { encodeWav, type WavFormat } from "./wav";
