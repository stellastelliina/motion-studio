/**
 * Spring presets on top of Remotion's physical spring.
 */

import { spring, type SpringConfig } from "remotion";

export const springs = {
  /** Fast with a hint of overshoot: type and UI. */
  snappy: { damping: 16, mass: 0.5, stiffness: 240 },
  /** Visible overshoot, one or two wobbles. */
  bouncy: { damping: 9, mass: 0.6, stiffness: 180 },
  /** No overshoot, smooth arrival. */
  smooth: { damping: 200, mass: 1, stiffness: 120 },
  /** Loose jelly for secondary motion. */
  wobbly: { damping: 5, mass: 0.8, stiffness: 120 },
} satisfies Record<string, Partial<SpringConfig>>;

/** Spring going 0 to 1 from frame `start`; 0 before it. */
export const springAt = (
  frame: number,
  fps: number,
  start: number,
  config: Partial<SpringConfig> = springs.snappy,
  durationInFrames?: number,
) => (frame < start ? 0 : spring({ frame: frame - start, fps, config, durationInFrames }));
