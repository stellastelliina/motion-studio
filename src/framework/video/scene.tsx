/**
 * Scene clock: places a scene of a storyboard on the video timeline and gives it a local clock
 * aligned with the musical grid. The same scene component renders inside the full video
 * (<SceneSlot>) and standalone in Studio (scenePreview), with identical timing.
 */

import { createContext, useContext } from "react";
import { Sequence, useCurrentFrame } from "remotion";
import type { Grid } from "@/framework/time/grid";
import type { SceneTiming, Storyboard } from "@/framework/time/storyboard";

type SceneContextValue = {
  readonly timing: SceneTiming;
  readonly storyboard: Storyboard;
};

const SceneContext = createContext<SceneContextValue | null>(null);

export const SceneSlot: React.FC<{
  readonly storyboard: Storyboard;
  readonly id: string;
  readonly children: React.ReactNode;
}> = ({ storyboard, id, children }) => {
  const timing = storyboard.scene(id);
  return (
    <Sequence
      name={timing.title}
      from={timing.from - timing.lead}
      durationInFrames={timing.lead + timing.durationInFrames + timing.tail}
    >
      <SceneContext.Provider value={{ timing, storyboard }}>{children}</SceneContext.Provider>
    </Sequence>
  );
};

export type SceneClock = {
  /** Local frame: 0 on the scene downbeat, negative during the lead. May be fractional. */
  readonly frame: number;
  /** Frame on the whole video timeline. */
  readonly videoFrame: number;
  readonly timing: SceneTiming;
  readonly grid: Grid;
  /** Nominal length in frames (lead and tail excluded). */
  readonly duration: number;
  /** Local frame of a beat counted from the scene downbeat. */
  readonly beat: (b: number) => number;
  /** Local frame of an absolute video beat (e.g. a cue from cues.ts). */
  readonly at: (videoBeat: number) => number;
  /** Exact fractional local frame of a video beat, for continuous math (physics, curves). */
  readonly atExact: (videoBeat: number) => number;
  /** Fractional beat position inside the scene. */
  readonly beatPos: number;
};

export const useScene = (): SceneClock => {
  const ctx = useContext(SceneContext);
  const raw = useCurrentFrame();
  if (!ctx) {
    throw new Error("useScene() must run inside <SceneSlot> or a scene preview");
  }
  const { timing, storyboard } = ctx;
  const { grid } = storyboard;
  const frame = raw - timing.lead;
  const videoFrame = timing.from + frame;
  return {
    frame,
    videoFrame,
    timing,
    grid,
    duration: timing.durationInFrames,
    beat: (b) => grid.beat(timing.startBeat + b) - timing.from,
    at: (videoBeat) => grid.beat(videoBeat) - timing.from,
    atExact: (videoBeat) => grid.beatExact(videoBeat) - timing.from,
    beatPos: grid.beatAt(videoFrame) - timing.startBeat,
  };
};

/** Wraps a scene component so it can be registered as its own Studio composition. */
export const scenePreview = (
  storyboard: Storyboard,
  id: string,
  Component: React.FC,
): { id: string; component: React.FC; durationInFrames: number } => {
  const timing = storyboard.scene(id);
  const Preview: React.FC = () => (
    <SceneContext.Provider value={{ timing, storyboard }}>
      <Component />
    </SceneContext.Provider>
  );
  Preview.displayName = `ScenePreview(${id})`;
  return {
    id,
    component: Preview,
    durationInFrames: timing.lead + timing.durationInFrames + timing.tail,
  };
};
