/**
 * Per-frame camera settings of a video: motion blur, post chain, grain and HUD mode.
 * Scenes contribute through a `look(localFrame)` export; the video merges the contribution of
 * the scene on screen with its global finish. WebGL scenes force motion blur off while they are
 * mounted (lead and tail included), because every blur sample would clone their GL context.
 */

import type { EffectDescriptor } from "remotion";
import type { Storyboard } from "@/framework/time/storyboard";

export type Look<Hud extends string = string> = {
  /** Motion blur samples, 1 = off. */
  readonly samples: number;
  /** Shutter angle in degrees. */
  readonly shutter: number;
  /** WebGL post effects (applied by the Lens on single-sample frames only). */
  readonly effects: readonly EffectDescriptor<unknown>[];
  readonly hud: Hud;
  /** Film grain strength (0-1), drawn by the Lens. */
  readonly grain: number;
};

export type SceneLook<Hud extends string = string> = (localFrame: number) => Partial<Look<Hud>>;

type ResolverOptions<Hud extends string> = {
  readonly storyboard: Storyboard;
  readonly looks: Readonly<Record<string, SceneLook<Hud> | undefined>>;
  readonly base: Look<Hud>;
  /** Scenes that mount a WebGL canvas. */
  readonly webgl?: readonly string[];
  /** Global finish appended after the scene's own effects (e.g. one aberration hit). */
  readonly finish?: (frame: number) => readonly EffectDescriptor<unknown>[];
};

export const createLookResolver = <Hud extends string>({
  storyboard,
  looks,
  base,
  webgl = [],
  finish,
}: ResolverOptions<Hud>) => {
  const mounted = (frame: number, id: string) => {
    const s = storyboard.scene(id);
    return frame >= s.from - s.lead && frame < s.from + s.durationInFrames + s.tail;
  };

  return (frame: number): Look<Hud> => {
    const f = Math.floor(frame);
    const active =
      [...storyboard.scenes].reverse().find((s) => f >= s.from) ?? storyboard.scenes[0];
    const own = looks[active.id]?.(f - active.from) ?? {};
    const look: Look<Hud> = { ...base, ...own };
    const samples = webgl.some((id) => mounted(f, id)) ? 1 : look.samples;
    return { ...look, samples, effects: [...look.effects, ...(finish?.(f) ?? [])] };
  };
};
