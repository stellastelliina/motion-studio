/**
 * Storyboard: the ordered list of scenes of a video, positioned on the musical grid.
 * Nominal scene ranges must tile the timeline with no gaps and no overlaps; visual overlaps for
 * transitions are expressed with `lead` (rendered before the nominal start, under the previous
 * scene) and `tail` (kept alive after the nominal end, under the next scene).
 *
 * Pure module: shared by compositions and by the audio score.
 */

import type { Grid } from "./grid";

export type SceneInput = {
  readonly id: string;
  readonly title: string;
  /** Start in beats, 0-based. */
  readonly start: number;
  /** Length in beats. */
  readonly length: number;
  /** Frames rendered before the nominal start. */
  readonly lead?: number;
  /** Frames rendered after the nominal end. */
  readonly tail?: number;
};

export type SceneTiming = {
  readonly id: string;
  readonly title: string;
  readonly index: number;
  readonly startBeat: number;
  readonly lengthBeats: number;
  /** Nominal first frame on the video timeline. */
  readonly from: number;
  /** Nominal length in frames. */
  readonly durationInFrames: number;
  readonly lead: number;
  readonly tail: number;
};

export type Storyboard = {
  readonly grid: Grid;
  readonly scenes: readonly SceneTiming[];
  readonly durationInFrames: number;
  readonly scene: (id: string) => SceneTiming;
};

export const defineStoryboard = (grid: Grid, inputs: readonly SceneInput[]): Storyboard => {
  if (inputs.length === 0) {
    throw new Error("A storyboard needs at least one scene");
  }
  const scenes = inputs.map((s, index): SceneTiming => {
    const from = grid.beat(s.start);
    return {
      id: s.id,
      title: s.title,
      index,
      startBeat: s.start,
      lengthBeats: s.length,
      from,
      durationInFrames: grid.beat(s.start + s.length) - from,
      lead: s.lead ?? 0,
      tail: s.tail ?? 0,
    };
  });

  scenes.forEach((s, i) => {
    if (s.durationInFrames <= 0) {
      throw new Error(`Scene "${s.id}" has no frames`);
    }
    if (i === 0 && s.startBeat !== 0) {
      throw new Error(`First scene "${s.id}" must start at beat 0`);
    }
    const prev = scenes[i - 1];
    if (prev && prev.startBeat + prev.lengthBeats !== s.startBeat) {
      throw new Error(`Scenes "${prev.id}" and "${s.id}" leave a gap or overlap on the grid`);
    }
    if (s.from - s.lead < 0) {
      throw new Error(`Scene "${s.id}" lead starts before frame 0`);
    }
  });

  const ids = new Set(scenes.map((s) => s.id));
  if (ids.size !== scenes.length) {
    throw new Error("Scene ids must be unique");
  }

  const last = scenes[scenes.length - 1];
  const durationInFrames = last.from + last.durationInFrames;
  const byId = new Map(scenes.map((s) => [s.id, s]));

  return {
    grid,
    scenes,
    durationInFrames,
    scene: (id) => {
      const s = byId.get(id);
      if (!s) {
        throw new Error(`Unknown scene "${id}"`);
      }
      return s;
    },
  };
};
