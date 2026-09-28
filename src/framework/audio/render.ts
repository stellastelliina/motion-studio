/**
 * Offline renderer: plan the score, render voices into buses, process buses and send effects,
 * master. Deterministic: same score, same samples.
 */

import {
  cloneStereo,
  createStereo,
  dbToGain,
  firstInvalid,
  mixInto,
  scale,
  type Stereo,
} from "./core";
import { master, type MasterStats } from "./master";
import { processBus, renderEffect, renderVoices } from "./mixer";
import { planScore, type BusConfig, type Mark, type Score } from "./score";

export type RenderOptions = {
  /** Keep post-fader bus outputs and effect returns, scaled to the master gain. */
  readonly stems?: boolean;
};

export type RenderResult = {
  readonly id: string;
  readonly sampleRate: number;
  readonly frames: number;
  readonly output: Stereo;
  readonly stats: MasterStats;
  readonly stems: ReadonlyMap<string, Stereo>;
  readonly marks: readonly Mark[];
  /** True digital silences, in seconds. */
  readonly silences: readonly { readonly from: number; readonly to: number }[];
};

export const renderScore = <B extends string, E extends string>(
  score: Score<B, E>,
  options: RenderOptions = {},
): RenderResult => {
  const plan = planScore(score);
  const busConfigs = score.buses as Record<string, BusConfig<string>>;
  const busNames = Object.keys(busConfigs);
  const { buses, keys } = renderVoices(plan, busNames);
  for (const name of busNames) {
    processBus(name, buses.get(name) as Stereo, busConfigs[name], plan, keys);
  }
  const returns = new Map<string, Stereo>();
  for (const [name, cfg] of Object.entries(score.effects ?? {})) {
    returns.set(name, renderEffect(name, cfg as never, buses, busConfigs, plan));
  }
  const mix = createStereo(plan.frames);
  for (const [name, s] of [
    ...buses,
    ...[...returns].map(([k, v]) => [`effect ${k}`, v] as const),
  ]) {
    const bad = firstInvalid(s);
    if (bad >= 0) {
      throw new Error(`NaN or Infinity in ${name} at ${(bad / plan.sampleRate).toFixed(4)} s`);
    }
    mixInto(mix, s, 0);
  }
  const { output, stats } = master(mix, score.master ?? {}, plan);
  const stems = new Map<string, Stereo>();
  if (options.stems) {
    const g = dbToGain(stats.gain);
    for (const [name, s] of [...buses, ...[...returns].map(([k, v]) => [`fx-${k}`, v] as const)]) {
      const copy = cloneStereo(s);
      scale(copy, g);
      stems.set(name, copy);
    }
  }
  return {
    id: score.id ?? "score",
    sampleRate: plan.sampleRate,
    frames: plan.frames,
    output,
    stats,
    stems,
    marks: plan.marks,
    silences: plan.silences.map((r) => ({
      from: r.from / plan.sampleRate,
      to: r.to / plan.sampleRate,
    })),
  };
};
