/**
 * Master chain: subsonic high-pass, normalization to a -20 LUFS reference, glue compression,
 * subtle saturation, silences, then a loudness search around a true-peak lookahead limiter,
 * safety fades and 24-bit quantization.
 */

import { cloneStereo, dbToGain, fade, gainToDb, scale, type Stereo } from "./core";
import { compress, limit, limiterDetect } from "./dynamics";
import { saturateStereo } from "./effects";
import { filterStereo } from "./filters";
import { dcOffset, loudnessMeter, samplePeak, truePeak } from "./meter";
import type { MasterConfig, Plan } from "./score";
import { quantize24 } from "./wav";

export type MasterStats = {
  /** LUFS. */
  readonly integrated: number;
  readonly momentaryMax: number;
  readonly shortTermMax: number;
  /** Loudness range, LU. */
  readonly loudnessRange: number;
  /** dBTP. */
  readonly truePeak: number;
  /** dBFS. */
  readonly samplePeak: number;
  /** Largest limiter gain reduction in dB. */
  readonly limiterReduction: number;
  /** Largest glue compressor gain reduction in dB. */
  readonly glueReduction: number;
  /** Total linear gain applied to the mix before the limiter, in dB. */
  readonly gain: number;
  readonly dc: readonly [number, number];
  readonly iterations: number;
};

const REFERENCE_LUFS = -20;
/** Headroom under the true-peak ceiling: estimators differ by about 0.1 dB (ffmpeg upsamples to 192 kHz). */
const TP_MARGIN = 0.3;

const applySilences = (s: Stereo, plan: Plan): void => {
  const fadeN = Math.round(0.001 * plan.sampleRate);
  for (const { from, to } of plan.silences) {
    for (let k = 0; k < fadeN; k++) {
      const i = from - fadeN + k;
      if (i >= 0) {
        const g = 1 - (k + 1) / fadeN;
        s.l[i] *= g;
        s.r[i] *= g;
      }
    }
    s.l.fill(0, from, to);
    s.r.fill(0, from, to);
  }
};

export const master = (
  mix: Stereo,
  cfg: MasterConfig,
  plan: Plan,
): { readonly output: Stereo; readonly stats: MasterStats } => {
  const sr = plan.sampleRate;
  const n = mix.l.length;
  const target = cfg.targetLufs ?? -14;
  const ceiling = cfg.ceiling ?? -1;
  filterStereo(mix, { type: "highpass", freq: cfg.lowCut ?? 22, q: 0.707 }, sr);
  if (cfg.highCut) {
    filterStereo(mix, { type: "lowpass", freq: cfg.highCut, q: 0.707 }, sr);
  }

  const raw = loudnessMeter(mix, sr).integrated();
  if (!Number.isFinite(raw)) {
    throw new Error("The mix is silent: nothing to master");
  }
  const refGain = REFERENCE_LUFS - raw;
  scale(mix, dbToGain(refGain));
  const glue = cfg.glue ? compress(mix, cfg.glue, sr) : { maxReduction: 0, meanReduction: 0 };
  if (cfg.drive) {
    saturateStereo(mix, cfg.drive);
  }
  applySilences(mix, plan);

  const detection = limiterDetect(mix, true);
  const fadeIn = Math.round(((cfg.fadeIn ?? 5) / 1000) * sr);
  const fadeOut = Math.round(((cfg.fadeOut ?? 100) / 1000) * sr);
  const finish = (s: Stereo) => {
    fade(s, 0, fadeIn, "in");
    fade(s, n - fadeOut, fadeOut, "out", true);
  };
  let gainDb = target - loudnessMeter(mix, sr).integrated();
  let out = mix;
  let reduction = 0;
  let iterations = 0;
  for (; iterations < 8; iterations++) {
    out = cloneStereo(mix);
    reduction = limit(
      out,
      { ceiling: ceiling - TP_MARGIN, lookahead: 1.5, release: cfg.release ?? 80 },
      sr,
      detection,
      dbToGain(gainDb),
    ).maxReduction;
    finish(out);
    const measured = loudnessMeter(out, sr).integrated();
    if (Math.abs(target - measured) < 0.02) {
      break;
    }
    gainDb += target - measured;
  }

  let tp = gainToDb(truePeak(out));
  if (tp > ceiling - TP_MARGIN / 2) {
    scale(out, dbToGain(ceiling - TP_MARGIN / 2 - tp));
  }
  quantize24(out);
  tp = gainToDb(truePeak(out));
  const meter = loudnessMeter(out, sr);
  return {
    output: out,
    stats: {
      integrated: meter.integrated(),
      momentaryMax: meter.momentaryMax(),
      shortTermMax: meter.shortTermMax(),
      loudnessRange: meter.loudnessRange(),
      truePeak: tp,
      samplePeak: gainToDb(samplePeak(out)),
      limiterReduction: reduction,
      glueReduction: glue.maxReduction,
      gain: refGain + gainDb,
      dc: dcOffset(out),
      iterations: iterations + 1,
    },
  };
};
