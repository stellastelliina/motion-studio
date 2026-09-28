/** __TITLE__ camera: per-scene motion blur and post, plus the global finish. */

import {
  createLookResolver,
  type Look as FrameworkLook,
  type SceneLook as FrameworkSceneLook,
} from "@/framework/video/look";
import { storyboard } from "./timeline";

export type HudMode = "none";
export type Look = FrameworkLook<HudMode>;
export type SceneLook = FrameworkSceneLook<HudMode>;

export const createVideoLook = (looks: Readonly<Record<string, SceneLook | undefined>>) =>
  createLookResolver<HudMode>({
    storyboard,
    looks,
    base: { samples: 1, shutter: 180, effects: [], hud: "none", grain: 0.05 },
    // List here the scenes that mount a LensThreeCanvas: motion blur is forced off on them.
    webgl: [],
  });
